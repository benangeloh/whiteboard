'use client';

import { useEffect, useRef, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { throttle } from '@/lib/utils';
import { CanvasElement, Camera, Point, UserCursor, ToolType, BoundingBox } from '@/types/canvas';
import { screenToCanvas, canvasToScreen, getElementBounds, isHit, getResizeHandle, getCursorForHandle, rotatePoint, getWrappedText } from '@/lib/canvas-math';
import { RealtimeChannel } from '@supabase/supabase-js';
import TopToolbar from './TopToolbar';
import SideToolbar from './SideToolbar';

interface CanvasBoardProps {
  roomId: string;
  userId: string;
}

type TransformAction = 
  | { type: 'none' }
  | { type: 'moving'; offsetX: number; offsetY: number }
  | { type: 'resizing'; handle: string; startPoint: Point; startBounds: BoundingBox; startElement: CanvasElement }
  | { type: 'rotating'; startAngle: number; startRotation: number; centerX: number; centerY: number };

type WritingNodeState = {
    id: string;
    x: number;
    y: number;
    width: number;
    height: number;
    text: string;
    color: string;
    rotation: number;
};

type HistoryItem = 
  | { type: 'create'; id: string }
  | { type: 'delete'; id: string }
  | { type: 'update'; id: string; prev: Partial<CanvasElement>; next: Partial<CanvasElement> };

const FONT_FAMILY = "Inter, sans-serif";

export default function CanvasBoard({ roomId, userId }: CanvasBoardProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  
  // State
  const [camera, setCamera] = useState<Camera>({ x: 0, y: 0, z: 1 });
  const [activeTool, setActiveTool] = useState<ToolType>('pencil');
  const [color, setColor] = useState('#000000');
  const [strokeWidth, setStrokeWidth] = useState(3);
  const [elements, setElements] = useState<CanvasElement[]>([]);
  const [otherCursors, setOtherCursors] = useState<Record<string, UserCursor>>({});
  const [selectedElement, setSelectedElement] = useState<CanvasElement | null>(null);
  const [transformAction, setTransformAction] = useState<TransformAction>({ type: 'none' });
  const [writingNode, setWritingNode] = useState<WritingNodeState | null>(null);
  const [cursorStyle, setCursorStyle] = useState('default');
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [historyStep, setHistoryStep] = useState(-1); 
  const clipboardRef = useRef<CanvasElement | null>(null);

  // Refs
  const isDraggingRef = useRef(false);
  const dragStartRef = useRef<Point>({ x: 0, y: 0 }); 
  const currentElementRef = useRef<CanvasElement | null>(null);
  const elementsRef = useRef<CanvasElement[]>([]); 
  const channelRef = useRef<RealtimeChannel | null>(null); 
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  
  const transformStartElementRef = useRef<CanvasElement | null>(null);

  const supabase = createClient();

  useEffect(() => { elementsRef.current = elements; }, [elements]);

  // --- SHORTCUTS ---
  useEffect(() => {
    const handleKeyDown = async (e: KeyboardEvent) => {
        if ((e.target as HTMLElement).tagName === 'TEXTAREA') return;

        const isCtrl = e.ctrlKey || e.metaKey;

        if (isCtrl && e.key === 'z' && !e.shiftKey) {
            e.preventDefault();
            performUndo();
        }
        if ((isCtrl && e.shiftKey && e.key === 'z') || (isCtrl && e.key === 'y')) {
            e.preventDefault();
            performRedo();
        }
        if (isCtrl && e.key === 'c') {
            if (selectedElement) {
                clipboardRef.current = selectedElement;
            }
        }
        if (isCtrl && e.key === 'v') {
            performPaste();
        }
        if (isCtrl && e.key === 'x') {
            if (selectedElement) {
                clipboardRef.current = selectedElement;
                deleteElement(selectedElement);
            }
        }
        if (e.key === 'Delete' || e.key === 'Backspace') {
            if (selectedElement) {
                deleteElement(selectedElement);
            }
        }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedElement, history, historyStep]); 

  // --- ACTIONS ---

  const addToHistory = (item: HistoryItem) => {
      const newHistory = history.slice(0, historyStep + 1);
      newHistory.push(item);
      setHistory(newHistory);
      setHistoryStep(newHistory.length - 1);
  };

  const performUndo = async () => {
      if (historyStep < 0) return;
      const item = history[historyStep];
      
      if (item.type === 'create') {
          await supabase.from('strokes').update({ is_deleted: true }).eq('id', item.id);
          setElements(prev => prev.filter(e => e.id !== item.id));
          setSelectedElement(null);
      } else if (item.type === 'delete') {
          await supabase.from('strokes').update({ is_deleted: false }).eq('id', item.id);
      } else if (item.type === 'update') {
          await supabase.from('strokes').update(item.prev).eq('id', item.id);
          setElements(prev => prev.map(e => e.id === item.id ? { ...e, ...item.prev } : e));
          if (selectedElement?.id === item.id) setSelectedElement(prev => prev ? { ...prev, ...item.prev } : null);
      }

      setHistoryStep(prev => prev - 1);
  };

  const performRedo = async () => {
      if (historyStep >= history.length - 1) return;
      const nextStep = historyStep + 1;
      const item = history[nextStep];

      if (item.type === 'create') {
          await supabase.from('strokes').update({ is_deleted: false }).eq('id', item.id);
      } else if (item.type === 'delete') {
          await supabase.from('strokes').update({ is_deleted: true }).eq('id', item.id);
          setElements(prev => prev.filter(e => e.id !== item.id));
          setSelectedElement(null);
      } else if (item.type === 'update') {
          await supabase.from('strokes').update(item.next).eq('id', item.id);
          setElements(prev => prev.map(e => e.id === item.id ? { ...e, ...item.next } : e));
          if (selectedElement?.id === item.id) setSelectedElement(prev => prev ? { ...prev, ...item.next } : null);
      }

      setHistoryStep(nextStep);
  };

  const performPaste = async () => {
      if (!clipboardRef.current) return;
      
      const copy = { ...clipboardRef.current };
      const newId = crypto.randomUUID();
      const offset = 20;
      let newPoints = copy.points;
      
      if (copy.type === 'pencil' && copy.points) {
          newPoints = copy.points.map(p => ({ x: p.x + offset, y: p.y + offset }));
      }

      const newEl: CanvasElement = {
          ...copy,
          id: newId,
          user_id: userId,
          x: copy.x + offset,
          y: copy.y + offset,
          points: newPoints,
      };

      const { id, ...rest } = newEl;
      const payload = { ...rest, points: rest.points || null } as any; 
      if (payload.created_at) delete payload.created_at; 

      const { data } = await supabase.from('strokes').insert(payload).select();
      
      if (data && data[0]) {
          const inserted = data[0];
          setElements(prev => [...prev, inserted]);
          setSelectedElement(inserted);
          addToHistory({ type: 'create', id: inserted.id });
      }
  };

  const deleteElement = async (el: CanvasElement) => {
      addToHistory({ type: 'delete', id: el.id! });
      setElements(prev => prev.filter(e => e.id !== el.id));
      setSelectedElement(null);
      await supabase.from('strokes').update({ is_deleted: true }).eq('id', el.id);
  };

  // 1. Data Loading & Realtime
  useEffect(() => {
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

    const channel = supabase.channel(`room:${roomId}`, { config: { presence: { key: userId } } });
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
          if (updated.is_deleted) {
              setElements(prev => prev.filter(e => e.id !== updated.id));
              if (selectedElement?.id === updated.id) setSelectedElement(null);
              return;
          }
          setElements(prev => {
              const exists = prev.find(e => e.id === updated.id);
              if (exists) return prev.map(e => e.id === updated.id ? updated : e);
              return [...prev, updated];
          });
      })
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') channel.track({ x: 0, y: 0, userId, color });
      });

    return () => { 
        supabase.removeChannel(channel);
        channelRef.current = null;
    };
  }, [roomId, userId, supabase]);


  const broadcastCursor = useRef(throttle((point: Point) => {
    if (channelRef.current) channelRef.current.track({ x: point.x, y: point.y, userId, color });
  }, 30)).current;

  // --- EVENT HANDLERS ---

  const handleDoubleClick = (e: React.MouseEvent) => {
    const canvasPoint = screenToCanvas({ x: e.clientX, y: e.clientY }, camera);
    const hitEl = [...elementsRef.current].reverse().find(el => isHit(canvasPoint, el));

    if (hitEl && hitEl.type === 'text') {
        setWritingNode({
            id: hitEl.id!,
            x: hitEl.x,
            y: hitEl.y,
            width: hitEl.width || 100,
            height: hitEl.height || 24,
            text: hitEl.text || '',
            color: hitEl.color,
            rotation: hitEl.rotation || 0
        });
        setSelectedElement(null); 
    }
  };

  const handlePointerDown = (e: React.PointerEvent) => {
    if (writingNode) { saveTextNode(); return; }

    e.currentTarget.setPointerCapture(e.pointerId);
    isDraggingRef.current = true;
    dragStartRef.current = { x: e.clientX, y: e.clientY };
    const canvasPoint = screenToCanvas({ x: e.clientX, y: e.clientY }, camera);

    if (activeTool === 'selection') {
        if (selectedElement) {
            const bounds = getElementBounds(selectedElement);
            if (bounds) {
                const handle = getResizeHandle(canvasPoint, bounds, camera.z, selectedElement.rotation || 0);
                if (handle) {
                    transformStartElementRef.current = JSON.parse(JSON.stringify(selectedElement)); 
                    
                    if (handle === 'rot') {
                        const cx = bounds.minX + bounds.width / 2;
                        const cy = bounds.minY + bounds.height / 2;
                        const angle = Math.atan2(canvasPoint.y - cy, canvasPoint.x - cx);
                        setTransformAction({ type: 'rotating', startAngle: angle, startRotation: selectedElement.rotation || 0, centerX: cx, centerY: cy });
                    } else {
                        setTransformAction({ 
                            type: 'resizing', handle, startPoint: canvasPoint, startBounds: { ...bounds },
                            startElement: JSON.parse(JSON.stringify(selectedElement))
                        });
                    }
                    return;
                }
            }
        }
        
        const hitEl = [...elementsRef.current].reverse().find(el => isHit(canvasPoint, el));
        if (hitEl) {
            setSelectedElement(hitEl);
            transformStartElementRef.current = JSON.parse(JSON.stringify(hitEl));
            const startX = hitEl.type === 'pencil' ? getElementBounds(hitEl)!.minX : hitEl.x;
            const startY = hitEl.type === 'pencil' ? getElementBounds(hitEl)!.minY : hitEl.y;
            setTransformAction({ type: 'moving', offsetX: canvasPoint.x - startX, offsetY: canvasPoint.y - startY });
        } else {
            setSelectedElement(null);
            setTransformAction({ type: 'none' });
        }
        return;
    }

    if (activeTool === 'hand') return;
    
    if (activeTool === 'eraser') {
      const hitElement = [...elementsRef.current].reverse().find(el => isHit(canvasPoint, el));
      if (hitElement && hitElement.id) {
        deleteElement(hitElement);
      }
      return;
    }

    setSelectedElement(null);
    const newId = crypto.randomUUID();
    
    const newEl: CanvasElement = {
      id: newId, 
      room_id: roomId, 
      user_id: userId, 
      type: activeTool,
      x: canvasPoint.x, 
      y: canvasPoint.y, 
      width: activeTool === 'text' ? 10 : 0, 
      height: activeTool === 'text' ? 24 : 0, 
      color, 
      stroke_width: strokeWidth, 
      points: activeTool === 'pencil' ? [canvasPoint] : undefined, 
      rotation: 0
    };
    currentElementRef.current = newEl;
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    const screenPoint = { x: e.clientX, y: e.clientY };
    const canvasPoint = screenToCanvas(screenPoint, camera);
    broadcastCursor(canvasPoint);

    if (!isDraggingRef.current && activeTool === 'selection') {
        let cursor = 'default';
        if (selectedElement) {
            const bounds = getElementBounds(selectedElement);
            if (bounds) {
                const handle = getResizeHandle(canvasPoint, bounds, camera.z, selectedElement.rotation || 0);
                if (handle) cursor = getCursorForHandle(handle, selectedElement.rotation || 0);
                else if (isHit(canvasPoint, selectedElement)) cursor = 'move';
            }
        } else {
            const hitEl = [...elementsRef.current].reverse().find(el => isHit(canvasPoint, el));
            if (hitEl) cursor = 'move';
        }
        setCursorStyle(cursor);
    } else if (activeTool === 'hand') {
        setCursorStyle(isDraggingRef.current ? 'grabbing' : 'grab');
    } else {
        setCursorStyle('crosshair');
    }

    if (!isDraggingRef.current) return;

    if (activeTool === 'hand' || (e.buttons === 4) || (activeTool === 'selection' && !selectedElement && !transformAction.type.includes('mov'))) { 
      if(activeTool === 'selection' && transformAction.type !== 'none') { /* noop */ }
      else if (activeTool === 'hand' || e.buttons === 4 || e.shiftKey) {
          const dx = screenPoint.x - dragStartRef.current.x;
          const dy = screenPoint.y - dragStartRef.current.y;
          setCamera(prev => ({ ...prev, x: prev.x + dx, y: prev.y + dy }));
          dragStartRef.current = screenPoint;
          return;
      }
    }

    if (activeTool === 'selection' && selectedElement) {
        if (transformAction.type === 'rotating') {
            const { centerX, centerY, startAngle, startRotation } = transformAction;
            const currentAngle = Math.atan2(canvasPoint.y - centerY, canvasPoint.x - centerX);
            const deltaDegrees = (currentAngle - startAngle) * (180 / Math.PI);
            const newRotation = startRotation + deltaDegrees;
            const updatedEl = { ...selectedElement, rotation: newRotation };
            setSelectedElement(updatedEl);
            setElements(prev => prev.map(el => el.id === updatedEl.id ? updatedEl : el));
        }
        else if (transformAction.type === 'moving') {
            const newX = canvasPoint.x - transformAction.offsetX;
            const newY = canvasPoint.y - transformAction.offsetY;
            if (selectedElement.type === 'pencil' && selectedElement.points) {
                const bounds = getElementBounds(selectedElement);
                if (!bounds) return;
                const dx = newX - bounds.minX;
                const dy = newY - bounds.minY;
                const shiftedPoints = selectedElement.points.map(p => ({ x: p.x + dx, y: p.y + dy }));
                const updatedEl = { ...selectedElement, points: shiftedPoints };
                setSelectedElement(updatedEl);
                setElements(prev => prev.map(el => el.id === updatedEl.id ? updatedEl : el));
            } else {
                const updatedEl = { ...selectedElement, x: newX, y: newY };
                setSelectedElement(updatedEl);
                setElements(prev => prev.map(el => el.id === updatedEl.id ? updatedEl : el));
            }
        } 
        else if (transformAction.type === 'resizing') {
             const { startBounds, startPoint, handle, startElement } = transformAction;
             const rotation = (startElement.rotation || 0);
             const oldCx = startBounds.minX + startBounds.width / 2;
             const oldCy = startBounds.minY + startBounds.height / 2;
             const unrotatedMouse = rotatePoint(canvasPoint, { x: oldCx, y: oldCy }, -rotation);
             const unrotatedStart = rotatePoint(startPoint, { x: oldCx, y: oldCy }, -rotation);
             const dx = unrotatedMouse.x - unrotatedStart.x;
             const dy = unrotatedMouse.y - unrotatedStart.y;
             let newX = startBounds.minX; let newY = startBounds.minY;
             let newW = startBounds.width; let newH = startBounds.height;
             if (handle.includes('r')) newW = startBounds.width + dx;
             if (handle.includes('l')) { newX = startBounds.minX + dx; newW = startBounds.width - dx; }
             if (handle.includes('b')) newH = startBounds.height + dy;
             if (handle.includes('t')) { newY = startBounds.minY + dy; newH = startBounds.height - dy; }
             
             if (e.shiftKey) {
                 const ratio = startBounds.width / startBounds.height;
                 if (handle.includes('l') || handle.includes('r')) {
                     newH = newW / ratio; 
                     if (handle.includes('t')) newY = startBounds.maxY - newH;
                 } else {
                     newW = newH * ratio; 
                     if (handle.includes('l')) newX = startBounds.maxX - newW;
                 }
             }

             if (newW < 0) { newX += newW; newW = Math.abs(newW); }
             if (newH < 0) { newY += newH; newH = Math.abs(newH); }
             let ax = startBounds.minX; let ay = startBounds.minY;
             if (handle.includes('l')) ax = startBounds.maxX;
             if (handle.includes('t')) ay = startBounds.maxY;
             if (handle === 'tm') { ax = startBounds.minX + startBounds.width/2; ay = startBounds.maxY; }
             if (handle === 'bm') { ax = startBounds.minX + startBounds.width/2; ay = startBounds.minY; }
             if (handle === 'lm') { ax = startBounds.maxX; ay = startBounds.minY + startBounds.height/2; }
             if (handle === 'rm') { ax = startBounds.minX; ay = startBounds.minY + startBounds.height/2; }
             const originalAnchorWorld = rotatePoint({x: ax, y: ay}, {x: oldCx, y: oldCy}, rotation);
             let newAx = newX; let newAy = newY;
             if (handle.includes('l')) newAx = newX + newW;
             if (handle.includes('t')) newAy = newY + newH;
             if (handle === 'tm') { newAx = newX + newW/2; newAy = newY + newH; }
             if (handle === 'bm') { newAx = newX + newW/2; newAy = newY; }
             if (handle === 'lm') { newAx = newX + newW; newAy = newY + newH/2; }
             if (handle === 'rm') { newAx = newX; newAy = newY + newH/2; }
             const newCx = newX + newW / 2;
             const newCy = newY + newH / 2;
             const unrotatedDistToAnchorX = newAx - newCx;
             const unrotatedDistToAnchorY = newAy - newCy;
             const rotatedDistToAnchor = rotatePoint({x: unrotatedDistToAnchorX, y: unrotatedDistToAnchorY}, {x: 0, y: 0}, rotation);
             const correctCenterWorldX = originalAnchorWorld.x - rotatedDistToAnchor.x;
             const correctCenterWorldY = originalAnchorWorld.y - rotatedDistToAnchor.y;
             const correctedX = correctCenterWorldX - newW / 2;
             const correctedY = correctCenterWorldY - newH / 2;
             if (selectedElement.type === 'pencil' && startElement.points) {
                 const scaleX = newW / (startBounds.width || 1);
                 const scaleY = newH / (startBounds.height || 1);
                 const newPoints = startElement.points.map(p => ({
                     x: correctedX + (p.x - startBounds.minX) * scaleX,
                     y: correctedY + (p.y - startBounds.minY) * scaleY
                 }));
                 const updatedEl = { ...selectedElement, points: newPoints };
                 setSelectedElement(updatedEl);
                 setElements(prev => prev.map(el => el.id === updatedEl.id ? updatedEl : el));
             } else {
                 const updatedEl = { ...selectedElement, x: correctedX, y: correctedY, width: newW, height: newH };
                 setSelectedElement(updatedEl);
                 setElements(prev => prev.map(el => el.id === updatedEl.id ? updatedEl : el));
             }
        }
        return;
    }

    if (activeTool === 'eraser') {
       const hitElement = [...elementsRef.current].reverse().find(el => isHit(canvasPoint, el));
       if (hitElement && hitElement.id) {
         deleteElement(hitElement);
       }
       return;
    }

    const current = currentElementRef.current;
    if (!current) return;

    if (activeTool === 'pencil') {
      current.points?.push(canvasPoint);
    } else if (activeTool === 'text') {
        current.width = canvasPoint.x - current.x;
    } else {
      let w = canvasPoint.x - current.x;
      let h = canvasPoint.y - current.y;

      if (e.shiftKey) {
          if (['rect', 'diamond', 'ellipse'].includes(activeTool)) {
              const dim = Math.max(Math.abs(w), Math.abs(h));
              w = w < 0 ? -dim : dim;
              h = h < 0 ? -dim : dim;
          } else if (['line', 'arrow'].includes(activeTool)) {
              const angle = Math.atan2(h, w) * (180 / Math.PI);
              const snap = Math.round(angle / 45) * 45;
              const dist = Math.hypot(w, h);
              const rad = snap * (Math.PI / 180);
              w = Math.cos(rad) * dist;
              h = Math.sin(rad) * dist;
          }
      }

      current.width = w;
      current.height = h;
    }
  };

  const handlePointerUp = async (e: React.PointerEvent) => {
    isDraggingRef.current = false;
    e.currentTarget.releasePointerCapture(e.pointerId);

    if (activeTool === 'selection' && selectedElement && transformAction.type !== 'none') {
        const { id, ...payload } = selectedElement;
        const dbPayload = { ...payload, points: payload.points || null };
        await supabase.from('strokes').update(dbPayload).eq('id', selectedElement.id);
        
        if (transformStartElementRef.current) {
            addToHistory({
                type: 'update',
                id: selectedElement.id!,
                prev: transformStartElementRef.current,
                next: selectedElement
            });
        }
        setTransformAction({ type: 'none' });
        transformStartElementRef.current = null;
        return;
    }

    const current = currentElementRef.current;
    if (!current) return;

    if (activeTool !== 'pencil') {
        if ((current.width || 0) < 0) {
            current.x += current.width || 0;
            current.width = Math.abs(current.width || 0);
        }
        if (activeTool === 'text') {
             if ((current.width || 0) < 20) current.width = 100;
             current.height = 24; 
        } else {
            if ((current.height || 0) < 0) {
                current.y += current.height || 0;
                current.height = Math.abs(current.height || 0);
            }
        }
        
        if (activeTool !== 'text' && (current.width || 0) < 5 && (current.height || 0) < 5) {
            currentElementRef.current = null;
            return;
        }
    }

    if (activeTool === 'text' && current.id) {
        setWritingNode({
            id: current.id,
            x: current.x,
            y: current.y,
            width: current.width || 100,
            height: current.height || 24,
            text: '',
            color: current.color,
            rotation: current.rotation || 0
        });
        currentElementRef.current = null;
        return; 
    }

    setElements(prev => [...prev, current]);
    setSelectedElement(current);
    setActiveTool('selection'); 
    currentElementRef.current = null;
    
    addToHistory({ type: 'create', id: current.id! });

    const { id, ...rest } = current;
    const payload = { ...rest, id: current.id, points: rest.points || null }; 

    const { data } = await supabase.from('strokes').insert(payload).select();
    if (data && data[0]) {
        const realElement = data[0];
        setElements(prev => prev.map(el => el === current ? realElement : el));
        setSelectedElement(realElement); 
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

  const saveTextNode = async () => {
     if (!writingNode) return;
     if (!writingNode.text.trim()) { setWritingNode(null); return; }

     const finalHeight = textareaRef.current ? textareaRef.current.scrollHeight : writingNode.height;

     const newEl: CanvasElement = {
         id: writingNode.id, 
         room_id: roomId, 
         user_id: userId, 
         type: 'text',
         x: writingNode.x, 
         y: writingNode.y, 
         width: writingNode.width, 
         height: finalHeight / camera.z,
         color: writingNode.color, 
         stroke_width: 1, 
         text: writingNode.text, 
         rotation: writingNode.rotation
     };

     const exists = elements.find(e => e.id === writingNode.id);
     
     if (exists) {
         setElements(prev => prev.map(e => e.id === writingNode.id ? newEl : e));
         const { id, ...payload } = newEl;
         await supabase.from('strokes').update({ ...payload, points: null }).eq('id', id);
     } else {
         setElements(prev => [...prev, newEl]);
         addToHistory({ type: 'create', id: newEl.id! }); 
         
         const { id, ...rest } = newEl;
         const payload = { ...rest, id: newEl.id, points: null };
         
         const { data } = await supabase.from('strokes').insert(payload).select();
         if(data && data[0]) setSelectedElement(data[0]);
     }

     setWritingNode(null);
     setActiveTool('selection');
  };

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
        ctx.save();
        if (el.rotation) {
            const bounds = getElementBounds(el);
            if (bounds) {
                const cx = bounds.minX + bounds.width / 2;
                const cy = bounds.minY + bounds.height / 2;
                ctx.translate(cx, cy);
                ctx.rotate((el.rotation * Math.PI) / 180);
                ctx.translate(-cx, -cy);
            }
        }
        ctx.strokeStyle = el.color;
        ctx.lineWidth = el.stroke_width;
        ctx.fillStyle = el.fill_color || 'transparent'; 
        ctx.beginPath();
        switch(el.type) {
            case 'pencil':
                if (el.points && el.points.length > 0) {
                    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
                    ctx.moveTo(el.points[0].x, el.points[0].y);
                    for(let i=1; i<el.points.length; i++) ctx.lineTo(el.points[i].x, el.points[i].y);
                    ctx.stroke();
                }
                break;
            case 'text':
                if(el.text && el.width) { 
                    ctx.font = `24px ${FONT_FAMILY}`; 
                    ctx.fillStyle = el.color; 
                    ctx.textBaseline = "top";
                    const lines = getWrappedText(ctx, el.text, el.width - 4);
                    lines.forEach((line, i) => {
                        ctx.fillText(line, el.x, el.y + (i * 28));
                    });
                }
                break;
            case 'rect': ctx.rect(el.x, el.y, el.width || 0, el.height || 0); ctx.stroke(); break;
            case 'ellipse':
                const rx = (el.width || 0) / 2; const ry = (el.height || 0) / 2;
                ctx.ellipse(el.x + rx, el.y + ry, Math.abs(rx), Math.abs(ry), 0, 0, 2 * Math.PI); ctx.stroke(); break;
            case 'diamond':
                const w = el.width || 0; const h = el.height || 0;
                ctx.moveTo(el.x + w/2, el.y); ctx.lineTo(el.x + w, el.y + h/2);
                ctx.lineTo(el.x + w/2, el.y + h); ctx.lineTo(el.x, el.y + h/2);
                ctx.closePath(); ctx.stroke(); break;
            case 'line': case 'arrow':
                ctx.moveTo(el.x, el.y); ctx.lineTo(el.x + (el.width || 0), el.y + (el.height || 0)); ctx.stroke(); break;
        }
        ctx.restore();
      };

      elementsRef.current.forEach(drawElement);
      
      if (currentElementRef.current) { 
        ctx.globalAlpha = 0.6; 
        drawElement(currentElementRef.current); 
        ctx.globalAlpha = 1.0; 
        if(currentElementRef.current.type === 'text') {
            ctx.strokeStyle = '#3b82f6'; ctx.lineWidth = 1;
            ctx.strokeRect(currentElementRef.current.x, currentElementRef.current.y, currentElementRef.current.width || 0, currentElementRef.current.height || 0);
        }
      }

      if (selectedElement) {
         const bounds = getElementBounds(selectedElement);
        if (bounds) {
            ctx.save();
            if (selectedElement.rotation) {
                const cx = bounds.minX + bounds.width / 2;
                const cy = bounds.minY + bounds.height / 2;
                ctx.translate(cx, cy);
                ctx.rotate((selectedElement.rotation * Math.PI) / 180);
                ctx.translate(-cx, -cy);
            }
            ctx.strokeStyle = '#3b82f6'; ctx.lineWidth = 1 / camera.z;
            ctx.strokeRect(bounds.minX, bounds.minY, bounds.width, bounds.height);
            const handleSize = 8 / camera.z; ctx.fillStyle = '#ffffff'; ctx.strokeStyle = '#3b82f6';
            const handles = [
                { x: bounds.minX, y: bounds.minY }, { x: bounds.maxX, y: bounds.minY },
                { x: bounds.minX, y: bounds.maxY }, { x: bounds.maxX, y: bounds.maxY },
                { x: bounds.minX + bounds.width/2, y: bounds.minY }, { x: bounds.minX + bounds.width/2, y: bounds.maxY },
                { x: bounds.minX, y: bounds.minY + bounds.height/2 }, { x: bounds.maxX, y: bounds.minY + bounds.height/2 },
            ];
            handles.forEach(h => { ctx.fillRect(h.x - handleSize/2, h.y - handleSize/2, handleSize, handleSize); ctx.strokeRect(h.x - handleSize/2, h.y - handleSize/2, handleSize, handleSize); });
            const rotY = bounds.minY - (30 / camera.z);
            ctx.beginPath(); ctx.moveTo(bounds.minX + bounds.width/2, bounds.minY); ctx.lineTo(bounds.minX + bounds.width/2, rotY); ctx.stroke();
            ctx.beginPath(); ctx.arc(bounds.minX + bounds.width/2, rotY, 5/camera.z, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
            ctx.restore();
        }
      }

      Object.values(otherCursors).forEach(c => {
         ctx.fillStyle = c.color; ctx.beginPath(); ctx.arc(c.x, c.y, 5 / camera.z, 0, 2 * Math.PI); 
         ctx.fill(); ctx.font = `${12 / camera.z}px ${FONT_FAMILY}`; ctx.fillText(c.userId.slice(0, 4), c.x + 10/camera.z, c.y);
      });

      ctx.restore(); 
      requestAnimationFrame(render);
    };

    const id = requestAnimationFrame(render);
    return () => cancelAnimationFrame(id);
  }, [camera, otherCursors, selectedElement]); 

  useEffect(() => {
      if (writingNode && textareaRef.current) {
          textareaRef.current.style.height = 'auto';
          textareaRef.current.style.height = textareaRef.current.scrollHeight + 'px';
      }
  }, [writingNode?.text]);

  return (
    <div className="w-full h-screen bg-slate-50 overflow-hidden relative">
      <TopToolbar activeTool={activeTool} setTool={setActiveTool} />
      <SideToolbar 
        tool={activeTool} 
        color={color} 
        setColor={setColor} 
        width={strokeWidth} 
        setWidth={setStrokeWidth} 
        onUndo={performUndo} 
        onSave={() => {}} 
      />
      <div className="fixed bottom-4 left-4 bg-white p-2 rounded shadow text-xs z-50">{Math.round(camera.z * 100)}%</div>
      
      {writingNode && (
          <textarea
            ref={textareaRef}
            autoFocus
            className="fixed bg-transparent border border-blue-500 outline-none resize-none overflow-hidden"
            style={{
                left: canvasToScreen({ x: writingNode.x, y: writingNode.y }, camera).x,
                top: canvasToScreen({ x: writingNode.x, y: writingNode.y }, camera).y,
                width: writingNode.width * camera.z,
                height: 'auto',
                minHeight: writingNode.height * camera.z,
                fontSize: `${24 * camera.z}px`, 
                lineHeight: `${28 * camera.z}px`,
                fontFamily: FONT_FAMILY,
                color: writingNode.color,
                zIndex: 60,
                padding: 0,
                margin: 0,
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
                transform: `rotate(${writingNode.rotation}deg)`,
                transformOrigin: 'top left'
            }}
            value={writingNode.text}
            onChange={(e) => setWritingNode({ ...writingNode, text: e.target.value })}
            onBlur={saveTextNode}
            onPointerDown={(e) => e.stopPropagation()} 
          />
      )}
      
      <canvas 
        ref={canvasRef} 
        onPointerDown={handlePointerDown} 
        onPointerMove={handlePointerMove} 
        onPointerUp={handlePointerUp} 
        onDoubleClick={handleDoubleClick} 
        onWheel={handleWheel} 
        style={{ cursor: cursorStyle }}
        className="block w-full h-full touch-none"
      />
    </div>
  );
}