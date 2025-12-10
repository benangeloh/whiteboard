'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { createClient } from '@/lib/supabase/client';
import { PermissionLevel } from '@/types/database';
import UserAvatar from '@/components/auth/UserAvatar';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Loader2, Copy, Check, Trash2, Ellipsis } from 'lucide-react';

interface ShareModalProps {
  canvasId: string;
  canvasTitle: string;
  isPublic: boolean;
  onClose: () => void;
  onVisibilityChange?: (nextIsPublic: boolean) => void;
  onShareCountChange?: (count: number) => void;
}

interface ShareEntry {
  id: string;
  email: string | null;
  permission: PermissionLevel;
  share_token: string | null;
  user?: {
    id: string;
    display_name: string | null;
    avatar_url: string | null;
  } | null;
}

type ShareRow = Omit<ShareEntry, 'user'> & {
  user: ShareEntry['user'] | ShareEntry['user'][] | null;
};

export default function ShareModal({
  canvasId,
  canvasTitle,
  isPublic: initialIsPublic,
  onClose,
  onVisibilityChange,
  onShareCountChange,
}: ShareModalProps) {
  const [email, setEmail] = useState('');
  const [permission, setPermission] = useState<PermissionLevel>('viewer');
  const [shares, setShares] = useState<ShareEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [inviting, setInviting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [isPublic, setIsPublic] = useState(initialIsPublic);
  const [updatingVisibility, setUpdatingVisibility] = useState(false);
  const [shareUrl, setShareUrl] = useState('');

  const supabase = useMemo(() => createClient(), []);

  const loadShares = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('canvas_shares')
      .select(`
        id,
        email,
        permission,
        share_token,
        user:profiles!user_id(id, display_name, avatar_url)
      `)
      .eq('canvas_id', canvasId);

    if (!error && data) {
      const transformedData: ShareEntry[] = data.map((item: ShareRow) => ({
        id: item.id,
        email: item.email,
        permission: item.permission,
        share_token: item.share_token,
        user: Array.isArray(item.user) ? item.user[0] || null : item.user,
      }));
      setShares(transformedData);
      onShareCountChange?.(transformedData.length);
    }
    setLoading(false);
  }, [canvasId, onShareCountChange, supabase]);

  useEffect(() => {
    void loadShares();
  }, [loadShares]);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      setShareUrl(`${window.location.origin}/board/${canvasId}`);
    }
  }, [canvasId]);

  useEffect(() => {
    setIsPublic(initialIsPublic);
  }, [initialIsPublic]);

  const handleInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) return;

    setInviting(true);
    setError(null);

    try {
      const { data: existingUser } = await supabase
        .from('profiles')
        .select('id')
        .eq('email', email.trim().toLowerCase())
        .maybeSingle();

      const { error } = await supabase.from('canvas_shares').insert({
        canvas_id: canvasId,
        email: email.trim().toLowerCase(),
        user_id: existingUser?.id || null,
        permission,
      });

      if (error) {
        if (error.code === '23505') {
          setError('This user already has access.');
        } else {
          throw error;
        }
      } else {
        setEmail('');
        void loadShares();
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to invite user';
      setError(message);
    } finally {
      setInviting(false);
    }
  };

  const handleRemoveShare = async (shareId: string) => {
    await supabase.from('canvas_shares').delete().eq('id', shareId);
    setShares((prev) => {
      const next = prev.filter((s) => s.id !== shareId);
      onShareCountChange?.(next.length);
      return next;
    });
  };

  const handleUpdatePermission = async (shareId: string, newPermission: PermissionLevel) => {
    await supabase.from('canvas_shares').update({ permission: newPermission }).eq('id', shareId);
    setShares((prev) => prev.map((s) => (s.id === shareId ? { ...s, permission: newPermission } : s)));
  };

  const handleCopyLink = async () => {
    if (!shareUrl) return;
    await navigator.clipboard.writeText(shareUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleTogglePublic = async (nextValue: boolean) => {
    setUpdatingVisibility(true);
    const { error } = await supabase
      .from('canvases')
      .update({ is_public: nextValue })
      .eq('id', canvasId);

    if (!error) {
      setIsPublic(nextValue);
      onVisibilityChange?.(nextValue);
    }
    setUpdatingVisibility(false);
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Share canvas</DialogTitle>
          <DialogDescription className="truncate">{canvasTitle}</DialogDescription>
        </DialogHeader>

        <div className="space-y-6 max-h-[70vh] overflow-y-auto pr-2">
          <div className="flex items-center justify-between rounded-lg border px-4 py-3">
            <div>
              <p className="text-sm font-medium">Visibility</p>
              <p className="text-xs text-muted-foreground">
                {isPublic ? 'Anyone with the link can view.' : 'Only invited collaborators can view.'}
              </p>
            </div>
            <Switch
              checked={isPublic}
              onCheckedChange={handleTogglePublic}
              disabled={updatingVisibility}
            />
          </div>

          <Button variant="outline" className="w-full justify-between" onClick={handleCopyLink} disabled={!shareUrl}>
            <span className="truncate text-left">{shareUrl || 'Loading link...'}</span>
            {copied ? <Check className="h-4 w-4 text-emerald-500" /> : <Copy className="h-4 w-4" />}
          </Button>

          <form onSubmit={handleInvite} className="space-y-2">
            <div className="grid gap-3 md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_auto]">
              <div className="space-y-2">
                <Label htmlFor="invite-email">Email</Label>
                <Input
                  id="invite-email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="teammate@example.com"
                  required
                />
              </div>
              <div className="space-y-2">
                <Label>Permission</Label>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="outline" className="w-full justify-between">
                      <span className="capitalize">{permission}</span>
                      <Ellipsis className="h-4 w-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent className="w-40">
                    <DropdownMenuRadioGroup value={permission} onValueChange={(value) => setPermission(value as PermissionLevel)}>
                      <DropdownMenuRadioItem value="viewer">Viewer</DropdownMenuRadioItem>
                      <DropdownMenuRadioItem value="editor">Editor</DropdownMenuRadioItem>
                    </DropdownMenuRadioGroup>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
              <Button type="submit" disabled={inviting || !email.trim()} className="self-end">
                {inviting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Invite
              </Button>
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
          </form>

          <div className="space-y-3">
            <Label>People with access</Label>
            {loading ? (
              <div className="flex justify-center py-6 text-muted-foreground">
                <Loader2 className="h-5 w-5 animate-spin" />
              </div>
            ) : shares.length === 0 ? (
              <p className="rounded-lg border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">
                No collaborators yet.
              </p>
            ) : (
              <div className="space-y-2">
                {shares.map((share) => (
                  <div
                    key={share.id}
                    className="flex items-center justify-between rounded-lg border px-3 py-2"
                  >
                    <div className="flex items-center gap-3">
                      <UserAvatar
                        displayName={share.user?.display_name}
                        avatarUrl={share.user?.avatar_url}
                        email={share.email || undefined}
                        size="sm"
                      />
                      <div>
                        <p className="text-sm font-medium text-foreground">
                          {share.user?.display_name || share.email}
                        </p>
                        {share.email && (
                          <p className="text-xs text-muted-foreground">{share.email}</p>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant="secondary" className="capitalize">
                        {share.permission}
                      </Badge>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" className="h-8 w-8">
                            <Ellipsis className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-44">
                          <DropdownMenuLabel>Permission</DropdownMenuLabel>
                          <DropdownMenuRadioGroup
                            value={share.permission}
                            onValueChange={(value) => handleUpdatePermission(share.id, value as PermissionLevel)}
                          >
                            <DropdownMenuRadioItem value="viewer">Viewer</DropdownMenuRadioItem>
                            <DropdownMenuRadioItem value="editor">Editor</DropdownMenuRadioItem>
                          </DropdownMenuRadioGroup>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            className="text-red-600 focus:text-red-600"
                            onClick={() => handleRemoveShare(share.id)}
                          >
                            <Trash2 className="mr-2 h-4 w-4" /> Remove
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

