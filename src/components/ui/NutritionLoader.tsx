import { Leaf } from 'lucide-react';
import { cn } from '@/lib/utils';

interface NutritionLoaderProps {
  className?: string;
  text?: string;
}

export function NutritionLoader({ className, text = "Cargando..." }: NutritionLoaderProps) {
  return (
    <div role="status" aria-live="polite" aria-label={text || 'Cargando...'} className={cn("flex flex-col items-center justify-center gap-5 w-full h-full min-h-[200px]", className)}>
      <div className="relative flex items-center justify-center">
        {/* Outer ambient glow ring */}
        <div className="absolute w-[68px] h-[68px] border-[1.5px] border-white/10 rounded-full animate-[spin_4s_linear_infinite]" />
        
        {/* Inner fast indicator ring */}
        <div className="absolute w-[52px] h-[52px] border-[2.5px] border-t-white border-r-white/50 border-b-transparent border-l-transparent rounded-full animate-spin" />
        
        {/* Center glowing element */}
        <div className="w-[38px] h-[38px] flex items-center justify-center bg-white rounded-full shadow-[0_0_20px_rgba(255,255,255,0.8)] z-10 transition-transform duration-700 animate-pulse">
          <Leaf className="w-5 h-5 text-black" fill="currentColor" />
        </div>
      </div>
      
      {text && (
        <p className="text-[#a0a0a0] text-[10px] font-black tracking-[0.25em] uppercase animate-pulse">
          {text}
        </p>
      )}
    </div>
  );
}
