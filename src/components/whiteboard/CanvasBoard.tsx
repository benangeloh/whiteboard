'use client';

import { useEffect, useRef, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { throttle } from '@/lib/utils';
import { CanvasElement, Camera, Point, UserCursor, ToolType } from '@/types/canvas';
import { screenToCanvas, canvasToScreen } from '@/lib/canvas-math';
import { RealtimeChannel } from '@supabase/supabase-js'; // Import this type
import TopToolbar from './TopToolbar';
import SideToolbar from './SideToolbar';

interface CanvasBoardProps {
  roomId: string;
  userId: string;
}

export default function CanvasBoard({ roomId, userId }: CanvasBoardProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  
  // -- Core State --
  const [camera, setCamera] = useState<Camera>({ x: 0, y: 0, z: 1 });
  const [activeTool, setActiveTool] = useState<ToolType>('pencil');
  
  // -- Style State --
  const [color, setColor] = useState('#000000');
  const [strokeWidth, setStrokeWidth] = useState(3);
  
  // -- Data State --
  const [elements, setElements] = useState<CanvasElement[]>([]);
  const [otherCursors, setOtherCursors] = useState<Record<string, UserCursor>>({});
  
  // -- Text Editing State --
  const [writingNode, setWritingNode] = useState<{ id: string; x: number; y: number; text: string; color: string } | null>(null);
  
  // -- Refs --
  const isDraggingRef = useRef(false);
  const dragStartRef = useRef<Point>({ x: 0, y: 0 }); 
  const currentElementRef = useRef<CanvasElement | null>(null);
  const elementsRef = useRef<CanvasElement[]>([]); 
  
  // VITAL: Store the active channel here so we don't recreate it on mousemove
  const channelRef = useRef<RealtimeChannel | null>(null); 
  
  const supabase = createClient();

  useEffect(() => { elementsRef.current = elements; }, [elements]);

  // 1. Data Loading & Realtime
  useEffect(() => {
    // A. Load initial data
    const fetchElements = async () => {
      const { data } = await supabase
        .from('strokes')
        .select('*')
        .eq('room_id', roomId)
        .eq('is_deleted', false)
        .order('created_at', { ascending: true });
      if (data) setElements(data as any);
    };
    fetchElements();

    // B. Setup Channel
    // We create the channel instance ONCE here
    const channel = supabase.channel(`room:${roomId}`, { config: { presence: { key: userId } } });
    
    // Store it in the ref for the mousemove handler to use
    channelRef.current = channel;

    channel
      .on('presence', { event: 'sync' }, () => {
        const newState = channel.presenceState();
        const cursors: Record<string, UserCursor> = {};
        Object.keys(newState).forEach((key) => {
          if (key !== userId) {
             const list = newState[key];
             if(list && list.length > 0) {
                 const data = list[0] as unknown as UserCursor;
                 if(data.x !== undefined && data.y !== undefined) cursors[key] = data;
             }
          }
        });
        setOtherCursors(cursors);
      })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'strokes', filter: `room_id=eq.${roomId}` }, (payload) => {
          const newEl = payload.new as CanvasElement;
          if (newEl.user_id !== userId) setElements(prev => [...prev, newEl]);
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'strokes', filter: `room_id=eq.${roomId}` }, (payload) => {
          const updated = payload.new as CanvasElement;
          if (updated.is_deleted) setElements(prev => prev.filter(e => e.id !== updated.id));
      })
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
            // Only track presence once connected
            channel.track({ x: 0, y: 0, userId, color });
        }
      });

    return () => { 
        supabase.removeChannel(channel);
        channelRef.current = null; // Cleanup ref
    };
  }, [roomId, userId, supabase]);

  // 2. Interaction Logic 
  const broadcastCursor = useRef(throttle((point: Point) => {
    // FIX: Use the existing channel ref instead of creating a new one
    if (channelRef.current) {
        channelRef.current.track({ x: point.x, y: point.y, userId, color });
    }
  }, 30)).current;

  // --- Helper: Eraser Logic ---
  const eraseAtPoint = (canvasPoint: Point) => {
    const hitElement = [...elementsRef.current].reverse().find(el => {
      if (el.is_deleted) return false;
      
      if (el.type === 'pencil' && el.points) {
        return el.points.some(p => Math.hypot(p.x - canvasPoint.x, p.y - canvasPoint.y) < 10); 
      } else if (el.width && el.height) {
        return (
          canvasPoint.x >= el.x && 
          canvasPoint.x <= el.x + el.width &&
          canvasPoint.y >= el.y && 
          canvasPoint.y <= el.y + el.height
        );
      }
      return false;
    });

    if (hitElement && hitElement.id) {
      setElements(prev => prev.filter(e => e.id !== hitElement.id));
      supabase.from('strokes').update({ is_deleted: true }).eq('id', hitElement.id).then();
    }
  };


  const handlePointerDown = (e: React.PointerEvent) => {
    if (writingNode) {
        saveTextNode();
        return;
    }

    e.currentTarget.setPointerCapture(e.pointerId);
    isDraggingRef.current = true;
    dragStartRef.current = { x: e.clientX, y: e.clientY };

    const canvasPoint = screenToCanvas({ x: e.clientX, y: e.clientY }, camera);

    if (activeTool === 'hand') return;

    if (activeTool === 'eraser') {
      eraseAtPoint(canvasPoint);
      return;
    }

    if (activeTool === 'text') {
        const id = crypto.randomUUID();
        setWritingNode({
            id,
            x: canvasPoint.x,
            y: canvasPoint.y,
            text: '',
            color: color
        });
        isDraggingRef.current = false; 
        return;
    }

    const newId = crypto.randomUUID();
    const newEl: CanvasElement = {
      id: newId, 
      room_id: roomId,
      user_id: userId,
      type: activeTool,
      x: canvasPoint.x,
      y: canvasPoint.y,
      width: 0,
      height: 0,
      color,
      stroke_width: strokeWidth,
      points: activeTool === 'pencil' ? [canvasPoint] : undefined
    };

    currentElementRef.current = newEl;
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    const screenPoint = { x: e.clientX, y: e.clientY };
    const canvasPoint = screenToCanvas(screenPoint, camera);
    
    broadcastCursor(canvasPoint);

    if (!isDraggingRef.current) return;

    // 1. Panning
    if (activeTool === 'hand' || (e.buttons === 4) || e.shiftKey) { 
      const dx = screenPoint.x - dragStartRef.current.x;
      const dy = screenPoint.y - dragStartRef.current.y;
      setCamera(prev => ({ ...prev, x: prev.x + dx, y: prev.y + dy }));
      dragStartRef.current = screenPoint;
      return;
    }

    // 2. Eraser Dragging
    if (activeTool === 'eraser') {
        eraseAtPoint(canvasPoint);
        return;
    }

    // 3. Drawing / Shaping
    const current = currentElementRef.current;
    if (!current) return;

    if (activeTool === 'pencil') {
      current.points?.push(canvasPoint);
    } else {
      current.width = canvasPoint.x - current.x;
      current.height = canvasPoint.y - current.y;
    }
  };

  const handlePointerUp = async (e: React.PointerEvent) => {
    isDraggingRef.current = false;
    e.currentTarget.releasePointerCapture(e.pointerId);

    const current = currentElementRef.current;
    if (!current) return;

    // Normalize shapes
    if (activeTool !== 'pencil') {
        if ((current.width || 0) < 0) {
            current.x += current.width || 0;
            current.width = Math.abs(current.width || 0);
        }
        if ((current.height || 0) < 0) {
            current.y += current.height || 0;
            current.height = Math.abs(current.height || 0);
        }
        // Filter tiny clicks
        if ((current.width || 0) < 5 && (current.height || 0) < 5) {
            currentElementRef.current = null;
            return;
        }
    }

    setElements(prev => [...prev, current]);
    currentElementRef.current = null;

    // Save to DB
    const { id, ...payload } = current;
    
    // Explicitly set points to null if undefined to match DB types
    const dbPayload = {
        ...payload,
        points: payload.points || null
    };

    const { data, error } = await supabase.from('strokes').insert(dbPayload).select();
    if (error) console.error("Save Error:", error);
    if (data && data[0]) {
        setElements(prev => prev.map(el => el === current ? data[0] : el));
    }
  };

  const handleWheel = (e: React.WheelEvent) => {
    if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        const zoomSensitivity = 0.001;
        const zoomDelta = -e.deltaY * zoomSensitivity;
        const newZoom = Math.max(0.1, Math.min(5, camera.z + zoomDelta));
        setCamera(prev => ({ ...prev, z: newZoom }));
    } else {
        setCamera(prev => ({ ...prev, x: prev.x - e.deltaX, y: prev.y - e.deltaY }));
    }
  };

  // --- Text Tool Helpers ---
  const saveTextNode = async () => {
     if (!writingNode || !writingNode.text.trim()) {
         setWritingNode(null);
         return;
     }

     const newEl: CanvasElement = {
         id: writingNode.id,
         room_id: roomId,
         user_id: userId,
         type: 'text',
         x: writingNode.x,
         y: writingNode.y,
         width: writingNode.text.length * 10,
         height: 24,
         color: writingNode.color,
         stroke_width: 1,
         // @ts-ignore
         text: writingNode.text 
     };

     setElements(prev => [...prev, newEl]);
     setWritingNode(null);

     const { id, ...payload } = newEl;
     const dbPayload = { ...payload, points: null };
     
     const { data, error } = await supabase.from('strokes').insert(dbPayload).select();
     if(error) console.error("Text Save Error:", error);
     if (data && data[0]) {
        setElements(prev => prev.map(el => el === newEl ? data[0] : el));
    }
  };


  // 3. Render Loop
  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;

    const render = () => {
      if (canvas.width !== window.innerWidth || canvas.height !== window.innerHeight) {
          canvas.width = window.innerWidth;
          canvas.height = window.innerHeight;
      }
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      
      ctx.save();
      ctx.translate(camera.x, camera.y);
      ctx.scale(camera.z, camera.z);

      const drawElement = (el: CanvasElement) => {
        ctx.strokeStyle = el.color;
        ctx.lineWidth = el.stroke_width;
        ctx.fillStyle = el.fill_color || 'transparent'; 
        
        ctx.beginPath();
        switch(el.type) {
            case 'pencil':
                if (el.points && el.points.length > 0) {
                    ctx.lineCap = 'round';
                    ctx.lineJoin = 'round';
                    ctx.moveTo(el.points[0].x, el.points[0].y);
                    for(let i=1; i<el.points.length; i++) ctx.lineTo(el.points[i].x, el.points[i].y);
                    ctx.stroke();
                }
                break;
            case 'text':
                // @ts-ignore
                if(el.text) {
                    ctx.font = '24px sans-serif';
                    ctx.fillStyle = el.color;
                    ctx.fillText(el.text, el.x, el.y + 24); 
                }
                break;
            case 'rect':
                ctx.rect(el.x, el.y, el.width || 0, el.height || 0);
                ctx.stroke();
                break;
            case 'ellipse':
                const rx = (el.width || 0) / 2;
                const ry = (el.height || 0) / 2;
                ctx.ellipse(el.x + rx, el.y + ry, Math.abs(rx), Math.abs(ry), 0, 0, 2 * Math.PI);
                ctx.stroke();
                break;
            case 'diamond':
                const w = el.width || 0;
                const h = el.height || 0;
                ctx.moveTo(el.x + w/2, el.y);
                ctx.lineTo(el.x + w, el.y + h/2);
                ctx.lineTo(el.x + w/2, el.y + h);
                ctx.lineTo(el.x, el.y + h/2);
                ctx.closePath();
                ctx.stroke();
                break;
            case 'line':
            case 'arrow':
                ctx.moveTo(el.x, el.y);
                ctx.lineTo(el.x + (el.width || 0), el.y + (el.height || 0));
                ctx.stroke();
                break;
        }
      };

      elementsRef.current.forEach(drawElement);

      if (currentElementRef.current) {
        ctx.globalAlpha = 0.6;
        drawElement(currentElementRef.current);
        ctx.globalAlpha = 1.0;
      }

      Object.values(otherCursors).forEach(c => {
         ctx.fillStyle = c.color;
         ctx.beginPath();
         ctx.arc(c.x, c.y, 5 / camera.z, 0, 2 * Math.PI); 
         ctx.fill();
         ctx.font = `${12 / camera.z}px sans-serif`;
         ctx.fillText(c.userId.slice(0, 4), c.x + 10/camera.z, c.y);
      });

      ctx.restore(); 
      requestAnimationFrame(render);
    };

    const id = requestAnimationFrame(render);
    return () => cancelAnimationFrame(id);
  }, [camera, otherCursors]); 

  return (
    <div className="w-full h-screen bg-slate-50 overflow-hidden relative">
      <TopToolbar activeTool={activeTool} setTool={setActiveTool} />
      <SideToolbar 
        tool={activeTool}
        color={color}
        setColor={setColor}
        width={strokeWidth}
        setWidth={setStrokeWidth}
        onUndo={() => {}} 
        onSave={() => {}}
      />
      
      <div className="fixed bottom-4 left-4 bg-white p-2 rounded shadow text-xs z-50">
        {Math.round(camera.z * 100)}%
      </div>

      {writingNode && (
          <textarea
            autoFocus
            className="fixed bg-transparent border border-dashed border-blue-400 outline-none resize-none p-0 m-0 overflow-hidden"
            style={{
                left: canvasToScreen({ x: writingNode.x, y: writingNode.y }, camera).x,
                top: canvasToScreen({ x: writingNode.x, y: writingNode.y }, camera).y,
                fontSize: `${24 * camera.z}px`,
                color: writingNode.color,
                width: '300px',
                height: '100px',
                zIndex: 60
            }}
            value={writingNode.text}
            onChange={(e) => setWritingNode({ ...writingNode, text: e.target.value })}
            onBlur={saveTextNode}
            onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    saveTextNode();
                }
            }}
          />
      )}

      <canvas
        ref={canvasRef}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onWheel={handleWheel}
        className={`block w-full h-full touch-none ${activeTool === 'hand' ? 'cursor-grab active:cursor-grabbing' : 'cursor-crosshair'}`}
      />
    </div>
  );
}