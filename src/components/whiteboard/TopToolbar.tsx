'use client';

import {
  Hand, MousePointer2, Square, Diamond, Circle,
  ArrowRight, Minus, Pencil, Type, Image as ImageIcon, Eraser,
  ArrowLeft, Share2, Eye
} from "lucide-react";
import { cn } from "@/lib/utils";
import { ToolType } from "@/types/canvas";
import { useEffect } from "react";
import Link from "next/link";
import { PermissionLevel } from "@/types/database";

interface TopToolbarProps {
  activeTool: ToolType;
  setTool: (t: ToolType) => void;
  canvasTitle?: string;
  canEdit?: boolean;
  permission?: PermissionLevel;
  onShare?: () => void;
}

export default function TopToolbar({
  activeTool,
  setTool,
  canvasTitle = 'Canvas',
  canEdit = true,
  permission = 'editor',
  onShare
}: TopToolbarProps) {
  
  // Keyboard Shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't trigger if user is typing in an input
      if ((e.target as HTMLElement).tagName === 'INPUT') return;

      switch(e.key.toLowerCase()) {
        case 'h': setTool('hand'); break;
        case 'v': case '1': setTool('selection'); break;
        case 'r': case '2': setTool('rect'); break;
        case 'd': case '3': setTool('diamond'); break;
        case 'o': case '4': setTool('ellipse'); break;
        case 'a': case '5': setTool('arrow'); break;
        case 'l': case '6': setTool('line'); break;
        case 'p': case '7': setTool('pencil'); break;
        case 't': case '8': setTool('text'); break;
        case '9': setTool('image'); break;
        case 'e': case '0': setTool('eraser'); break;
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [setTool]);

  const tools: { type: ToolType; icon: React.ReactNode; label: string; shortcut: string }[] = [
    { type: 'hand', icon: <Hand size={18} />, label: 'Hand', shortcut: 'H' },
    { type: 'selection', icon: <MousePointer2 size={18} />, label: 'Selection', shortcut: 'V' },
    { type: 'rect', icon: <Square size={18} />, label: 'Rectangle', shortcut: 'R' },
    { type: 'diamond', icon: <Diamond size={18} />, label: 'Diamond', shortcut: 'D' },
    { type: 'ellipse', icon: <Circle size={18} />, label: 'Ellipse', shortcut: 'O' },
    { type: 'arrow', icon: <ArrowRight size={18} />, label: 'Arrow', shortcut: 'A' },
    { type: 'line', icon: <Minus size={18} />, label: 'Line', shortcut: 'L' },
    { type: 'pencil', icon: <Pencil size={18} />, label: 'Draw', shortcut: 'P' },
    { type: 'text', icon: <Type size={18} />, label: 'Text', shortcut: 'T' },
    { type: 'image', icon: <ImageIcon size={18} />, label: 'Image', shortcut: '9' },
    { type: 'eraser', icon: <Eraser size={18} />, label: 'Eraser', shortcut: 'E' },
  ];

  // Filter tools based on edit permission
  const availableTools = canEdit ? tools : tools.filter(t => t.type === 'hand' || t.type === 'selection');

  return (
    <>
      {/* Left side: Back button and title */}
      <div className="fixed top-4 left-4 flex items-center gap-3 z-50">
        <Link
          href="/dashboard"
          className="p-2 bg-white shadow-lg border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors"
          title="Back to Dashboard"
        >
          <ArrowLeft size={18} className="text-slate-600" />
        </Link>
        <div className="bg-white shadow-lg border border-slate-200 rounded-lg px-3 py-2 flex items-center gap-2">
          <span className="font-medium text-slate-800 max-w-[200px] truncate">{canvasTitle}</span>
          {!canEdit && (
            <span className="flex items-center gap-1 text-xs bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full">
              <Eye size={12} />
              View only
            </span>
          )}
        </div>
      </div>

      {/* Center: Tools */}
      <div className="fixed top-4 left-1/2 -translate-x-1/2 bg-white shadow-lg border border-slate-200 rounded-lg flex p-1 gap-1 z-50">
        {availableTools.map((tool) => (
          <button
            key={tool.type}
            onClick={() => setTool(tool.type)}
            className={cn(
              "p-2 rounded-md transition-all flex items-center justify-center relative group",
              activeTool === tool.type
                ? "bg-indigo-100 text-indigo-700 shadow-sm"
                : "hover:bg-slate-100 text-slate-600"
            )}
            title={`${tool.label} (${tool.shortcut})`}
          >
            {tool.icon}
            <span className="absolute top-full mt-2 bg-black text-white text-xs px-2 py-1 rounded opacity-0 group-hover:opacity-100 whitespace-nowrap pointer-events-none">
              {tool.label} <span className="text-slate-400 ml-1">{tool.shortcut}</span>
            </span>
          </button>
        ))}
      </div>

      {/* Right side: Share button (only for owners) */}
      {permission === 'owner' && onShare && (
        <div className="fixed top-4 right-4 z-50">
          <button
            onClick={onShare}
            className="flex items-center gap-2 px-3 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors shadow-lg"
          >
            <Share2 size={16} />
            <span className="font-medium">Share</span>
          </button>
        </div>
      )}
    </>
  );
}