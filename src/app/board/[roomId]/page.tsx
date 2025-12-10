import { createClient } from '@/lib/supabase/server';
import { redirect, notFound } from 'next/navigation';
import CanvasBoard from '@/components/whiteboard/CanvasBoard';
import { PermissionLevel } from '@/types/database';

type Props = {
  params: Promise<{ roomId: string }>
}

export default async function BoardPage({ params }: Props) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    redirect('/');
  }

  const { roomId } = await params;

  // Get user profile for display name and avatar
  const { data: profile } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', user.id)
    .single();

  // Check if this is a UUID (canvas) or a legacy room-id
  const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(roomId);

  let canvasId: string | null = null;
  let permission: PermissionLevel = 'viewer';
  let canvasTitle = 'Canvas';

  if (isUUID) {
    // Try to fetch the canvas
    const { data: canvas, error } = await supabase
      .from('canvases')
      .select('id, title, owner_id, is_public')
      .eq('id', roomId)
      .single();

    if (error || !canvas) {
      notFound();
    }

    canvasId = canvas.id;
    canvasTitle = canvas.title;

    // Check permission
    if (canvas.owner_id === user.id) {
      permission = 'owner';
    } else {
      // Check if user has been shared this canvas
      const { data: share } = await supabase
        .from('canvas_shares')
        .select('permission')
        .eq('canvas_id', roomId)
        .or(`user_id.eq.${user.id},email.eq.${user.email}`)
        .single();

      if (share) {
        permission = share.permission;
      } else if (canvas.is_public) {
        permission = 'viewer';
      } else {
        // No access
        redirect('/dashboard?error=access_denied');
      }
    }
  }

  // For legacy room-based access, allow full edit
  if (!isUUID) {
    permission = 'editor';
  }

  const canEdit = permission === 'owner' || permission === 'editor';

  return (
    <CanvasBoard
      roomId={roomId}
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