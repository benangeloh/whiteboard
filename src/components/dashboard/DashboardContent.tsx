'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import type { CanvasWithOwner, PermissionLevel, Profile } from '@/types/database';
import UserAvatar from '@/components/auth/UserAvatar';
import CanvasCard from './CanvasCard';
import CreateCanvasModal from './CreateCanvasModal';
import ProfileModal from './ProfileModal';
import ShareModal from '@/components/sharing/ShareModal';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Users, Layout, Plus } from 'lucide-react';

export type DashboardCanvas = CanvasWithOwner & {
  shares?: { id: string }[];
  permission?: PermissionLevel;
};

export interface DashboardContentProps {
  profile: Profile | null;
  myCanvases: DashboardCanvas[];
  sharedCanvases: DashboardCanvas[];
}

export default function DashboardContent({ 
  profile, 
  myCanvases, 
  sharedCanvases 
}: DashboardContentProps) {
  const [currentProfile, setCurrentProfile] = useState(profile);
  const [activeTab, setActiveTab] = useState<'my' | 'shared'>('my');
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showProfileModal, setShowProfileModal] = useState(false);
  const [canvases, setCanvases] = useState<DashboardCanvas[]>(myCanvases);
  const [shared, setShared] = useState<DashboardCanvas[]>(sharedCanvases);
  const [shareCanvas, setShareCanvas] = useState<DashboardCanvas | null>(null);
  
  const supabase = createClient();
  const router = useRouter();

  const handleLogout = async () => {
    await supabase.auth.signOut();
    router.push('/');
    router.refresh();
  };

  const handleCanvasCreated = (newCanvas: DashboardCanvas) => {
    setCanvases(prev => [newCanvas, ...prev]);
    setShowCreateModal(false);
    router.push(`/board/${newCanvas.id}`);
  };

  const handleCanvasDeleted = (canvasId: string) => {
    setCanvases(prev => prev.filter(c => c.id !== canvasId));
    setShared(prev => prev.filter(c => c.id !== canvasId));
  };

  const handleOpenShareModal = (canvasId: string) => {
    const target = canvases.find(c => c.id === canvasId);
    if (target) {
      setShareCanvas(target);
    }
  };

  const handleVisibilityChange = (canvasId: string, nextIsPublic: boolean) => {
    setCanvases(prev => prev.map(c => (c.id === canvasId ? { ...c, is_public: nextIsPublic } : c)));
    setShareCanvas(prev => (prev && prev.id === canvasId ? { ...prev, is_public: nextIsPublic } : prev));
  };

  const displayCanvases = activeTab === 'my' ? canvases : shared;

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="border-b bg-white/90 backdrop-blur supports-backdrop-filter:bg-white/60 sticky top-0 z-40">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4">
          <div className="flex items-center gap-3">
            <div>
              <p className="text-sm text-muted-foreground">Collab Whiteboard</p>
              <p className="text-base font-semibold">Dashboard</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <Button onClick={() => setShowCreateModal(true)} className="gap-2">
              <Plus size={16} />
              New canvas
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" className="gap-2 pr-2">
                  <UserAvatar
                    displayName={currentProfile?.display_name}
                    avatarUrl={currentProfile?.avatar_url}
                    email={currentProfile?.email}
                    size="sm"
                  />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuLabel>
                  <div className="text-sm font-medium">{currentProfile?.display_name || currentProfile?.email}</div>
                  <p className="text-xs text-muted-foreground">{currentProfile?.email}</p>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => setShowProfileModal(true)}>
                  Account settings
                </DropdownMenuItem>
                <DropdownMenuItem onClick={handleLogout} className="text-red-600 focus:text-red-600">
                  Sign out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-8">
        <div className="mb-8 flex w-fit items-center gap-1 rounded-full border bg-white p-1 text-sm">
          <Button
            variant={activeTab === 'my' ? 'secondary' : 'ghost'}
            className="gap-2 rounded-full"
            onClick={() => setActiveTab('my')}
          >
            <Layout size={16} />
            My canvases
            <Badge variant="outline" className="rounded-full border-muted-foreground/30 text-muted-foreground">
              {canvases.length}
            </Badge>
          </Button>
          <Button
            variant={activeTab === 'shared' ? 'secondary' : 'ghost'}
            className="gap-2 rounded-full"
            onClick={() => setActiveTab('shared')}
          >
            <Users size={16} />
            Shared with me
            <Badge variant="outline" className="rounded-full border-muted-foreground/30 text-muted-foreground">
              {shared.length}
            </Badge>
          </Button>
        </div>

        {displayCanvases.length === 0 ? (
          <Card className="grid place-items-center gap-4 py-16 text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-full bg-muted">
              {activeTab === 'my' ? <Layout className="text-muted-foreground" /> : <Users className="text-muted-foreground" />}
            </div>
            <div>
              <p className="text-base font-semibold text-foreground">
                {activeTab === 'my' ? 'No canvases yet' : 'Nothing shared with you'}
              </p>
              <p className="text-sm text-muted-foreground">
                {activeTab === 'my'
                  ? 'Create your first canvas to get started.'
                  : 'When someone shares a canvas with you it will appear here.'}
              </p>
            </div>
            {activeTab === 'my' && (
              <Button onClick={() => setShowCreateModal(true)} className="gap-2">
                <Plus size={16} />
                Create canvas
              </Button>
            )}
          </Card>
        ) : (
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {displayCanvases.map((canvas) => (
              <CanvasCard
                key={canvas.id}
                canvas={canvas}
                isOwner={activeTab === 'my'}
                onDeleted={handleCanvasDeleted}
                onShare={handleOpenShareModal}
              />
            ))}
          </div>
        )}
      </main>

      {showCreateModal && (
        <CreateCanvasModal onClose={() => setShowCreateModal(false)} onCreated={handleCanvasCreated} />
      )}
      {showProfileModal && currentProfile && (
        <ProfileModal
          profile={currentProfile}
          onClose={() => setShowProfileModal(false)}
          onUpdated={(next) => setCurrentProfile(next)}
        />
      )}
      {shareCanvas && (
        <ShareModal
          canvasId={shareCanvas.id}
          canvasTitle={shareCanvas.title}
          isPublic={shareCanvas.is_public}
          onClose={() => setShareCanvas(null)}
          onVisibilityChange={(nextIsPublic) => handleVisibilityChange(shareCanvas.id, nextIsPublic)}
        />
      )}
    </div>
  );
}

