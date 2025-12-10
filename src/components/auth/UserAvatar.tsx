'use client';

import { cn } from '@/lib/utils';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';

interface UserAvatarProps {
  displayName?: string | null;
  avatarUrl?: string | null;
  email?: string;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
  showName?: boolean;
}

const avatarSizes = {
  sm: 'h-8 w-8 text-xs',
  md: 'h-10 w-10 text-sm',
  lg: 'h-14 w-14 text-base',
};

export default function UserAvatar({
  displayName,
  avatarUrl,
  email,
  size = 'md',
  className,
  showName = false,
}: UserAvatarProps) {
  const getInitials = () => {
    if (displayName) {
      const parts = displayName.trim().split(' ');
      if (parts.length >= 2) {
        return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
      }
      return displayName.slice(0, 2).toUpperCase();
    }
    if (email) {
      return email[0]?.toUpperCase() ?? '?';
    }
    return '?';
  };

  const getDisplayText = () => displayName || email?.split('@')[0] || 'Unknown';

  return (
    <div className={cn('flex items-center gap-2', className)}>
      <Avatar className={cn('border', avatarSizes[size])}>
        <AvatarImage src={avatarUrl || undefined} alt={getDisplayText()} />
        <AvatarFallback className="bg-muted text-sm font-medium text-muted-foreground">
          {getInitials()}
        </AvatarFallback>
      </Avatar>
      {showName && (
        <span className="text-sm font-medium text-foreground truncate">
          {getDisplayText()}
        </span>
      )}
    </div>
  );
}

