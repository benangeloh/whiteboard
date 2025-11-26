import { Point, Camera } from "@/types/canvas";

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