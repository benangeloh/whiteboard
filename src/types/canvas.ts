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
  points?: Point[] | null;
  color: string;
  fill_color?: string;
  stroke_width: number;
  rotation?: number;
  is_deleted?: boolean;
  text?: string;
};

export type UserCursor = { x: number; y: number; userId: string; color: string; };
export type Camera = { x: number; y: number; z: number; };
export type BoundingBox = { minX: number; minY: number; maxX: number; maxY: number; width: number; height: number };