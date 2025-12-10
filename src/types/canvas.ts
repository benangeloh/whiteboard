export type ToolType = 
  | 'hand' | 'selection' | 'rect' | 'diamond' | 'ellipse' 
  | 'arrow' | 'line' | 'pencil' | 'text' | 'image' | 'eraser';

export type Point = { x: number; y: number };

export type StrokeStyle = 'solid' | 'dashed' | 'dotted';
export type TextAlign = 'left' | 'center' | 'right';

export type CanvasElement = {
  id?: string;
  canvas_id: string; // Reference to canvases table for permissions
  user_id: string;
  type: ToolType;
  x: number;
  y: number;
  width?: number; 
  height?: number;
  points?: Point[] | null;
  
  // styles
  color: string;
  fill_color?: string;
  stroke_width: number;
  stroke_style?: StrokeStyle;
  opacity?: number;
  rotation?: number;
  
  // text
  text?: string;
  font_family?: string;
  font_size?: number;
  text_align?: TextAlign;

  layer?: number;
  is_deleted?: boolean;
};

export type UserCursor = {
  x: number;
  y: number;
  userId: string;
  color: string;
  displayName?: string;
  avatarUrl?: string | null;
};

export type Camera = { x: number; y: number; z: number; };
export type BoundingBox = { minX: number; minY: number; maxX: number; maxY: number; width: number; height: number };