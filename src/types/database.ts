// Database types matching Supabase schema

export type PermissionLevel = 'viewer' | 'editor' | 'owner';

export interface Profile {
  id: string;
  email: string;
  display_name: string | null;
  avatar_url: string | null;
  created_at: string;
  updated_at: string;
}

export interface Canvas {
  id: string;
  owner_id: string;
  title: string;
  description: string | null;
  thumbnail_url: string | null;
  is_public: boolean;
  created_at: string;
  updated_at: string;
}

export interface CanvasShare {
  id: string;
  canvas_id: string;
  user_id: string | null;
  email: string | null;
  permission: PermissionLevel;
  share_token: string | null;
  created_at: string;
  updated_at: string;
}

// Extended types with relations
export interface CanvasWithOwner extends Canvas {
  owner: Profile;
}

export interface CanvasWithShares extends Canvas {
  owner: Profile;
  shares: CanvasShareWithUser[];
}

export interface CanvasShareWithUser extends CanvasShare {
  user?: Profile | null;
}

export interface CanvasShareWithCanvas extends CanvasShare {
  canvas: CanvasWithOwner;
}

// Presence types for real-time collaboration
export interface UserPresence {
  user_id: string;
  display_name: string;
  avatar_url: string | null;
  color: string;
  x: number;
  y: number;
  online_at: string;
}

// Auth related types
export interface AuthUser {
  id: string;
  email: string;
  profile: Profile | null;
}

// Form/Input types
export interface CreateCanvasInput {
  title: string;
  description?: string;
  is_public?: boolean;
}

export interface UpdateCanvasInput {
  title?: string;
  description?: string;
  is_public?: boolean;
}

export interface ShareCanvasInput {
  email: string;
  permission: PermissionLevel;
}

export interface UpdateProfileInput {
  display_name?: string;
  avatar_url?: string;
}

// API Response types
export interface ApiResponse<T> {
  data: T | null;
  error: string | null;
}

// Dashboard canvas list item
export interface DashboardCanvas {
  id: string;
  title: string;
  description: string | null;
  thumbnail_url: string | null;
  is_public: boolean;
  created_at: string;
  updated_at: string;
  owner: {
    id: string;
    display_name: string | null;
    avatar_url: string | null;
  };
  permission: PermissionLevel;
  collaborator_count: number;
}

