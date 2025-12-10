import { Point, Camera, CanvasElement, BoundingBox } from "@/types/canvas";

export function screenToCanvas(point: Point, camera: Camera): Point {
  return {
    x: (point.x - camera.x) / camera.z,
    y: (point.y - camera.y) / camera.z,
  };
}

export function canvasToScreen(point: Point, camera: Camera): Point {
  return {
    x: (point.x * camera.z) + camera.x,
    y: (point.y * camera.z) + camera.y,
  };
}

export function rotatePoint(point: Point, center: Point, angleDegrees: number): Point {
  const angle = (angleDegrees * Math.PI) / 180;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const dx = point.x - center.x;
  const dy = point.y - center.y;
  return {
    x: center.x + (dx * cos - dy * sin),
    y: center.y + (dx * sin + dy * cos),
  };
}

export function getElementBounds(el: CanvasElement): BoundingBox | null {
  if (el.type === 'pencil' && el.points) {
    if (el.points.length === 0) return null;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    el.points.forEach(p => {
      if (p.x < minX) minX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.x > maxX) maxX = p.x;
      if (p.y > maxY) maxY = p.y;
    });
    return { minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY };
  } 
  
  if (el.width !== undefined && el.height !== undefined) {
    const x = el.width < 0 ? el.x + el.width : el.x;
    const y = el.height < 0 ? el.y + el.height : el.y;
    const w = Math.abs(el.width);
    const h = Math.abs(el.height);
    return { minX: x, minY: y, maxX: x + w, maxY: y + h, width: w, height: h };
  }
  return null;
}

export function isHit(point: Point, el: CanvasElement): boolean {
  if (el.is_deleted) return false;
  
  const bounds = getElementBounds(el);
  if (!bounds) return false;

  const cx = bounds.minX + bounds.width / 2;
  const cy = bounds.minY + bounds.height / 2;
  const localPoint = rotatePoint(point, { x: cx, y: cy }, -(el.rotation || 0));

  const padding = 5;
  const inBox = 
    localPoint.x >= bounds.minX - padding && 
    localPoint.x <= bounds.maxX + padding &&
    localPoint.y >= bounds.minY - padding && 
    localPoint.y <= bounds.maxY + padding;

  if (inBox) return true;
  return false;
}

export function getResizeHandle(point: Point, bounds: BoundingBox, zoom: number, rotation: number): string | null {
  const handleThreshold = 12 / zoom; 
  const { minX, minY, maxX, maxY, width, height } = bounds;
  const cx = minX + width / 2;
  const cy = minY + height / 2;

  const localPoint = rotatePoint(point, { x: cx, y: cy }, -rotation);

  const handles = {
    tl: { x: minX, y: minY },
    tr: { x: maxX, y: minY },
    bl: { x: minX, y: maxY },
    br: { x: maxX, y: maxY },
    tm: { x: cx, y: minY },
    bm: { x: cx, y: maxY },
    lm: { x: minX, y: cy },
    rm: { x: maxX, y: cy },
    rot: { x: cx, y: minY - (30 / zoom) }
  };

  for (const [key, pos] of Object.entries(handles)) {
    if (Math.hypot(localPoint.x - pos.x, localPoint.y - pos.y) < handleThreshold) {
      return key;
    }
  }
  return null;
}

export function getCursorForHandle(handle: string, rotation: number): string {
  if (!handle) return 'default';
  if (handle === 'rot') return 'grabbing';

  const cursorMap: Record<string, number> = {
    n: 0, ne: 45, e: 90, se: 135, s: 180, sw: 225, w: 270, nw: 315,
    tm: 0, tr: 45, rm: 90, br: 135, bm: 180, bl: 225, lm: 270, tl: 315
  };
  
  const baseAngle = cursorMap[handle];
  if (baseAngle === undefined) return 'default';

  const totalAngle = (baseAngle + rotation + 360) % 360;
  
  if (totalAngle > 337.5 || totalAngle <= 22.5) return 'ns-resize';
  if (totalAngle > 22.5 && totalAngle <= 67.5) return 'nesw-resize';
  if (totalAngle > 67.5 && totalAngle <= 112.5) return 'ew-resize';
  if (totalAngle > 112.5 && totalAngle <= 157.5) return 'nwse-resize';
  if (totalAngle > 157.5 && totalAngle <= 202.5) return 'ns-resize';
  if (totalAngle > 202.5 && totalAngle <= 247.5) return 'nesw-resize';
  if (totalAngle > 247.5 && totalAngle <= 292.5) return 'ew-resize';
  return 'nwse-resize';
}

export function getWrappedText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  return text.split('\n').flatMap(paragraph => {
      const words = paragraph.split(' ');
      const lines: string[] = [];
      let currentLine = words[0] || '';

      for (let i = 1; i < words.length; i++) {
          const word = words[i];
          const testLine = currentLine + " " + word;
          const width = ctx.measureText(testLine).width;

          if (width < maxWidth) {
              currentLine = testLine;
          } else {
              lines.push(currentLine);
              currentLine = word;
          }
      }
      lines.push(currentLine);
      
      const finalLines: string[] = [];
      lines.forEach(line => {
          if (ctx.measureText(line).width <= maxWidth) {
              finalLines.push(line);
          } else {
              const chars = line.split('');
              let tempLine = chars[0];
              for(let k=1; k<chars.length; k++) {
                  if (ctx.measureText(tempLine + chars[k]).width < maxWidth) {
                      tempLine += chars[k];
                  } else {
                      finalLines.push(tempLine);
                      tempLine = chars[k];
                  }
              }
              finalLines.push(tempLine);
          }
      });

      return finalLines;
  });
}