'use client';
import { cn } from "@/lib/utils";
import { Undo, Save } from "lucide-react";
import { ToolType } from "@/types/canvas";

interface SideToolbarProps {
  tool: ToolType;
  color: string;
  setColor: (c: string) => void;
  width: number;
  setWidth: (w: number) => void;
  onUndo: () => void;
  onSave: () => void;
}

const COLORS = ["#000000", "#ef4444", "#22c55e", "#3b82f6", "#a855f7", "transparent"];

export default function SideToolbar({ tool, color, setColor, width, setWidth, onUndo, onSave }: SideToolbarProps) {
  // Hide if tool is hand, selection, or eraser (simple implementation)
  const isHidden = ['hand', 'selection', 'eraser', 'image'].includes(tool);

  if (isHidden) return (
    <div className="fixed left-4 top-1/2 -translate-y-1/2 flex flex-col gap-2 bg-white p-2 rounded-lg shadow-md border border-slate-200 z-50">
        <button onClick={onUndo} className="p-2 hover:bg-slate-100 rounded" title="Undo"><Undo size={20}/></button>
        <button onClick={onSave} className="p-2 hover:bg-slate-100 rounded" title="Export"><Save size={20}/></button>
    </div>
  );

  return (
    <div className="fixed left-4 top-1/2 -translate-y-1/2 flex flex-col gap-4 bg-white p-3 rounded-xl shadow-xl border border-slate-200 z-50 animate-in slide-in-from-left-4 fade-in">
      
      {/* Stroke Color */}
      <div className="flex flex-col gap-2">
        <label className="text-xs font-bold text-slate-400 uppercase">Stroke</label>
        <div className="grid grid-cols-2 gap-2">
          {COLORS.filter(c => c !== 'transparent').map((c) => (
            <button
              key={c}
              className={cn(
                "w-6 h-6 rounded-full border border-slate-200",
                color === c && "ring-2 ring-offset-1 ring-black"
              )}
              style={{ backgroundColor: c }}
              onClick={() => setColor(c)}
            />
          ))}
        </div>
        <input 
          type="color" 
          value={color} 
          onChange={(e) => setColor(e.target.value)} 
          className="w-full h-8 cursor-pointer"
        />
      </div>

      <div className="h-[1px] bg-slate-200 w-full" />

      {/* Stroke Width */}
      <div className="flex flex-col gap-2">
        <label className="text-xs font-bold text-slate-400 uppercase">Width: {width}px</label>
        <input
          type="range"
          min="1"
          max="20"
          value={width}
          onChange={(e) => setWidth(parseInt(e.target.value))}
          className="w-full accent-black"
        />
      </div>

      <div className="h-[1px] bg-slate-200 w-full" />

      <div className="flex flex-col gap-2">
         <button onClick={onUndo} className="p-2 hover:bg-slate-100 rounded flex items-center gap-2"><Undo size={16}/> Undo</button>
         <button onClick={onSave} className="p-2 hover:bg-slate-100 rounded flex items-center gap-2"><Save size={16}/> Export</button>
      </div>
    </div>
  );
}