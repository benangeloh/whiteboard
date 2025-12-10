'use client';

import { useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { Loader2 } from 'lucide-react';
import type { CanvasWithOwner } from '@/types/database';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';

interface CreateCanvasModalProps {
  onClose: () => void;
  onCreated: (canvas: CanvasWithOwner) => void;
}

export default function CreateCanvasModal({ onClose, onCreated }: CreateCanvasModalProps) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [isPublic, setIsPublic] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const supabase = createClient();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      const { data, error } = await supabase
        .from('canvases')
        .insert({
          title: title.trim() || 'Untitled Canvas',
          description: description.trim() || null,
          is_public: isPublic,
          owner_id: user.id,
        })
        .select(`
          *,
          owner:profiles!owner_id(id, display_name, avatar_url, email)
        `)
        .single();

      if (error || !data) throw error || new Error('Failed to create canvas');
      onCreated(data as CanvasWithOwner);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to create canvas';
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Create new canvas</DialogTitle>
          <DialogDescription>Give your canvas a name and decide who can access it.</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="title">Title</Label>
            <Input
              id="title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Standup Notes"
              autoFocus
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="description">Description</Label>
            <Textarea
              id="description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Optional context for collaborators"
              rows={3}
            />
          </div>
          <div className="flex items-center justify-between rounded-lg border px-4 py-3">
            <div>
              <p className="text-sm font-medium">Make canvas public</p>
              <p className="text-xs text-muted-foreground">
                {isPublic ? 'Anyone with the link can view.' : 'Only invited collaborators can access.'}
              </p>
            </div>
            <Switch checked={isPublic} onCheckedChange={setIsPublic} />
          </div>
          {error && (
            <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-600">{error}</div>
          )}
          <div className="flex gap-2">
            <Button type="button" variant="secondary" className="flex-1" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" className="flex-1" disabled={loading}>
              {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Create canvas
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

