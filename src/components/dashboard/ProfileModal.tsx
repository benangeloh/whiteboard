'use client';

import { Profile } from '@/types/database';
import ProfileForm from '@/components/auth/ProfileForm';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';

interface ProfileModalProps {
  profile: Profile;
  onClose: () => void;
  onUpdated?: (profile: Profile) => void;
}

export default function ProfileModal({ profile, onClose, onUpdated }: ProfileModalProps) {
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Profile settings</DialogTitle>
        </DialogHeader>
        <ProfileForm
          profile={profile}
          onUpdate={(next) => {
            onUpdated?.(next);
            onClose();
          }}
        />
      </DialogContent>
    </Dialog>
  );
}

