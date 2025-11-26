import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import CanvasBoard from '@/components/whiteboard/CanvasBoard';

// 1. Change type to Promise
type Props = {
  params: Promise<{ roomId: string }>
}

export default async function BoardPage({ params }: Props) {
  const supabase = await createClient(); 
  const { data: { user } } = await supabase.auth.getUser();
  
  if (!user) {
    redirect('/');
  }

  // 2. Await the params before using them
  const { roomId } = await params;

  return (
    <CanvasBoard roomId={roomId} userId={user.id} />
  );
}