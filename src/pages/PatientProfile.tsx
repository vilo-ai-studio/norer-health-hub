import { useEffect, useState } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '@/lib/queryKeys';
import { invalidateAfterPacienteChange, invalidateAfterValoracionChange } from '@/lib/invalidation';
import { Edit, Plus, ChevronDown, X, User, Phone, Mail, Clock, Calendar, Shield, Hash, Activity, Heart, ClipboardList, Trash2, ArrowLeft, Send, FileText, RotateCcw, ArchiveRestore } from 'lucide-react';
import api from '@/lib/api';
import type { Paciente, Valoracion, Plan } from '@/types';
import { formatDate, formatDateShort, formatDecimal, getBadgeForValuation } from '@/lib/format';
import { formatDisciplinasForDisplay } from '@/lib/disciplinas';
import { otrosBioquimicosFromValoracion } from '@/lib/laboratorio';
import { useToast } from '@/hooks/use-toast';
import { useConfirm } from '@/components/ui/ConfirmDialog';
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer
} from 'recharts';
import { NutritionLoader } from '@/components/ui/NutritionLoader';
import { hasRecall24Data, normalizeRecall24 } from '@/lib/recall24';
import { NutritionistPhotoHistory } from '@/components/NutritionistPhotoHistory';

// Soft delete: la restauración queda implementada pero oculta de momento (a propósito
// debe parecer que la consulta se borró; se reactiva poniendo esto en true si hace falta).
const SHOW_ARCHIVADAS = false;

// --- Sub-componentes Estilo Moderno & Premium ---

const InfoItem = ({ label, value, icon: Icon }: { label: string, value: string | number, icon: any }) => (
  <div className="flex items-center gap-4 py-4 px-6 border-r border-border-subtle/50 last:border-r-0 group hover:bg-bg-surface/50 transition-colors">
    <div className="flex-shrink-0 p-2.5 bg-bg-elevated border border-border-subtle rounded-[10px] group-hover:bg-[#222] transition-colors">
      <Icon className="h-4 w-4 text-text-secondary group-hover:text-text-primary transition-colors" />
    </div>
    <div className="flex flex-col min-w-0">
      <span className="text-[10px] font-medium text-text-muted uppercase tracking-[0.1em] leading-none mb-1.5">{label}</span>
      <span className="text-[13px] font-semibold text-text-primary uppercase tracking-tight truncate" title={String(value)}>{value}</span>
    </div>
  </div>
);

const KpiCardCompact = ({ label, value, active, icon: Icon }: { label: string, value: any, active?: boolean, icon?: any }) => (
  <div className={`relative overflow-hidden py-6 px-6 border rounded-[12px] flex flex-col items-start justify-center transition-all duration-300 flex-1 group ${active ? 'bg-bg-elevated border-[#444]' : 'bg-bg-surface border-border-subtle text-text-primary'}`}>
    <div className="flex items-center gap-3 mb-2">
      {Icon && <Icon className={`h-4 w-4 ${active ? 'text-brand-primary' : 'text-text-secondary'}`} />}
      <span className={`text-[12px] font-medium uppercase tracking-widest leading-none ${active ? 'text-brand-primary' : 'text-text-secondary'}`}>{label}</span>
    </div>
    <span className="text-[28px] font-bold tracking-tighter leading-none text-text-primary">{value}</span>
  </div>
);

const ChartBox = ({ title, children, extra, onExpand }: { title: string, children: React.ReactNode, extra?: React.ReactNode, onExpand?: () => void }) => (
  <div
    onClick={onExpand}
    className={`border border-border-subtle p-6 bg-bg-surface flex flex-col rounded-[12px] min-h-[300px] transition-all ${onExpand ? 'cursor-pointer hover:border-[#555]' : ''}`}
  >
    <div className="flex items-center justify-between mb-6">
      <div className="flex items-center gap-3">
        <h2 className="text-[12px] font-medium uppercase tracking-widest text-text-secondary leading-none">
          {title}
        </h2>
        {onExpand && (
          <button className="text-[9px] bg-bg-elevated px-2 py-0.5 rounded border border-border-subtle hover:bg-[#333] transition-colors text-text-primary uppercase font-bold tracking-wider mt-[-2px] hover:text-white pointer-events-none">
            Ver Todo
          </button>
        )}
      </div>
      {/* prevent clicking the extra buttons (like % | KG) from bubbling up */}
      <div onClick={(e) => e.stopPropagation()}>
        {extra}
      </div>
    </div>
    <div className="w-full flex-1 min-h-0">
      {children}
    </div>
  </div>
);

const AccordionRow = ({ val, index, onVerDetalles, onVerPlan, onAsignarPlan, onEditPlan, onArchive }: {
  val: Valoracion,
  index: number,
  onVerDetalles: (id: string) => void,
  onVerPlan: (id: string) => void,
  onAsignarPlan: (id: string) => void,
  onEditPlan: (id: string) => void,
  onArchive: (id: string) => void
}) => {
  const [isOpen, setIsOpen] = useState(index === 0);
  const planId = (val as any).planId;
  const estadoEnvio = (val as any).estadoEnvio || (val as any).plan?.estadoEnvio || 'pendiente';

  return (
    <div className="bg-bg-elevated/30 border border-border-subtle rounded-[12px] overflow-hidden group">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-full text-left p-6 flex flex-col md:flex-row md:items-center justify-between gap-4 hover:bg-bg-elevated/50 transition-colors"
      >
        <div className="flex items-center gap-4">
          <div className="w-10 h-10 rounded-full bg-bg-surface border border-border-subtle flex items-center justify-center font-bold text-[14px] text-text-primary">
            #{(val as any).numeroValoracion || '—'}
          </div>
          <div>
            <h3 className="text-[16px] font-bold text-text-primary m-0 tracking-tight">{formatDate(val.fecha)}</h3>
            <p className="text-[12px] font-medium text-text-muted mt-0.5 uppercase tracking-wider">{val.id.slice(-8).toUpperCase()}</p>
          </div>
        </div>

        <div className="flex flex-col md:flex-row md:items-center gap-4 md:gap-8">
          <div className="flex gap-6">
            <div className="space-y-1">
              <p className="text-[10px] font-medium text-text-muted uppercase tracking-widest leading-none">Peso</p>
              <p className="text-[14px] font-bold text-text-primary m-0">{formatDecimal(val.pesoActual || val.peso)} <span className="text-[11px] font-normal text-text-secondary">kg</span></p>
            </div>
            <div className="space-y-1">
              <p className="text-[10px] font-medium text-text-muted uppercase tracking-widest leading-none">% Grasa</p>
              <p className="text-[14px] font-bold text-text-primary m-0">{formatDecimal((val as any).pctGrasaCorp || (val as any).pctGrasaCorporal4comp || (val as any).pctGrasa2comp || (val as any).pctGrasa || 0)} <span className="text-[11px] font-normal text-text-secondary">%</span></p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {(() => {
              const bg = getBadgeForValuation(val);
              return (
                <span className={`px-2 py-0.5 rounded-full text-[10px] font-medium border uppercase tracking-wider ${bg.cls}`}>
                  {bg.text}
                </span>
              );
            })()}
          </div>

          <div className="h-4 w-[1px] bg-border-subtle hidden md:block" />
          <div className={`p-1.5 rounded-full bg-bg-surface border border-border-subtle transition-transform duration-300 ${isOpen ? 'rotate-180' : ''}`}>
            <ChevronDown className="h-4 w-4 text-text-secondary" />
          </div>
        </div>
      </button>

      {isOpen && (
        <div className="p-6 bg-bg-surface text-text-primary animate-slide-down">
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6 mb-8">
            <MetricItem label="ESTATURA" value={`${(() => {
              const raw = parseFloat(String(val.estatura || val.talla));
              if (!raw) return '—';
              return raw < 10 ? Math.round(raw * 100) : raw;
            })()} cm`} />
            <MetricItem label="IMC" value={String(formatDecimal(val.imc))} />
            <MetricItem label="% GRASA" value={`${(val as any).pctGrasaCorp || (val as any).pctGrasaCorporal4comp || (val as any).pctGrasa2comp || (val as any).pctGrasa || '—'}%`} />
            <MetricItem label="MASA MAGRA" value={`${(val as any).masaMagra || '—'} kg`} />
          </div>

          <div className="flex flex-wrap items-center gap-4 pt-6 border-t border-border-subtle">
            <button
              onClick={() => onVerDetalles(val.id)}
              className="flex items-center gap-2 px-[18px] py-[10px] bg-bg-elevated text-text-primary text-[12px] font-medium border border-border-subtle rounded-[8px] hover:bg-[#222] transition-colors"
            >
              <ClipboardList className="h-[18px] w-[18px]" /> Ver Consulta
            </button>
            {(() => {
              const bg = getBadgeForValuation(val);

              if (!planId) {
                if (bg.text === 'Pendiente de menú') {
                  return (
                    <button
                      onClick={() => onVerDetalles(val.id + '#barrido')}
                      className="flex items-center gap-2 px-[18px] py-[10px] bg-rose-500 text-white text-[12px] font-bold border border-rose-600 rounded-[8px] hover:bg-rose-600 transition-all shadow-lg shadow-rose-500/10"
                    >
                      <Plus className="h-[18px] w-[18px]" /> Calcular Equivalencias
                    </button>
                  );
                }
                return (
                  <button
                    onClick={() => onAsignarPlan(val.id)}
                    className="flex items-center gap-2 px-[18px] py-[10px] bg-[#1a0f00] text-accent-orange text-[12px] font-medium border border-accent-orange/30 rounded-[8px] hover:bg-[#2a1a00] transition-colors"
                  >
                    <Plus className="h-[18px] w-[18px]" /> Asignar menú
                  </button>
                );
              }

              return (
                <div className="flex flex-wrap gap-2">
                  <button
                    onClick={() => onVerPlan(planId)}
                    className="flex items-center gap-2 px-[18px] py-[10px] bg-bg-surface text-text-primary border border-border-subtle rounded-[8px] text-[12px] font-medium transition-colors hover:bg-bg-elevated"
                  >
                    <FileText className="h-[18px] w-[18px]" /> {estadoEnvio === 'enviado' ? 'Ver plan' : 'Ver y preparar envío'}
                  </button>
                  {estadoEnvio === 'pendiente' && (
                    <button
                      onClick={() => onEditPlan(planId)}
                      className="flex items-center gap-2 px-[18px] py-[10px] bg-bg-elevated text-text-secondary border border-border-subtle rounded-[8px] text-[12px] font-medium transition-colors hover:bg-[#222] hover:text-text-primary"
                    >
                      <Edit className="h-[18px] w-[18px]" /> Editar
                    </button>
                  )}
                </div>
              );
            })()}
            <button
              onClick={() => onArchive(val.id)}
              className="flex items-center gap-2 px-[18px] py-[10px] bg-[#1a0f0f] text-accent-red text-[12px] font-medium border border-accent-red/20 rounded-[8px] hover:bg-[#2e1a1a] transition-colors ml-auto"
            >
              <Trash2 className="h-[18px] w-[18px]" /> Archivar
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

const MetricItem = ({ label, value, alert }: { label: string, value: string, alert?: boolean }) => (
  <div className="space-y-1 flex flex-col bg-bg-elevated p-4 rounded-[8px] border border-border-subtle">
    <p className="text-[10px] font-medium text-text-muted uppercase tracking-widest leading-tight">{label}</p>
    <p className={`text-[16px] font-semibold tracking-tight ${alert ? 'text-accent-red font-bold' : 'text-text-primary'}`}>{value}</p>
  </div>
);

const ClinicalSection = ({ title, data, icon: Icon, className = "" }: { title: string, data: Record<string, any>, icon?: any, className?: string }) => {
  const renderValue = (value: any) => {
    if (!value || value === 'N/A' || value === '—') return <p className="text-[14px] font-medium text-text-muted tracking-tight">—</p>;
    const str = String(value).trim();
    // Dividir en viñetas si contiene coma, punto y coma, o salto de línea
    const parts = str.split(/[,;\n]+/).map(s => s.trim()).filter(Boolean);
    if (parts.length <= 1) {
      return <p className="text-[14px] font-medium text-text-primary tracking-tight">{str}</p>;
    }
    return (
      <ul className="m-0 p-0 space-y-1">
        {parts.map((item, i) => (
          <li key={i} className="flex items-start gap-2">
            <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-brand-primary flex-shrink-0" />
            <span className="text-[13px] font-medium text-text-primary leading-snug">{item}</span>
          </li>
        ))}
      </ul>
    );
  };

  return (
    <div className={`bg-bg-elevated/20 border border-border-subtle/50 rounded-[12px] p-6 group hover:bg-bg-elevated/40 transition-colors ${className}`}>
      <div className="flex items-center gap-3 border-b border-border-subtle pb-4">
        {Icon && <Icon className="h-4 w-4 text-text-secondary" />}
        <h4 className="text-[12px] font-medium text-text-primary uppercase tracking-widest">{title}</h4>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mt-6">
        {Object.entries(data).map(([key, value]) => (
          <div key={key} className="space-y-2 group">
            <p className="text-[10px] font-medium text-text-muted uppercase tracking-widest leading-none">{key}</p>
            {renderValue(value)}
          </div>
        ))}
      </div>
    </div>
  );
};

const PatientProfile = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  // ── Datos del paciente (con cache React Query) ────────────────────────────
  const { data: paciente, isLoading: loadingPaciente } = useQuery({
    queryKey: queryKeys.pacientes.detail(id!),
    queryFn: async () => {
      const res = await api.get(`/api/pacientes/${id}`);
      return res.data?.data || res.data;
    },
    enabled: !!id,
    staleTime: 60 * 1000,
    placeholderData: (prev) => prev,
  });

  const { data: valoraciones = [], isLoading: loadingValoraciones } = useQuery({
    queryKey: queryKeys.valoraciones.byPaciente(id!),
    queryFn: async () => {
      const res = await api.get(`/api/pacientes/${id}/valoraciones`);
      const vals = res.data?.data || res.data || [];
      if (!Array.isArray(vals)) return [];
      const chartNumber = (value: unknown) => {
        if (value == null || value === '') return null;
        const parsed = Number(String(value).replace(',', '.'));
        return Number.isFinite(parsed) ? parsed : null;
      };
      return vals
        .filter((v: any) => v && v.fecha)
        .map((v: any) => ({
          ...v,
          pesoEvolucion: chartNumber(v.pesoActual ?? v.peso),
          grasaEvolucion: chartNumber(v.pctGrasa ?? v.pctGrasa2comp ?? v.pctGrasaCorporal4comp ?? v.pctGrasaCorp),
          masaMagraEvolucion: chartNumber(v.masaMagra ?? v.kgMasaMagra2comp ?? v.kgMasaMagra4comp),
          kgGrasaEvolucion: chartNumber(v.masaGrasaReal ?? v.kgGrasa2comp),
          glucosaEvolucion: chartNumber(v.glucosa),
          trigliceridosEvolucion: chartNumber(v.trigliceridos),
          colesterolEvolucion: chartNumber(v.colesterol),
          creatininaEvolucion: chartNumber(v.creatinina),
          acidoUricoEvolucion: chartNumber(v.acidoUrico),
        }))
        .sort((a: any, b: any) => new Date(b.fecha).getTime() - new Date(a.fecha).getTime());
    },
    enabled: !!id,
    staleTime: 60 * 1000,
    placeholderData: (prev) => prev,
  });

  // B9: Query para consultas archivadas
  const { data: archivadas = [], isLoading: loadingArchivadas, refetch: refetchArchivadas } = useQuery({
    queryKey: queryKeys.valoraciones.archived(id!),
    queryFn: async () => {
      const res = await api.get(`/api/pacientes/${id}/valoraciones/archivadas`);
      return res.data?.data || res.data || [];
    },
    enabled: !!id,
  });

  const loading = loadingPaciente || loadingValoraciones || loadingArchivadas;

  const [showFullExpediente, setShowFullExpediente] = useState(false);
  const [fatChartMode, setFatChartMode] = useState<'kg' | 'pct'>('pct');
  const [labMarker, setLabMarker] = useState<'glucosa' | 'trigliceridos' | 'colesterol' | 'creatinina' | 'acidoUrico'>('glucosa');
  const [isActivatingPortal, setIsActivatingPortal] = useState(false);
  const [isChangingTier, setIsChangingTier] = useState(false);

  const handleTogglePortal = async () => {
    if (!paciente || isActivatingPortal) return;
    setIsActivatingPortal(true);
    try {
      const newState = !paciente.portalActivo;
      await api.put(`/api/portal/activar/${id}`, { activar: newState });
      queryClient.invalidateQueries({ queryKey: queryKeys.pacientes.detail(id!) });
      toast({ title: newState ? 'Portal Norder Health activado' : 'Portal desactivado' });
    } catch {
      toast({ title: 'Error', description: 'No se pudo cambiar el estado del portal', variant: 'destructive' });
    } finally {
      setIsActivatingPortal(false);
    }
  };

  const handleChangeTier = async (tier: 'gratis' | 'basico' | 'premium') => {
    if (!paciente || isChangingTier) return;
    const nivelMap = { gratis: 'ninguna', basico: 'basica', premium: 'premium' } as const;
    setIsChangingTier(true);
    try {
      await api.put(`/api/portal/activar/${id}`, { activar: true, nivelMembresia: nivelMap[tier] });
      queryClient.invalidateQueries({ queryKey: queryKeys.pacientes.detail(id!) });
      toast({ title: `Plan cambiado a ${tier.charAt(0).toUpperCase() + tier.slice(1)}` });
    } catch {
      toast({ title: 'Error', description: 'No se pudo cambiar el plan', variant: 'destructive' });
    } finally {
      setIsChangingTier(false);
    }
  };
  const [fullChartModal, setFullChartModal] = useState<{
    isOpen: boolean, title: string, baseDataKey: string, baseName: string, isFatModal?: boolean
  }>({ isOpen: false, title: '', baseDataKey: '', baseName: '' });

  useEffect(() => {
    if (loading) return;

    if (location.hash === '#historial') {
      const scrollToHistorial = (smooth = true) => {
        const el = document.getElementById('historial');
        const mainEl = document.querySelector('main');
        if (el && mainEl) {
          const elRect = el.getBoundingClientRect();
          const mainRect = mainEl.getBoundingClientRect();
          const targetTop = mainEl.scrollTop + (elRect.top - mainRect.top) - 16;
          mainEl.scrollTo({ top: Math.max(0, targetTop), behavior: smooth ? 'smooth' : 'instant' });
          return true;
        }
        return false;
      };

      // Múltiples pasadas para garantizar precisión exacta en cualquier monitor (incluso tras renderizado dinámico de gráficas)
      const t1 = setTimeout(() => scrollToHistorial(true), 100);
      const t2 = setTimeout(() => scrollToHistorial(true), 350);
      const t3 = setTimeout(() => scrollToHistorial(false), 700);

      return () => {
        clearTimeout(t1);
        clearTimeout(t2);
        clearTimeout(t3);
      };
    } else {
      // Si entra desde el módulo de Pacientes (sin hash), mostrar siempre desde el inicio
      const mainEl = document.querySelector('main');
      if (mainEl) mainEl.scrollTo({ top: 0, behavior: 'instant' });
      window.scrollTo({ top: 0, behavior: 'instant' });
    }
  }, [location.pathname, location.hash, loading]);

  const { confirm, ConfirmDialogComponent } = useConfirm();

  const handleDelete = async () => {
    const ok = await confirm({
      title: '¿Eliminar Expediente?',
      description: 'Esta acción eliminará PERMANENTEMENTE todo el historial clínico, valoraciones y planes del paciente. No se puede deshacer.',
      confirmLabel: 'Sí, Eliminar',
      cancelLabel: 'Cancelar',
      variant: 'danger',
    });
    if (!ok) return;
    try {
      await api.delete(`/api/pacientes/${id}`);
      toast({ title: 'EXPEDIENTE ELIMINADO', description: 'El paciente y toda su data han sido borrados del sistema.' });
      invalidateAfterPacienteChange(queryClient, id);
      navigate('/pacientes');
    } catch (err) {
      toast({ title: 'Error de Purga', description: 'No se pudo eliminar el expediente. Verifique la conexión con el servidor.', variant: 'destructive' });
    }
  };

  // B9: Archivar consulta (soft delete) con confirmación
  const [archiveTarget, setArchiveTarget] = useState<Valoracion | null>(null);
  const [archiving, setArchiving] = useState(false);
  const handleArchive = async () => {
    if (!archiveTarget) return;
    setArchiving(true);
    try {
      await api.delete(`/api/pacientes/${id}/valoraciones/${archiveTarget.id}`);
      toast({ title: 'Consulta Archivada', description: 'Se ocultó del historial.' });
      invalidateAfterValoracionChange(queryClient, id!);
      refetchArchivadas();
    } catch (err: any) {
      toast({ title: 'Error', description: err.response?.data?.error || 'No se pudo archivar la consulta.', variant: 'destructive' });
    } finally {
      setArchiving(false);
      setArchiveTarget(null);
    }
  };

  // B9: Handler para restaurar consulta
  const handleRestore = async (valoracionId: string) => {
    try {
      await api.patch(`/api/pacientes/${id}/valoraciones/${valoracionId}/restore`);
      toast({ title: 'Consulta Restaurada', description: 'La consulta vuelve a estar activa en el expediente.' });
      invalidateAfterValoracionChange(queryClient, id!);
      refetchArchivadas();
    } catch (err: any) {
      toast({ title: 'Error', description: err.response?.data?.error || 'No se pudo restaurar la consulta.', variant: 'destructive' });
    }
  };

  if (loading || !paciente) return (
    <div className="flex flex-col items-center justify-center h-[calc(100vh-120px)]">
      <NutritionLoader text="Cargando expediente..." />
    </div>
  );

  const calcAge = (dob?: string) => {
    if (!dob) return '—';
    const cleanDob = dob.includes('T') ? dob.split('T')[0] : dob;
    const diff = Date.now() - new Date(cleanDob).getTime();
    return Math.floor(diff / 31557600000);
  };

  const currentVal = valoraciones[0];
  const metricValue = (key: string, value: unknown, unit: string) => {
    if ((currentVal as any)?.medicionesEstado?.[key] === 'NO_APLICA') return 'No aplica';
    return value != null && value !== '' ? `${value}${unit}` : '—';
  };
  const recall24Rows = normalizeRecall24(paciente.habitos || (paciente as any).consumoCalorico);
  const fullHistoryData = [...valoraciones].reverse();
  const previewHistoryData = valoraciones.length > 5 ? [...valoraciones].slice(0, 5).reverse() : fullHistoryData;

  return (
    <>
      {/* B9: Modal confirmación archivar consulta */}
      {archiveTarget && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4 animate-fade-in">
          <div className="bg-[#111] border border-[#2e1a1a] rounded-[16px] p-8 max-w-sm w-full shadow-2xl text-center">
            <div className="w-14 h-14 rounded-full bg-[#2e1a1a] flex items-center justify-center mx-auto mb-5">
              <Trash2 className="w-6 h-6 text-accent-red" />
            </div>
            <h3 className="text-[18px] font-bold text-white m-0 mb-2">¿Archivar esta consulta?</h3>
            <p className="text-[13px] text-[#8a8a8a] mb-6 leading-relaxed">
              La consulta #{(archiveTarget as any).numeroValoracion} del {formatDate(archiveTarget.fecha)} quedará oculta del expediente. Los planes y citas vinculados se conservan y puedes restaurarla después.
            </p>
            <div className="flex flex-col gap-3">
              <button
                onClick={handleArchive}
                disabled={archiving}
                className="w-full py-3 bg-accent-red text-white rounded-[10px] text-[14px] font-bold hover:bg-red-700 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {archiving ? <div className="w-4 h-4 border-2 border-white/20 border-t-white rounded-full animate-spin" /> : <Trash2 className="w-4 h-4" />}
                Sí, archivar consulta
              </button>
              <button
                onClick={() => setArchiveTarget(null)}
                className="w-full py-3 bg-[#1a1a1a] text-[#8a8a8a] border border-[#333] rounded-[10px] text-[14px] font-medium hover:text-white transition-colors"
              >
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}
      <div className="min-h-screen bg-bg-base text-text-primary font-sans pb-24 animate-fade-in selection:bg-brand-primary selection:text-bg-base">
        {/* HEADER */}
        <header className="w-full border-b border-border-subtle pt-4 pb-6 flex flex-col md:flex-row justify-between items-start gap-4 bg-bg-base">
          <div className="flex items-start gap-4">
            <button
              onClick={() => navigate('/pacientes')}
              className="mt-1 p-2 rounded-[8px] border border-border-subtle text-text-secondary hover:text-text-primary hover:bg-bg-elevated transition-colors"
              title="Volver a la Lista"
            >
              <ArrowLeft className="h-5 w-5" />
            </button>
            <div className="flex flex-col">
              <div className="flex items-center gap-3">
                <h1 className="text-[26px] font-bold text-text-primary m-0 tracking-tight">
                  {paciente.nombre} {paciente.apellido}
                </h1>
                {currentVal && (
                  <span className={`px-2.5 py-1 rounded-full text-[12px] font-medium border ${getBadgeForValuation(currentVal).cls}`}>
                    {getBadgeForValuation(currentVal).text}
                  </span>
                )}
              </div>
              <p className="text-[14px] font-medium text-text-secondary mt-1 m-0">
                Expediente Clínico · ID {id?.slice(-8).toUpperCase()}
              </p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2 w-full md:w-auto mt-2 md:mt-0">
            <button
              onClick={() => navigate(`/pacientes/${id}/valoracion/nueva`)}
              className="flex-1 md:flex-none flex items-center justify-center gap-2 px-[18px] py-[10px] bg-white text-black text-[14px] font-bold rounded-[8px] hover:bg-[#e0e0e0] transition-colors shadow-sm"
            >
              <Plus className="h-[18px] w-[18px]" strokeWidth={3} /> Nueva Consulta
            </button>
            <button
              onClick={() => setShowFullExpediente(!showFullExpediente)}
              className={`flex-1 md:flex-none flex items-center justify-center gap-2 px-[18px] py-[10px] text-[14px] font-medium transition-colors rounded-[8px] border ${showFullExpediente ? 'bg-bg-elevated border-border-subtle text-text-primary' : 'bg-transparent border-border-default text-text-primary hover:bg-bg-elevated'}`}
            >
              {showFullExpediente ? <X className="h-4 w-4" /> : <ClipboardList className="h-4 w-4" />}
              {showFullExpediente ? 'Cerrar Detalles' : 'Ver Detalles del Expediente'}
            </button>
            <button
              onClick={() => navigate(`/pacientes/${id}/editar`)}
              className="flex-1 md:flex-none flex items-center justify-center gap-2 px-[18px] py-[10px] bg-bg-elevated text-text-primary border border-border-subtle text-[14px] font-medium transition-colors rounded-[8px] hover:bg-[#222]"
            >
              <Edit className="h-4 w-4" /> Editar Perfil
            </button>
            <button
              onClick={handleDelete}
              className="flex items-center justify-center p-[10px] bg-[#2e1a1a] text-accent-red border border-accent-red/20 text-[14px] font-medium transition-colors rounded-[8px] hover:bg-[#3d1a1a]"
              title="Borrar Expediente"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
        </header>

        <div className="max-w-full py-6 space-y-10">
          {/* INFO BAR */}
          <section className="grid grid-cols-2 lg:grid-cols-5 bg-bg-surface border border-border-subtle rounded-[14px] overflow-hidden shadow-sm">
            <InfoItem label="Edad" value={`${calcAge(paciente.fechaNacimiento)} Años`} icon={Clock} />
            <InfoItem label="Sexo" value={paciente.sexo === 'F' ? 'Femenino' : 'Masculino'} icon={User} />
            <InfoItem label="Teléfono" value={paciente.telefono ? paciente.telefono.replace(/\D/g, '').slice(-10) : '—'} icon={Phone} />
            <InfoItem label="Email" value={paciente.email || '—'} icon={Mail} />
            <InfoItem label="Registro" value={formatDate(paciente.fechaRegistro)} icon={Calendar} />
          </section>

          {/* NORDER HEALTH PORTAL */}
          <section className="px-5 py-4 bg-bg-surface border border-border-subtle rounded-[14px] space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <span className={`px-2.5 py-0.5 rounded-full text-[11px] font-semibold border uppercase tracking-wider ${paciente.portalActivo
                    ? 'bg-[#0f2e1a] text-[#4ade80] border-[#4ade80]/20'
                    : 'bg-bg-elevated text-text-muted border-border-subtle'
                  }`}>
                  {paciente.portalActivo ? 'Activo' : 'Inactivo'}
                </span>
                <span className="text-[12px] text-text-secondary font-medium">Norder Health</span>
                {paciente.suscripcionFin && (
                  <span className="text-[11px] text-text-muted hidden sm:inline">
                    Vence: {formatDate(paciente.suscripcionFin)}
                  </span>
                )}
              </div>
              <button
                onClick={handleTogglePortal}
                disabled={isActivatingPortal}
                className="flex items-center gap-2 px-[14px] py-[7px] text-[12px] font-medium border border-border-subtle rounded-[8px] hover:bg-bg-elevated transition-colors disabled:opacity-50"
              >
                {isActivatingPortal ? '...' : (paciente.portalActivo ? 'Desactivar Portal' : 'Activar Portal')}
              </button>
            </div>

            {paciente.portalActivo && (() => {
              const nivel = (paciente as any).nivelMembresia || 'ninguna';
              const currentTier = ['premium', 'norder_health'].includes(nivel)
                ? 'premium'
                : (nivel === 'basica' || nivel === 'basico') ? 'basico' : 'gratis';
              const tiers = [
                { key: 'gratis', label: 'Gratis', desc: '5 preguntas/día', active: 'bg-[#1c1000] text-[#f59e0b] border-[#f59e0b]/40' },
                { key: 'basico', label: 'Básico', desc: 'Equivalencias generales', active: 'bg-[#0a1628] text-[#60a5fa] border-[#60a5fa]/40' },
                { key: 'premium', label: 'Premium', desc: 'Plan personalizado', active: 'bg-[#0f2e1a] text-[#4ade80] border-[#4ade80]/40' },
              ] as const;
              return (
                <div className="grid grid-cols-3 gap-2">
                  {tiers.map(t => (
                    <button
                      key={t.key}
                      onClick={() => handleChangeTier(t.key)}
                      disabled={isChangingTier || currentTier === t.key}
                      className={`flex flex-col items-center py-2.5 px-2 rounded-[10px] border text-center transition-all disabled:cursor-default ${
                        currentTier === t.key
                          ? t.active
                          : 'bg-bg-elevated border-border-subtle text-text-muted hover:border-[#444] hover:text-text-secondary'
                      }`}
                    >
                      <span className="text-[12px] font-semibold leading-none">{t.label}</span>
                      <span className="text-[10px] opacity-70 mt-0.5 leading-none">{t.desc}</span>
                    </button>
                  ))}
                </div>
              );
            })()}
          </section>

          {showFullExpediente && (
            <div className="animate-slide-down space-y-8 bg-bg-surface p-8 rounded-[12px] border border-border-subtle">
              <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 border-b border-border-subtle pb-6">
                <div>
                  <h3 className="text-[20px] font-bold text-text-primary m-0 tracking-tight">Detalles Completos del Expediente</h3>
                  <p className="text-[14px] text-text-secondary m-0">Información clínica y hábitos registrados</p>
                </div>
                <button
                  onClick={() => navigate(`/pacientes/${id}/editar`)}
                  className="flex items-center gap-2 px-[18px] py-[10px] bg-bg-elevated text-text-primary border border-border-subtle text-[14px] font-medium transition-colors rounded-[8px] hover:bg-[#222]"
                >
                  <Edit className="h-4 w-4" /> Editar Expediente Completo
                </button>
              </div>

              <div className="grid lg:grid-cols-2 gap-8 mt-6">
                <ClinicalSection title="Estilo de Vida y Dinámica" icon={Activity} data={{
                  'Estado del ejercicio': (paciente.ejercicio || (paciente as any).datosEjercicio)?.activo === false ? 'Pausado' : 'Activo',
                  'Objetivo': (paciente.ejercicio || (paciente as any).datosEjercicio)?.objetivo || 'N/A',
                  'Gym de Origen': (paciente.ejercicio || (paciente as any).datosEjercicio)?.gymOrigen || 'N/A',
                  'Hora Entrenamiento': (paciente.ejercicio || (paciente as any).datosEjercicio)?.horaEntrenamiento || 'N/A',
                  'Disciplinas': formatDisciplinasForDisplay(
                    (paciente.ejercicio || (paciente as any).datosEjercicio)?.disciplina,
                    {
                      frecuencia: (paciente.ejercicio || (paciente as any).datosEjercicio)?.frecuencia,
                      tiempo: (paciente.ejercicio || (paciente as any).datosEjercicio)?.tiempo,
                    },
                    (paciente.ejercicio || (paciente as any).datosEjercicio)?.disciplinasDetalle
                  ),
                  'Nivel Actividad': (paciente.ejercicio || (paciente as any).datosEjercicio)?.nivelActividad || 'N/A',
                  'Distribución Actividad': `${(paciente.ejercicio || (paciente as any).datosEjercicio)?.porcentajeSedentario || 0}% S / ${(paciente.ejercicio || (paciente as any).datosEjercicio)?.porcentajeLeve || 0}% L / ${(paciente.ejercicio || (paciente as any).datosEjercicio)?.porcentajeModerado || 0}% M / ${(paciente.ejercicio || (paciente as any).datosEjercicio)?.porcentajeIntenso || 0}% I`,
                }} />

                <ClinicalSection title="Perfil Clínico y Patologías" icon={Heart} data={{
                  'Patología': paciente.antecedentes?.patologia || 'N/A',
                  'Cirugías / Traumas': paciente.antecedentes?.cirugias || 'N/A',
                  'Fármacos': (paciente.antecedentes?.farmacosDetalle && paciente.antecedentes.farmacosDetalle.length > 0)
                    ? paciente.antecedentes.farmacosDetalle.map(f => `${f.nombre}${f.tiempoTomando ? ` (${f.tiempoTomando})` : ''}${f.activo === false ? ' — ya no' : ''}`).join('\n')
                    : (paciente.antecedentes?.farmacos || 'N/A'),
                  'Alergias': paciente.antecedentes?.alergias || 'N/A',
                  'Tránsito Intestinal': paciente.antecedentes?.estrenimiento || 'N/A',
                  'Agua al día': paciente.antecedentes?.agua || 'N/A',
                  'Alcohol': paciente.antecedentes?.consumoAlcohol || 'N/A',
                  'Tabaco': paciente.antecedentes?.tabaco || 'N/A',
                  'Ciclo Menstrual': paciente.antecedentes?.cicloMenstrual || 'N/A',
                }} />

                <div className="bg-bg-elevated/20 border border-border-subtle/50 rounded-[12px] p-6 hover:bg-bg-elevated/40 transition-colors lg:col-span-2">
                  <div className="flex items-center gap-3 border-b border-border-subtle pb-4">
                    <Shield className="h-4 w-4 text-text-secondary" />
                    <h4 className="text-[12px] font-medium text-text-primary uppercase tracking-widest">Suplementación y Notas</h4>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mt-6">
                    <div className="space-y-2 md:col-span-2 lg:col-span-1">
                      <p className="text-[10px] font-medium text-text-muted uppercase tracking-widest leading-none">Suplementos del Registro</p>
                      {(paciente.antecedentes?.suplementosDetalle && paciente.antecedentes.suplementosDetalle.length > 0) ? (
                        <ul className="m-0 p-0 space-y-1">
                          {paciente.antecedentes.suplementosDetalle.map((s, i) => (
                            <li key={s.id || i} className="flex items-start gap-2">
                              <span className={`mt-1.5 w-1.5 h-1.5 rounded-full flex-shrink-0 ${s.activo !== false ? 'bg-green-500' : 'bg-[#555]'}`} />
                              <span className="text-[13px] font-medium text-text-primary leading-snug">
                                {s.nombre}{s.indicaciones ? ` — ${s.indicaciones}` : ''}
                              </span>
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <p className="text-[14px] font-medium text-text-muted tracking-tight">—</p>
                      )}
                    </div>
                    {[
                      { label: 'Historial Suplementos', value: paciente.antecedentes?.historialProductos },
                      { label: 'Aversiones (No gusta)', value: paciente.antecedentes?.alimentosNoGustan },
                      { label: 'Signos y Síntomas', value: paciente.antecedentes?.signosYSintomas },
                    ].map(({ label, value }) => (
                      <div key={label} className="space-y-2">
                        <p className="text-[10px] font-medium text-text-muted uppercase tracking-widest leading-none">{label}</p>
                        {value ? (
                          <p className="text-[14px] font-medium text-text-primary tracking-tight">{value}</p>
                        ) : (
                          <p className="text-[14px] font-medium text-text-muted tracking-tight">—</p>
                        )}
                      </div>
                    ))}
                    {/* Suplementos activos de última consulta */}
                    <div className="space-y-2">
                      <p className="text-[10px] font-medium text-text-muted uppercase tracking-widest leading-none">Suplementos — Última Consulta</p>
                      {(currentVal?.suplementosDetalle && currentVal.suplementosDetalle.length > 0) ? (
                        <ul className="m-0 p-0 space-y-1">
                          {currentVal.suplementosDetalle.filter((s: any) => s.activo !== false).map((s: any, i: number) => (
                            <li key={s.id || i} className="flex items-start gap-2">
                              <span className="mt-1.5 w-1.5 h-1.5 rounded-full flex-shrink-0 bg-green-500" />
                              <span className="text-[13px] font-medium text-text-primary leading-snug">
                                {s.nombre}{s.indicaciones ? ` — ${s.indicaciones}` : ''}
                              </span>
                            </li>
                          ))}
                          {currentVal.suplementosDetalle.filter((s: any) => s.activo === false).map((s: any, i: number) => (
                            <li key={`inact-${s.id || i}`} className="flex items-start gap-2">
                              <span className="mt-1.5 w-1.5 h-1.5 rounded-full flex-shrink-0 bg-[#555]" />
                              <span className="text-[13px] font-medium text-text-muted line-through leading-snug">{s.nombre}</span>
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <p className="text-[14px] font-medium text-text-muted tracking-tight">—</p>
                      )}
                    </div>
                  </div>
                </div>

                {/* Recordatorio 24 horas */}
                {(
                  <div className="bg-bg-elevated/20 border border-border-subtle/50 rounded-[12px] p-6 hover:bg-bg-elevated/40 transition-colors lg:col-span-2">
                    <div className="flex items-center gap-3 border-b border-border-subtle pb-4 mb-4">
                      <h4 className="text-[12px] font-medium text-text-primary uppercase tracking-widest">Recordatorio 24 Horas</h4>
                    </div>
                    <div className="overflow-x-auto">
                      <table className="w-full text-[12px]">
                        <thead>
                          <tr className="border-b border-border-subtle">
                            <th className="text-left text-[10px] font-medium text-text-muted uppercase tracking-widest pb-2 pr-4 w-28">Tiempo</th>
                            <th className="text-left text-[10px] font-medium text-text-muted uppercase tracking-widest pb-2 pr-4">Hora</th>
                            <th className="text-left text-[10px] font-medium text-text-muted uppercase tracking-widest pb-2">Notas</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-border-subtle/30">
                          {recall24Rows.map((row, index) => {
                            if (!row.hora && !row.notas) return null;
                            return (
                              <tr key={`${row.label}-${index}`}>
                                <td className="py-2 pr-4 text-[11px] font-bold text-text-muted uppercase tracking-wider">{row.label}</td>
                                <td className="py-2 pr-4 text-[13px] text-text-secondary">{row.hora || '—'}</td>
                                <td className="py-2 text-[13px] text-text-secondary">{row.notas || '—'}</td>
                              </tr>
                            );
                          })}
                          {!hasRecall24Data(recall24Rows) && (
                            <tr>
                              <td colSpan={3} className="py-5 text-center text-[12px] text-text-muted">Sin información registrada.</td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          <div className="flex justify-between items-center pt-4 border-t border-border-subtle/50">
            <div>
              <h2 className="text-[18px] font-semibold text-text-primary m-0 mb-1 tracking-tight">Indicadores Críticos</h2>
              <p className="text-[14px] text-text-secondary m-0">Métricas principales de progreso físico</p>
            </div>
          </div>

          <NutritionistPhotoHistory pacienteId={id!} />

          {/* KPIs */}
          <section className="grid grid-cols-2 lg:grid-cols-4 gap-4 mt-6">
            <KpiCardCompact label="Porcentaje Grasa (%)" value={metricValue('pctGrasa', (currentVal as any)?.pctGrasaCorp ?? (currentVal as any)?.pctGrasaCorporal4comp ?? currentVal?.pctGrasa2comp ?? (currentVal as any)?.pctGrasa, '%')} active icon={Activity} />
            <KpiCardCompact label="Kilos Grasa (KG)" value={metricValue('kgGrasa', (currentVal as any)?.masaGrasaReal ?? (currentVal as any)?.kgGrasa2comp, ' KG')} icon={Heart} />
            <KpiCardCompact label="Peso Actual" value={metricValue('peso', currentVal?.pesoActual ?? currentVal?.peso ?? paciente.peso, ' KG')} icon={Activity} />
            <KpiCardCompact label="Masa Magra" value={metricValue('masaMagra', (currentVal as any)?.masaMagra ?? currentVal?.kgMasaMagra2comp, ' KG')} icon={Shield} />
          </section>

          {/* PROGRESS CHARTS HIGH-CONTRAST */}
          <section className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <ChartBox
              title="Grasa Corporal"
              onExpand={() => setFullChartModal({ isOpen: true, title: 'Historial de Grasa Corporal', baseDataKey: '', baseName: '', isFatModal: true })}

              extra={
                <div className="flex bg-bg-elevated p-0.5 rounded-[6px] border border-border-subtle">
                  <button
                    onClick={() => setFatChartMode('pct')}
                    className={`px-3 py-1 text-[9px] font-bold uppercase tracking-wider rounded-[4px] transition-all ${fatChartMode === 'pct' ? 'bg-[#333] text-white' : 'text-text-muted hover:text-text-secondary'}`}
                  >
                    %
                  </button>
                  <button
                    onClick={() => setFatChartMode('kg')}
                    className={`px-3 py-1 text-[9px] font-bold uppercase tracking-wider rounded-[4px] transition-all ${fatChartMode === 'kg' ? 'bg-[#333] text-white' : 'text-text-muted hover:text-text-secondary'}`}
                  >
                    KG
                  </button>
                </div>
              }
            >
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={previewHistoryData} margin={{ top: 10, right: 10, left: -25, bottom: 20 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#2a2a2a" vertical={false} />
                  <XAxis
                    dataKey="fecha"
                    tickFormatter={(val) => formatDateShort(val)}
                    tick={{ fontSize: 10, fontWeight: 500, fill: '#8a8a8a' }}
                    axisLine={false}
                    tickLine={false}
                    dy={10}
                  />
                  <YAxis
                    tick={{ fontSize: 10, fontWeight: 500, fill: '#8a8a8a' }}
                    axisLine={false}
                    tickLine={false}
                    domain={['auto', 'auto']}
                  />
                  <Tooltip contentStyle={{ borderRadius: '8px', border: '1px solid #2a2a2a', background: '#111', color: '#f0f0f0' }} labelStyle={{ display: 'none' }} />
                  <Area
                    key={fatChartMode}
                    type="monotone"
                    dataKey={fatChartMode === 'pct' ? "grasaEvolucion" : "kgGrasaEvolucion"}
                    name={fatChartMode === 'pct' ? "Porcentaje de Grasa (%)" : "Kilos Grasa (KG)"}
                    stroke={fatChartMode === 'pct' ? "#f0f0f0" : "#f0f0f0"}
                    strokeWidth={2}
                    fill="rgba(240, 240, 240, 0.05)"
                    dot={{ r: 4, fill: '#111', stroke: '#f0f0f0', strokeWidth: 2 }}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </ChartBox>

            <ChartBox
              title="Evolución de Peso (KG)"
              onExpand={() => setFullChartModal({ isOpen: true, title: 'Evolución de Peso Completa', baseDataKey: 'pesoEvolucion', baseName: 'Peso' })}
            >
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={previewHistoryData} margin={{ top: 10, right: 10, left: -25, bottom: 20 }}>
                  <defs>
                    <linearGradient id="premiumGradient" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#f0f0f0" stopOpacity={0.15} />
                      <stop offset="95%" stopColor="#f0f0f0" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#2a2a2a" vertical={false} />
                  <XAxis
                    dataKey="fecha"
                    tickFormatter={(val) => formatDateShort(val)}
                    tick={{ fontSize: 10, fontWeight: 500, fill: '#8a8a8a' }}
                    axisLine={false}
                    tickLine={false}
                    dy={10}
                  />
                  <YAxis
                    tick={{ fontSize: 10, fontWeight: 500, fill: '#8a8a8a' }}
                    axisLine={false}
                    tickLine={false}
                    domain={['auto', 'auto']}
                  />
                  <Tooltip
                    contentStyle={{ borderRadius: '8px', border: '1px solid #2a2a2a', background: '#111111', color: '#f0f0f0', fontSize: '12px' }}
                    itemStyle={{ color: '#f0f0f0', textTransform: 'uppercase' }}
                    labelStyle={{ display: 'none' }}
                  />
                  <Area
                    type="monotone"
                    dataKey="pesoEvolucion"
                    name="Peso"
                    stroke="#f0f0f0"
                    strokeWidth={2}
                    fillOpacity={1}
                    fill="url(#premiumGradient)"
                    dot={{ r: 4, fill: '#111', stroke: '#f0f0f0', strokeWidth: 2 }}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </ChartBox>

            <ChartBox
              title="Masa Magra (KG)"
              onExpand={() => setFullChartModal({ isOpen: true, title: 'Historial de Masa Magra', baseDataKey: 'masaMagraEvolucion', baseName: 'Masa Magra' })}
            >
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={previewHistoryData} margin={{ top: 10, right: 10, left: -25, bottom: 20 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#2a2a2a" vertical={false} />
                  <XAxis
                    dataKey="fecha"
                    tickFormatter={(val) => formatDateShort(val)}
                    tick={{ fontSize: 10, fontWeight: 500, fill: '#8a8a8a' }}
                    axisLine={false}
                    tickLine={false}
                    dy={10}
                  />
                  <YAxis
                    tick={{ fontSize: 10, fontWeight: 500, fill: '#8a8a8a' }}
                    axisLine={false}
                    tickLine={false}
                    domain={['auto', 'auto']}
                  />
                  <Tooltip contentStyle={{ borderRadius: '8px', border: '1px solid #2a2a2a', background: '#111', color: '#f0f0f0' }} labelStyle={{ display: 'none' }} />
                  <Area
                    type="monotone"
                    dataKey="masaMagraEvolucion"
                    name="Masa Magra"
                    stroke="#f0f0f0"
                    strokeWidth={2}
                    fill="rgba(240, 240, 240, 0.05)"
                    dot={{ r: 4, fill: '#111', stroke: '#f0f0f0', strokeWidth: 2 }}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </ChartBox>

          </section>

          {/* Historial de Laboratorio */}
          {previewHistoryData.some((v: any) => v.glucosaEvolucion != null || v.trigliceridosEvolucion != null || v.colesterolEvolucion != null || v.creatininaEvolucion != null || v.acidoUricoEvolucion != null) && (
            <section className="grid grid-cols-1 gap-6">
              <ChartBox
                title="Historial de Laboratorio"
                extra={
                  <div className="flex flex-wrap gap-1 bg-bg-elevated p-0.5 rounded-[6px] border border-border-subtle">
                    {([
                      { key: 'glucosa', label: 'Glucosa' },
                      { key: 'trigliceridos', label: 'Triglicéridos' },
                      { key: 'colesterol', label: 'Colesterol' },
                      { key: 'creatinina', label: 'Creatinina' },
                      { key: 'acidoUrico', label: 'Ác. Úrico' },
                    ] as const).map(({ key, label }) => (
                      <button
                        key={key}
                        onClick={() => setLabMarker(key)}
                        className={`px-3 py-1 text-[9px] font-bold uppercase tracking-wider rounded-[4px] transition-all ${labMarker === key ? 'bg-[#333] text-white' : 'text-text-muted hover:text-text-secondary'}`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                }
              >
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={previewHistoryData} margin={{ top: 10, right: 10, left: -25, bottom: 20 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#2a2a2a" vertical={false} />
                    <XAxis
                      dataKey="fecha"
                      tickFormatter={(val) => formatDateShort(val)}
                      tick={{ fontSize: 10, fontWeight: 500, fill: '#8a8a8a' }}
                      axisLine={false}
                      tickLine={false}
                      dy={10}
                    />
                    <YAxis
                      tick={{ fontSize: 10, fontWeight: 500, fill: '#8a8a8a' }}
                      axisLine={false}
                      tickLine={false}
                      domain={['auto', 'auto']}
                    />
                    <Tooltip contentStyle={{ borderRadius: '8px', border: '1px solid #2a2a2a', background: '#111', color: '#f0f0f0' }} labelStyle={{ display: 'none' }} />
                    <Area
                      key={labMarker}
                      type="monotone"
                      dataKey={`${labMarker}Evolucion`}
                      name={{ glucosa: 'Glucosa (mg/dL)', trigliceridos: 'Triglicéridos (mg/dL)', colesterol: 'Colesterol (mg/dL)', creatinina: 'Creatinina (mg/dL)', acidoUrico: 'Ácido Úrico (mg/dL)' }[labMarker]}
                      stroke="#f0f0f0"
                      strokeWidth={2}
                      fill="rgba(240, 240, 240, 0.05)"
                      dot={{ r: 4, fill: '#111', stroke: '#f0f0f0', strokeWidth: 2 }}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </ChartBox>
            </section>
          )}

          {currentVal && otrosBioquimicosFromValoracion(currentVal).length > 0 && (
            <section className="rounded-[12px] border border-border-default bg-bg-surface p-5">
              <p className="m-0 mb-2 text-[10px] font-bold uppercase tracking-widest text-text-muted">Bioquímica · Otros resultados</p>
              {otrosBioquimicosFromValoracion(currentVal).map(item => (
                <p key={item.id} className="m-0 text-[13px] text-text-primary">{item.nombre}: {item.valor}</p>
              ))}
            </section>
          )}

          {/* LOG DE CONSULTAS */}
          <section className="space-y-6 pt-4" id="historial">
            <div className="flex items-center gap-4">
              <h2 className="text-[18px] font-semibold text-text-primary m-0">Historial Clínico</h2>
              <div className="flex-1 h-[1px] bg-border-subtle" />
            </div>

            {valoraciones.length > 0 ? (
              <div className="space-y-3">
                {valoraciones.map((v, i) => (
                  <AccordionRow
                    key={v.id}
                    val={v}
                    index={i}
                    onVerDetalles={(valId) => navigate(`/pacientes/${id}/valoraciones/${valId}`)}
                    onVerPlan={(planId) => navigate(`/pacientes/${id}/planes/${planId}`)}
                    onAsignarPlan={(valId) => navigate(`/pacientes/${id}/planes/nuevo?valoracionId=${valId}`)}
                    onEditPlan={(pId) => navigate(`/pacientes/${id}/planes/${pId}/editar?valoracionId=${v.id}`)}
                    onArchive={() => setArchiveTarget(v)}
                  />
                ))}
              </div>
            ) : (
              <div className="py-20 text-center border border-border-default border-dashed rounded-[12px] bg-bg-surface">
                <ClipboardList className="h-8 w-8 text-text-muted mx-auto mb-4" />
                <p className="text-[14px] font-medium text-text-secondary">Aún no hay valoraciones clínicas registradas</p>
              </div>
            )}
          </section>

          {/* B9: CONSULTAS ARCHIVADAS — oculto a propósito, ver SHOW_ARCHIVADAS */}
          {SHOW_ARCHIVADAS && archivadas.length > 0 && (
            <section className="space-y-6 pt-4 border-t border-border-subtle/50 mt-8">
              <div className="flex items-center gap-4">
                <h2 className="text-[18px] font-semibold text-text-muted m-0 flex items-center gap-2">
                  <ArchiveRestore className="w-5 h-5" /> Consultas Archivadas
                </h2>
                <div className="flex-1 h-[1px] bg-border-subtle" />
              </div>
              <div className="space-y-3">
                {archivadas.map((v: any) => (
                  <div key={v.id} className="bg-bg-elevated/20 border border-border-subtle/50 rounded-[12px] p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                    <div>
                      <div className="flex items-center gap-3 mb-1">
                        <span className="px-2 py-0.5 rounded-[4px] bg-[#2a2a2a] text-[#8a8a8a] text-[10px] font-bold uppercase">
                          #{v.numeroValoracion}
                        </span>
                        <h4 className="text-[15px] font-bold text-[#8a8a8a] m-0">
                          {formatDate(v.fecha)}
                        </h4>
                      </div>
                      <p className="text-[12px] text-text-muted m-0">
                        Archivada el {formatDateShort(v.deletedAt)} · ID: {v.id.slice(-8).toUpperCase()}
                      </p>
                    </div>
                    <button
                      onClick={() => handleRestore(v.id)}
                      className="flex items-center justify-center gap-2 px-4 py-2 bg-bg-surface border border-border-subtle text-text-primary text-[12px] font-bold rounded-[8px] hover:bg-bg-elevated transition-colors whitespace-nowrap"
                    >
                      <RotateCcw className="w-4 h-4" /> Restaurar
                    </button>
                  </div>
                ))}
              </div>
            </section>
          )}

        </div>
      </div>

      {/* MODAL HISTORIAL COMPLETO */}
      {fullChartModal.isOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 animate-fade-in" onClick={() => setFullChartModal(prev => ({ ...prev, isOpen: false }))}>
          <div className="bg-bg-base border border-border-default rounded-[16px] w-full max-w-4xl p-8 relative flex flex-col max-h-[90vh]" onClick={e => e.stopPropagation()}>
            <button
              onClick={() => setFullChartModal(prev => ({ ...prev, isOpen: false }))}
              className="absolute top-6 right-6 p-2 rounded-[8px] bg-bg-surface hover:bg-bg-elevated text-text-secondary hover:text-white transition-colors"
            >
              <X className="h-5 w-5" />
            </button>
            <div className="mb-8">
              <h2 className="text-[20px] font-bold text-white uppercase tracking-wider m-0">{fullChartModal.title}</h2>
              <p className="text-[13px] text-text-muted mt-1 m-0">Gráfica detallada de toda la evolución temporal del paciente ({fullHistoryData.length} registros)</p>
            </div>

            <div style={{ width: '100%', height: '400px', marginTop: '16px' }}>
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={fullHistoryData} margin={{ top: 10, right: 10, left: -25, bottom: 20 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#2a2a2a" vertical={false} />
                  <XAxis
                    dataKey="fecha"
                    tickFormatter={(val) => formatDateShort(val)}
                    tick={{ fontSize: 10, fontWeight: 500, fill: '#8a8a8a' }}
                    axisLine={false}
                    tickLine={false}
                    dy={10}
                  />
                  <YAxis
                    tick={{ fontSize: 10, fontWeight: 500, fill: '#8a8a8a' }}
                    axisLine={false}
                    tickLine={false}
                    domain={['auto', 'auto']}
                  />
                  <Tooltip contentStyle={{ borderRadius: '8px', border: '1px solid #2a2a2a', background: '#111', color: '#f0f0f0', fontSize: '12px' }} itemStyle={{ color: '#f0f0f0' }} labelStyle={{ display: 'none' }} />
                  <Area
                    type="monotone"
                    dataKey={fullChartModal.isFatModal ? (fatChartMode === 'pct' ? 'grasaEvolucion' : 'kgGrasaEvolucion') : fullChartModal.baseDataKey}
                    name={fullChartModal.isFatModal ? (fatChartMode === 'pct' ? 'Porcentaje de Grasa (%)' : 'Kilos Grasa (KG)') : fullChartModal.baseName}
                    stroke="#f0f0f0"
                    strokeWidth={2}
                    fill="rgba(240, 240, 240, 0.05)"
                    dot={{ r: 4, fill: '#111', stroke: '#f0f0f0', strokeWidth: 2 }}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>
      )}

      {ConfirmDialogComponent}
    </>
  );
};

export default PatientProfile;
