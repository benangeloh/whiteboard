'use client';

import { useState, useEffect, useMemo, Suspense } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useRouter, useSearchParams } from 'next/navigation';
import AuthForm from '@/components/auth/AuthForm';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

function HomeContent() {
  const [authMode, setAuthMode] = useState<'login' | 'register'>('login');
  const [checkingAuth, setCheckingAuth] = useState(true);
  const supabase = useMemo(() => createClient(), []);
  const router = useRouter();
  const searchParams = useSearchParams();
  const error = searchParams.get('error');

  useEffect(() => {
    let isMounted = true;

    const checkAuth = async () => {
      const { data } = await supabase.auth.getUser();
      if (!isMounted) return;

      if (data.user) {
        router.replace('/dashboard');
      } else {
        setCheckingAuth(false);
      }
    };

    void checkAuth();
    return () => {
      isMounted = false;
    };
  }, [router, supabase]);

  if (checkingAuth) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <div className="text-sm font-medium text-slate-500">Checking your session...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center px-4 py-10">
      <Card className="w-full max-w-md border-slate-200 shadow-sm">
        <CardHeader className="space-y-4 text-center">
          <div>
            <CardTitle className="text-2xl">{authMode === 'login' ? 'Sign in to continue' : 'Create your account'}</CardTitle>
            <CardDescription className="text-sm text-muted-foreground">
              Enter your email and password to access your canvases.
            </CardDescription>
          </div>
          <div className="flex gap-2">
            <Button
              type="button"
              variant={authMode === 'login' ? 'default' : 'ghost'}
              className="flex-1"
              onClick={() => setAuthMode('login')}
            >
              Sign in
            </Button>
            <Button
              type="button"
              variant={authMode === 'register' ? 'default' : 'ghost'}
              className="flex-1"
              onClick={() => setAuthMode('register')}
            >
              Register
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {error && (
            <div className="mb-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-600">
              {error === 'auth_callback_error'
                ? 'Email link invalid or expired. Please request a new one.'
                : 'Something went wrong. Please try again.'}
            </div>
          )}
          <AuthForm mode={authMode} onModeChange={setAuthMode} />
        </CardContent>
      </Card>
    </div>
  );
}

export default function Home() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center bg-linear-to-br from-indigo-50 to-white">
        <div className="animate-pulse text-indigo-600">Loading...</div>
      </div>
    }>
      <HomeContent />
    </Suspense>
  );
}