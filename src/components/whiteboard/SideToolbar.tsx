'use client';
import { cn } from "@/lib/utils";
import { 
  Undo, Save, Trash2, 
  BringToFront, SendToBack, 
  AlignLeft, AlignCenter, AlignRight,
  Minus, MoreHorizontal, SquareDashed
} from "lucide-react";
import { CanvasElement, ToolType, StrokeStyle } from "@/types/canvas";

interface SideToolbarProps {
  tool: ToolType;
  selectedElement: CanvasElement | null;
  attributes: Partial<CanvasElement>;
  setAttributes: (attrs: Partial<CanvasElement>) => void;
  onUndo: () => void;
  onSave: () => void;
  onDelete: () => void;
  onLayerChange: (direction: 'front' | 'back') => void;
}

const COLORS = ["#000000", "#ef4444", "#22c55e", "#3b82f6", "#a855f7", "#f59e0b"];
const FILL_COLORS = ["transparent", "#ffffff", "#ef4444", "#22c55e", "#3b82f6", "#f59e0b"];
const STROKE_WIDTHS = [2, 4, 8];
const STROKE_STYLES: StrokeStyle[] = ['solid', 'dashed', 'dotted'];
const FONT_SIZES = [16, 24, 32, 48, 64];
const FONT_FAMILIES = ["Inter, sans-serif", "serif", "monospace", "cursive"];

export default function SideToolbar({ 
  tool, selectedElement, attributes, setAttributes, 
  onUndo, onSave, onDelete, onLayerChange 
}: SideToolbarProps) {
  
  const isHidden = ['hand', 'eraser', 'image'].includes(tool) && !selectedElement;
  const targetType = selectedElement ? selectedElement.type : tool;

  const update = <K extends keyof CanvasElement>(key: K, value: CanvasElement[K]) => {
    setAttributes({ [key]: value } as Partial<CanvasElement>);
  };

  if (isHidden) return (
    <div className="fixed left-4 top-1/2 -translate-y-1/2 flex flex-col gap-2 bg-white p-2 rounded-lg shadow-md border border-slate-200 z-50">
        <button onClick={onUndo} className="p-2 hover:bg-slate-100 rounded" title="Undo"><Undo size={20}/></button>
        <button onClick={onSave} className="p-2 hover:bg-slate-100 rounded" title="Export"><Save size={20}/></button>
    </div>
  );

  return (
    <div className="fixed left-4 top-1/2 -translate-y-1/2 flex flex-col gap-4 bg-white p-4 rounded-xl shadow-xl border border-slate-200 z-50 w-64 max-h-[80vh] overflow-y-auto">
      
      <div className="space-y-3">
        <div>
          <label className="text-xs font-bold text-slate-400 uppercase mb-2 block">Stroke</label>
          <div className="flex flex-wrap gap-2">
            {COLORS.map(c => (
              <button key={c} onClick={() => update('color', c)}
                className={cn("w-6 h-6 rounded-full border border-slate-200", attributes.color === c && "ring-2 ring-offset-1 ring-black")}
                style={{ backgroundColor: c }} />
            ))}
            <input type="color" value={attributes.color || '#000000'} onChange={(e) => update('color', e.target.value)} className="w-6 h-6 p-0 border-0 rounded-full overflow-hidden" />
          </div>
        </div>

        {['rect', 'diamond', 'ellipse'].includes(targetType) && (
          <div>
            <label className="text-xs font-bold text-slate-400 uppercase mb-2 block">Background</label>
            <div className="flex flex-wrap gap-2">
              {FILL_COLORS.map(c => (
                <button key={c} onClick={() => update('fill_color', c)}
                  className={cn("w-6 h-6 rounded-full border border-slate-200 relative", attributes.fill_color === c && "ring-2 ring-offset-1 ring-black")}
                  style={{ backgroundColor: c === 'transparent' ? '#fff' : c }}
                >
                  {c === 'transparent' && <div className="absolute inset-0 border-red-500 border-t transform rotate-45 top-1/2" />}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="h-px bg-slate-200" />

      {targetType !== 'text' && (
        <div className="space-y-3">
          <div>
            <label className="text-xs font-bold text-slate-400 uppercase mb-2 block">Thickness</label>
            <div className="flex gap-2 bg-slate-100 p-1 rounded-lg">
              {STROKE_WIDTHS.map(w => (
                <button key={w} onClick={() => update('stroke_width', w)} className={cn("flex-1 h-8 rounded flex items-center justify-center hover:bg-white transition-all", attributes.stroke_width === w && "bg-white shadow-sm")}>
                  <div className="bg-slate-800 rounded-full w-4" style={{ height: w }} />
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="text-xs font-bold text-slate-400 uppercase mb-2 block">Style</label>
            <div className="flex gap-2 text-slate-800 bg-slate-100 p-1 rounded-lg">
               {STROKE_STYLES.map(s => (
                 <button key={s} onClick={() => update('stroke_style', s)} className={cn("flex-1 h-8 rounded flex items-center justify-center hover:bg-white text-xs capitalize", attributes.stroke_style === s && "bg-white shadow-sm")}>
                    {s === 'solid' ? <Minus size={16}/> : s === 'dashed' ? <MoreHorizontal size={16}/> : <SquareDashed size={16}/>}
                 </button>
               ))}
            </div>
          </div>
        </div>
      )}

      {targetType === 'text' && (
        <div className="space-y-3">
           <div>
            <label className="text-xs font-bold text-slate-400 uppercase mb-2 block">Size</label>
            <div className="flex flex-wrap gap-1 text-slate-800">
              {FONT_SIZES.map(s => (
                <button key={s} onClick={() => update('font_size', s)} className={cn("px-2 py-1 rounded text-xs hover:bg-slate-100", attributes.font_size === s && "bg-slate-200 font-bold")}>
                  {s}
                </button>
              ))}
            </div>
           </div>
           <div>
             <label className="text-xs font-bold text-slate-400 uppercase mb-2 block">Font</label>
             <select 
               className="w-full text-xs p-2 rounded bg-slate-100 border-none text-slate-800"
               value={attributes.font_family} 
               onChange={(e) => update('font_family', e.target.value)}
             >
               {FONT_FAMILIES.map(f => <option key={f} value={f}>{f.split(',')[0]}</option>)}
             </select>
           </div>
           <div>
             <label className="text-xs font-bold text-slate-400 uppercase mb-2 block">Align</label>
             <div className="flex gap-2 bg-slate-100 p-1 rounded-lg text-slate-800">
                <button onClick={() => update('text_align', 'left')} className={cn("flex-1 p-1 rounded", attributes.text_align === 'left' && "bg-white shadow")}><AlignLeft size={16} className="mx-auto"/></button>
                <button onClick={() => update('text_align', 'center')} className={cn("flex-1 p-1 rounded", attributes.text_align === 'center' && "bg-white shadow")}><AlignCenter size={16} className="mx-auto"/></button>
                <button onClick={() => update('text_align', 'right')} className={cn("flex-1 p-1 rounded", attributes.text_align === 'right' && "bg-white shadow")}><AlignRight size={16} className="mx-auto"/></button>
             </div>
           </div>
        </div>
      )}

      <div className="h-px bg-slate-200" />

      <div className="space-y-3">
        <div>
          <label className="text-xs font-bold text-slate-400 uppercase mb-2 flex justify-between">
            Opacity <span>{Math.round((attributes.opacity || 1) * 100)}%</span>
          </label>
          <input type="range" min="0.1" max="1" step="0.1" 
            value={attributes.opacity || 1} 
            onChange={(e) => update('opacity', parseFloat(e.target.value))} 
            className="w-full accent-black" />
        </div>

        {selectedElement && (
          <div className="space-y-2 text-slate-800">
            <div className="flex gap-2">
              <button onClick={() => onLayerChange('back')} className="flex-1 flex items-center justify-center gap-2 p-2 bg-slate-100 rounded hover:bg-slate-200 text-xs" title="Send to Back"><SendToBack size={14}/></button>
              <button onClick={() => onLayerChange('front')} className="flex-1 flex items-center justify-center gap-2 p-2 bg-slate-100 rounded hover:bg-slate-200 text-xs" title="Bring to Front"><BringToFront size={14}/></button>
            </div>
            <button
              onClick={onDelete}
              className="flex w-full items-center justify-center gap-2 rounded-lg border border-red-200 bg-red-50 p-2 text-xs text-red-600 hover:bg-red-100"
              title="Delete selection"
            >
              <Trash2 size={14} /> Delete selection
            </button>
          </div>
        )}

        {/* <div className="flex gap-2 pt-2">
           <button onClick={onUndo} className="flex-1 p-2 bg-slate-50 border hover:bg-slate-100 rounded text-xs flex items-center justify-center gap-1"><Undo size={14}/> Undo</button>
           {selectedElement && <button onClick={onDelete} className="p-2 bg-red-50 text-red-600 hover:bg-red-100 rounded"><Trash2 size={16}/></button>}
           <button onClick={onSave} className="p-2 bg-blue-50 text-blue-600 hover:bg-blue-100 rounded"><Save size={16}/></button>
        </div> */}
      </div>

    </div>
  );
}