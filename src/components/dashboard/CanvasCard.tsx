'use client';

import { useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { createClient } from '@/lib/supabase/client';
import UserAvatar from '@/components/auth/UserAvatar';
import type { CanvasWithOwner, PermissionLevel } from '@/types/database';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { MoreVertical, Trash2, Share2, Globe, Lock, Users } from 'lucide-react';
import { toast } from 'sonner';

type CanvasCardCanvas = Omit<CanvasWithOwner, 'owner'> & {
  owner?: CanvasWithOwner['owner'];
  thumbnail_url: string | null;
  shares?: { id: string }[];
  permission?: PermissionLevel;
};

interface CanvasCardProps {
  canvas: CanvasCardCanvas;
  isOwner: boolean;
  onDeleted?: (id: string) => void;
  onShare?: (id: string) => void;
}

export default function CanvasCard({ canvas, isOwner, onDeleted, onShare }: CanvasCardProps) {
  const [showMenu, setShowMenu] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const supabase = createClient();

  const deleteCanvas = async () => {
    setDeleting(true);
    try {
      await supabase.from('canvases').delete().eq('id', canvas.id);
      toast.success('Canvas deleted');
      onDeleted?.(canvas.id);
    } catch (error) {
      console.error('Failed to delete canvas:', error);
      toast.error('Failed to delete canvas');
    } finally {
      setDeleting(false);
      setShowMenu(false);
    }
  };

  const confirmDelete = () => {
    if (deleting) return;
    const toastId = toast.warning('Delete this canvas?', {
      description: 'This action cannot be undone.',
      action: {
        label: 'Delete',
        onClick: () => {
          void deleteCanvas();
        },
      },
      cancel: {
        label: 'Cancel',
        onClick: () => {},
      },
      duration: Infinity,
      position: 'top-center',
    });
    return toastId;
  };

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    
    if (diffDays === 0) return 'Today';
    if (diffDays === 1) return 'Yesterday';
    if (diffDays < 7) return `${diffDays} days ago`;
    if (diffDays < 30) return `${Math.floor(diffDays / 7)} weeks ago`;
    return date.toLocaleDateString();
  };

  const collaboratorCount = (canvas.shares?.length || 0);

  return (
    <Link href={`/board/${canvas.id}`} className="block" data-clickable="true">
      <Card data-clickable="true" className="overflow-hidden border-muted shadow-sm transition hover:-translate-y-0.5 hover:shadow-md">
        <CardHeader className="p-0">
          <div className="relative aspect-video bg-linear-to-br from-slate-100 to-white">
            {canvas.thumbnail_url ? (
              <Image
                src={canvas.thumbnail_url}
                alt={canvas.title}
                fill
                sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 25vw"
                className="object-cover"
                priority={false}
              />
            ) : (
              <div className="flex h-full w-full items-center justify-center text-sm text-muted-foreground">
                No preview
              </div>
            )}
            {isOwner && (
              <div className="absolute right-2 top-2">
                <DropdownMenu open={showMenu} onOpenChange={setShowMenu}>
                  <DropdownMenuTrigger asChild>
                    <Button variant="secondary" size="icon" className="h-8 w-8 rounded-full bg-white/90">
                      <MoreVertical size={16} />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem
                      onClick={(e) => {
                        e.preventDefault();
                        onShare?.(canvas.id);
                        setShowMenu(false);
                      }}
                      className="cursor-pointer"
                    >
                      <Share2 size={14} className="mr-2" /> Share
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onClick={(e) => {
                        e.preventDefault();
                        confirmDelete();
                      }}
                      disabled={deleting}
                      className="cursor-pointer text-red-600 focus:text-red-600"
                    >
                      <Trash2 size={14} className="mr-2" /> {deleting ? 'Deleting...' : 'Delete'}
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-3 p-4">
          <div className="flex items-start justify-between gap-2">
            <div>
              <p className="text-base font-semibold text-foreground line-clamp-1">{canvas.title}</p>
              {canvas.description && (
                <p className="text-sm text-muted-foreground line-clamp-2">{canvas.description}</p>
              )}
            </div>
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Badge variant="outline" className="rounded-full border-muted-foreground/30">
                    {canvas.is_public ? <Globe size={14} className="text-emerald-500" /> : <Lock size={14} className="text-slate-400" />}
                  </Badge>
                </TooltipTrigger>
                <TooltipContent>{canvas.is_public ? 'Public canvas' : 'Private canvas'}</TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <div className="flex items-center gap-2">
              {!isOwner && canvas.owner && (
                <UserAvatar displayName={canvas.owner.display_name} avatarUrl={canvas.owner.avatar_url} size="sm" />
              )}
              <span>Updated {formatDate(canvas.updated_at)}</span>
            </div>
            {collaboratorCount > 0 && (
              <Badge variant="secondary" className="gap-1 rounded-full">
                <Users size={12} />
                {collaboratorCount}
              </Badge>
            )}
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}

