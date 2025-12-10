import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import DashboardContent from '@/components/dashboard/DashboardContent';

export default async function DashboardPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  
  if (!user) {
    redirect('/');
  }

  // Fetch user profile
  const { data: profile } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', user.id)
    .single();

  // Fetch user's own canvases
  const { data: myCanvases } = await supabase
    .from('canvases')
    .select(`
      *,
      owner:profiles!owner_id(id, display_name, avatar_url),
      shares:canvas_shares(id)
    `)
    .eq('owner_id', user.id)
    .order('updated_at', { ascending: false });

  // Fetch canvases shared with user
  const { data: sharedWithMe } = await supabase
    .from('canvas_shares')
    .select(`
      permission,
      canvas:canvases(
        *,
        owner:profiles!owner_id(id, display_name, avatar_url),
        shares:canvas_shares(id)
      )
    `)
    .eq('user_id', user.id)
    .order('created_at', { ascending: false });

  // Transform shared canvases to match expected format
  const sharedCanvases = sharedWithMe?.map(share => ({
    ...share.canvas,
    permission: share.permission,
  })).filter(Boolean) || [];

  return (
    <DashboardContent
      profile={profile}
      myCanvases={myCanvases || []}
      sharedCanvases={sharedCanvases}
    />
  );
}

