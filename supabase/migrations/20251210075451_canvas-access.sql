CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE IF NOT EXISTS public.profiles (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    email TEXT UNIQUE NOT NULL,
    display_name TEXT,
    avatar_url TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- Profiles policies (drop if exist first to avoid conflicts)
DROP POLICY IF EXISTS "Users can view all profiles" ON public.profiles;
DROP POLICY IF EXISTS "Users can update own profile" ON public.profiles;
DROP POLICY IF EXISTS "Users can insert own profile" ON public.profiles;

CREATE POLICY "Users can view all profiles" ON public.profiles
    FOR SELECT USING (true);

CREATE POLICY "Users can update own profile" ON public.profiles
    FOR UPDATE USING (auth.uid() = id);

CREATE POLICY "Users can insert own profile" ON public.profiles
    FOR INSERT WITH CHECK (auth.uid() = id);

-- Trigger to auto-create profile on user signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO public.profiles (id, email, display_name)
    VALUES (NEW.id, NEW.email, SPLIT_PART(NEW.email, '@', 1));
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

CREATE TABLE IF NOT EXISTS public.canvases (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    title TEXT NOT NULL DEFAULT 'Untitled Canvas',
    description TEXT,
    thumbnail_url TEXT,
    is_public BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.canvases ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
    CREATE TYPE permission_level AS ENUM ('viewer', 'editor', 'owner');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

CREATE TABLE IF NOT EXISTS public.canvas_shares (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    canvas_id UUID NOT NULL REFERENCES public.canvases(id) ON DELETE CASCADE,
    user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
    email TEXT,
    permission permission_level NOT NULL DEFAULT 'viewer',
    share_token TEXT UNIQUE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(canvas_id, user_id),
    UNIQUE(canvas_id, email)
);

ALTER TABLE public.canvas_shares ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_name = 'strokes' AND column_name = 'canvas_id') THEN
        ALTER TABLE public.strokes ADD COLUMN canvas_id UUID REFERENCES public.canvases(id) ON DELETE CASCADE;
    END IF;
END $$;

DROP POLICY IF EXISTS "Canvas owner has full access" ON public.canvases;
DROP POLICY IF EXISTS "Shared users can view canvas" ON public.canvases;

CREATE POLICY "Canvas owner has full access" ON public.canvases
    FOR ALL USING (owner_id = auth.uid());

CREATE POLICY "Shared users can view canvas" ON public.canvases
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM public.canvas_shares
            WHERE canvas_id = canvases.id
            AND (
                user_id = auth.uid()
                OR email = (auth.jwt()->>'email')
            )
        )
        OR is_public = true
    );

DROP POLICY IF EXISTS "Canvas owner can manage shares" ON public.canvas_shares;
DROP POLICY IF EXISTS "Users can view their own shares" ON public.canvas_shares;

CREATE POLICY "Canvas owner can manage shares" ON public.canvas_shares
    FOR ALL USING (
        public.is_canvas_owner(canvas_id)
    );

CREATE POLICY "Users can view their own shares" ON public.canvas_shares
    FOR SELECT USING (
        user_id = auth.uid()
        OR email = (auth.jwt()->>'email')
    );

CREATE INDEX IF NOT EXISTS idx_canvases_owner_id ON public.canvases(owner_id);
CREATE INDEX IF NOT EXISTS idx_canvas_shares_canvas_id ON public.canvas_shares(canvas_id);
CREATE INDEX IF NOT EXISTS idx_canvas_shares_user_id ON public.canvas_shares(user_id);
CREATE INDEX IF NOT EXISTS idx_canvas_shares_email ON public.canvas_shares(email);
CREATE INDEX IF NOT EXISTS idx_strokes_canvas_id ON public.strokes(canvas_id);

CREATE OR REPLACE FUNCTION public.update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;


DROP TRIGGER IF EXISTS update_profiles_updated_at ON public.profiles;
CREATE TRIGGER update_profiles_updated_at
    BEFORE UPDATE ON public.profiles
    FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

DROP TRIGGER IF EXISTS update_canvases_updated_at ON public.canvases;
CREATE TRIGGER update_canvases_updated_at
    BEFORE UPDATE ON public.canvases
    FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

DROP TRIGGER IF EXISTS update_canvas_shares_updated_at ON public.canvas_shares;
CREATE TRIGGER update_canvas_shares_updated_at
    BEFORE UPDATE ON public.canvas_shares
    FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

CREATE OR REPLACE FUNCTION public.is_canvas_owner(canvas_uuid UUID)
RETURNS BOOLEAN AS $$
BEGIN
    RETURN EXISTS (
        SELECT 1 FROM public.canvases c
        WHERE c.id = canvas_uuid
        AND c.owner_id = auth.uid()
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, auth;

CREATE OR REPLACE FUNCTION public.get_canvas_permission(canvas_uuid UUID)
RETURNS permission_level AS $$
DECLARE
    perm permission_level;
BEGIN
    IF EXISTS (SELECT 1 FROM public.canvases WHERE id = canvas_uuid AND owner_id = auth.uid()) THEN
        RETURN 'owner';
    END IF;
    SELECT permission INTO perm FROM public.canvas_shares
    WHERE canvas_id = canvas_uuid
    AND (
        user_id = auth.uid()
        OR email = (auth.jwt()->>'email')
    )
    LIMIT 1;
    RETURN perm;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION public.can_edit_canvas(canvas_uuid UUID)
RETURNS BOOLEAN AS $$
DECLARE
    perm permission_level;
BEGIN
    perm := public.get_canvas_permission(canvas_uuid);
    RETURN perm IN ('editor', 'owner');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Drop existing policies
DROP POLICY IF EXISTS "Enable insert for authenticated users" ON public.strokes;
DROP POLICY IF EXISTS "Enable read access for all users" ON public.strokes;
DROP POLICY IF EXISTS "Enable update for all users" ON public.strokes;

-- New SELECT policy: Allow reading if user has canvas access OR if legacy room-based
CREATE POLICY "Enable read access for all users" ON public.strokes
    FOR SELECT USING (
        canvas_id IS NULL  -- Legacy room-based strokes
        OR EXISTS (
            SELECT 1 FROM public.canvases c
            LEFT JOIN public.canvas_shares cs ON cs.canvas_id = c.id
            WHERE c.id = strokes.canvas_id
            AND (
                c.owner_id = auth.uid()
                OR c.is_public = true
                OR cs.user_id = auth.uid()
            )
        )
    );

-- New INSERT policy: Allow inserting if user has edit access OR if legacy room-based
CREATE POLICY "Enable insert for authenticated users" ON public.strokes
    FOR INSERT WITH CHECK (
        (canvas_id IS NULL AND auth.uid() = user_id)  -- Legacy: authenticated user
        OR EXISTS (
            SELECT 1 FROM public.canvases c
            LEFT JOIN public.canvas_shares cs ON cs.canvas_id = c.id
            WHERE c.id = strokes.canvas_id
            AND (
                c.owner_id = auth.uid()
                OR (cs.user_id = auth.uid() AND cs.permission IN ('editor', 'owner'))
            )
        )
    );

-- New UPDATE policy: Allow updating if user has edit access OR if legacy room-based
CREATE POLICY "Enable update for all users" ON public.strokes
    FOR UPDATE USING (
        canvas_id IS NULL  -- Legacy room-based strokes
        OR EXISTS (
            SELECT 1 FROM public.canvases c
            LEFT JOIN public.canvas_shares cs ON cs.canvas_id = c.id
            WHERE c.id = strokes.canvas_id
            AND (
                c.owner_id = auth.uid()
                OR (cs.user_id = auth.uid() AND cs.permission IN ('editor', 'owner'))
            )
        )
    );

DO $$ BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.canvases;
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.canvas_shares;
EXCEPTION WHEN duplicate_object THEN null;
END $$;