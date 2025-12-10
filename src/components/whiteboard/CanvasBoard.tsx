'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { throttle } from '@/lib/utils';
import { CanvasElement, Camera, Point, UserCursor, ToolType, BoundingBox } from '@/types/canvas';
import { screenToCanvas, canvasToScreen, getElementBounds, isHit, getResizeHandle, getCursorForHandle, rotatePoint, getWrappedText } from '@/lib/canvas-math';
import { RealtimeChannel } from '@supabase/supabase-js';
import TopToolbar from './TopToolbar';
import SideToolbar from './SideToolbar';

import { PermissionLevel } from '@/types/database';

interface UserProfile {
  displayName: string;
  avatarUrl: string | null;
  email: string;
}

interface CanvasBoardProps {
  canvasId: string;
  userId: string;
  userProfile?: UserProfile;
  permission?: PermissionLevel;
  canEdit?: boolean;
  canvasTitle?: string;
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
    font_family: string;
    font_size: number;
    text_align: 'left' | 'center' | 'right';
};

type HistoryItem = 
  | { type: 'create'; id: string }
  | { type: 'delete'; id: string }
  | { type: 'update'; id: string; prev: Partial<CanvasElement>; next: Partial<CanvasElement> };

const FONT_FAMILY = "Inter, sans-serif";

export default function CanvasBoard({
  canvasId,
  userId,
  userProfile,
  permission = 'editor',
  canEdit = true,
  canvasTitle = 'Canvas'
}: CanvasBoardProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  
  // State
  const [camera, setCamera] = useState<Camera>({ x: 0, y: 0, z: 1 });
  const [activeTool, setActiveTool] = useState<ToolType>('pencil');
  const [toolAttributes, setToolAttributes] = useState<Partial<CanvasElement>>({
      color: '#000000',
      fill_color: 'transparent',
      stroke_width: 3,
      stroke_style: 'solid',
      opacity: 1,
      font_family: 'Inter, sans-serif',
      font_size: 24,
      text_align: 'left',
  });
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
  const broadcastCursorRef = useRef<(point: Point) => void>(() => {});
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const transformStartElementRef = useRef<CanvasElement | null>(null);

  const supabase = useMemo(() => createClient(), []);

  useEffect(() => { elementsRef.current = elements; }, [elements]);

  const selectedElementRef = useRef<CanvasElement | null>(null);
  useEffect(() => { selectedElementRef.current = selectedElement; }, [selectedElement]);

  const cursorColorRef = useRef(toolAttributes.color || '#000000');
  useEffect(() => { cursorColorRef.current = toolAttributes.color || '#000000'; }, [toolAttributes.color]);

  const userProfileRef = useRef(userProfile);
  useEffect(() => { userProfileRef.current = userProfile; }, [userProfile]);

  const thumbnailTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const normalizePoints = useCallback(<T extends { points?: Point[] | null }>(value: T): T & { points: Point[] | null } => ({
    ...value,
    points: value.points ?? null,
  }), []);

  const captureThumbnail = useCallback(async () => {
    if (!canvasRef.current) return;
    try {
      const dataUrl = canvasRef.current.toDataURL('image/png');
      const response = await fetch(dataUrl);
      const blob = await response.blob();
      const fileName = `${canvasId}-${Date.now()}.png`;
      const { error: uploadError } = await supabase.storage
        .from('thumbnails')
        .upload(fileName, blob, { upsert: true, cacheControl: '3600', contentType: 'image/png' });
      if (uploadError) return;
      const { data: publicUrlData } = supabase.storage.from('thumbnails').getPublicUrl(fileName);
      const publicUrl = publicUrlData?.publicUrl;
      if (!publicUrl) return;
      await supabase.from('canvases').update({ thumbnail_url: publicUrl }).eq('id', canvasId);
    } catch (thumbnailError) {
      console.error('Failed to capture thumbnail', thumbnailError);
    }
  }, [canvasId, supabase]);

  const scheduleThumbnailCapture = useCallback(() => {
    if (thumbnailTimeoutRef.current) clearTimeout(thumbnailTimeoutRef.current);
    thumbnailTimeoutRef.current = setTimeout(() => {
      thumbnailTimeoutRef.current = null;
      void captureThumbnail();
    }, 1500);
  }, [captureThumbnail, canvasId]);

  useEffect(() => () => {
    if (thumbnailTimeoutRef.current) {
      clearTimeout(thumbnailTimeoutRef.current);
      thumbnailTimeoutRef.current = null;
    }
  }, []);

  // --- ATTRIBUTE HANDLER ---
  const updateAttributes = async (attrs: Partial<CanvasElement>) => {
      if (selectedElement) {
          const updated = { ...selectedElement, ...attrs };
          setElements(prev => prev.map(e => e.id === updated.id ? updated : e));
          setSelectedElement(updated);
          
          // debounce in prod, direct update for now
          const { id: updatedId, ...payload } = updated;
          await supabase.from('strokes').update(normalizePoints(payload)).eq('id', updatedId);
          
      } else {
          setToolAttributes(prev => ({ ...prev, ...attrs }));
      }
  };

  // --- LAYERING HANDLER ---
  const handleLayerChange = async (direction: 'front' | 'back') => {
      if (!selectedElement) return;
      
      const newLayer = direction === 'front' ? Math.max(...elements.map(e => e.layer || 0)) + 1 : Math.min(...elements.map(e => e.layer || 0)) - 1;
      
      const updated = { ...selectedElement, layer: newLayer };
      setElements(prev => {
          const others = prev.filter(e => e.id !== updated.id);
          // resort locally based on layer
          const newList = [...others, updated].sort((a, b) => (a.layer || 0) - (b.layer || 0));
          return newList;
      });
      setSelectedElement(updated);
      await supabase.from('strokes').update({ layer: newLayer }).eq('id', updated.id);
  };

  // --- KEYBOARD SHORTCUTS ---
  // --- ACTIONS ---
    const addToHistory = useCallback((item: HistoryItem) => {
      const nextHistory = history.slice(0, historyStep + 1);
      nextHistory.push(item);
      setHistory(nextHistory);
      setHistoryStep(nextHistory.length - 1);
    }, [history, historyStep]);

    const performUndo = useCallback(async () => {
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
        setSelectedElement(prev => {
          if (!prev || prev.id !== item.id) return prev;
          return { ...prev, ...item.prev } as CanvasElement;
        });
      }
      setHistoryStep(prev => prev - 1);
      scheduleThumbnailCapture();
    }, [history, historyStep, scheduleThumbnailCapture, supabase]);

    const performRedo = useCallback(async () => {
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
        setSelectedElement(prev => {
          if (!prev || prev.id !== item.id) return prev;
          return { ...prev, ...item.next } as CanvasElement;
        });
      }
      setHistoryStep(nextStep);
      scheduleThumbnailCapture();
    }, [history, historyStep, scheduleThumbnailCapture, supabase]);

    const performPaste = useCallback(async () => {
      if (!clipboardRef.current) return;
      const copy = { ...clipboardRef.current };
      const newId = crypto.randomUUID();
      const offset = 20;
      let newPoints = copy.points;
      if (copy.type === 'pencil' && copy.points) { newPoints = copy.points.map(p => ({ x: p.x + offset, y: p.y + offset })); }

      const newEl: CanvasElement = {
        ...copy,
        id: newId,
        canvas_id: canvasId,
        user_id: userId,
        x: copy.x + offset,
        y: copy.y + offset,
        points: newPoints,
      };
        const { created_at: _createdAt, updated_at: _updatedAt, ...rest } = newEl as CanvasElement & {
        created_at?: string;
        updated_at?: string;
      };
        void _createdAt;
        void _updatedAt;
      const payload = normalizePoints(rest);

      const { data, error } = await supabase.from('strokes').insert(payload).select();
      if (error) {
        console.error('Failed to paste stroke', error);
        return;
      }
      if (data && data[0]) {
        const inserted = data[0];
        setElements(prev => [...prev, inserted]);
        setSelectedElement(inserted);
        addToHistory({ type: 'create', id: inserted.id! });
        scheduleThumbnailCapture();
      }
    }, [addToHistory, normalizePoints, scheduleThumbnailCapture, supabase, userId]);

    const deleteElement = useCallback(async (el: CanvasElement) => {
      addToHistory({ type: 'delete', id: el.id! });
      setElements(prev => prev.filter(e => e.id !== el.id));
      setSelectedElement(null);
      await supabase.from('strokes').update({ is_deleted: true }).eq('id', el.id);
      scheduleThumbnailCapture();
    }, [addToHistory, scheduleThumbnailCapture, supabase]);

    useEffect(() => {
      const handleKeyDown = (e: KeyboardEvent) => {
          if ((e.target as HTMLElement).tagName === 'TEXTAREA') return;
          const isCtrl = e.ctrlKey || e.metaKey;

          if (isCtrl && e.key === 'z' && !e.shiftKey) { e.preventDefault(); void performUndo(); }
          if ((isCtrl && e.shiftKey && e.key === 'z') || (isCtrl && e.key === 'y')) { e.preventDefault(); void performRedo(); }
          if (isCtrl && e.key === 'c') { if (selectedElement) clipboardRef.current = selectedElement; }
          if (isCtrl && e.key === 'v') { void performPaste(); }
          if (isCtrl && e.key === 'x') { if (selectedElement) { clipboardRef.current = selectedElement; void deleteElement(selectedElement); } }
          if (e.key === 'Delete' || e.key === 'Backspace') { if (selectedElement) void deleteElement(selectedElement); }
      };
      window.addEventListener('keydown', handleKeyDown);
      return () => window.removeEventListener('keydown', handleKeyDown);
    }, [deleteElement, performPaste, performRedo, performUndo, selectedElement]);

  // 1. Data Loading
  useEffect(() => {
    const fetchElements = async () => {
      const { data } = await supabase
        .from('strokes')
        .select('*')
        .eq('canvas_id', canvasId)
        .eq('is_deleted', false)
        .order('layer', { ascending: true }) // orderby layer
        .order('created_at', { ascending: true });
      if (data) setElements(data as CanvasElement[]);
    };
    fetchElements();

    const channel = supabase.channel(`canvas:${canvasId}`, { config: { presence: { key: userId } } });
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
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'strokes', filter: `canvas_id=eq.${canvasId}` }, (payload) => {
          const newEl = payload.new as CanvasElement;
          if (newEl.user_id !== userId) setElements(prev => [...prev, newEl].sort((a,b) => (a.layer||0) - (b.layer||0)));
      })
        .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'strokes', filter: `canvas_id=eq.${canvasId}` }, (payload) => {
          const updated = payload.new as CanvasElement;
          if (updated.is_deleted) {
              setElements(prev => prev.filter(e => e.id !== updated.id));
              setSelectedElement(prev => (prev?.id === updated.id ? null : prev));
              return;
          }
          setElements(prev => {
              const exists = prev.find(e => e.id === updated.id);
              if (exists) return prev.map(e => e.id === updated.id ? updated : e).sort((a,b) => (a.layer||0) - (b.layer||0));
              return [...prev, updated].sort((a,b) => (a.layer||0) - (b.layer||0));
          });
      })
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') channel.track({
          x: 0,
          y: 0,
          userId,
          color: cursorColorRef.current,
          displayName: userProfile?.displayName || userId.slice(0, 8),
          avatarUrl: userProfile?.avatarUrl,
        });
      });

    return () => {
        supabase.removeChannel(channel);
        channelRef.current = null;
    };
  }, [canvasId, userId, supabase, userProfile]);

  useEffect(() => {
    const throttled = throttle((point: Point) => {
      const profileSnapshot = userProfileRef.current;
      if (channelRef.current) {
        channelRef.current.track({
          x: point.x,
          y: point.y,
          userId,
          color: cursorColorRef.current,
          displayName: profileSnapshot?.displayName || userId.slice(0, 8),
          avatarUrl: profileSnapshot?.avatarUrl,
        });
      }
    }, 30);

    broadcastCursorRef.current = throttled;
    return () => {
      broadcastCursorRef.current = () => {};
    };
  }, [userId]);

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
            rotation: hitEl.rotation || 0,
            font_family: hitEl.font_family || 'Inter, sans-serif',
            font_size: hitEl.font_size || 24,
            text_align: hitEl.text_align || 'left',
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
        const hitEl = [...elementsRef.current].reverse().find(el => isHit(canvasPoint, el));
        // check handles
        if (selectedElement) {
             const bounds = getElementBounds(selectedElement);
             if (bounds) {
                 const handle = getResizeHandle(canvasPoint, bounds, camera.z, selectedElement.rotation || 0);
                 if (handle) {
                     transformStartElementRef.current = JSON.parse(JSON.stringify(selectedElement)) as CanvasElement; 
                     if (handle === 'rot') {
                        const cx = bounds.minX + bounds.width / 2;
                        const cy = bounds.minY + bounds.height / 2;
                        const angle = Math.atan2(canvasPoint.y - cy, canvasPoint.x - cx);
                        setTransformAction({ type: 'rotating', startAngle: angle, startRotation: selectedElement.rotation || 0, centerX: cx, centerY: cy });
                     } else {
                        setTransformAction({ type: 'resizing', handle, startPoint: canvasPoint, startBounds: { ...bounds }, startElement: JSON.parse(JSON.stringify(selectedElement)) as CanvasElement });
                     }
                     return;
                 }
             }
        }

        // check body hit
        if (hitEl) {
            setSelectedElement(hitEl);
            transformStartElementRef.current = JSON.parse(JSON.stringify(hitEl)) as CanvasElement;
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

    // Read-only mode: only allow selection and hand tools
    if (!canEdit) return;

    if (activeTool === 'eraser') {
      const hitElement = [...elementsRef.current].reverse().find(el => isHit(canvasPoint, el));
      if (hitElement && hitElement.id) deleteElement(hitElement);
      return;
    }

    // CREATE NEW
    setSelectedElement(null);
    const newId = crypto.randomUUID();
    const topLayer = elements.length > 0 ? Math.max(...elements.map(e => e.layer || 0)) + 1 : 0;
    
    const newEl: CanvasElement = {
      id: newId, 
      canvas_id: canvasId,
      user_id: userId, 
      type: activeTool,
      x: canvasPoint.x, 
      y: canvasPoint.y, 
      width: activeTool === 'text' ? 10 : 0, 
      height: activeTool === 'text' ? 24 : 0, 
      points: activeTool === 'pencil' ? [canvasPoint] : undefined, 
      rotation: 0,
      layer: topLayer,
      // INHERIT ATTRIBUTES
      color: toolAttributes.color!,
      fill_color: toolAttributes.fill_color,
      stroke_width: toolAttributes.stroke_width!,
      stroke_style: toolAttributes.stroke_style,
      opacity: toolAttributes.opacity,
      font_family: toolAttributes.font_family,
      font_size: toolAttributes.font_size,
      text_align: toolAttributes.text_align,
    };
    currentElementRef.current = newEl;
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    const screenPoint = { x: e.clientX, y: e.clientY };
    const canvasPoint = screenToCanvas(screenPoint, camera);
    broadcastCursorRef.current(canvasPoint);

    // cursor Logic
    if (!isDraggingRef.current && activeTool === 'selection') {
        let cursor = 'default';
        if(selectedElement) {
            const bounds = getElementBounds(selectedElement);
            const handle = bounds ? getResizeHandle(canvasPoint, bounds, camera.z, selectedElement.rotation||0) : null;
            if(handle) cursor = getCursorForHandle(handle, selectedElement.rotation||0);
            else if(isHit(canvasPoint, selectedElement)) cursor = 'move';
        } else {
            const hitEl = [...elementsRef.current].reverse().find(el => isHit(canvasPoint, el));
            if(hitEl) cursor = 'move';
        }
        setCursorStyle(cursor);
    } else if (activeTool === 'hand') { setCursorStyle(isDraggingRef.current ? 'grabbing' : 'grab'); } 
    else { setCursorStyle('crosshair'); }

    if (!isDraggingRef.current) return;

    if (activeTool === 'hand' || (e.buttons === 4) || e.shiftKey) { 
        const dx = screenPoint.x - dragStartRef.current.x;
        const dy = screenPoint.y - dragStartRef.current.y;
        setCamera(prev => ({ ...prev, x: prev.x + dx, y: prev.y + dy }));
        dragStartRef.current = screenPoint;
        return;
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
                 if(!bounds) return;
                 const dx = newX - bounds.minX;
                 const dy = newY - bounds.minY;
                 const shifted = selectedElement.points.map(p => ({x: p.x+dx, y: p.y+dy}));
                 const upd = {...selectedElement, points: shifted};
                 setSelectedElement(upd);
                 setElements(prev => prev.map(el => el.id === upd.id ? upd : el));
             } else {
                 const upd = {...selectedElement, x: newX, y: newY};
                 setSelectedElement(upd);
                 setElements(prev => prev.map(el => el.id === upd.id ? upd : el));
             }
        }
        else if (transformAction.type === 'resizing') {
             // resizing logic
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
                 if (handle.includes('l') || handle.includes('r')) { newH = newW / ratio; if (handle.includes('t')) newY = startBounds.maxY - newH; } 
                 else { newW = newH * ratio; if (handle.includes('l')) newX = startBounds.maxX - newW; }
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
                 const newPoints = startElement.points.map(p => ({ x: correctedX + (p.x - startBounds.minX) * scaleX, y: correctedY + (p.y - startBounds.minY) * scaleY }));
                 const upd = {...selectedElement, points: newPoints};
                 setSelectedElement(upd);
                 setElements(prev => prev.map(el => el.id === upd.id ? upd : el));
             } else {
                 const upd = {...selectedElement, x: correctedX, y: correctedY, width: newW, height: newH};
                 setSelectedElement(upd);
                 setElements(prev => prev.map(el => el.id === upd.id ? upd : el));
             }
        }
        return;
    }

    if (activeTool === 'eraser') {
        const hitElement = [...elementsRef.current].reverse().find(el => isHit(canvasPoint, el));
        if (hitElement && hitElement.id) deleteElement(hitElement);
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
          if(['rect','diamond','ellipse'].includes(activeTool)) { const d = Math.max(Math.abs(w), Math.abs(h)); w = w<0?-d:d; h=h<0?-d:d; }
          else if(['line','arrow'].includes(activeTool)) { 
              const angle = Math.atan2(h, w) * (180 / Math.PI); const snap = Math.round(angle/45)*45; const d = Math.hypot(w,h); 
              w = Math.cos(snap*Math.PI/180)*d; h = Math.sin(snap*Math.PI/180)*d; 
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
        const { id: selectedId, ...payload } = selectedElement;
        const dbPayload = normalizePoints(payload);
        await supabase.from('strokes').update(dbPayload).eq('id', selectedId);
        if (transformStartElementRef.current) addToHistory({ type: 'update', id: selectedElement.id!, prev: transformStartElementRef.current, next: selectedElement });
        setTransformAction({ type: 'none' });
        transformStartElementRef.current = null;
      scheduleThumbnailCapture();
        return;
    }

    const current = currentElementRef.current;
    if (!current) return;

    if (activeTool !== 'pencil' && activeTool !== 'text') {
        if((current.width||0) < 0) { current.x += current.width||0; current.width = Math.abs(current.width||0); }
        if((current.height||0) < 0) { current.y += current.height||0; current.height = Math.abs(current.height||0); }
        if((current.width||0) < 5 && (current.height||0) < 5) { currentElementRef.current = null; return; }
    }

    if (activeTool === 'text' && current.id) {
        setWritingNode({
            id: current.id,
            x: current.x,
            y: current.y,
            width: Math.max(100, current.width || 100),
            height: 24,
            text: '',
            color: current.color,
            rotation: 0,
            font_family: current.font_family || 'Inter, sans-serif',
            font_size: current.font_size || 24,
            text_align: current.text_align || 'left'
        });
        currentElementRef.current = null;
        return; 
    }

    setElements(prev => [...prev, current].sort((a,b) => (a.layer||0) - (b.layer||0)));
    setSelectedElement(current);
    setActiveTool('selection'); 
    currentElementRef.current = null;
    
    addToHistory({ type: 'create', id: current.id! });

    const payload = normalizePoints({ ...current });
    const { data, error } = await supabase.from('strokes').insert(payload).select();
    if (error) {
      console.error('Failed to create stroke', error, payload);
      return;
    }
    if (data && data[0]) {
        const realElement = data[0];
        setElements(prev => prev.map(el => el === current ? realElement : el).sort((a,b) => (a.layer||0) - (b.layer||0)));
        setSelectedElement(realElement); 
    }
    scheduleThumbnailCapture();
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
         canvas_id: canvasId,
         user_id: userId, 
         type: 'text',
         x: writingNode.x, 
         y: writingNode.y, 
         width: writingNode.width, 
         height: finalHeight / camera.z,
         color: writingNode.color, 
         stroke_width: 1, 
         text: writingNode.text, 
         rotation: writingNode.rotation,
         font_family: writingNode.font_family,
         font_size: writingNode.font_size,
         text_align: writingNode.text_align,
         layer: elements.length + 1
     };

     const exists = elements.find(e => e.id === writingNode.id);
     
     if (exists) {
       setElements(prev => prev.map(e => e.id === writingNode.id ? newEl : e));
       const { id: textId, ...payload } = newEl;
       await supabase.from('strokes').update({ ...payload, points: null }).eq('id', textId);
     } else {
         setElements(prev => [...prev, newEl]);
         addToHistory({ type: 'create', id: newEl.id! }); 
       const payload = normalizePoints({ ...newEl, points: null });
       const { data, error } = await supabase.from('strokes').insert(payload).select();
       if (error) {
         console.error('Failed to insert text stroke', error);
       } else if(data && data[0]) setSelectedElement(data[0]);
     }

     setWritingNode(null);
     setActiveTool('selection');
      scheduleThumbnailCapture();
  };

  // --- RENDER LOOP ---
  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;

    const render = () => {
      if (canvas.width !== window.innerWidth || canvas.height !== window.innerHeight) { canvas.width = window.innerWidth; canvas.height = window.innerHeight; }
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.save();
      ctx.translate(camera.x, camera.y);
      ctx.scale(camera.z, camera.z);

      const drawElement = (el: CanvasElement) => {
        ctx.save();
        ctx.globalAlpha = el.opacity ?? 1;
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
        
        if (el.stroke_style === 'dashed') ctx.setLineDash([10, 10]);
        else if (el.stroke_style === 'dotted') ctx.setLineDash([2, 5]);
        else ctx.setLineDash([]);

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
                    const fontSize = el.font_size || 24;
                    const fontFamily = el.font_family || FONT_FAMILY;
                    ctx.font = `${fontSize}px ${fontFamily}`; 
                    ctx.fillStyle = el.color; 
                    ctx.textBaseline = "top";
                    ctx.textAlign = el.text_align || 'left';
                    const lines = getWrappedText(ctx, el.text, el.width - 4);
                    let xOffset = 0;
                    if (el.text_align === 'center') xOffset = el.width / 2;
                    if (el.text_align === 'right') xOffset = el.width;
                    lines.forEach((line, i) => { ctx.fillText(line, el.x + xOffset, el.y + (i * (fontSize * 1.2))); });
                }
                break;
            case 'rect': ctx.fillRect(el.x, el.y, el.width||0, el.height||0); ctx.strokeRect(el.x, el.y, el.width||0, el.height||0); break;
            case 'ellipse':
                const rx = (el.width||0)/2; const ry = (el.height||0)/2;
                ctx.beginPath(); ctx.ellipse(el.x+rx, el.y+ry, Math.abs(rx), Math.abs(ry), 0, 0, 2*Math.PI); 
                ctx.fill(); ctx.stroke(); break;
            case 'diamond':
                const w = el.width||0; const h = el.height||0;
                ctx.moveTo(el.x+w/2, el.y); ctx.lineTo(el.x+w, el.y+h/2); ctx.lineTo(el.x+w/2, el.y+h); ctx.lineTo(el.x, el.y+h/2); ctx.closePath();
                ctx.fill(); ctx.stroke(); break;
            case 'line': case 'arrow':
                ctx.moveTo(el.x, el.y); ctx.lineTo(el.x+(el.width||0), el.y+(el.height||0)); ctx.stroke(); break;
        }
        ctx.restore();
      };

      elementsRef.current.forEach(drawElement);
      if (currentElementRef.current) { ctx.globalAlpha = 0.5; drawElement(currentElementRef.current); ctx.globalAlpha = 1.0; }
      
      // selection box
      if (selectedElement) {
          const bounds = getElementBounds(selectedElement);
          if (bounds) {
             ctx.save();
             ctx.globalAlpha = 1.0;
             ctx.setLineDash([]);
             if (selectedElement.rotation) {
                const cx = bounds.minX + bounds.width / 2;
                const cy = bounds.minY + bounds.height / 2;
                ctx.translate(cx, cy);
                ctx.rotate((selectedElement.rotation * Math.PI) / 180);
                ctx.translate(-cx, -cy);
             }
             ctx.strokeStyle = '#3b82f6'; ctx.lineWidth = 1 / camera.z;
             ctx.strokeRect(bounds.minX, bounds.minY, bounds.width, bounds.height);
             
             // resize handles
             const handleSize = 8 / camera.z; ctx.fillStyle = '#ffffff'; ctx.strokeStyle = '#3b82f6';
             const handles = [
                { x: bounds.minX, y: bounds.minY }, { x: bounds.maxX, y: bounds.minY },
                { x: bounds.minX, y: bounds.maxY }, { x: bounds.maxX, y: bounds.maxY },
                { x: bounds.minX + bounds.width/2, y: bounds.minY }, { x: bounds.minX + bounds.width/2, y: bounds.maxY },
                { x: bounds.minX, y: bounds.minY + bounds.height/2 }, { x: bounds.maxX, y: bounds.minY + bounds.height/2 },
             ];
             handles.forEach(h => { ctx.fillRect(h.x - handleSize/2, h.y - handleSize/2, handleSize, handleSize); ctx.strokeRect(h.x - handleSize/2, h.y - handleSize/2, handleSize, handleSize); });
             
             // rot handle
             const rotY = bounds.minY - (30 / camera.z);
             ctx.beginPath(); ctx.moveTo(bounds.minX + bounds.width/2, bounds.minY); ctx.lineTo(bounds.minX + bounds.width/2, rotY); ctx.stroke();
             ctx.beginPath(); ctx.arc(bounds.minX + bounds.width/2, rotY, 5/camera.z, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
             ctx.restore();
          }
      }

      Object.values(otherCursors).forEach(c => {
         // Draw cursor dot
         ctx.fillStyle = c.color;
         ctx.beginPath();
         ctx.arc(c.x, c.y, 5 / camera.z, 0, 2 * Math.PI);
         ctx.fill();

         // Draw user name label with background
         const labelText = c.displayName || c.userId.slice(0, 8);
         ctx.font = `${11 / camera.z}px ${FONT_FAMILY}`;
         const textWidth = ctx.measureText(labelText).width;
         const labelX = c.x + 12 / camera.z;
         const labelY = c.y - 8 / camera.z;
         const padding = 4 / camera.z;

         // Background
         ctx.fillStyle = c.color;
         ctx.beginPath();
         ctx.roundRect(labelX - padding, labelY - 12 / camera.z, textWidth + padding * 2, 16 / camera.z, 3 / camera.z);
         ctx.fill();

         // Text
         ctx.fillStyle = '#ffffff';
         ctx.fillText(labelText, labelX, labelY);
      });

      ctx.restore(); 
      requestAnimationFrame(render);
    };
    const id = requestAnimationFrame(render);
    return () => cancelAnimationFrame(id);
  }, [camera, otherCursors, selectedElement]);

  return (
    <div className="w-full h-screen bg-slate-50 overflow-hidden relative">
      <TopToolbar
        activeTool={activeTool}
        setTool={setActiveTool}
        canvasTitle={canvasTitle}
        canEdit={canEdit}
        permission={permission}
      />
      
      <SideToolbar 
        tool={activeTool} 
        selectedElement={selectedElement}
        attributes={selectedElement || toolAttributes}
        setAttributes={updateAttributes}
        onUndo={performUndo} 
        onSave={() => {}} 
        onDelete={() => selectedElement && deleteElement(selectedElement)}
        onLayerChange={handleLayerChange}
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
                fontSize: `${(writingNode.font_size || 24) * camera.z}px`, 
                lineHeight: `${(writingNode.font_size || 24) * 1.2 * camera.z}px`,
                fontFamily: writingNode.font_family,
                color: writingNode.color,
                textAlign: writingNode.text_align,
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