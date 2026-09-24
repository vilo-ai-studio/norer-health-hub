import React, { useState, useMemo, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Plus, Trash2, Shield, Calendar as CalendarIcon, BookOpen, ChevronDown, FileText, Activity, GripVertical, Check, Droplets, MapPin, Wifi, Search } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { invalidateAfterValoracionChange } from '@/lib/invalidation';
import api from '@/lib/api';
import {
  APPOINTMENT_REQUEST_TIMEOUT_MS,
  getBookingFailureCopy
} from '@/lib/appointmentScheduling';
import { useToast } from '@/hooks/use-toast';
import BarridosEquivalenciasManager, {
  getBarridoVariantes,
  type BarridoCollection,
} from '@/components/BarridosEquivalenciasManager';
import { normalizeColacionLabel } from '@/components/BarridoEquivalencias';
import { CreateEditPlanForm } from './CreateEditPlan';
import { PlanEnvioForm } from './PlanView';
import { Phase4Delivery } from './Phase4Delivery';
import CalcomScheduling from '@/components/CalcomScheduling';
import { buildPatientFullName } from '@/lib/patientName';
import { PhotoFollowup } from '@/components/PhotoFollowup';
import type { PendingFollowupPhoto } from '@/lib/followupPhotos';
import { useConfirm } from '@/components/ui/ConfirmDialog';
import { AppointmentSummary, type AppointmentSummaryData } from '@/components/AppointmentSummary';
import {
  EMPTY_ONLINE_MEASUREMENTS,
  buildOnlinePerimeters,
  hasInvalidOnlineMeasurement,
  onlineMeasurementsFromPerimeters,
} from '@/lib/assessmentModality';
import { DEFAULT_RECALL_24, normalizeRecall24, resolveAssessmentDietetica, serializeRecall24, type Recall24Row } from '@/lib/recall24';
import { encodeDisciplinas, decodeDisciplinas, type DisciplinaItem } from '@/lib/disciplinas';
import { hasLaboratorio, laboratorioFromValoracion } from '@/lib/laboratorio';
import DietTable from '@/components/DietTable';
import { SupplementHistoryEditor } from '@/components/SupplementHistoryEditor';
import { PreviousConsultationMenuPreview } from '@/components/PreviousConsultationMenuPreview';
import { findPreviousConsultationPlan } from '@/lib/previousConsultationPlan';

const COMP_NOTES_MARKER = '__COMPETENCIA_NOTES__';
const DIETETICA_DRAFT_VERSION = 2;
type MeasurementStatus = 'REGISTRADA' | 'NO_APLICA' | 'NO_CAPTURADA';
type CompositionMethod = 'ANTROPOMETRIA' | 'BIOIMPEDANCIA';

const parseCompetenciaFromTemario = (items: { tema: string; detalle: string }[] | undefined) => {
  if (!items) return { comp: { antes: '', durante: '', despues: '' }, rest: [] as typeof items };
  const compItem = items.find(t => t.tema === COMP_NOTES_MARKER);
  const rest = items.filter(t => t.tema !== COMP_NOTES_MARKER);
  if (!compItem) return { comp: { antes: '', durante: '', despues: '' }, rest };
  try {
    const parsed = JSON.parse(compItem.detalle || '{}');
    return { comp: { antes: parsed.antes || '', durante: parsed.durante || '', despues: parsed.despues || '' }, rest };
  } catch {
    return { comp: { antes: '', durante: '', despues: '' }, rest };
  }
};

const Field = ({
  label, value, onChange, type = 'number', disabled = false, suffix = '', placeholder = '', status, onStatusChange,
}: {
  label: string; value: string | number; onChange?: (v: string) => void;
  type?: string; disabled?: boolean; suffix?: string; placeholder?: string;
  status?: MeasurementStatus; onStatusChange?: (status: MeasurementStatus) => void;
}) => (
  <div className="space-y-1">
    <div className="flex items-center justify-between gap-2">
      <label className="block text-[10px] font-bold text-[#8a8a8a] m-0 uppercase tracking-widest">{label}{suffix && ` (${suffix})`}</label>
      {onStatusChange && (
        <button type="button" onClick={() => onStatusChange(status === 'NO_APLICA' ? 'NO_CAPTURADA' : 'NO_APLICA')} className={`text-[9px] font-bold uppercase tracking-wider px-2 py-0.5 rounded border ${status === 'NO_APLICA' ? 'text-amber-300 border-amber-700 bg-amber-950/30' : 'text-[#666] border-[#333] hover:text-white'}`}>
          {status === 'NO_APLICA' ? 'No aplica ✓' : 'Marcar N/A'}
        </button>
      )}
    </div>
    <div className="relative">
      <input
        type={type}
        value={status === 'NO_APLICA' ? '' : value}
        onChange={onChange ? (e) => onChange(e.target.value) : undefined}
        disabled={disabled || status === 'NO_APLICA'}
        placeholder={status === 'NO_APLICA' ? 'No aplica' : placeholder}
        className={`w-full bg-[#181818] rounded-[6px] px-3 py-2 text-[13px] font-medium text-white outline-none border border-[#333] focus:border-[#555555] transition-colors placeholder-[#555] [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none ${disabled ? 'opacity-50 cursor-not-allowed bg-[#111111]' : ''}`}
        step={type === 'number' ? "0.01" : undefined}
      />
    </div>
  </div>
);

const NewAssessment = () => {
  const { id: pacienteId, valoracionId } = useParams<{ id: string; valoracionId?: string }>();
  const isEdit = !!valoracionId;
  const navigate = useNavigate();
  const { toast } = useToast();
  const { confirm, ConfirmDialogComponent } = useConfirm();
  const [saving, setSaving] = useState(false);
  const [paciente, setPaciente] = useState<any>(null);
  const mostrarBioimpedancia = paciente?.mostrarBioimpedancia !== false;

  const now = new Date();
  const [step, setStep] = useState(1);
  const [fecha, setFecha] = useState(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`);
  const [hora, setHora] = useState(`${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`);
  const [numeroValoracion, setNumeroValoracion] = useState(1);
  const [peso, setPeso] = useState('');
  const [estatura, setEstatura] = useState('');
  const [pctGrasa, setPctGrasa] = useState('');
  const [kgGrasa, setKgGrasa] = useState(''); // Kg Grasa manually? Or just auto? I'll add for capture.
  const [measurementStatuses, setMeasurementStatuses] = useState<Record<'peso' | 'estatura' | 'pctGrasa' | 'kgGrasa' | 'masaMagra', MeasurementStatus>>({
    peso: 'NO_CAPTURADA', estatura: 'NO_CAPTURADA', pctGrasa: 'NO_CAPTURADA', kgGrasa: 'NO_CAPTURADA', masaMagra: 'NO_CAPTURADA',
  });
  const [pendingFollowupPhotos, setPendingFollowupPhotos] = useState<PendingFollowupPhoto[]>([]);
  const [consultaEnLinea, setConsultaEnLinea] = useState(false);
  const [compositionMethod, setCompositionMethod] = useState<CompositionMethod>('ANTROPOMETRIA');
  const [bioimpedancia, setBioimpedancia] = useState({
    grasa: '',
    agua: '',
    musculo: '',
  });
  const [laboratorio, setLaboratorio] = useState(laboratorioFromValoracion(null));
  const [laboratorioAnteriorFecha, setLaboratorioAnteriorFecha] = useState<string | null>(null);
  const [onlineMeasurements, setOnlineMeasurements] = useState({ ...EMPTY_ONLINE_MEASUREMENTS });
  const [comentarios, setComentarios] = useState('');
  const [temario, setTemario] = useState<{ id: string; tema: string; detalle: string }[]>([]);
  const [evitar, setEvitar] = useState<{ id: string; valor: string }[]>([]);
  const [competencia, setCompetencia] = useState<{ antes: string; durante: string; despues: string }>({ antes: '', durante: '', despues: '' });
  const [showCompetencia, setShowCompetencia] = useState(false);
  const [barridoData, setBarridoData] = useState<BarridoCollection | null>(null);
  const [isGrasaModified, setIsGrasaModified] = useState(false);
  const [proximaSesion, setProximaSesion] = useState('');
  const [showScheduling, setShowScheduling] = useState(true);

  const [valoracionIdGuardada, setValoracionIdGuardada] = useState<string | null>(null);
  const [calcomData, setCalcomData] = useState<AppointmentSummaryData | null>(null);

  const queryClient = useQueryClient();

  const [suplementacionActiva, setSuplementacionActiva] = useState(false);
  const [suplementosDetalle, setSuplementosDetalle] = useState<{ id: string; nombre: string; indicaciones: string; activo: boolean; fechaInicio?: string; fechaFin?: string }[]>([]);
  const [farmacosDetalle, setFarmacosDetalle] = useState<{ id: string; nombre: string; tiempoTomando: string; activo: boolean }[]>([]);
  const [dragFarmIdx, setDragFarmIdx] = useState<number | null>(null);
  const [historialSupDetalle, setHistorialSupDetalle] = useState<{ id: string; nombre: string; indicaciones: string; activo: boolean }[]>([]);
  const [registroSupAdded, setRegistroSupAdded] = useState<Set<string>>(new Set());
  const [planIdGuardado, setPlanIdGuardado] = useState<string | null>(null);
  // B8: en modo edición, plan ya vinculado a esta valoración — el paso 3 lo edita en vez de duplicar
  const [planVinculadoId, setPlanVinculadoId] = useState<string | null>(null);
  const [pendingDraft, setPendingDraft] = useState<any>(null);
  const [showDraftPrompt, setShowDraftPrompt] = useState(false);

  const [tieneSuplementos, setTieneSuplementos] = useState(false);
  const [suplementos, setSuplementos] = useState<{ id: string; nombre: string; indicaciones: string; fechaInicio: string; activo: boolean }[]>([]);

  const [dragSupIdx, setDragSupIdx] = useState<number | null>(null);
  const [notasLibres, setNotasLibres] = useState('');
  const [notasLibresOpen, setNotasLibresOpen] = useState(true);
  const [esqueHidratacion, setEsqueHidratacion] = useState('');
  const [esqueHidratacionOpen, setEsqueHidratacionOpen] = useState(true);
  const [adjuntos, setAdjuntos] = useState<{ id: string; nombre: string; tipo: string; dataUrl: string }[]>([]);

  const [expediente, setExpediente] = useState({
    objetivo: '', nivelActividad: '', gymOrigen: '', horaEntrenamiento: '', disciplina: '', frecuencia: '', tiempo: '',
    porcentajeSedentario: '10', porcentajeLeve: '20', porcentajeModerado: '30', porcentajeIntenso: '40',
    patologia: '', cirugias: '', alergias: '', alimentosNoGustan: '', alimentosGustan: '',
    agua: '', estrenimiento: '', signosYSintomas: '', consumoAlcohol: '', tabaco: '',
    cicloMenstrual: '', historialProductos: '', farmacos: '',
  });
  const [expedienteModified, setExpedienteModified] = useState(false);
  const [showExpediente, setShowExpediente] = useState(false);
  const [habitos, setHabitos] = useState<Recall24Row[]>(DEFAULT_RECALL_24.map((row) => ({ ...row })));
  const [showNotasConsulta, setShowNotasConsulta] = useState(true);
  const [showDinamicaDeportiva, setShowDinamicaDeportiva] = useState(false);
  const [showBioquimica, setShowBioquimica] = useState(false);
  const [ejercicioActivo, setEjercicioActivo] = useState(true);
  const [disciplinas, setDisciplinas] = useState<DisciplinaItem[]>([{ disciplina: '', frecuencia: '', tiempo: '', activo: true }]);
  const firstDisciplinaInputRef = useRef<HTMLInputElement>(null);
  const addDisciplina = () => {
    setDisciplinas(prev => [{ disciplina: '', frecuencia: '', tiempo: '', activo: true }, ...prev]);
    setExpedienteModified(true);
    requestAnimationFrame(() => firstDisciplinaInputRef.current?.focus());
  };
  const removeDisciplina = (idx: number) => setDisciplinas(prev => prev.length > 1 ? prev.filter((_, i) => i !== idx) : prev);
  const updateDisciplina = (idx: number, field: 'disciplina' | 'frecuencia' | 'tiempo', val: string) => {
    setDisciplinas(prev => prev.map((d, i) => i === idx ? { ...d, [field]: val } : d));
    setExpedienteModified(true);
  };
  const [showDietetico, setShowDietetico] = useState(true);
  const [showPreviousMenus, setShowPreviousMenus] = useState(false);

  const previousConsultationPlan = useMemo(
    () => findPreviousConsultationPlan(paciente?.valoraciones, isEdit ? valoracionId : undefined),
    [isEdit, paciente?.valoraciones, valoracionId],
  );

  useEffect(() => {
    if (!previousConsultationPlan) setShowPreviousMenus(false);
  }, [previousConsultationPlan]);
  // Si el nutriólogo agrega/renombra/quita un tiempo directamente en Barrido (no en Dietético),
  // se refleja de vuelta aquí. Se emparaja por POSICIÓN (índice dentro del barrido), no por nombre:
  // un renombrado cambia el nombre por definición, así que emparejar por nombre no podría
  // distinguirlo de "se borró uno y se agregó otro" — perdiendo la hora/notas ya capturadas. Los
  // tiempos protegidos (huérfanos, en uso por un Plan) viven siempre al final del arreglo del
  // barrido, más allá de lo que hay en Dietética, así que un índice fuera de rango simplemente no
  // toca Dietética (no reintroduce un tiempo protegido). Como esto solo se dispara desde las
  // ediciones manuales de BarridoEquivalencias (nunca desde su propio efecto de auto-sync), no hay
  // riesgo de loop con la sincronización Dietético→Barrido.
  const handleTiempoAddedFromBarrido = (nombre: string) => {
    setHabitos((current) => [...current, { label: normalizeColacionLabel(nombre) || 'Tiempo', hora: '', notas: '' }]);
    setExpedienteModified(true);
  };
  const handleTiempoRenamedFromBarrido = (idx: number, nombre: string) => {
    setHabitos((current) => {
      if (idx >= current.length) return current;
      return current.map((h, i) => (i === idx ? { ...h, label: normalizeColacionLabel(nombre) || h.label } : h));
    });
    setExpedienteModified(true);
  };
  const handleTiempoRemovedFromBarrido = (idx: number) => {
    setHabitos((current) => {
      if (idx >= current.length) return current;
      return current.filter((_, i) => i !== idx);
    });
    setExpedienteModified(true);
  };
  const handleTiempoReorderedFromBarrido = (fromIdx: number, toIdx: number) => {
    setHabitos((current) => {
      if (fromIdx < 0 || fromIdx >= current.length || toIdx < 0 || toIdx >= current.length) return current;
      const next = [...current];
      const [moved] = next.splice(fromIdx, 1);
      next.splice(toIdx, 0, moved);
      return next;
    });
    setExpedienteModified(true);
  };
  const [showSuplemantacion, setShowSuplemantacion] = useState(true);
  const [showMedidas, setShowMedidas] = useState(true);
  const [showAgendarCita, setShowAgendarCita] = useState(true);

  const handleAdjuntoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    files.forEach(file => {
      if (file.size > 1.5 * 1024 * 1024) {
        toast({ title: 'Archivo muy grande', description: `${file.name} supera 1.5MB. Comprime la imagen.`, variant: 'destructive' });
        return;
      }
      const reader = new FileReader();
      reader.onload = (ev) => {
        const dataUrl = ev.target?.result as string;
        setAdjuntos(prev => [...prev, { id: Date.now().toString() + Math.random(), nombre: file.name, tipo: file.type, dataUrl }]);
      };
      reader.readAsDataURL(file);
    });
    e.target.value = '';
  };

  const seedFarmacosDetalle = (ant: any) => {
    if (ant.farmacosDetalle && Array.isArray(ant.farmacosDetalle) && ant.farmacosDetalle.length > 0) {
      setFarmacosDetalle(ant.farmacosDetalle.map((f: any) => ({ ...f, id: f.id || Math.random().toString() })));
    } else if (ant.farmacos) {
      setFarmacosDetalle([{ id: Date.now().toString(), nombre: ant.farmacos, tiempoTomando: '', activo: true }]);
    } else {
      setFarmacosDetalle([]);
    }
  };

  const seedHistorialSupDetalle = (ant: any) => {
    if (ant.suplementosDetalle && Array.isArray(ant.suplementosDetalle) && ant.suplementosDetalle.length > 0) {
      setHistorialSupDetalle(ant.suplementosDetalle.map((s: any) => ({ id: s.id || Math.random().toString(), nombre: s.nombre || '', indicaciones: s.indicaciones || '', activo: s.activo !== false })));
    } else {
      setHistorialSupDetalle([]);
    }
  };

  const updateFarmacosDetalle = (updater: (prev: { id: string; nombre: string; tiempoTomando: string; activo: boolean }[]) => { id: string; nombre: string; tiempoTomando: string; activo: boolean }[]) => {
    setFarmacosDetalle(updater);
    setExpedienteModified(true);
  };

  const updateExpediente = (field: string, value: string) => {
    setExpediente(e => ({ ...e, [field]: value }));
    setExpedienteModified(true);
  };

  const totalSteps = 4;
  const STEPS = [
    { id: 1, label: 'Valoración' },
    { id: 2, label: 'Equivalencias' },
    { id: 3, label: 'Creación de Plan' },
    { id: 4, label: 'Opciones de Envío' }
  ];

  // Detect drafts but don't apply automatically (only if not editing)
  useEffect(() => {
    if (isEdit) return; // No drafts in edit mode
    const draftStr = localStorage.getItem(`draft_assessment_${pacienteId}`);
    if (draftStr) {
      try {
        const draft = JSON.parse(draftStr);
        setPendingDraft(draft);
        setShowDraftPrompt(true);
      } catch (e) {
        console.error('Error parsing draft:', e);
      }
    }
  }, [pacienteId, isEdit]);

  const applyDraft = () => {
    if (!pendingDraft) return;
    const d = pendingDraft;
    if (d.step) setStep(Math.min(d.step, 2));
    if (d.peso) setPeso(d.peso);
    if (d.estatura) setEstatura(d.estatura);
    if (d.pctGrasa) setPctGrasa(d.pctGrasa);
    if (typeof d.consultaEnLinea === 'boolean') setConsultaEnLinea(d.consultaEnLinea);
    if (d.compositionMethod === 'BIOIMPEDANCIA' || d.compositionMethod === 'ANTROPOMETRIA') {
      setCompositionMethod(d.compositionMethod);
    }
    if (d.bioimpedancia) {
      setBioimpedancia({
        grasa: d.bioimpedancia.grasa || '',
        agua: d.bioimpedancia.agua || '',
        musculo: d.bioimpedancia.musculo || '',
      });
    }
    if (d.laboratorio) setLaboratorio({
      ...laboratorioFromValoracion(null),
      ...d.laboratorio,
      otrosDetalle: Array.isArray(d.laboratorio.otrosDetalle)
        ? d.laboratorio.otrosDetalle
        : laboratorioFromValoracion({ otrosBioquimicos: d.laboratorio.otros }).otrosDetalle,
    });
    if (typeof d.ejercicioActivo === 'boolean') setEjercicioActivo(d.ejercicioActivo);
    if (Array.isArray(d.disciplinas)) setDisciplinas(d.disciplinas.map((item: DisciplinaItem) => ({ ...item, activo: item.activo !== false })));
    if (d.onlineMeasurements) {
      setOnlineMeasurements(onlineMeasurementsFromPerimeters(d.onlineMeasurements));
    }
    if (d.comentarios) setComentarios(d.comentarios);
    if (d.temario) {
      const { comp, rest } = parseCompetenciaFromTemario(d.temario);
      setTemario(rest.map((t: any) => ({ ...t, id: t.id || Math.random().toString() })));
      setCompetencia(comp);
      if (comp.antes || comp.durante || comp.despues) setShowCompetencia(true);
    }
    if (d.barridoData) setBarridoData(d.barridoData);
    if (d.fecha) setFecha(d.fecha);
    if (d.hora) setHora(d.hora);
    if (d.proximaSesion) setProximaSesion(d.proximaSesion);
    if (d.suplementacionActiva !== undefined) setSuplementacionActiva(d.suplementacionActiva);
    if (d.suplementosDetalle) setSuplementosDetalle(d.suplementosDetalle);
    if (d.tieneSuplementos !== undefined) setTieneSuplementos(d.tieneSuplementos);
    if (d.suplementos) setSuplementos(d.suplementos);
    // Los borradores anteriores a la herencia por valoración contienen la vieja
    // lista acumulada del expediente. Se restauran sus demás campos, pero no esa
    // Dietética obsoleta; la base correcta ya fue cargada desde la última consulta.
    if (d.dieteticaInheritanceVersion === DIETETICA_DRAFT_VERSION && Array.isArray(d.habitos)) {
      setHabitos(normalizeRecall24(d.habitos));
    }
    if (d.notasLibres) setNotasLibres(d.notasLibres);
    if (d.adjuntos) setAdjuntos(d.adjuntos);
    setIsGrasaModified(true);
    setShowDraftPrompt(false);
    toast({ title: 'Progreso restaurado', description: 'Has vuelto a donde te quedaste.' });
  };

  const discardDraft = () => {
    localStorage.removeItem(`draft_assessment_${pacienteId}`);
    setPendingDraft(null);
    setShowDraftPrompt(false);
    // After discarding, we refill with patient base data
    reFillWithBaseData();
    toast({ title: 'Borrador descartado', description: 'Iniciando con datos del expediente.' });
  };

  const reFillWithBaseData = () => {
    if (!paciente) return;
    const p = paciente;
    const vals = p?.valoraciones || [];
    let lastVal = null;
    if (vals.length > 0) {
      lastVal = [...vals].sort((a: any, b: any) => new Date(b.fecha).getTime() - new Date(a.fecha).getTime())[0];
    }

    // Peso (siempre limpio)
    setPeso('');

    // Estatura
    let eVal = lastVal?.estatura || lastVal?.talla || p?.estatura || p?.talla || '';
    if (eVal) {
      const eNum = parseFloat(String(eVal));
      setEstatura(String(eNum < 10 ? Math.round(eNum * 100) : eNum));
    }

    // Grasa (siempre limpio)
    setPctGrasa('');

    // Re-llenar expediente desde datos del paciente
    const ej = p.ejercicio || p.datosEjercicio;
    const ant = p.antecedentes || {};
    setEjercicioActivo(ej?.activo !== false);
    setLaboratorio(laboratorioFromValoracion(lastVal));
    setLaboratorioAnteriorFecha(lastVal && hasLaboratorio(lastVal) ? lastVal.fecha : null);
    setExpediente({
      objetivo: ej?.objetivo || '',
      nivelActividad: ej?.nivelActividad || '',
      gymOrigen: ej?.gymOrigen || '',
      horaEntrenamiento: ej?.horaEntrenamiento || '',
      disciplina: ej?.disciplina || '',
      frecuencia: ej?.frecuencia || '',
      tiempo: ej?.tiempo || '',
      porcentajeSedentario: String(ej?.porcentajeSedentario ?? 10),
      porcentajeLeve: String(ej?.porcentajeLeve ?? 20),
      porcentajeModerado: String(ej?.porcentajeModerado ?? 30),
      porcentajeIntenso: String(ej?.porcentajeIntenso ?? 40),
      patologia: ant.patologia || '',
      cirugias: ant.cirugias || '',
      farmacos: ant.farmacos || '',
      alergias: ant.alergias || '',
      alimentosNoGustan: ant.alimentosNoGustan || '',
      alimentosGustan: ant.alimentosGustan || '',
      agua: ant.agua || '',
      estrenimiento: ant.estrenimiento || '',
      signosYSintomas: ant.signosYSintomas || '',
      consumoAlcohol: ant.consumoAlcohol || '',
      tabaco: ant.tabaco || '',
      cicloMenstrual: ant.cicloMenstrual || '',
      historialProductos: ant.historialProductos || '',
    });
    setDisciplinas(decodeDisciplinas(ej?.disciplina, { frecuencia: ej?.frecuencia, tiempo: ej?.tiempo }, ej?.disciplinasDetalle));
    seedFarmacosDetalle(ant);
    seedHistorialSupDetalle(ant);
    setHabitos(resolveAssessmentDietetica(lastVal, p.habitos || p.consumoCalorico));
    setExpedienteModified(false);
  };

  // Save drafts (only if not editing)
  useEffect(() => {
    if (isEdit) return; // No drafts in edit mode
    if (step > 2) return; // Only save draft for steps 1 and 2
    if (!isGrasaModified) return; // Only start saving draft once fat % is touched
    const hasComp = competencia.antes || competencia.durante || competencia.despues;
    const temarioParaDraft = hasComp
      ? [...temario, { id: '__comp__', tema: COMP_NOTES_MARKER, detalle: JSON.stringify(competencia) }]
      : temario;
    // adjuntos se excluyen del draft — base64 agota localStorage (5MB). Se pierden al recargar antes de guardar.
    const draft = { step, peso, estatura, pctGrasa, consultaEnLinea, compositionMethod, bioimpedancia, laboratorio, ejercicioActivo, disciplinas, onlineMeasurements, comentarios, temario: temarioParaDraft, barridoData, habitos: serializeRecall24(habitos), dieteticaInheritanceVersion: DIETETICA_DRAFT_VERSION, fecha, hora, proximaSesion, tieneSuplementos, suplementos, suplementacionActiva, suplementosDetalle, notasLibres };
    localStorage.setItem(`draft_assessment_${pacienteId}`, JSON.stringify(draft));
  }, [step, peso, estatura, pctGrasa, consultaEnLinea, compositionMethod, bioimpedancia, laboratorio, ejercicioActivo, disciplinas, onlineMeasurements, comentarios, temario, competencia, barridoData, habitos, fecha, hora, proximaSesion, pacienteId, isGrasaModified, tieneSuplementos, suplementos, suplementacionActiva, suplementosDetalle, notasLibres, isEdit]);

  useEffect(() => {
    const fetchPatientAndData = async () => {
      try {
        // Parallelizar: paciente + valoracion(edición) + barrido(edición) en un solo round-trip
        const [pacienteRes, valRes, barridoRes] = await Promise.all([
          api.get(`/api/pacientes/${pacienteId}`),
          isEdit && valoracionId ? api.get(`/api/pacientes/${pacienteId}/valoraciones/${valoracionId}`).catch(() => null) : Promise.resolve(null),
          isEdit && valoracionId ? api.get(`/api/pacientes/${pacienteId}/valoraciones/${valoracionId}/barrido`).catch(() => null) : Promise.resolve(null),
        ]);

        const { data } = pacienteRes;
        const p = data?.data || data;
        setPaciente(p);

        const ej = p.ejercicio || p.datosEjercicio;
        setEjercicioActivo(ej?.activo !== false);
        const ant2 = p.antecedentes || {};
        setExpediente({
          patologia: ant2.patologia || '',
          cirugias: ant2.cirugias || '',
          farmacos: ant2.farmacos || '',
          alergias: ant2.alergias || '',
          alimentosNoGustan: ant2.alimentosNoGustan || '',
          alimentosGustan: ant2.alimentosGustan || '',
          agua: ant2.agua || '',
          estrenimiento: ant2.estrenimiento || '',
          signosYSintomas: ant2.signosYSintomas || '',
          consumoAlcohol: ant2.consumoAlcohol || '',
          tabaco: ant2.tabaco || '',
          cicloMenstrual: ant2.cicloMenstrual || '',
          historialProductos: ant2.historialProductos || '',
          objetivo: p.datosEjercicio?.objetivo || ej?.objetivo || '',
          nivelActividad: p.datosEjercicio?.nivelActividad || ej?.nivelActividad || 'Sedentario',
          gymOrigen: p.datosEjercicio?.gymOrigen || ej?.gymOrigen || '',
          horaEntrenamiento: p.datosEjercicio?.horaEntrenamiento || ej?.horaEntrenamiento || '',
          disciplina: p.datosEjercicio?.disciplina || ej?.disciplina || '',
          frecuencia: p.datosEjercicio?.frecuencia || ej?.frecuencia || '',
          tiempo: p.datosEjercicio?.tiempo || ej?.tiempo || '',
          porcentajeSedentario: String(p.datosEjercicio?.porcentajeSedentario ?? 10),
          porcentajeLeve: String(p.datosEjercicio?.porcentajeLeve ?? 20),
          porcentajeModerado: String(p.datosEjercicio?.porcentajeModerado ?? 30),
          porcentajeIntenso: String(p.datosEjercicio?.porcentajeIntenso ?? 40),
        });
        setDisciplinas(decodeDisciplinas(
          p.datosEjercicio?.disciplina || ej?.disciplina,
          { frecuencia: p.datosEjercicio?.frecuencia || ej?.frecuencia, tiempo: p.datosEjercicio?.tiempo || ej?.tiempo },
          p.datosEjercicio?.disciplinasDetalle || ej?.disciplinasDetalle
        ));
        seedFarmacosDetalle(ant2);
        seedHistorialSupDetalle(ant2);
        const h2 = p.habitos || p.consumoCalorico || {};
        if (Array.isArray(h2)) {
          setHabitos(normalizeRecall24(h2));
        } else {
          const mk = (label: string, obj: any, horaKey?: string, ayerKey?: string, usKey?: string): Recall24Row => {
            const ayer = obj?.ayer || (ayerKey && h2[ayerKey]) || '';
            const usualmente = obj?.usualmente || (usKey && h2[usKey]) || '';
            return {
              label,
              hora: obj?.hora || (horaKey && h2[horaKey]) || '',
              notas: obj?.notas || [ayer, usualmente].filter(Boolean).join(' / '),
            };
          };
          setHabitos([
            mk('Desayuno', h2.desayuno, 'horaDesayuno', 'ayerDesayuno', 'usalmenteDesayuno'),
            mk('Colación', h2.colacion1, 'horaColacion1', 'ayerColacion1', 'usalmenteColacion1'),
            mk('Almuerzo', h2.almuerzo,  'horaAlmuerzo',  'ayerAlmuerzo',  'usalmenteAlmuerzo'),
            mk('Colación', h2.colacion2, 'horaColacion2', 'ayerColacion2', 'usalmenteColacion2'),
            mk('Cena',     h2.cena,      'horaCena',      'ayerCena',      'usalmenteCena'),
          ]);
        }

        if (isEdit) {
          try {
            const val = valRes ? (valRes.data?.data || valRes.data) : null;

            if (val) {
              if (Array.isArray(val.dietetica)) {
                setHabitos(normalizeRecall24(val.dietetica));
              }
              setFecha(val.fecha ? val.fecha.split('T')[0] : '');
              setHora(val.hora || '');
              setNumeroValoracion(val.numeroValoracion || 1);
              setPeso(val.pesoActual ? String(val.pesoActual) : String(val.peso || ''));
              const eVal = val.estatura || val.talla || '';
              if (eVal) {
                const eNum = parseFloat(String(eVal));
                setEstatura(String(eNum < 10 ? Math.round(eNum * 100) : eNum));
              }
              setPctGrasa(val.pctGrasa ? String(val.pctGrasa) : '');
              setKgGrasa(val.masaGrasaReal ? String(val.masaGrasaReal) : (val.kgGrasa2comp ? String(val.kgGrasa2comp) : ''));
              const savedStatuses = val.medicionesEstado || {};
              setConsultaEnLinea(savedStatuses.consultaEnLinea === true);
              const savedBio = val.bioimpedancia || {};
              const hasBioimpedancia = [
                savedBio['Grasa %'],
                savedBio['Agua %'],
                savedBio['Músculo (kg)'],
                savedBio['Músculo %'],
                savedBio['Energía (kcal)'],
              ].some(value => value != null && value !== '');
              setCompositionMethod(savedStatuses.metodoComposicion === 'BIOIMPEDANCIA' || hasBioimpedancia ? 'BIOIMPEDANCIA' : 'ANTROPOMETRIA');
              setBioimpedancia({
                grasa: savedBio['Grasa %'] != null ? String(savedBio['Grasa %']) : '',
                agua: savedBio['Agua %'] != null ? String(savedBio['Agua %']) : '',
                musculo: savedBio['Músculo (kg)'] != null
                  ? String(savedBio['Músculo (kg)'])
                  : (savedBio['Músculo %'] != null ? String(savedBio['Músculo %']) : ''),
              });
              const savedPerimeters = val.perimetros || {};
              setOnlineMeasurements(onlineMeasurementsFromPerimeters(savedPerimeters));
              setMeasurementStatuses({
                peso: savedStatuses.peso || (val.pesoActual != null ? 'REGISTRADA' : 'NO_CAPTURADA'),
                estatura: savedStatuses.estatura || (val.estatura != null ? 'REGISTRADA' : 'NO_CAPTURADA'),
                pctGrasa: savedStatuses.pctGrasa || (val.pctGrasa != null ? 'REGISTRADA' : 'NO_CAPTURADA'),
                kgGrasa: savedStatuses.kgGrasa || ((val.masaGrasaReal ?? val.kgGrasa2comp) != null ? 'REGISTRADA' : 'NO_CAPTURADA'),
                masaMagra: savedStatuses.masaMagra || ((val.masaMagra ?? val.kgMasaMagra2comp) != null ? 'REGISTRADA' : 'NO_CAPTURADA'),
              });
              setComentarios(val.comentarios || '');
              setPlanVinculadoId(val.plan?.id || null);
              setLaboratorio(laboratorioFromValoracion(val));
              setLaboratorioAnteriorFecha(null);
              if (Array.isArray(val.dinamicaDeportiva?.disciplinas)) {
                setEjercicioActivo(val.dinamicaDeportiva.activo !== false);
                setDisciplinas(decodeDisciplinas(null, {}, val.dinamicaDeportiva.disciplinas));
              }

              const rawItems = (val.temarioConsulta && Array.isArray(val.temarioConsulta))
                ? val.temarioConsulta
                : (val.temario && Array.isArray(val.temario) ? val.temario : []);
              const { comp, rest } = parseCompetenciaFromTemario(rawItems);
              setTemario(rest.map((t: any) => ({ ...t, id: t.id || Math.random().toString() })));
              setCompetencia(comp);
              if (comp.antes || comp.durante || comp.despues) setShowCompetencia(true);

              if (val.evitar) {
                const avoidArray = typeof val.evitar === 'string' ? val.evitar.split('\n').map((v: string) => v.trim()).filter(Boolean) : [];
                setEvitar(avoidArray.map((valor: string) => ({ id: Math.random().toString(), valor })));
              }

              if (val.notasLibres) { setNotasLibres(val.notasLibres); setNotasLibresOpen(true); }
              if (val.esqueHidratacion) { setEsqueHidratacion(val.esqueHidratacion); setEsqueHidratacionOpen(true); }
              if (val.adjuntosJson && Array.isArray(val.adjuntosJson)) setAdjuntos(val.adjuntosJson);

              if (val.suplementosDetalle && Array.isArray(val.suplementosDetalle) && val.suplementosDetalle.length > 0) {
                setTieneSuplementos(true);
                setSuplementos(val.suplementosDetalle.map((s: any) => ({ ...s, id: s.id || Math.random().toString() })));
                setSuplementacionActiva(true);
                setSuplementosDetalle(val.suplementosDetalle.map((s: any) => ({ ...s, id: s.id || Math.random().toString() })));
              }

              // Use pre-fetched barrido
              if (barridoRes) {
                const bd = barridoRes.data?.data || barridoRes.data;
                if (bd && (bd.tiempos || bd.kcalTotal)) setBarridoData(bd);
              }
            }
          } catch {
            toast({ title: 'Error', description: 'No se pudo cargar la valoración a editar.', variant: 'destructive' });
          }
        } else {
          // Siempre carga primero la consulta anterior. Si existe un borrador
          // compatible, el usuario puede restaurarlo encima explícitamente.
          const vals = p?.valoraciones || [];
          let lastVal = null;
          if (vals.length > 0) {
            lastVal = [...vals].sort((a: any, b: any) => new Date(b.fecha).getTime() - new Date(a.fecha).getTime())[0];
          }
          setLaboratorio(laboratorioFromValoracion(lastVal));
          setLaboratorioAnteriorFecha(lastVal && hasLaboratorio(lastVal) ? lastVal.fecha : null);
          setHabitos(resolveAssessmentDietetica(lastVal, p.habitos || p.consumoCalorico));

          // Peso (siempre limpio en nueva valoración)
          setPeso('');

          // Estatura
          let eVal = lastVal?.estatura || lastVal?.talla || p?.estatura || p?.talla || '';
          if (eVal) {
            const eNum = parseFloat(String(eVal));
            setEstatura(String(eNum < 10 ? Math.round(eNum * 100) : eNum));
          }

          // Suplementos activos anteriores
          if (lastVal?.suplementosDetalle && Array.isArray(lastVal.suplementosDetalle)) {
            const activeSups = lastVal.suplementosDetalle.filter((s: any) => s.activo);
            if (activeSups.length > 0) {
              setTieneSuplementos(true);
              // Clonar para evitar mutar el estado anterior
              setSuplementos(activeSups.map((s: any) => ({ ...s, id: Date.now().toString() + Math.random() })));
            }
          }

          // Grasa (siempre lo dejamos manual para capturar Kg o % por solicitud)
          setPctGrasa('');
          setKgGrasa('');

          // Suplementación (arrastrada de la valoración pasada; si es primera consulta, desde antecedentes del registro)
          if (lastVal?.suplementosDetalle && Array.isArray(lastVal.suplementosDetalle) && lastVal.suplementosDetalle.length > 0) {
            setSuplementosDetalle(lastVal.suplementosDetalle);
            setSuplementacionActiva(true);
          } else if (p?.antecedentes?.suplementosDetalle && Array.isArray(p.antecedentes.suplementosDetalle) && p.antecedentes.suplementosDetalle.length > 0) {
            // Primera consulta: heredar suplementos del registro del paciente
            setSuplementosDetalle(p.antecedentes.suplementosDetalle.map((s: any) => ({
              ...s,
              id: s.id || Date.now().toString() + Math.random(),
              activo: s.activo !== false,
              fechaInicio: s.fechaInicio || new Date().toISOString(),
            })));
            setSuplementacionActiva(true);
          } else {
            setSuplementosDetalle([]);
            setSuplementacionActiva(false);
          }

          // Esquema de hidratación (heredar de la consulta anterior si existe)
          if (lastVal?.esqueHidratacion) {
            setEsqueHidratacion(lastVal.esqueHidratacion);
            setEsqueHidratacionOpen(true);
          }
        }

        if (!isEdit) {
          const vals = p?.valoraciones || [];
          setNumeroValoracion(vals.length + 1);
        }
      } catch (err) {
        console.error('Error cargando paciente:', err);
      }
    };
    fetchPatientAndData();
  }, [pacienteId, valoracionId, isEdit]);

  const pesoNum = parseFloat(peso) || 0;
  const estaturaNum = parseFloat(estatura) || 0;
  const estaturaEnMetros = estaturaNum > 0 && estaturaNum < 3 ? estaturaNum : estaturaNum / 100;

  const imc = useMemo(() => {
    if (pesoNum <= 0 || estaturaNum <= 0) return 0;
    return pesoNum / (estaturaEnMetros * estaturaEnMetros);
  }, [pesoNum, estaturaNum, estaturaEnMetros]);

  const masaMagra = useMemo(() => {
    const pg = parseFloat(pctGrasa);
    if (!pesoNum || !pg) return null;
    return pesoNum - (pesoNum * pg / 100);
  }, [pesoNum, pctGrasa]);

  const handlePctGrasaChange = (v: string) => {
    setPctGrasa(v);
    setMeasurementStatuses(prev => ({ ...prev, pctGrasa: v ? 'REGISTRADA' : 'NO_CAPTURADA' }));
    const vNum = parseFloat(v);
    if (pesoNum > 0 && !isNaN(vNum)) {
      setKgGrasa(((pesoNum * vNum) / 100).toFixed(2));
      setMeasurementStatuses(prev => ({ ...prev, kgGrasa: 'REGISTRADA', masaMagra: 'REGISTRADA' }));
    } else {
      setKgGrasa('');
    }
  };

  const handleKgGrasaChange = (v: string) => {
    setKgGrasa(v);
    setMeasurementStatuses(prev => ({ ...prev, kgGrasa: v ? 'REGISTRADA' : 'NO_CAPTURADA' }));
    const vNum = parseFloat(v);
    if (pesoNum > 0 && !isNaN(vNum) && vNum > 0) {
      setPctGrasa(((vNum / pesoNum) * 100).toFixed(2));
    } else {
      setPctGrasa('');
    }
  };

  const addTema = () => setTemario([...temario, { id: Date.now().toString(), tema: '', detalle: '' }]);
  const removeTema = (idx: number) => setTemario(temario.filter((_, i) => i !== idx));
  const updateTema = (idx: number, field: 'tema' | 'detalle', val: string) => {
    const nt = [...temario];
    nt[idx][field] = val;
    setTemario(nt);
  };

  const addSuplemento = () => setSuplementos([...suplementos, { id: Date.now().toString(), nombre: '', indicaciones: '', activo: true, fechaInicio: new Date().toISOString() }]);
  const removeSuplemento = (idx: number) => setSuplementos(suplementos.filter((_, i) => i !== idx));
  const updateSuplemento = (idx: number, field: 'nombre' | 'indicaciones' | 'activo', val: any) => {
    const ns = [...suplementos];
    ns[idx] = { ...ns[idx], [field]: val };
    setSuplementos(ns);
  };

  const addEvitar = () => setEvitar([...evitar, { id: Date.now().toString(), valor: '' }]);
  const removeEvitar = (idx: number) => setEvitar(evitar.filter((_, i) => i !== idx));
  const updateEvitar = (idx: number, val: string) => {
    const ne = [...evitar];
    ne[idx].valor = val;
    setEvitar(ne);
  };

  const clearDraft = () => localStorage.removeItem(`draft_assessment_${pacienteId}`);

  const handleSave = async (redirectAPlan: boolean | 'equivalencias' = false) => {
    if (!peso && measurementStatuses.peso === 'REGISTRADA') { toast({ title: 'Peso incompleto', description: 'Captura el peso o cambia su estado.', variant: 'destructive' }); return; }
    if (laboratorio.otrosDetalle.some(item => (item.nombre.trim() === '') !== (item.valor.trim() === ''))) {
      toast({ title: 'Resultado incompleto', description: 'Escribe el nombre y el valor de cada resultado adicional.', variant: 'destructive' });
      return;
    }
    if (mostrarBioimpedancia && !consultaEnLinea && compositionMethod === 'BIOIMPEDANCIA') {
      const bioValues = Object.values(bioimpedancia).filter(value => value.trim() !== '');
      if (bioValues.length === 0) {
        toast({ title: 'Bioimpedancia incompleta', description: 'Captura al menos uno de los resultados de bioimpedancia.', variant: 'destructive' });
        return;
      }
      if (bioValues.some(value => !Number.isFinite(Number(value)) || Number(value) < 0)) {
        toast({ title: 'Resultado inválido', description: 'Los resultados de bioimpedancia deben ser números iguales o mayores a cero.', variant: 'destructive' });
        return;
      }
    }
    if (consultaEnLinea) {
      if (hasInvalidOnlineMeasurement(onlineMeasurements)) {
        toast({ title: 'Medida inválida', description: 'Las medidas de la consulta en línea deben ser números iguales o mayores a cero.', variant: 'destructive' });
        return;
      }
    }

    if (calcomData) {
      const confirmed = await confirm({
        title: 'Confirmar cita de seguimiento',
        description: <AppointmentSummary data={calcomData} />,
        confirmLabel: 'Confirmar cita y guardar',
        cancelLabel: 'Volver',
        variant: 'info',
      });
      if (!confirmed) return;
    }

    setSaving(true);

    // Asignar fechas al esquema de suplementos justo al guardar (estrategia de mutación en frío)
    const suplementosParaGuardar = suplementacionActiva ? suplementosDetalle.map(sup => {
      const s = { ...sup };
      if (s.activo) {
        // Si estaba suspendido previamente (tiene fechaFin) y lo reactivan, es una 'Nueva Cuenta' (ciclo 0)
        if (s.fechaFin) {
          s.fechaInicio = new Date().toISOString();
          s.fechaFin = undefined;
        } else if (!s.fechaInicio) {
          s.fechaInicio = new Date().toISOString();
        }
      } else {
        // Lo apagan en esta sesión, congelamos el tiempo en este instante
        if (!s.fechaFin) {
          s.fechaFin = new Date().toISOString();
        }
      }
      return s;
    }) : [];

    const body: Record<string, any> = {
      fecha, hora,
      numeroValoracion,
      pesoActual: measurementStatuses.peso === 'REGISTRADA' && peso ? pesoNum : null,
      estatura: !consultaEnLinea && estatura ? (estaturaNum < 10 ? Math.round(estaturaNum * 100) : estaturaNum) : null,
      imc: !consultaEnLinea && measurementStatuses.peso === 'REGISTRADA' && imc > 0 ? parseFloat(imc.toFixed(2)) : null,
      medicionesEstado: {
        ...measurementStatuses,
        estatura: consultaEnLinea ? 'NO_APLICA' : (estatura ? 'REGISTRADA' : measurementStatuses.estatura),
        consultaEnLinea,
        metodoComposicion: consultaEnLinea ? 'FOTOSCOPIA' : (!mostrarBioimpedancia && !isEdit ? 'ANTROPOMETRIA' : compositionMethod),
      },
      comentarios,
      temario: (() => {
        const base = temario.map(({ tema, detalle }) => ({ tema, detalle }));
        const hasComp = competencia.antes || competencia.durante || competencia.despues;
        if (hasComp) base.push({ tema: COMP_NOTES_MARKER, detalle: JSON.stringify(competencia) });
        return base;
      })(),
      evitar: evitar.map(e => e.valor).filter(v => v.trim() !== '').join('\n'),
      notasLibres: notasLibres || null,
      esqueHidratacion: esqueHidratacion || null,
      adjuntosJson: adjuntos.length > 0 ? adjuntos : null,
      suplementosDetalle: suplementosParaGuardar,
      // Fotografía de Dietética de esta consulta. El barrido de esta valoración se
      // sincroniza únicamente contra estas filas, sin mezclar consultas anteriores.
      dietetica: serializeRecall24(habitos),
      dinamicaDeportiva: {
        activo: ejercicioActivo,
        disciplinas: encodeDisciplinas(disciplinas).disciplinasDetalle,
      },
      // proximaSesion NO se manda aquí — ese campo vive en Plan, no en Valoracion.
      // Se guarda en estado React y se pasa como prop a CreateEditPlanForm.
    };

    if (consultaEnLinea) {
      body.perimetros = buildOnlinePerimeters(onlineMeasurements);
    }

    if (mostrarBioimpedancia && !consultaEnLinea && compositionMethod === 'BIOIMPEDANCIA') {
      // Energía está bloqueada a captura manual: se llena y guarda únicamente con el
      // total calculado en el barrido de equivalencias de esta consulta.
      body.bioimpedancia = {
        'Grasa %': bioimpedancia.grasa.trim() === '' ? null : Number(bioimpedancia.grasa),
        'Agua %': bioimpedancia.agua.trim() === '' ? null : Number(bioimpedancia.agua),
        'Músculo (kg)': bioimpedancia.musculo.trim() === '' ? null : Number(bioimpedancia.musculo),
        'Energía (kcal)': barridoData?.kcalTotal ? Math.round(barridoData.kcalTotal) : null,
      };
    } else if (isEdit && mostrarBioimpedancia) {
      // Al cambiar una valoración existente de bioimpedancia a antropometría,
      // se eliminan los resultados anteriores para evitar mostrarlos en el PDF.
      body.bioimpedancia = {
        'Grasa %': null,
        'Agua %': null,
        'Músculo (kg)': null,
        'Energía (kcal)': null,
      };
    }

    body.glucosa = laboratorio.glucosa.trim() === '' ? null : parseFloat(laboratorio.glucosa);
    body.trigliceridos = laboratorio.trigliceridos.trim() === '' ? null : parseFloat(laboratorio.trigliceridos);
    body.colesterol = laboratorio.colesterol.trim() === '' ? null : parseFloat(laboratorio.colesterol);
    body.creatinina = laboratorio.creatinina.trim() === '' ? null : parseFloat(laboratorio.creatinina);
    body.acidoUrico = laboratorio.acidoUrico.trim() === '' ? null : parseFloat(laboratorio.acidoUrico);
    body.bioquimicosOtrosDetalle = laboratorio.otrosDetalle
      .filter(item => item.nombre.trim() && item.valor.trim())
      .map(item => ({ id: item.id, nombre: item.nombre.trim(), valor: item.valor.trim() }));
    body.otrosBioquimicos = null;

    if (measurementStatuses.pctGrasa === 'REGISTRADA' && pctGrasa) {
      // pctGrasa (no pctGrasaCorp): backend lo destructura para calcular pctGrasa2comp/kgGrasa2comp/kgMasaMagra2comp
      // y getById lo regresa como val.pctGrasa para precargar este campo al editar.
      body.pctGrasa = parseFloat(pctGrasa);
      if (measurementStatuses.masaMagra === 'REGISTRADA' && masaMagra !== null) body.masaMagra = parseFloat(masaMagra.toFixed(2));
      if (measurementStatuses.kgGrasa === 'REGISTRADA' && kgGrasa) body.masaGrasaReal = parseFloat(kgGrasa);
    } else {
      body.pctGrasa2comp = null;
      body.kgGrasa2comp = null;
      body.kgMasaMagra2comp = null;
      body.masaGrasaReal = measurementStatuses.kgGrasa === 'REGISTRADA' && kgGrasa ? parseFloat(kgGrasa) : null;
      body.masaMagra = null;
    }

    try {
      // 1. Verificamos cambios de contacto ANTES de guardar la valoración
      if (calcomData) {
        const pacienteNombreCompleto = buildPatientFullName(paciente?.nombre, paciente?.apellido);
        const hasChanges = calcomData.name.trim() !== pacienteNombreCompleto ||
          calcomData.email !== paciente?.email ||
          (calcomData.phone && calcomData.phone !== paciente?.telefono);

        if (hasChanges) {
          try {
            await api.put(`/api/pacientes/${pacienteId}`, {
              // El nombre del agendamiento es completo; el expediente conserva
              // nombre y apellido en sus campos separados.
              nombre: paciente.nombre,
              apellido: paciente.apellido,
              email: calcomData.email,
              telefono: calcomData.phone
            });
          } catch (updateErr: any) {
            const msg = updateErr.response?.data?.error || updateErr.response?.data?.message || updateErr.message || '';
            if (updateErr.response?.status === 409 || msg.toLowerCase().includes('telefono') || msg.toLowerCase().includes('teléfono') || msg.toLowerCase().includes('correo') || msg.toLowerCase().includes('email')) {
              toast({ title: 'Dato Duplicado en Contacto', description: msg, variant: 'destructive', duration: 8000 });
              setSaving(false);
              return; // Detenemos la ejecución si hay un duplicado crítico
            }
            console.error('Error actualizando paciente:', updateErr);
            toast({ title: 'Error de Contacto', description: msg, variant: 'destructive' });
            // Dejamos que pase la respuesta de error de actualizar contacto para no bloquear el plan si es otro tipo de error? No, mejor abortar.
            setSaving(false);
            return;
          }
        }
      }

      // En modo edición siempre guardamos el expediente para asegurar que cambios
      // como cicloMenstrual o historial de suplementación se persistan correctamente.
      if (expedienteModified || isEdit) {
        try {
          await api.put(`/api/pacientes/${pacienteId}`, {
            ejercicio: {
              objetivo: expediente.objetivo,
              nivelActividad: expediente.nivelActividad,
              gymOrigen: expediente.gymOrigen,
              horaEntrenamiento: expediente.horaEntrenamiento,
              ...encodeDisciplinas(disciplinas),
              activo: ejercicioActivo,
              porcentajeSedentario: parseInt(expediente.porcentajeSedentario) || 10,
              porcentajeLeve: parseInt(expediente.porcentajeLeve) || 20,
              porcentajeModerado: parseInt(expediente.porcentajeModerado) || 30,
              porcentajeIntenso: parseInt(expediente.porcentajeIntenso) || 40,
            },
            antecedentes: {
              patologia: expediente.patologia,
              cirugias: expediente.cirugias,
              farmacos: expediente.farmacos,
              alergias: expediente.alergias,
              alimentosNoGustan: expediente.alimentosNoGustan,
              alimentosGustan: expediente.alimentosGustan,
              agua: expediente.agua,
              estrenimiento: expediente.estrenimiento,
              signosYSintomas: expediente.signosYSintomas,
              consumoAlcohol: expediente.consumoAlcohol,
              tabaco: expediente.tabaco,
              cicloMenstrual: expediente.cicloMenstrual,
              historialProductos: expediente.historialProductos,
              farmacosDetalle,
              // Historial de suplementación (registro permanente del expediente)
              suplementosDetalle: historialSupDetalle.filter(s => s.nombre.trim()),
            },
          });
          setExpedienteModified(false);
        } catch (e) {
          console.error('No se pudo actualizar expediente:', e);
          toast({ title: 'No se guardó el expediente', description: 'Revisa los datos del expediente y vuelve a intentar. La valoración todavía no se ha guardado.', variant: 'destructive' });
          setSaving(false);
          return;
        }
      }

      let valoracionResId = valoracionId;
      if (isEdit) {
        await api.put(`/api/pacientes/${pacienteId}/valoraciones/${valoracionId}`, body);
        toast({ title: 'Valoración actualizada correctamente' });
      } else {
        const response = await api.post(`/api/pacientes/${pacienteId}/valoraciones`, body);
        const serverData = response.data?.data || response.data;
        valoracionResId = serverData?.id;
        toast({ title: 'Valoración guardada correctamente' });
      }

      // Guardar barrido si existe y tiene tiempos definidos.
      // En edición siempre persistimos aunque kcalTotal sea 0 (el usuario puede haber
      // borrado tiempos o editado nombres sin recalcular aún).
      const barridoTieneContenido = barridoData && (
        isEdit
          ? Array.isArray((barridoData as any).tiempos) && (barridoData as any).tiempos.length > 0
          : getBarridoVariantes(barridoData).some(item => item.kcalTotal > 0)
      );
      if (valoracionResId && barridoTieneContenido) {
        try { await api.post(`/api/pacientes/${pacienteId}/valoraciones/${valoracionResId}/barrido`, barridoData); } catch { }
      }

      if (consultaEnLinea && valoracionResId && pendingFollowupPhotos.length > 0) {
        for (const photo of pendingFollowupPhotos) {
          await api.post(`/api/pacientes/${pacienteId}/valoraciones/${valoracionResId}/fotos`, {
            dataUrl: photo.dataUrl,
            nombreOriginal: photo.nombreOriginal,
            ancho: photo.ancho,
            alto: photo.alto,
            esPrincipal: photo.esPrincipal,
          });
        }
        setPendingFollowupPhotos([]);
      }

      // AGENDAR CITA EN SEGUNDO PLANO SI HAY DATOS
      if (calcomData) {
        // AGENDAR CITA SINCRÓNICAMENTE PARA EVITAR RACE CONDITIONS EN LA SIGUIENTE PANTALLA
        try {
          await api.post(
            '/api/citas/agendar',
            {
              pacienteId,
              valoracionId: valoracionResId,
              ...calcomData
            },
            {
              timeout: APPOINTMENT_REQUEST_TIMEOUT_MS,
              skipRetry: true
            }
          );
          toast({ title: 'Cita agendada', description: 'Se ha agendado la próxima cita y notificado al paciente.' });
          setCalcomData(null);
        } catch (bookingErr: any) {
          console.error('Error al agendar cita:', bookingErr);
          const failureCopy = getBookingFailureCopy(bookingErr);
          toast({
            title: failureCopy.title,
            description: failureCopy.description,
            variant: 'destructive',
            duration: 8000
          });
        }
      }

      if (!isEdit) clearDraft();

      // Invalidar cache para que Profile, Dashboard, Pendientes se actualicen
      invalidateAfterValoracionChange(queryClient, pacienteId!);

      if (redirectAPlan && valoracionResId) {
        setValoracionIdGuardada(valoracionResId);
        setStep(redirectAPlan === 'equivalencias' ? 2 : 3);
      } else {
        navigate('/dashboard');
      }
    } catch (err: any) {
      toast({ title: 'Error al guardar', description: err.response?.data?.message || `No se pudo ${isEdit ? 'actualizar' : 'guardar'} la valoración.`, variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="animate-fade-in w-full min-h-full font-sans flex flex-col pb-6 relative" style={{ backgroundColor: '#0a0a0a' }}>
      {ConfirmDialogComponent}

      {/* DRAFT PROMPT MODAL */}
      {showDraftPrompt && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-md animate-fade-in p-4">
          <div className="norder-glass rounded-[24px] p-8 max-w-md w-full shadow-2xl animate-scale-in text-center relative overflow-hidden">
            <div className="w-16 h-16 bg-[#1a1a1a] rounded-full flex items-center justify-center mx-auto mb-6 border border-white/10">
              <Plus className="h-8 w-8 text-white rotate-45" />
            </div>
            <h3 className="text-[20px] font-bold text-white mb-2 leading-tight">¿Continuar con la sesión anterior?</h3>
            <p className="text-[14px] text-[#8a8a8a] mb-8">Detectamos un borrador sin finalizar para este paciente. ¿Deseas recuperar los datos o iniciar una consulta nueva?</p>
            <div className="flex flex-col gap-3">
              <button
                onClick={applyDraft}
                className="w-full py-4 bg-white text-black rounded-[12px] text-[14px] font-bold hover:bg-[#e0e0e0] transition-colors"
              >
                Restaurar Sesión
              </button>
              <button
                onClick={discardDraft}
                className="w-full py-4 bg-[#1a1a1a] text-[#8a8a8a] border border-white/10 rounded-[12px] text-[14px] font-bold hover:bg-[#222] hover:text-white transition-colors"
              >
                Descartar y Empezar de Cero
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="max-w-none w-full mx-auto flex flex-col flex-1 min-h-0">
        {/* TOP HEADER — sticky */}
        <div className="sticky top-0 z-20 -mx-3 sm:-mx-4 md:-mx-6 lg:-mx-8 px-3 sm:px-4 md:px-6 lg:px-8 py-2 bg-[#0a0a0a]/95 backdrop-blur-md border-b border-[#1a1a1a] flex flex-col sm:flex-row items-start sm:items-center justify-between text-[#f0f0f0]">
          {paciente && (
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-full bg-[#1a1a1a] border border-[#333] text-[#f0f0f0] flex items-center justify-center font-bold text-[12px] uppercase">
                {paciente?.nombre?.[0] || ''}{paciente?.apellido?.[0] || ''}
              </div>
              <div>
                <h2 className="text-[14px] font-bold text-white m-0 tracking-tight leading-tight">
                  {paciente.nombre} {paciente.apellido}
                </h2>
                <div className="flex items-center gap-1.5 text-[11px] text-[#8a8a8a] mt-0.5">
                  <span>{paciente.fechaNacimiento ? `${Math.floor((Date.now() - new Date(paciente.fechaNacimiento.includes('T') ? paciente.fechaNacimiento.split('T')[0] : paciente.fechaNacimiento).getTime()) / 31557600000)} años` : '—'}</span>
                  <span>·</span>
                  <span>Última visita {(() => {
                    const vals = paciente.valoraciones || [];
                    if (vals.length === 0) return 'Ninguna';
                    const lastVal = [...vals].sort((a: any, b: any) => new Date(b.fecha).getTime() - new Date(a.fecha).getTime())[0];
                    // Parche timezone: anclar a T12:00:00 para evitar restar días en UTC-6
                    const rawFecha = lastVal.fecha || '';
                    const cleanFecha = rawFecha.includes('T') ? rawFecha.split('T')[0] + 'T12:00:00' : rawFecha;
                    const d = new Date(cleanFecha);
                    return `${d.getDate()} ${d.toLocaleString('es-ES', { month: 'short' })} ${d.getFullYear()}`;
                  })()}</span>
                  <span>·</span>
                  <span className="uppercase">ID {pacienteId?.slice(-6)}</span>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* STEPPER */}
        <div className="flex items-center justify-center max-w-lg mx-auto w-full mb-5 mt-4 shrink-0">
          {STEPS.map((s, i, arr) => (
            <React.Fragment key={s.id}>
              <div className="flex flex-col items-center gap-1 relative">
                <div className={`w-8 h-8 rounded-full flex items-center justify-center text-[12px] font-bold z-10 transition-colors shadow-none ${step >= s.id ? 'bg-[#f0f0f0] text-[#0a0a0a]' : 'bg-[#1a1a1a] text-[#6a6a6a] border border-[#333]'}`}>
                  {s.id}
                </div>
                <span className={`text-[9px] font-bold absolute -bottom-4 whitespace-nowrap uppercase tracking-wider ${step >= s.id ? 'text-white' : 'text-[#6a6a6a]'}`}>
                  {s.label}
                </span>
              </div>
              {i < arr.length - 1 && (
                <div className={`flex-1 h-[2px] mx-2 transition-colors ${step > s.id ? 'bg-[#f0f0f0]' : 'bg-[#2a2a2a]'}`} />
              )}
            </React.Fragment>
          ))}
        </div>

        <div className="w-full flex-1 flex flex-col overflow-y-auto custom-scrollbar">
          {/* FASE 1: MÉTRICAS Y TEMARIO */}
          {step === 1 && (
            <div className="flex flex-col flex-1 min-h-0 animate-slide-up gap-3">
              <div className="shrink-0 mb-1">
                <p className="text-[10px] font-semibold text-[#8a8a8a] uppercase tracking-[0.15em] mb-1">Paso 1 de {totalSteps}</p>
                <h3 className="text-[22px] font-bold text-white m-0 tracking-tight">
                  Datos Clínicos y Valoración
                </h3>
                <p className="text-[12px] text-[#8a8a8a] m-0 mt-1">
                  Medidas antropométricas y notas en consulta.
                </p>
              </div>

              <div className="shrink-0 rounded-[12px] border border-[#303030] bg-[#151515] p-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="mb-1 text-[10px] font-bold uppercase tracking-widest text-[#8a8a8a]">Modalidad de consulta</p>
                    <p className="m-0 text-[11px] text-[#666]">Selecciona cómo se está realizando esta consulta.</p>
                  </div>
                  <div className="grid w-full grid-cols-2 gap-2 sm:w-[300px]">
                    <button
                      type="button"
                      onClick={() => {
                        setConsultaEnLinea(false);
                        setMeasurementStatuses(prev => ({
                          ...prev,
                          estatura: estatura ? 'REGISTRADA' : 'NO_CAPTURADA',
                          pctGrasa: pctGrasa ? 'REGISTRADA' : 'NO_CAPTURADA',
                          kgGrasa: kgGrasa ? 'REGISTRADA' : 'NO_CAPTURADA',
                          masaMagra: masaMagra !== null ? 'REGISTRADA' : 'NO_CAPTURADA',
                        }));
                      }}
                      className={`flex items-center justify-center gap-2 rounded-[8px] border px-3 py-2.5 text-[11px] font-bold uppercase tracking-wider transition-all duration-200 ${!consultaEnLinea ? 'border-emerald-500/50 bg-emerald-500/15 text-emerald-400 shadow-[0_0_12px_rgba(16,185,129,0.1)]' : 'border-[#333] text-[#666] hover:text-[#999] hover:border-[#444]'}`}
                    >
                      <MapPin className="w-3.5 h-3.5" />
                      Presencial
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setConsultaEnLinea(true);
                        setIsGrasaModified(true);
                        setMeasurementStatuses(prev => ({ ...prev, estatura: 'NO_APLICA', pctGrasa: 'NO_APLICA', kgGrasa: 'NO_APLICA', masaMagra: 'NO_APLICA' }));
                      }}
                      className={`flex items-center justify-center gap-2 rounded-[8px] border px-3 py-2.5 text-[11px] font-bold uppercase tracking-wider transition-all duration-200 ${consultaEnLinea ? 'border-sky-500/50 bg-sky-500/15 text-sky-400 shadow-[0_0_12px_rgba(14,165,233,0.1)]' : 'border-[#333] text-[#666] hover:text-[#999] hover:border-[#444]'}`}
                    >
                      <Wifi className="w-3.5 h-3.5" />
                      En línea
                    </button>
                  </div>
                </div>
                {consultaEnLinea && (
                  <p className="mb-0 mt-3 border-t border-[#292929] pt-3 text-[11px] leading-relaxed text-sky-400/80">
                    <Wifi className="w-3 h-3 inline-block mr-1.5 -mt-0.5" />
                    Captura el peso y los cuatro perímetros proporcionados por el paciente. Los perímetros quedan únicamente en el expediente interno.
                  </p>
                )}
                {!consultaEnLinea && (
                  <p className="mb-0 mt-3 border-t border-[#292929] pt-3 text-[11px] leading-relaxed text-emerald-400/80">
                    <MapPin className="w-3 h-3 inline-block mr-1.5 -mt-0.5" />
                    Consulta presencial — medidas completas del paciente en consultorio.
                  </p>
                )}
              </div>

              {/* PANEL EXPEDIENTE DEL PACIENTE */}
              {/* ── 1. EXPEDIENTE DEL PACIENTE ── */}
              <div className="bg-[#111111] border border-[#2a2a2a] rounded-[16px] shrink-0 overflow-hidden">
                <button
                  type="button"
                  onClick={() => setShowExpediente(s => !s)}
                  className="w-full flex items-center justify-between px-5 py-4 hover:bg-[#181818] transition-colors"
                >
                  <div className="flex items-center gap-2">
                    <FileText className="w-4 h-4 text-brand-primary" />
                    <span className="text-[13px] font-bold text-white tracking-widest uppercase">Expediente del Paciente</span>
                    {expedienteModified && <span className="w-2 h-2 rounded-full bg-brand-primary shrink-0" />}
                  </div>
                  <ChevronDown className={`w-4 h-4 text-[#8a8a8a] transition-transform duration-200 ${showExpediente ? 'rotate-180' : ''}`} />
                </button>
                {showExpediente && (
                  <div className="px-5 pb-5 space-y-6 border-t border-[#2a2a2a]">
                    {/* Consumo Calórico — oculto a pedido: no aporta valor en la consulta */}
                    {/* <div>
                      <p className="text-[10px] font-bold text-[#8a8a8a] uppercase tracking-widest mb-3">Distribución Actividad (%)</p>
                      <div className="grid grid-cols-1 xs:grid-cols-2 md:grid-cols-4 gap-3">
                        {([
                          { label: 'Sedentario', field: 'porcentajeSedentario' },
                          { label: 'Leve', field: 'porcentajeLeve' },
                          { label: 'Moderado', field: 'porcentajeModerado' },
                          { label: 'Intenso', field: 'porcentajeIntenso' },
                        ] as { label: string; field: keyof typeof expediente }[]).map(({ label, field }) => (
                          <div key={field} className="space-y-1">
                            <label className="text-[10px] font-bold text-[#8a8a8a] uppercase tracking-widest">{label}</label>
                            <div className="relative">
                              <input
                                type="number"
                                min="0" max="100"
                                value={expediente[field]}
                                onChange={(e) => updateExpediente(field, e.target.value)}
                                className="w-full bg-[#181818] rounded-[6px] px-3 py-2 pr-8 text-[13px] font-medium text-white outline-none border border-[#333] focus:border-[#555] transition-colors"
                              />
                              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[11px] text-[#8a8a8a]">%</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div> */}

                    {/* Antecedentes */}
                    <div className="pt-4">
                      <p className="text-[10px] font-bold text-[#8a8a8a] uppercase tracking-widest mb-3">Antecedentes</p>
                      <div className="grid grid-cols-1 xs:grid-cols-2 md:grid-cols-3 gap-3">
                        {([
                          { label: 'Patología / Enfermedades', field: 'patologia' },
                          { label: 'Cirugías / Traumas', field: 'cirugias' },
                          { label: 'Fármacos / Medicamentos', field: 'farmacos' },
                          { label: 'Agua al día', field: 'agua' },
                          { label: 'Tránsito Intestinal', field: 'estrenimiento' },
                          { label: 'Alcohol', field: 'consumoAlcohol' },
                          { label: 'Tabaco', field: 'tabaco' },
                          { label: 'Ciclo Menstrual', field: 'cicloMenstrual' },
                          { label: 'Signos y Síntomas', field: 'signosYSintomas' },
                        ] as { label: string; field: keyof typeof expediente }[]).map(({ label, field }) => (
                          <div key={field} className="space-y-1">
                            <label className="text-[10px] font-bold text-[#8a8a8a] uppercase tracking-widest">{label}</label>
                            <input
                              type="text"
                              value={expediente[field]}
                              onChange={(e) => updateExpediente(field, e.target.value)}
                              className="w-full bg-[#181818] rounded-[6px] px-3 py-2 text-[13px] font-medium text-white outline-none border border-[#333] focus:border-[#555] transition-colors"
                            />
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Mismo editor de Anamnesis y Suplementación usado en Nuevo Expediente. */}
                    <SupplementHistoryEditor
                      value={historialSupDetalle}
                      onChange={(next) => {
                        setHistorialSupDetalle(next);
                        setExpedienteModified(true);
                      }}
                    />

                  </div>
                )}
              </div>

              {/* ── BIOQUÍMICA ── */}
              <div className="bg-[#111111] border border-[#2a2a2a] rounded-[16px] shrink-0 overflow-hidden">
                <button type="button" onClick={() => setShowBioquimica(s => !s)} className="w-full flex items-center justify-between px-5 py-4 hover:bg-[#181818] transition-colors">
                  <div className="flex items-center gap-2">
                    <Activity className="w-4 h-4 text-brand-primary" />
                    <span className="text-[13px] font-bold text-white tracking-widest uppercase">Bioquímica · Laboratorios</span>
                    {(laboratorio.otrosDetalle.length > 0 || [laboratorio.glucosa, laboratorio.trigliceridos, laboratorio.colesterol, laboratorio.creatinina, laboratorio.acidoUrico].some(Boolean)) && <span className="w-2 h-2 rounded-full bg-brand-primary shrink-0" />}
                  </div>
                  <ChevronDown className={`w-4 h-4 text-[#8a8a8a] transition-transform duration-200 ${showBioquimica ? 'rotate-180' : ''}`} />
                </button>
                {showBioquimica && (
                  <div className="px-5 pb-5 pt-4 space-y-4 border-t border-[#2a2a2a]">
                    {laboratorioAnteriorFecha && !isEdit && (
                      <p className="m-0 text-[11px] text-[#8a8a8a]">
                        Resultados heredados de la consulta del {new Date(laboratorioAnteriorFecha).toLocaleDateString('es-MX', { timeZone: 'UTC' })}. Revisa y actualiza los valores antes de guardar.
                      </p>
                    )}
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-x-6 gap-y-5">
                      <Field label="Glucosa" value={laboratorio.glucosa} onChange={(value) => setLaboratorio(prev => ({ ...prev, glucosa: value }))} suffix="mg/dL" placeholder="Ej. 92" />
                      <Field label="Triglicéridos" value={laboratorio.trigliceridos} onChange={(value) => setLaboratorio(prev => ({ ...prev, trigliceridos: value }))} suffix="mg/dL" placeholder="Ej. 130" />
                      <Field label="Colesterol" value={laboratorio.colesterol} onChange={(value) => setLaboratorio(prev => ({ ...prev, colesterol: value }))} suffix="mg/dL" placeholder="Ej. 180" />
                      <Field label="Creatinina" value={laboratorio.creatinina} onChange={(value) => setLaboratorio(prev => ({ ...prev, creatinina: value }))} suffix="mg/dL" placeholder="Ej. 0.9" />
                      <Field label="Ácido Úrico" value={laboratorio.acidoUrico} onChange={(value) => setLaboratorio(prev => ({ ...prev, acidoUrico: value }))} suffix="mg/dL" placeholder="Ej. 5.2" />
                    </div>
                    <div className="space-y-3">
                      <div className="flex items-center justify-between gap-3">
                        <p className="m-0 text-[10px] font-bold text-[#8a8a8a] uppercase tracking-widest">Otros resultados</p>
                        <button type="button" onClick={() => setLaboratorio(prev => ({ ...prev, otrosDetalle: [...prev.otrosDetalle, { id: crypto.randomUUID(), nombre: '', valor: '' }] }))} className="flex items-center gap-1.5 rounded-[6px] border border-[#333] bg-[#181818] px-3 py-1.5 text-[11px] font-bold text-white hover:border-[#555]">
                          <Plus className="h-3 w-3" /> Agregar resultado
                        </button>
                      </div>
                      {laboratorio.otrosDetalle.map((item, index) => (
                        <div key={item.id} className="grid grid-cols-1 gap-3 rounded-[8px] border border-[#333] bg-[#181818] p-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
                          <div className="space-y-1">
                            <label className="block text-[10px] font-bold uppercase tracking-widest text-[#8a8a8a]">Estudio {index + 1}</label>
                            <input type="text" value={item.nombre} onChange={(e) => setLaboratorio(prev => ({ ...prev, otrosDetalle: prev.otrosDetalle.map(row => row.id === item.id ? { ...row, nombre: e.target.value } : row) }))} placeholder="Ej. Vitamina D" className="w-full rounded-[6px] border border-[#333] bg-[#111] px-3 py-2 text-[13px] text-white outline-none focus:border-[#555]" />
                          </div>
                          <div className="space-y-1">
                            <label className="block text-[10px] font-bold uppercase tracking-widest text-[#8a8a8a]">Valor y unidad</label>
                            <input type="text" value={item.valor} onChange={(e) => setLaboratorio(prev => ({ ...prev, otrosDetalle: prev.otrosDetalle.map(row => row.id === item.id ? { ...row, valor: e.target.value } : row) }))} placeholder="Ej. 35 ng/mL" className="w-full rounded-[6px] border border-[#333] bg-[#111] px-3 py-2 text-[13px] text-white outline-none focus:border-[#555]" />
                          </div>
                          <button type="button" onClick={() => setLaboratorio(prev => ({ ...prev, otrosDetalle: prev.otrosDetalle.filter(row => row.id !== item.id) }))} title="Quitar resultado" className="rounded-[6px] p-2 text-[#8a8a8a] hover:bg-[#222] hover:text-red-400"><Trash2 className="h-4 w-4" /></button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* ── DINÁMICA DEPORTIVA ── */}
              <div className="bg-[#111111] border border-[#2a2a2a] rounded-[16px] shrink-0 overflow-hidden">
                <button
                  type="button"
                  onClick={() => setShowDinamicaDeportiva(s => !s)}
                  className="w-full flex items-center justify-between px-5 py-4 hover:bg-[#181818] transition-colors"
                >
                  <div className="flex items-center gap-2">
                    <Activity className="w-4 h-4 text-brand-primary" />
                    <span className="text-[13px] font-bold text-white tracking-widest uppercase">Dinámica Deportiva</span>
                    {expedienteModified && <span className="w-2 h-2 rounded-full bg-brand-primary shrink-0" />}
                  </div>
                  <ChevronDown className={`w-4 h-4 text-[#8a8a8a] transition-transform duration-200 ${showDinamicaDeportiva ? 'rotate-180' : ''}`} />
                </button>
                {showDinamicaDeportiva && (
                  <div className="px-5 pb-5 pt-4 space-y-4 border-t border-[#2a2a2a]">
                    <div className="flex items-center justify-between gap-3">
                      <p className="m-0 text-[12px] text-[#8a8a8a]">La pausa general detiene todas las disciplinas; al reanudar se conserva la pausa individual de cada una.</p>
                      <label className="relative inline-flex items-center cursor-pointer shrink-0">
                        <input type="checkbox" className="sr-only peer" checked={ejercicioActivo} onChange={(e) => { setEjercicioActivo(e.target.checked); setExpedienteModified(true); }} />
                        <div className="w-11 h-6 bg-[#333] peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-brand-primary"></div>
                        <span className="ml-3 text-[12px] font-bold text-white uppercase tracking-wider">{ejercicioActivo ? 'Activo' : 'Pausado'}</span>
                      </label>
                    </div>
                    <div className="grid grid-cols-1 xs:grid-cols-2 md:grid-cols-3 gap-3">
                      {([
                        { label: 'Objetivo', field: 'objetivo' },
                        { label: 'Gym / Lugar', field: 'gymOrigen' },
                        { label: 'Hora Entrenamiento', field: 'horaEntrenamiento' },
                      ] as { label: string; field: keyof typeof expediente }[]).map(({ label, field }) => (
                        <div key={field} className="space-y-1">
                          <label className="text-[10px] font-bold text-[#8a8a8a] uppercase tracking-widest">{label}</label>
                          <input
                            type="text"
                            value={expediente[field]}
                            onChange={(e) => updateExpediente(field, e.target.value)}
                            className="w-full bg-[#181818] rounded-[6px] px-3 py-2 text-[13px] font-medium text-white outline-none border border-[#333] focus:border-[#555] transition-colors"
                          />
                        </div>
                      ))}
                    </div>

                    <div className="space-y-3">
                      <div className="flex flex-col items-start gap-2">
                        <p className="text-[10px] font-bold text-[#8a8a8a] uppercase tracking-widest m-0">Disciplinas</p>
                        <button
                          type="button"
                          onClick={addDisciplina}
                          className="flex items-center gap-1.5 text-[11px] font-bold text-[#8a8a8a] hover:text-white bg-[#181818] border border-[#333] hover:border-[#555] px-3 py-1.5 rounded-[6px] uppercase tracking-wider transition-colors shrink-0"
                        >
                          <Plus className="w-3 h-3" /> Agregar disciplina
                        </button>
                      </div>
                      {disciplinas.map((d, idx) => (
                        <div key={idx} className="grid sm:grid-cols-3 gap-3 items-end p-3 bg-[#181818] border border-[#333] rounded-[8px] relative">
                          <div className="sm:col-span-3 flex items-center justify-between gap-3">
                            <span className="text-[10px] font-bold uppercase tracking-widest text-[#8a8a8a]">{`Disciplina ${idx + 1}`}</span>
                            <label className="relative inline-flex items-center cursor-pointer">
                              <input type="checkbox" className="sr-only peer" checked={d.activo !== false} onChange={(e) => { setDisciplinas(prev => prev.map((row, i) => i === idx ? { ...row, activo: e.target.checked } : row)); setExpedienteModified(true); }} />
                              <div className="w-11 h-6 bg-[#333] rounded-full peer peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-brand-primary"></div>
                              <span className="ml-3 text-[11px] font-bold uppercase text-white">{d.activo === false ? 'Pausada' : 'Activa'}</span>
                            </label>
                          </div>
                          <div className="space-y-1">
                            <label className="text-[10px] font-bold text-[#8a8a8a] uppercase tracking-widest">{`Disciplina${disciplinas.length > 1 ? ` ${idx + 1}` : ''}`}</label>
                            <input
                              ref={idx === 0 ? firstDisciplinaInputRef : undefined}
                              type="text"
                              value={d.disciplina}
                              onChange={(e) => updateDisciplina(idx, 'disciplina', e.target.value)}
                              placeholder="Crossfit / Pesas / Correr"
                              className="w-full bg-[#111111] rounded-[6px] px-3 py-2 text-[13px] font-medium text-white outline-none border border-[#333] focus:border-[#555] transition-colors"
                            />
                          </div>
                          <div className="space-y-1">
                            <label className="text-[10px] font-bold text-[#8a8a8a] uppercase tracking-widest">Frecuencia</label>
                            <input
                              type="text"
                              value={d.frecuencia}
                              onChange={(e) => updateDisciplina(idx, 'frecuencia', e.target.value)}
                              placeholder="Ej: 5 días a la semana"
                              className="w-full bg-[#111111] rounded-[6px] px-3 py-2 text-[13px] font-medium text-white outline-none border border-[#333] focus:border-[#555] transition-colors"
                            />
                          </div>
                          <div className="flex gap-2 items-end">
                            <div className="flex-1 space-y-1">
                              <label className="text-[10px] font-bold text-[#8a8a8a] uppercase tracking-widest">Duración</label>
                              <input
                                type="text"
                                value={d.tiempo}
                                onChange={(e) => updateDisciplina(idx, 'tiempo', e.target.value)}
                                placeholder="Ej: 60-90 min"
                                className="w-full bg-[#111111] rounded-[6px] px-3 py-2 text-[13px] font-medium text-white outline-none border border-[#333] focus:border-[#555] transition-colors"
                              />
                            </div>
                            {disciplinas.length > 1 && (
                              <button
                                type="button"
                                onClick={() => removeDisciplina(idx)}
                                className="p-2 text-[#8a8a8a] hover:text-[#ff6b6b] rounded-[6px] hover:bg-[#111111] transition-colors"
                                title="Eliminar disciplina"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* ── DIETÉTICO ── */}
              <div className="bg-[#111111] border border-[#2a2a2a] rounded-[16px] shrink-0 overflow-hidden">
                <div className="flex items-center px-5 py-2 hover:bg-[#181818] transition-colors">
                  <button
                    type="button"
                    onClick={() => setShowDietetico(s => !s)}
                    className="flex min-w-0 flex-1 items-center justify-between py-2"
                  >
                    <div className="flex items-center gap-2">
                      <BookOpen className="w-4 h-4 text-brand-primary" />
                      <span className="text-[13px] font-bold text-white tracking-widest uppercase">Dietético</span>
                    </div>
                    <ChevronDown className={`w-4 h-4 text-[#8a8a8a] transition-transform duration-200 ${showDietetico ? 'rotate-180' : ''}`} />
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowPreviousMenus(open => !open)}
                    disabled={!previousConsultationPlan}
                    className="ml-3 flex shrink-0 items-center gap-1.5 rounded-[7px] border border-[#333] bg-[#1b1b1b] px-2.5 py-2 text-[10px] font-bold uppercase tracking-wider text-[#90c2ff] transition-colors hover:border-[#90c2ff]/50 hover:bg-[#90c2ff]/10 disabled:cursor-not-allowed disabled:opacity-35"
                    title={previousConsultationPlan ? 'Comparar con los menús enviados en la consulta anterior' : 'No hay un plan anterior disponible'}
                    aria-label="Ver menús de la consulta anterior"
                  >
                    <Search className="h-3.5 w-3.5" />
                    <span className="hidden sm:inline">Menú anterior</span>
                  </button>
                </div>
                {showDietetico && (
                  <div className="px-5 pb-5 space-y-6 border-t border-[#2a2a2a]">
                    <div className="pt-4">
                      <PreviousConsultationMenuPreview
                        isOpen={showPreviousMenus}
                        planId={previousConsultationPlan?.planId}
                        consultationDate={previousConsultationPlan?.fecha}
                        onClose={() => setShowPreviousMenus(false)}
                      />
                      <div className="flex justify-start mb-3">
                        <button
                          type="button"
                          onClick={() => setHabitos((rows) => [{ id: `diet-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, label: '', hora: '', notas: '' }, ...rows])}
                          className="flex items-center gap-1.5 text-[11px] font-bold text-[#8a8a8a] hover:text-white bg-[#181818] border border-[#333] hover:border-[#555] px-3 py-1.5 rounded-[6px] uppercase tracking-wider transition-colors shrink-0"
                        >
                          <Plus className="w-3 h-3" /> Agregar tiempo
                        </button>
                      </div>
                      <DietTable habitos={habitos} setHabitos={setHabitos} variant="dark" />
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      <div className="space-y-1">
                        <label className="text-[10px] font-bold text-[#8a8a8a] uppercase tracking-widest">Alergias</label>
                        <input
                          type="text"
                          value={expediente.alergias}
                          onChange={(e) => updateExpediente('alergias', e.target.value)}
                          placeholder="Ej. Nueces, Mariscos, Lactosa"
                          className="w-full bg-[#181818] rounded-[6px] px-3 py-2 text-[13px] font-medium text-white outline-none border border-[#333] focus:border-[#555] transition-colors"
                        />
                      </div>
                      <div className="space-y-1">
                        <label className="text-[10px] font-bold text-[#8a8a8a] uppercase tracking-widest">Alimentos que no gusta</label>
                        <input
                          type="text"
                          value={expediente.alimentosNoGustan}
                          onChange={(e) => updateExpediente('alimentosNoGustan', e.target.value)}
                          placeholder="Ej. Pescado, Brócoli"
                          className="w-full bg-[#181818] rounded-[6px] px-3 py-2 text-[13px] font-medium text-white outline-none border border-[#333] focus:border-[#555] transition-colors"
                        />
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* ── 2. ESQUEMA DE SUPLEMENTACIÓN ── */}
              <div className="bg-[#111111] border border-[#2a2a2a] rounded-[16px] shrink-0 overflow-hidden">
                <button
                  type="button"
                  onClick={() => setShowSuplemantacion(s => !s)}
                  className="w-full flex items-center justify-between px-5 py-4 hover:bg-[#181818] transition-colors"
                >
                  <div className="flex items-center gap-2">
                    <Shield className="w-4 h-4 text-brand-primary" />
                    <span className="text-[13px] font-bold text-white tracking-widest uppercase">NORDER SUPS</span>
                    {suplementacionActiva && suplementosDetalle.length > 0 && <span className="w-2 h-2 rounded-full bg-brand-primary shrink-0" />}
                  </div>
                  <ChevronDown className={`w-4 h-4 text-[#8a8a8a] transition-transform duration-200 ${showSuplemantacion ? 'rotate-180' : ''}`} />
                </button>
                {showSuplemantacion && (
                  <div className="px-5 pb-5 border-t border-[#2a2a2a] pt-4">
                    <div className="flex items-center justify-between mb-4">
                      <p className="text-[12px] text-[#8a8a8a] m-0">Configura los suplementos que el paciente tomará en esta fase.</p>
                      <label className="relative inline-flex items-center cursor-pointer shrink-0">
                        <input
                          type="checkbox"
                          className="sr-only peer"
                          checked={suplementacionActiva}
                          onChange={(e) => setSuplementacionActiva(e.target.checked)}
                        />
                        <div className="w-11 h-6 bg-[#333] peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-brand-primary"></div>
                        <span className="ml-3 text-[12px] font-bold text-white uppercase tracking-wider">{suplementacionActiva ? 'Habilitado' : 'Deshabilitado'}</span>
                      </label>
                    </div>
                    {(() => {
                      const norm = (s?: string) => (s || '').toLowerCase().trim();

                      // Fusionar suplementos ya guardados en BD + los que el usuario
                      // acaba de registrar en "Fármacos" en esta sesión (sin duplicados)
                      const guardados: any[] = paciente?.antecedentes?.suplementosDetalle || [];
                      const enSesion: any[] = historialSupDetalle.filter(s => s.nombre?.trim());
                      const guardadosNombres = new Set(guardados.map(s => norm(s.nombre)));
                      const soloSesion = enSesion.filter(s => !guardadosNombres.has(norm(s.nombre)));
                      const registroSuplementos = [...guardados, ...soloSesion].filter(s => s.activo !== false && s.nombre?.trim());

                      if (registroSuplementos.length === 0) return null;
                      return (
                        <div className="mb-4 p-3 bg-[#141414] border border-dashed border-[#333] rounded-[8px]">
                          <p className="text-[10px] font-bold text-[#8a8a8a] uppercase tracking-widest mb-2">Suplementos del historial — selecciona para agregar a NORDER SUPS</p>
                          <div className="flex flex-wrap gap-2">
                            {registroSuplementos.map((s: any, sIdx: number) => {
                              const yaAgregado = suplementosDetalle.some(sd => norm(sd.nombre) === norm(s.nombre));
                              if (yaAgregado) {
                                return (
                                  <span
                                    key={s.id || sIdx}
                                    className="flex items-center gap-1.5 text-[12px] font-semibold text-[#666] bg-[#181818] border border-[#2a2a2a] px-3 py-1.5 rounded-[8px] cursor-default"
                                  >
                                    <Check className="w-3 h-3" /> {s.nombre}
                                  </span>
                                );
                              }
                              return (
                                <button
                                  key={s.id || sIdx}
                                  type="button"
                                  onClick={() => {
                                    setSuplementosDetalle(prev => [{
                                      id: Date.now().toString() + Math.random(),
                                      nombre: s.nombre,
                                      indicaciones: s.indicaciones || '',
                                      activo: true,
                                      fechaInicio: new Date().toISOString(),
                                    }, ...prev]);
                                    setSuplementacionActiva(true);
                                  }}
                                  className="flex items-center gap-1.5 text-[12px] font-semibold text-white bg-[#1a1a1a] hover:bg-[#222] border border-[#333] hover:border-brand-primary px-3 py-1.5 rounded-[8px] transition-colors"
                                >
                                  <Plus className="w-3 h-3" /> {s.nombre}
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })()}

                    {suplementacionActiva && (
                      <div className="space-y-4 animate-fade-in">
                        <div className="grid grid-cols-[20px_1fr_36px] xs:grid-cols-[20px_1fr_1fr_36px] md:grid-cols-[20px_1.5fr_2fr_120px_80px_40px] gap-2 md:gap-4 items-center px-3 py-2 border-b border-[#2a2a2a] text-[10px] font-bold text-[#8a8a8a] uppercase tracking-widest">
                          <div></div>
                          <div>Suplemento</div>
                          <div className="hidden xs:block">Indicaciones</div>
                          <div className="hidden md:block">Tiempo</div>
                          <div className="hidden md:block text-center">Estado</div>
                          <div></div>
                        </div>
                        <div className="grid grid-cols-[20px_1fr_36px] xs:grid-cols-[20px_1fr_1fr_36px] md:grid-cols-[20px_1.5fr_2fr_120px_80px_40px] gap-2 md:gap-4 items-center px-3">
                          <div></div>
                          <button
                            type="button"
                            onClick={() => setSuplementosDetalle(prev => [{ id: Date.now().toString(), nombre: '', indicaciones: '', activo: true, fechaInicio: new Date().toISOString() }, ...prev])}
                            className="flex w-fit items-center gap-2 text-[12px] font-bold text-[#0a0a0a] bg-[#f0f0f0] hover:bg-white px-4 py-2 rounded-[8px] transition-colors uppercase tracking-wider"
                          >
                            <Plus className="w-4 h-4" /> Agregar Suplemento
                          </button>
                        </div>
                        <div className="space-y-2 max-h-[250px] overflow-y-auto custom-scrollbar pr-1">
                          {suplementosDetalle.map((sup, idx) => (
                            <div
                              key={sup.id}
                              draggable
                              onDragStart={() => setDragSupIdx(idx)}
                              onDragOver={(e) => { e.preventDefault(); }}
                              onDrop={() => {
                                if (dragSupIdx === null || dragSupIdx === idx) return;
                                const arr = [...suplementosDetalle];
                                const [moved] = arr.splice(dragSupIdx, 1);
                                arr.splice(idx, 0, moved);
                                setSuplementosDetalle(arr);
                                setDragSupIdx(null);
                              }}
                              onDragEnd={() => setDragSupIdx(null)}
                              className={`grid grid-cols-[20px_1fr_36px] xs:grid-cols-[20px_1fr_1fr_36px] md:grid-cols-[20px_1.5fr_2fr_120px_80px_40px] gap-2 md:gap-4 items-center bg-[#181818] p-3 rounded-[8px] border transition-colors group ${dragSupIdx === idx ? 'opacity-40 border-brand-primary' : 'border-[#2a2a2a] hover:border-[#444]'}`}
                            >
                              <div className="flex items-center justify-center cursor-grab text-[#444] group-hover:text-[#666]">
                                <GripVertical className="w-4 h-4" />
                              </div>
                              <input type="text" value={sup.nombre} onChange={(e) => { const a = [...suplementosDetalle]; a[idx].nombre = e.target.value; setSuplementosDetalle(a); }} placeholder="Ej. Creatina" className="w-full bg-transparent text-[13px] font-semibold text-white outline-none placeholder-[#555] p-1 border-b border-transparent focus:border-[#444] transition-colors" />
                              <input type="text" value={sup.indicaciones} onChange={(e) => { const a = [...suplementosDetalle]; a[idx].indicaciones = e.target.value; setSuplementosDetalle(a); }} placeholder="Ej. 1 scoop post-entreno" className="hidden xs:block w-full bg-transparent text-[13px] text-[#c0c0c0] outline-none placeholder-[#555] p-1 border-b border-transparent focus:border-[#444] transition-colors" />
                              <div className="hidden md:block text-[12px] font-medium text-[#c0c0c0] px-1 truncate">
                                {(() => {
                                  if (!sup.fechaInicio) return '0 días';
                                  let end = new Date(); let suffix = '';
                                  if (sup.activo) { if (sup.fechaFin) return '0 días'; suffix = ' (En curso)'; }
                                  else { end = sup.fechaFin ? new Date(sup.fechaFin) : new Date(); suffix = ' (Pausado)'; }
                                  const start = new Date(sup.fechaInicio);
                                  if (isNaN(start.getTime()) || isNaN(end.getTime())) return '0 días';
                                  const diffDays = Math.max(0, Math.floor((end.getTime() - start.getTime()) / 86400000));
                                  const meses = Math.floor(diffDays / 30);
                                  return meses > 0 ? `${meses} mes${meses > 1 ? 'es' : ''}${suffix}` : `${diffDays} día${diffDays !== 1 ? 's' : ''}${suffix}`;
                                })()}
                              </div>
                              <div className="hidden md:flex items-center justify-center w-[80px]">
                                <label className="relative inline-flex items-center cursor-pointer">
                                  <input type="checkbox" className="sr-only peer" checked={sup.activo} onChange={(e) => { const a = [...suplementosDetalle]; a[idx].activo = e.target.checked; setSuplementosDetalle(a); }} />
                                  <div className="w-8 h-4 bg-[#333] peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-3 after:w-3 after:transition-all peer-checked:bg-green-500"></div>
                                </label>
                              </div>
                              <button type="button" onClick={() => setSuplementosDetalle(suplementosDetalle.filter((_, i) => i !== idx))} className="p-2 text-[#555] hover:text-[#ff6b6b] hover:bg-[#ff6b6b]/10 rounded-[6px] transition-colors flex justify-center items-center ml-auto">
                                <Trash2 className="w-4 h-4" />
                              </button>
                            </div>
                          ))}
                          {suplementosDetalle.length === 0 && (
                            <div className="py-8 text-center border border-dashed border-[#333] rounded-[8px] bg-[#141414]">
                              <p className="text-[12px] text-[#8a8a8a] m-0">No hay suplementos agregados.</p>
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* ── 3. ESQUEMA DE HIDRATACIÓN ── */}
              <div className="bg-[#111111] border border-[#2a2a2a] rounded-[16px] shrink-0">
                <button
                  type="button"
                  onClick={() => setEsqueHidratacionOpen(prev => !prev)}
                  className="w-full flex items-center justify-between px-5 py-4 hover:bg-[#181818] transition-colors text-left"
                >
                  <div className="flex items-center gap-2">
                    <Droplets className="w-4 h-4 text-brand-primary" />
                    <span className="text-[13px] font-bold text-white tracking-widest uppercase">Esquema de Hidratación</span>
                    {esqueHidratacion && <span className="w-2 h-2 rounded-full bg-brand-primary shrink-0" />}
                  </div>
                  <ChevronDown className={`w-4 h-4 text-[#8a8a8a] transition-transform duration-200 ${esqueHidratacionOpen ? 'rotate-180' : ''}`} />
                </button>
                {esqueHidratacionOpen && (
                  <div className="px-5 pb-5 border-t border-[#2a2a2a] pt-4">
                    <p className="text-[12px] text-[#8a8a8a] m-0 mb-3">Prescripción de hidratación para esta fase (separado del registro inicial del paciente).</p>
                    <textarea
                      value={esqueHidratacion}
                      onChange={(e) => setEsqueHidratacion(e.target.value)}
                      className="w-full bg-[#181818] rounded-[10px] px-4 py-3 text-[13px] font-medium text-white outline-none border border-[#333] focus:border-[#555] resize-y transition-colors placeholder-[#555] leading-relaxed"
                      placeholder="Ej. 2.5 L agua al día, 500 ml con cada comida principal..."
                      rows={4}
                    />
                  </div>
                )}
              </div>

              {/* ── 4. NOTAS DE CONSULTA ── */}
              <div className="bg-[#111111] border border-[#2a2a2a] rounded-[16px] shrink-0 overflow-hidden">
                <button
                  type="button"
                  onClick={() => setShowNotasConsulta(s => !s)}
                  className="w-full flex items-center justify-between px-5 py-4 hover:bg-[#181818] transition-colors"
                >
                  <div className="flex items-center gap-2">
                    <FileText className="w-4 h-4 text-brand-primary" />
                    <span className="text-[13px] font-bold text-white tracking-widest uppercase">Notas de Consulta</span>
                    {(comentarios || temario.length > 0 || evitar.length > 0) && <span className="w-2 h-2 rounded-full bg-brand-primary shrink-0" />}
                  </div>
                  <ChevronDown className={`w-4 h-4 text-[#8a8a8a] transition-transform duration-200 ${showNotasConsulta ? 'rotate-180' : ''}`} />
                </button>
                {showNotasConsulta && (
                  <div className="px-5 pb-5 space-y-4 border-t border-[#2a2a2a] pt-4">
                    <div className="space-y-1">
                      <label className="text-[10px] font-bold text-[#8a8a8a] uppercase tracking-widest">¿Qué se habló en la consulta?</label>
                      <textarea
                        value={comentarios}
                        onChange={(e) => setComentarios(e.target.value)}
                        className="w-full bg-[#181818] rounded-[6px] px-3 py-2 text-[13px] font-medium text-white outline-none border border-[#333] focus:border-[#555] min-h-[60px] resize-y transition-colors placeholder-[#555]"
                        placeholder="Observaciones relevantes de la consulta..."
                      />
                    </div>

                    <div>
                      <div className="flex items-center justify-between pb-2 border-b border-[#2a2a2a] mb-2">
                        <label className="block text-[10px] font-bold text-[#8a8a8a] m-0 uppercase tracking-widest">Alimentos a Evitar</label>
                        <button type="button" onClick={addEvitar} className="text-[10px] font-bold text-white hover:opacity-70 flex items-center gap-1 transition-colors uppercase tracking-wider bg-[#1a1a1a] px-2 py-1 border border-[#333] rounded-[4px]">
                          <Plus className="h-2.5 w-2.5" /> Agregar
                        </button>
                      </div>
                      <div className="space-y-2">
                        {evitar.map((e, idx) => (
                          <div key={e.id} className="flex gap-2 items-center">
                            <input
                              type="text"
                              value={e.valor}
                              onChange={(el) => updateEvitar(idx, el.target.value)}
                              className="flex-1 bg-[#181818] rounded-[6px] px-3 py-1.5 text-[12px] font-medium text-white outline-none border border-[#333] focus:border-[#555] transition-colors"
                              placeholder="Ej. Lácteos, Azúcares..."
                            />
                            <button type="button" onClick={() => removeEvitar(idx)} className="text-[#555] hover:text-[#ff6b6b] transition-colors">
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        ))}
                        {evitar.length === 0 && <p className="text-[11px] text-[#444] italic">Sin restricciones específicas.</p>}
                      </div>
                    </div>

                    <div>
                      <div className="flex items-center justify-between pb-2 border-b border-[#2a2a2a] mb-3">
                        <label className="block text-[11px] font-bold text-[#8a8a8a] m-0 uppercase tracking-widest">Temas de Consulta</label>
                        <button type="button" onClick={addTema} className="text-[11px] font-bold text-white hover:opacity-70 flex items-center gap-1.5 transition-colors uppercase tracking-wider bg-[#1a1a1a] px-3 py-1.5 border border-[#333] rounded-[6px]">
                          <Plus className="h-3 w-3" strokeWidth={3} /> Agregar
                        </button>
                      </div>
                      {temario.length === 0 && (
                        <div className="py-6 border border-[#2a2a2a] border-dashed rounded-[12px] bg-[#141414] text-center">
                          <p className="text-[12px] text-[#8a8a8a] px-4">Sin notas asignadas. Haz clic en "Agregar" para registrar notas de la consulta.</p>
                        </div>
                      )}
                      <div className="space-y-3">
                        {temario.map((t, idx) => (
                          <div key={t.id} className="relative group space-y-2 pb-3 pt-1 border-b border-[#2a2a2a] last:border-0 last:pb-0">
                            <button type="button" onClick={() => removeTema(idx)} className="absolute top-1 right-0 p-1.5 text-[#555] hover:text-[#ff6b6b] hover:bg-[#ff6b6b]/10 rounded-[6px] opacity-100 sm:opacity-0 group-hover:opacity-100 transition-all z-10">
                              <Trash2 className="h-4 w-4" />
                            </button>
                            <input
                              type="text"
                              placeholder="Título del tema..."
                              value={t.tema}
                              onChange={(e) => updateTema(idx, 'tema', e.target.value)}
                              className="w-full bg-transparent text-[14px] font-bold text-white outline-none placeholder-[#555] pr-8 border-none m-0 p-0"
                            />
                            <textarea
                              placeholder="Detalles y comentarios de lo conversado..."
                              value={t.detalle}
                              onChange={(e) => updateTema(idx, 'detalle', e.target.value)}
                              className="w-full bg-[#181818] border border-[#333] focus:border-[#555] rounded-[6px] p-2.5 text-[12px] font-medium text-[#8a8a8a] outline-none min-h-[50px] resize-none placeholder-[#444] transition-colors"
                            />
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Notas de Competencia */}
                    <div>
                      <button
                        type="button"
                        onClick={() => setShowCompetencia(s => !s)}
                        className="w-full flex items-center justify-between pb-2 border-b border-[#2a2a2a] mb-3 hover:opacity-80 transition-opacity"
                      >
                        <label className="block text-[11px] font-bold text-[#8a8a8a] m-0 uppercase tracking-widest cursor-pointer">
                          Notas de Competencia <span className="text-[#555] normal-case tracking-normal">(deportistas — opcional)</span>
                        </label>
                        <span className="text-[14px] font-bold text-[#8a8a8a]">{showCompetencia ? '−' : '+'}</span>
                      </button>
                      {showCompetencia && (
                        <div className="space-y-3">
                          {(['antes', 'durante', 'despues'] as const).map((fase) => (
                            <div key={fase}>
                              <label className="block text-[10px] font-bold text-[#8a8a8a] m-0 mb-1 uppercase tracking-widest">
                                {fase === 'antes' ? 'Antes' : fase === 'durante' ? 'Durante' : 'Después'} de competencia
                              </label>
                              <textarea
                                value={competencia[fase]}
                                onChange={(e) => setCompetencia(c => ({ ...c, [fase]: e.target.value }))}
                                placeholder={fase === 'antes' ? 'Ej. 3h antes: 1 taza avena + plátano...' : fase === 'durante' ? 'Ej. Cada 30 min: 200ml bebida isotónica...' : 'Ej. 30 min post: 30g whey + 50g carbo simple...'}
                                className="w-full bg-[#181818] border border-[#333] focus:border-[#555] rounded-[6px] p-2.5 text-[12px] font-medium text-white outline-none min-h-[60px] resize-y placeholder-[#444] transition-colors"
                              />
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>

              {/* ── 5. NOTAS DE ENTRENAMIENTO ── */}
              <div className="bg-[#111111] border border-[#2a2a2a] rounded-[16px] shrink-0">
                <button
                  type="button"
                  onClick={() => setNotasLibresOpen(prev => !prev)}
                  className="w-full flex items-center justify-between px-5 py-4 hover:bg-[#181818] transition-colors text-left"
                >
                  <div className="flex items-center gap-2">
                    <BookOpen className="w-4 h-4 text-brand-primary" />
                    <span className="text-[13px] font-bold text-white tracking-widest uppercase">Notas de Entrenamiento</span>
                    {(notasLibres || adjuntos.length > 0) && <span className="w-2 h-2 rounded-full bg-brand-primary shrink-0" />}
                  </div>
                  <ChevronDown className={`w-4 h-4 text-[#8a8a8a] transition-transform duration-200 ${notasLibresOpen ? 'rotate-180' : ''}`} />
                </button>
                {notasLibresOpen && (
                  <div className="px-5 pb-5 border-t border-[#2a2a2a] pt-4">
                    <div className="flex items-center justify-between mb-4 gap-3">
                      <p className="text-[12px] text-[#8a8a8a] m-0">Rutinas de entrenamiento, notas extensas, instrucciones especiales o seguimiento posterior a la consulta.</p>
                      <button
                        type="button"
                        onClick={() => {
                          const d = new Date();
                          const sep = `--- ${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()} ---`;
                          setNotasLibres(prev => prev ? `${prev.replace(/\n+$/, '')}\n\n${sep}\n` : `${sep}\n`);
                        }}
                        className="flex items-center gap-1.5 text-[10px] font-bold text-[#8a8a8a] hover:text-white border border-[#333] hover:border-[#555] px-2.5 py-1.5 rounded-[6px] transition-colors uppercase tracking-wider whitespace-nowrap shrink-0"
                      >
                        <Plus className="w-3 h-3" /> Nota con fecha
                      </button>
                    </div>
                    <textarea
                      value={notasLibres}
                      onChange={(e) => setNotasLibres(e.target.value)}
                      className="w-full bg-[#181818] rounded-[10px] px-4 py-3 text-[13px] font-medium text-white outline-none border border-[#333] focus:border-[#555] resize-y transition-colors placeholder-[#555] leading-relaxed"
                      placeholder={"Ej. Rutina de entrenamiento semana 1:\n\nLun — Pecho / Tríceps\n  Press banca 4x8\n  Fondos 3x12\n  ...\n\nMar — Espalda / Bíceps\n  ..."}
                      rows={10}
                    />
                    <div className="mt-4 space-y-3">
                      <div className="flex items-center justify-between">
                        <label className="text-[10px] font-bold text-[#8a8a8a] uppercase tracking-widest">Adjuntos / Imágenes</label>
                        <label className="flex items-center gap-2 text-[11px] font-bold text-[#0a0a0a] bg-[#f0f0f0] hover:bg-white px-3 py-1.5 rounded-[6px] cursor-pointer transition-colors uppercase tracking-wider">
                          <Plus className="w-3 h-3" /> Subir imagen
                          <input type="file" accept="image/*" multiple className="hidden" onChange={handleAdjuntoUpload} />
                        </label>
                      </div>
                      {adjuntos.length > 0 ? (
                        <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-3">
                          {adjuntos.map((adj) => (
                            <div key={adj.id} className="relative group rounded-[8px] overflow-hidden border border-[#2a2a2a] aspect-square">
                              <img src={adj.dataUrl} alt={adj.nombre} className="w-full h-full object-cover" />
                              <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                                <button type="button" onClick={() => setAdjuntos(prev => prev.filter(a => a.id !== adj.id))} className="p-1.5 bg-[#ff4444] rounded-full text-white">
                                  <Trash2 className="w-3 h-3" />
                                </button>
                              </div>
                              <p className="absolute bottom-0 left-0 right-0 text-[9px] text-white bg-black/70 px-1 py-0.5 truncate">{adj.nombre}</p>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <p className="text-[11px] text-[#555] italic">Sin adjuntos. Max 1.5MB por imagen.</p>
                      )}
                    </div>
                  </div>
                )}
              </div>

              {/* ── 6. MEDICIONES CORPORALES ── */}
              <div className="bg-[#111111] border border-[#2a2a2a] rounded-[16px] shrink-0 overflow-hidden">
                <button
                  type="button"
                  onClick={() => setShowMedidas(s => !s)}
                  className="w-full flex items-center justify-between px-5 py-4 hover:bg-[#181818] transition-colors"
                >
                  <div className="flex items-center gap-2">
                    <Activity className="w-4 h-4 text-brand-primary" />
                    <span className="text-[13px] font-bold text-white tracking-widest uppercase">Mediciones corporales</span>
                    {(peso || pctGrasa || (mostrarBioimpedancia && Object.values(bioimpedancia).some(Boolean))) && <span className="w-2 h-2 rounded-full bg-brand-primary shrink-0" />}
                  </div>
                  <ChevronDown className={`w-4 h-4 text-[#8a8a8a] transition-transform duration-200 ${showMedidas ? 'rotate-180' : ''}`} />
                </button>
                {showMedidas && (
                  <div className="px-5 pb-5 border-t border-[#2a2a2a] pt-4">
                    {!consultaEnLinea && mostrarBioimpedancia && (
                      <div className="mb-5 flex flex-col gap-3 rounded-[10px] border border-[#292929] bg-[#151515] p-4 sm:flex-row sm:items-center sm:justify-between">
                        <div>
                          <p className="mb-1 text-[10px] font-bold uppercase tracking-widest text-[#8a8a8a]">Método de composición corporal</p>
                          <p className="m-0 text-[11px] text-[#666]">Selecciona el método utilizado en esta valoración.</p>
                        </div>
                        <div className="grid w-full grid-cols-2 gap-2 sm:w-[300px]">
                          <button
                            type="button"
                            onClick={() => setCompositionMethod('ANTROPOMETRIA')}
                            className={`rounded-[7px] border px-3 py-2 text-[10px] font-bold uppercase tracking-wider transition-colors ${compositionMethod === 'ANTROPOMETRIA' ? 'border-brand-primary bg-brand-primary text-black' : 'border-[#333] text-[#777] hover:text-white'}`}
                          >
                            Antropometría
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setCompositionMethod('BIOIMPEDANCIA');
                              setIsGrasaModified(true);
                            }}
                            className={`rounded-[7px] border px-3 py-2 text-[10px] font-bold uppercase tracking-wider transition-colors ${compositionMethod === 'BIOIMPEDANCIA' ? 'border-brand-primary bg-brand-primary text-black' : 'border-[#333] text-[#777] hover:text-white'}`}
                          >
                            Bioimpedancia
                          </button>
                        </div>
                      </div>
                    )}
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-x-6 gap-y-5">
                      <Field label="Fecha" value={fecha} onChange={setFecha} type="date" />
                      <Field label="Hora" value={hora} onChange={setHora} type="time" />
                      {!consultaEnLinea && (!mostrarBioimpedancia || compositionMethod === 'ANTROPOMETRIA') ? (
                        <Field label="Masa Muscular" value={masaMagra !== null ? masaMagra.toFixed(2) : ''} disabled suffix="kg" placeholder="Auto" status={measurementStatuses.masaMagra} onStatusChange={(status) => setMeasurementStatuses(prev => ({ ...prev, masaMagra: status }))} />
                      ) : (
                        <Field label="Peso" value={peso} onChange={(value) => { setPeso(value); setMeasurementStatuses(prev => ({ ...prev, peso: value ? 'REGISTRADA' : 'NO_CAPTURADA' })); }} suffix="kg" placeholder="Ej. 68.5" status={measurementStatuses.peso} onStatusChange={(status) => { setMeasurementStatuses(prev => ({ ...prev, peso: status })); if (status === 'NO_APLICA') setPeso(''); }} />
                      )}
                      {consultaEnLinea ? (
                        <>
                          <Field label="Brazo relajado" value={onlineMeasurements.brazoRelajado} onChange={(value) => { setOnlineMeasurements(prev => ({ ...prev, brazoRelajado: value })); setIsGrasaModified(true); }} suffix="cm" placeholder="Ej. 29.5" />
                          <Field label="Brazo contraído" value={onlineMeasurements.brazoContraido} onChange={(value) => { setOnlineMeasurements(prev => ({ ...prev, brazoContraido: value })); setIsGrasaModified(true); }} suffix="cm" placeholder="Ej. 31.2" />
                          <Field label="Cintura" value={onlineMeasurements.cintura} onChange={(value) => { setOnlineMeasurements(prev => ({ ...prev, cintura: value })); setIsGrasaModified(true); }} suffix="cm" placeholder="Ej. 78.4" />
                          <Field label="Cadera" value={onlineMeasurements.cadera} onChange={(value) => { setOnlineMeasurements(prev => ({ ...prev, cadera: value })); setIsGrasaModified(true); }} suffix="cm" placeholder="Ej. 96.1" />
                        </>
                      ) : !mostrarBioimpedancia || compositionMethod === 'ANTROPOMETRIA' ? (
                        <>
                          <Field label="Peso" value={peso} onChange={(value) => { setPeso(value); setMeasurementStatuses(prev => ({ ...prev, peso: value ? 'REGISTRADA' : 'NO_CAPTURADA' })); }} suffix="kg" placeholder="Ej. 68.5" status={measurementStatuses.peso} onStatusChange={(status) => { setMeasurementStatuses(prev => ({ ...prev, peso: status })); if (status === 'NO_APLICA') setPeso(''); }} />
                          <Field label="% Grasa Corp." value={pctGrasa} onChange={handlePctGrasaChange} placeholder="Ej. 24.3" status={measurementStatuses.pctGrasa} onStatusChange={(status) => { setMeasurementStatuses(prev => ({ ...prev, pctGrasa: status })); if (status === 'NO_APLICA') { setPctGrasa(''); setKgGrasa(''); } }} />
                          <Field label="Kg Grasa" value={kgGrasa} onChange={handleKgGrasaChange} suffix="kg" placeholder="Ej. 15.2" status={measurementStatuses.kgGrasa} onStatusChange={(status) => { setMeasurementStatuses(prev => ({ ...prev, kgGrasa: status })); if (status === 'NO_APLICA') setKgGrasa(''); }} />
                        </>
                      ) : (
                        <>
                          <Field label="Grasa corporal" value={bioimpedancia.grasa} onChange={(value) => { setBioimpedancia(prev => ({ ...prev, grasa: value })); setIsGrasaModified(true); }} suffix="%" placeholder="Ej. 24.3" />
                          <Field label="Agua corporal" value={bioimpedancia.agua} onChange={(value) => { setBioimpedancia(prev => ({ ...prev, agua: value })); setIsGrasaModified(true); }} suffix="%" placeholder="Ej. 52.1" />
                          <Field label="Músculo" value={bioimpedancia.musculo} onChange={(value) => { setBioimpedancia(prev => ({ ...prev, musculo: value })); setIsGrasaModified(true); }} suffix="kg" placeholder="Ej. 31.8" />
                          <Field label="Energía" value={barridoData?.kcalTotal ? String(Math.round(barridoData.kcalTotal)) : ''} disabled suffix="kcal" placeholder="Se llena al completar el barrido" />
                        </>
                      )}
                    </div>

                    {consultaEnLinea && (
                      <PhotoFollowup pacienteId={pacienteId!} valoracionId={valoracionId} onPendingChange={setPendingFollowupPhotos} />
                    )}
                  </div>
                )}
              </div>

              {/* ── 7. AGENDAR PRÓXIMA CITA ── */}
              <div className="bg-[#111111] border border-[#2a2a2a] rounded-[16px] shrink-0 overflow-hidden">
                <button
                  type="button"
                  onClick={() => setShowAgendarCita(s => !s)}
                  className="w-full flex items-center justify-between px-5 py-4 hover:bg-[#181818] transition-colors"
                >
                  <div className="flex items-center gap-2">
                    <CalendarIcon className="w-4 h-4 text-brand-primary" />
                    <span className="text-[13px] font-bold text-white tracking-widest uppercase">Agendar Próxima Cita</span>
                    {proximaSesion && <span className="w-2 h-2 rounded-full bg-green-500 shrink-0" />}
                  </div>
                  <ChevronDown className={`w-4 h-4 text-[#8a8a8a] transition-transform duration-200 ${showAgendarCita ? 'rotate-180' : ''}`} />
                </button>
                {showAgendarCita && (
                  <div className="px-5 pb-5 border-t border-[#2a2a2a] pt-4">
                    <p className="text-[12px] text-[#8a8a8a] m-0 mb-4">Agenda la siguiente consulta directamente desde aquí.</p>
                    <div className="animate-fade-in">
                      <CalcomScheduling
                        pacienteData={paciente ? { nombre: paciente.nombre, apellido: paciente.apellido, email: paciente.email, telefono: paciente.telefono } : undefined}
                        onSelection={(data) => {
                          setCalcomData(data);
                          setProximaSesion(data?.fecha || '');
                        }}
                      />
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* FASE 2: BARRIDO */}
          {step === 2 && (
            <div className="flex flex-col flex-1 min-h-0 animate-slide-up gap-4">
              <div className="flex shrink-0 items-start justify-between gap-3 mb-1">
                <div>
                  <p className="text-[10px] font-semibold text-[#8a8a8a] uppercase tracking-[0.15em] mb-1">Paso 2 de {totalSteps}</p>
                  <h3 className="text-[22px] font-bold text-white m-0 tracking-tight">
                    Equivalencias
                  </h3>
                  <p className="text-[12px] text-[#8a8a8a] m-0 mt-1">
                    {barridoData && barridoData.kcalTotal > 0
                      ? `Total temporal: ${Math.round(barridoData.kcalTotal).toLocaleString()} kcal`
                      : 'Asigna el cuadro sintético o los macros del paciente.'}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setShowPreviousMenus(open => !open)}
                  disabled={!previousConsultationPlan}
                  className="mt-1 flex shrink-0 items-center gap-1.5 rounded-[7px] border border-[#333] bg-[#1b1b1b] px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-[#90c2ff] transition-colors hover:border-[#90c2ff]/50 hover:bg-[#90c2ff]/10 disabled:cursor-not-allowed disabled:opacity-35"
                  title={previousConsultationPlan ? 'Comparar con los menús enviados en la consulta anterior' : 'No hay un plan anterior disponible'}
                  aria-label="Ver menús de la consulta anterior"
                >
                  <Search className="h-3.5 w-3.5" />
                  <span className="hidden sm:inline">Menú anterior</span>
                </button>
              </div>

              <PreviousConsultationMenuPreview
                isOpen={showPreviousMenus}
                planId={previousConsultationPlan?.planId}
                consultationDate={previousConsultationPlan?.fecha}
                onClose={() => setShowPreviousMenus(false)}
              />

              <div className="bg-[#111111] px-5 py-4 rounded-[16px] border border-[#2a2a2a] shadow-none flex-1 min-h-0 overflow-y-auto custom-scrollbar">
                <div className="-mx-4 md:mx-0">
                  <BarridosEquivalenciasManager
                    value={barridoData}
                    onChange={(data) => setBarridoData(data)}
                    habitos={habitos}
                    onTiempoAdded={handleTiempoAddedFromBarrido}
                    onTiempoRenamed={handleTiempoRenamedFromBarrido}
                    onTiempoRemoved={handleTiempoRemovedFromBarrido}
                    onTiempoReordered={handleTiempoReorderedFromBarrido}
                  />
                </div>
              </div>
            </div>
          )}

          {/* FASE 3: CREACION DEL PLAN */}
          {step === 3 && (
            <div className="space-y-4 animate-slide-up mt-4">
              <CreateEditPlanForm
                pacienteId={pacienteId}
                planId={planVinculadoId || undefined}
                valoracionId={valoracionIdGuardada || undefined}
                initialProximaSesion={proximaSesion || undefined}
                onSaved={(planId) => {
                  setPlanIdGuardado(planId);
                  setStep(4);
                }}
                onCancel={() => navigate(`/pacientes/${pacienteId}`)}
              />
            </div>
          )}

          {/* FASE 4: OPCIONES DE ENVIO (PDF / WHATSAPP) */}
          {step === 4 && (
            <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar animate-slide-up mt-4">
              <Phase4Delivery
                pacienteId={pacienteId!}
                planId={planIdGuardado!}
                onFinish={() => navigate('/dashboard')}
              />
            </div>
          )}

          {/* BOTTOM NAVIGATION - ONLY FOR STEPS 1 AND 2 (sticky: Guardar siempre visible al hacer scroll) */}
          {step <= 2 && (
            <div className="sticky bottom-0 z-20 bg-[#0a0a0a]/95 backdrop-blur-md flex flex-col sm:flex-row items-center justify-between py-2 shrink-0 border-t border-[#1a1a1a]">
              {step > 1 ? (
                <button
                  onClick={() => setStep(step - 1)}
                  className="text-[12px] font-bold text-[#8a8a8a] hover:text-white transition-colors flex items-center gap-2 px-3 py-2 uppercase tracking-wide"
                >
                  ← Anterior
                </button>
              ) : (
                <button
                  onClick={() => navigate(`/pacientes/${pacienteId}`)}
                  className="text-[12px] font-bold text-[#8a8a8a] hover:text-white transition-colors flex items-center gap-2 px-3 py-2 uppercase tracking-wide"
                >
                  ← Salir Sin Guardar
                </button>
              )}

              {/* Dots Indicator */}
              <div className="hidden sm:flex items-center gap-1.5 opacity-50">
                {[1, 2, 3, 4].map(s => (
                  <div key={s} className={`rounded-full transition-all duration-300 ${step === s ? 'w-6 h-1 bg-white' : 'w-1 h-1 bg-[#444]'}`} />
                ))}
              </div>

              {step < 2 ? (
                <div className="flex flex-col-reverse sm:flex-row items-center gap-3 w-full sm:w-auto">
                  <button
                    onClick={() => setStep(step + 1)}
                    className="px-5 py-2.5 bg-transparent border border-[#333] text-white rounded-[8px] text-[12px] font-bold hover:bg-[#1a1a1a] transition-colors disabled:opacity-50 w-full sm:w-auto text-center uppercase tracking-wide"
                  >
                    Equivalencias
                  </button>
                  <button
                    onClick={() => handleSave(false)}
                    disabled={saving}
                    className="px-5 py-2.5 bg-[#f0f0f0] border border-[#333] text-black rounded-[8px] text-[12px] font-bold hover:bg-[#1a1a1a] transition-colors disabled:opacity-50 w-full sm:w-auto text-center uppercase tracking-wide"
                  >
                    {saving ? 'Guardando...' : 'Guardar  →'}
                  </button>
                </div>
              ) : (
                <div className="flex flex-col-reverse sm:flex-row items-center gap-3 w-full sm:w-auto">
                  <button
                    onClick={() => handleSave(false)}
                    disabled={saving || barridoData?.isValid === false}
                    className="px-5 py-2.5 bg-transparent border border-[#333] text-white rounded-[8px] text-[12px] font-bold hover:bg-[#1a1a1a] transition-colors disabled:opacity-50 disabled:cursor-not-allowed w-full sm:w-auto text-center uppercase tracking-wide"
                  >
                    {saving ? 'Guardando...' : 'Sólo Guardar'}
                  </button>
                  <button
                    onClick={() => handleSave(true)}
                    disabled={saving || barridoData?.isValid === false}
                    className="px-5 py-2.5 bg-[#f0f0f0] text-[#0a0a0a] rounded-[8px] text-[12px] font-bold hover:bg-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2 w-full sm:w-auto justify-center shadow-sm uppercase tracking-wide"
                    style={{ minWidth: '220px' }}
                  >
                    {saving ? <div className="w-4 h-4 border-2 border-[#0a0a0a]/20 border-t-[#0a0a0a] rounded-full animate-spin" /> : <>{planVinculadoId ? 'Guardar y Editar Plan' : 'Guardar y Crear Plan'} →</>}
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default NewAssessment;
