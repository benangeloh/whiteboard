'use client';

import { useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { Profile } from '@/types/database';
import { Loader2 } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';

interface ProfileFormProps {
  profile: Profile;
  onUpdate?: (profile: Profile) => void;
}

export default function ProfileForm({ profile, onUpdate }: ProfileFormProps) {
  const [displayName, setDisplayName] = useState(profile.display_name || '');
  const [avatarUrl, setAvatarUrl] = useState(profile.avatar_url || '');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  
  const supabase = createClient();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setSuccess(false);

    try {
      const { data, error } = await supabase
        .from('profiles')
        .update({
          display_name: displayName,
          avatar_url: avatarUrl || null,
        })
        .eq('id', profile.id)
        .select()
        .single();

      if (error) throw error;
      
      setSuccess(true);
      onUpdate?.(data);
      setTimeout(() => setSuccess(false), 3000);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to update profile';
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  const getInitials = () => {
    if (displayName) {
      return displayName.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2);
    }
    return profile.email[0].toUpperCase();
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {/* Avatar Preview */}
      <div className="flex items-center gap-4">
        <Avatar className="h-16 w-16 border">
          <AvatarImage src={avatarUrl || undefined} alt={displayName || profile.email} />
          <AvatarFallback>{getInitials()}</AvatarFallback>
        </Avatar>
        <div className="space-y-0.5">
          <p className="text-sm font-medium text-foreground">{displayName || profile.email.split('@')[0]}</p>
          <p className="text-xs text-muted-foreground">{profile.email}</p>
        </div>
      </div>

      {/* Display Name */}
      <div className="space-y-2">
        <Label htmlFor="displayName">Display name</Label>
        <Input
          id="displayName"
          type="text"
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          placeholder="Your display name"
        />
      </div>

      {/* Avatar URL */}
      <div className="space-y-2">
        <Label htmlFor="avatarUrl">Avatar URL</Label>
        <Input
          id="avatarUrl"
          type="url"
          value={avatarUrl}
          onChange={(e) => setAvatarUrl(e.target.value)}
          placeholder="https://example.com/avatar.jpg"
        />
        <p className="text-xs text-muted-foreground">Use a public image URL.</p>
      </div>

      {error && (
        <div className="p-3 bg-red-50 border border-red-200 text-red-700 rounded-lg text-sm">
          {error}
        </div>
      )}

      {success && (
        <div className="p-3 bg-green-50 border border-green-200 text-green-700 rounded-lg text-sm">
          Profile updated successfully!
        </div>
      )}

      <Button type="submit" className="w-full" disabled={loading}>
        {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
        Save changes
      </Button>
    </form>
  );
}

