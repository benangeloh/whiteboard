'use client';
import { createClient } from '@/lib/supabase/client';
import { useRouter } from 'next/navigation';

export default function Home() {
  const supabase = createClient();
  const router = useRouter();

  const handleLogin = async () => {
    // Anonymous login for demo speed. 
    // Change to signInWithOAuth or signInWithOtp for real auth
    const { error } = await supabase.auth.signInAnonymously();
    if (!error) {
      // Create a random room or go to a default one
      router.push('/board/room-1');
    }
  };

  return (   
    <div className="h-screen flex items-center justify-center bg-slate-100">
      <div className="p-8 bg-white rounded-lg shadow-md">
        <h1 className="text-2xl font-bold mb-4">Collab Whiteboard</h1>
        <button 
          onClick={handleLogin}
          className="bg-black text-white px-4 py-2 rounded hover:bg-gray-800"
        >
          Start Drawing
        </button>
      </div>
    </div>
  );
}