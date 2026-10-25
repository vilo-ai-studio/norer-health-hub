import { useState, useEffect, useRef } from 'react';
import { X, FileText, Check, Settings2 } from 'lucide-react';
import * as DialogPrimitive from "@radix-ui/react-dialog";
import api from '@/lib/api';
import { cn } from '@/lib/utils';
import { NutritionLoader } from '@/components/ui/NutritionLoader';
import { PdfMenuFontSize } from '@/components/PdfMenuFontSize';
import { buildPdfMeta, defaultShowDistribucionForMenus, getGlobalPdfPreferences, parsePdfPreferences, togglePdfMetaFlag } from '@/lib/pdfMeta';

interface PDFPreviewModalProps {
  isOpen: boolean;
  onClose: () => void;
  planId?: string;
  planCustomMeta: any;
  onSaveMeta: (meta: any) => void;
  loading?: boolean;
  planMenus?: { tipoContenido?: string }[] | null;
}

export function PDFPreviewModal({ isOpen, onClose, planId, planCustomMeta, onSaveMeta, loading, planMenus }: PDFPreviewModalProps) {
  const equivalencePdfOptionsEnabled = defaultShowDistribucionForMenus(planMenus);
  const [meta, setMeta] = useState<any>(() => {
    const defaultPrefs = parsePdfPreferences(localStorage.getItem('norder_pdfCustomMetaPrefs'));
    return buildPdfMeta(defaultPrefs, planCustomMeta, defaultShowDistribucionForMenus(planMenus), defaultShowDistribucionForMenus(planMenus));
  });
  
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [loadingPdf, setLoadingPdf] = useState(false);
  const [pdfError, setPdfError] = useState<string | null>(null);

  // El modal permanece montado aun cuando está cerrado. Recalcular aquí evita que conserve
  // opciones de otro tipo de menú al volver a abrir "Configurar PDF".
  useEffect(() => {
    if (isOpen) return;
    const defaultPrefs = parsePdfPreferences(localStorage.getItem('norder_pdfCustomMetaPrefs'));
    const menuDefault = defaultShowDistribucionForMenus(planMenus);
    setMeta(buildPdfMeta(defaultPrefs, planCustomMeta, menuDefault, menuDefault));
  }, [isOpen, planId, planCustomMeta, planMenus]);

  const fetchPdf = async (metaOptions?: any) => {
    if (!planId) return;
    setLoadingPdf(true);
    setPdfError(null);
    try {
      const res = await api.post(`/api/planes/${planId}/pdf/preview`, metaOptions || meta, { responseType: 'blob' });
      const url = window.URL.createObjectURL(new Blob([res.data], { type: 'application/pdf' }));
      setPdfUrl(url);
    } catch (e: any) {
      console.error('PDF Preview error:', e);
      let msg = 'Error generando PDF';
      if (e?.response?.data) {
        try {
          const text = await new Response(e.response.data).text();
          msg = text.slice(0, 200);
        } catch {}
      }
      setPdfError(msg);
    } finally {
      setLoadingPdf(false);
    }
  };

  // Ref para distinguir entre la carga inicial y cambios del usuario en meta
  const isInitialLoad = useRef(true);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!isOpen || !planId) {
      // Al cerrar: limpiar estado para la próxima apertura
      if (!isOpen) {
        isInitialLoad.current = true;
        if (debounceRef.current) clearTimeout(debounceRef.current);
      }
      return;
    }

    if (isInitialLoad.current) {
      // Primera apertura: cargar inmediatamente sin debounce
      isInitialLoad.current = false;
      fetchPdf(meta);
    } else {
      // Cambios subsecuentes (toggles del usuario): debounce de 900ms
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        fetchPdf(meta);
      }, 900);
    }

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [isOpen, meta, planId]);


  const handleToggle = (key: string) => {
    if (!equivalencePdfOptionsEnabled && (key === 'soloEquivalencias' || key === 'showDistribucionPorciones')) return;
    const newMeta = togglePdfMetaFlag(meta, key);
    setMeta(newMeta);
    
    // Guardar opciones booleanas en preferencias
    const prefsToSave = getGlobalPdfPreferences(newMeta);
    localStorage.setItem('norder_pdfCustomMetaPrefs', JSON.stringify(prefsToSave));
  };

  const handleSave = async () => {
    await onSaveMeta(meta);
  };

  return (
    <DialogPrimitive.Root open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-[1000] bg-black/80 backdrop-blur-md animate-fade-in" />
        <DialogPrimitive.Content 
          className="fixed left-[50%] top-[50%] z-[1001] w-[98vw] max-w-[1800px] translate-x-[-50%] translate-y-[-50%] px-2 sm:px-3 focus:outline-none"
        >
          <div className="bg-[#111111] border border-[#2a2a2a] rounded-[16px] sm:rounded-[24px] w-full h-[94vh] lg:h-[90vh] flex flex-col lg:flex-row overflow-hidden shadow-[0_0_80px_rgba(0,0,0,0.8)] animate-in fade-in zoom-in-95 duration-200">
            
            {/* SIDEBAR CONFIGURACIÓN */}
            <div className="w-full lg:w-[360px] lg:flex-shrink-0 bg-[#161616] border-b lg:border-b-0 lg:border-r border-[#2a2a2a] flex flex-col lg:h-full relative z-10 overflow-hidden">
              <div className="p-5 sm:p-6 border-b border-[#2a2a2a] flex items-center justify-between bg-gradient-to-b from-[#1a1a1a] to-transparent">
                <div>
                  <h2 className="text-[16px] sm:text-[18px] font-bold text-white flex items-center gap-2.5">
                    <div className="p-1.5 bg-[#90c2ff]/10 rounded-lg">
                      <Settings2 className="w-[18px] h-[18px] text-[#90c2ff]" />
                    </div>
                    Reporte PDF
                  </h2>
                </div>
                <DialogPrimitive.Close className="p-2 bg-[#222] hover:bg-[#333] rounded-full text-text-muted hover:text-white transition-all outline-none">
                  <X className="w-5 h-5" />
                </DialogPrimitive.Close>
              </div>

              <div className="flex-1 overflow-y-auto p-5 sm:p-6 space-y-6 sm:space-y-8 custom-scrollbar">
                <PdfMenuFontSize value={meta.menuFontSize} onChange={size => setMeta({ ...meta, menuFontSize: size })} />
                <div className="rounded-[10px] border border-red-400/20 bg-red-400/5 p-3">
                  <p className="m-0 text-[11px] font-semibold leading-relaxed text-red-300">
                    Revisión ortográfica: las palabras dudosas aparecen en rojo únicamente en esta vista previa.
                  </p>
                  <p className="mb-0 mt-1 text-[10px] leading-relaxed text-[#777]">
                    El PDF descargado o enviado al paciente se genera sin estas marcas.
                  </p>
                </div>
                
                {/* HOJAS */}
                <div className="space-y-4">
                  <h3 className="text-[11px] font-bold text-[#666] uppercase tracking-[0.2em] ml-1">Selección de Hojas</h3>
                  <div className="space-y-2">
                    <ToggleItem label="1. Antropometría" active={meta.showPageHistorial !== false} onChange={() => handleToggle('showPageHistorial')} />
                    <ToggleItem label="Correo y Teléfono" active={meta.showContacto === true} onChange={() => handleToggle('showContacto')} isSubItem />
                    <ToggleItem label="Alimentos a evitar" active={meta.showAlimentosEvitar !== false} onChange={() => handleToggle('showAlimentosEvitar')} isSubItem />
                    <ToggleItem label="2. Menús Ejemplo" active={meta.showPageMenus !== false} onChange={() => handleToggle('showPageMenus')} />
                    <ToggleItem label="Solo equivalencias" active={meta.soloEquivalencias === true} onChange={() => handleToggle('soloEquivalencias')} isSubItem disabled={!equivalencePdfOptionsEnabled} />
                    <ToggleItem label="Distribución de porciones" active={meta.showDistribucionPorciones !== false} onChange={() => handleToggle('showDistribucionPorciones')} isSubItem disabled={!equivalencePdfOptionsEnabled} />
                    <ToggleItem label="3. Lista SMAE" active={meta.showPageIntercambio !== false} onChange={() => handleToggle('showPageIntercambio')} />
                    <ToggleItem label="4. Extras" active={meta.showPageExtras !== false} onChange={() => handleToggle('showPageExtras')} />
                  </div>
                </div>

              </div>

              <div className="p-5 sm:p-6 bg-[#161616] border-t border-[#2a2a2a]">
                <button 
                  onClick={handleSave} disabled={loading}
                  className="w-full bg-brand-primary hover:bg-white text-black font-bold rounded-[12px] py-3 text-[14px] transition-all flex items-center justify-center gap-2"
                >
                  {loading ? <div className="w-5 h-5 border-2 border-black/30 border-t-black rounded-full animate-spin" /> : <Check className="w-5 h-5" />}
                  {loading ? 'Guardando...' : 'Aceptar y Cerrar'}
                </button>
              </div>
            </div>

            {/* PREVIEW */}
            <div className="flex-1 min-w-0 bg-[#0a0a0a] p-2 sm:p-4 flex flex-col items-center justify-center relative overflow-hidden">
              <div className="absolute top-[-20%] left-[-10%] w-[50%] h-[50%] bg-[#90c2ff]/5 blur-[120px] rounded-full pointer-events-none" />
              
              {loadingPdf && (
                <div className="absolute inset-0 z-20 bg-[#0a0a0a]/80 backdrop-blur-sm flex flex-col items-center justify-center text-white p-6 text-center">
                  <NutritionLoader text="Actualizando vista..." />
                </div>
              )}

              <div className="w-full h-full relative z-10 flex flex-col items-center justify-center">
                {pdfUrl ? (
                  <iframe 
                    src={`${pdfUrl}#toolbar=0&navpanes=0`} 
                    className="w-full h-full rounded-[4px] sm:rounded-[8px] shadow-2xl border border-[#222] bg-white transition-opacity duration-300"
                    style={{ opacity: loadingPdf ? 0.4 : 1 }}
                    title="PDF"
                  />
                ) : pdfError ? (
                  <div className="flex flex-col items-center gap-4 text-center max-w-sm p-8 bg-[#181818] border border-[#2a2a2a] rounded-[16px]">
                    <p className="text-red-400 font-semibold">Error al cargar PDF</p>
                    <button onClick={() => fetchPdf(meta)} className="px-5 py-2 bg-[#2a2a2a] text-white text-[12px] rounded-lg">Reintentar</button>
                  </div>
                ) : (
                  <div className="flex flex-col items-center gap-4 text-[#444]">
                    <FileText className="w-10 h-10" />
                    <p className="text-[14px]">Generando previsualización...</p>
                  </div>
                )}
              </div>
            </div>

          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

function ToggleItem({ label, active, onChange, isSubItem = false, disabled = false }: { label: string, active: boolean, onChange: () => void, isSubItem?: boolean, disabled?: boolean }) {
  return (
    <button 
      onClick={onChange}
      disabled={disabled}
      className={cn(
        "w-full flex items-center justify-between p-3 rounded-[10px] border transition-all duration-200",
        isSubItem ? "ml-4 w-[calc(100%-1rem)] text-[12px]" : "text-[13px]",
        active ? "bg-[#1a1a1a] border-[#333] text-[#e0e0e0]" : "bg-[#111] border-[#222] text-[#666]",
        disabled && "cursor-not-allowed opacity-60"
      )}
    >
      <span className={cn("font-medium", !active && "line-through")}>{label}</span>
      <div className={cn("w-9 h-5 rounded-full transition-colors relative", active ? "bg-[#90c2ff]" : "bg-[#333]")}>
        <div className={cn("absolute top-[2px] w-[16px] h-[16px] bg-white rounded-full transition-transform", active ? "left-[18px]" : "left-[2px]")} />
      </div>
    </button>
  );
}
