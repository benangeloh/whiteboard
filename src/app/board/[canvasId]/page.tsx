import { createClient } from '@/lib/supabase/server';
import { redirect, notFound } from 'next/navigation';
import CanvasBoard from '@/components/whiteboard/CanvasBoard';
import { PermissionLevel } from '@/types/database';

type Props = {
  params: Promise<{ canvasId: string }>
}

export default async function BoardPage({ params }: Props) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    redirect('/');
  }

  const { canvasId } = await params;

  // Get user profile for display name and avatar
  const { data: profile } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', user.id)
    .single();

  const { data: canvas, error } = await supabase
    .from('canvases')
    .select('id, title, owner_id, is_public')
    .eq('id', canvasId)
    .single();

  if (error || !canvas) {
    notFound();
  }

  let permission: PermissionLevel = 'viewer';
  const canvasTitle = canvas.title;

  if (canvas.owner_id === user.id) {
    permission = 'owner';
  } else {
    const { data: share } = await supabase
      .from('canvas_shares')
      .select('permission')
      .eq('canvas_id', canvasId)
      .or(`user_id.eq.${user.id},email.eq.${user.email}`)
      .single();

    if (share) {
      permission = share.permission;
    } else if (canvas.is_public) {
      permission = 'viewer';
    } else {
      redirect('/dashboard?error=access_denied');
    }
  }

  const canEdit = permission === 'owner' || permission === 'editor';

  return (
    <CanvasBoard
      canvasId={canvasId}
      userId={user.id}
      userProfile={{
        displayName: profile?.display_name || user.email?.split('@')[0] || 'User',
        avatarUrl: profile?.avatar_url,
        email: profile?.email || user.email || '',
      }}
      permission={permission}
      canEdit={canEdit}
      canvasTitle={canvasTitle}
    />
  );
}
