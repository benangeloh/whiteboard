export type ToolType = 
  | 'hand' | 'selection' | 'rect' | 'diamond' | 'ellipse' 
  | 'arrow' | 'line' | 'pencil' | 'text' | 'image' | 'eraser';

export type Point = { x: number; y: number };

export type CanvasElement = {
  id?: string;
  room_id: string;
  user_id: string;
  type: ToolType;
  x: number;
  y: number;
  width?: number; 
  height?: number;
  points?: Point[] | null; // Allow null
  color: string;
  fill_color?: string;
  stroke_width: number;
  is_deleted?: boolean;
  text?: string; // New field
};

export type UserCursor = {
  x: number; 
  y: number; 
  userId: string; 
  color: string;
};

export type Camera = {
  x: number; 
  y: number; 
  z: number; 
};