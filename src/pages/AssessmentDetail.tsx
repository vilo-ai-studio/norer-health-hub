import { useState, useEffect, useCallback, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Brain, Plus, X, FileText, Layers, ChevronDown, ChevronUp, Check, AlertCircle, Edit2, Clock, Activity, Calendar as CalendarIcon, Trash2, Search } from 'lucide-react';
import api from '@/lib/api';
import CalcomScheduling from '@/components/CalcomScheduling';
import { formatDate } from '@/lib/format';
import { useToast } from '@/hooks/use-toast';
import BarridosEquivalenciasManager, {
  getBarridoVariantes,
  type BarridoCollection,
} from '@/components/BarridosEquivalenciasManager';
import { NutritionLoader } from '@/components/ui/NutritionLoader';
import { useConfirm } from '@/components/ui/ConfirmDialog';
import { AppointmentSummary } from '@/components/AppointmentSummary';
import { PacienteResumenSidebar } from '@/components/PacienteResumenSidebar';
import { buildAvoidFoods } from '@/lib/avoidFoods';
import { PreviousConsultationMenuPreview } from '@/components/PreviousConsultationMenuPreview';
import { findPreviousConsultationPlan } from '@/lib/previousConsultationPlan';
import { resolveAssessmentDietetica } from '@/lib/recall24';
import { otrosBioquimicosFromValoracion } from '@/lib/laboratorio';
import {
  APPOINTMENT_REQUEST_TIMEOUT_MS,
  getBookingFailureCopy
} from '@/lib/appointmentScheduling';

// ─── Módulo Plan de la Consulta ───────────────────────────────────────────────
const PlanSection = ({
  pacienteId,
  valoracionId,
  planLigado,
  hasEquivalencias,
}: {
  pacienteId: string;
  valoracionId: string;
  planLigado?: { id: string; nombre?: string; tipoPlan?: string };
  hasEquivalencias: boolean;
}) => {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [showModal, setShowModal] = useState(false);
  const [plantillas, setPlantillas] = useState<any[]>([]);
  const [loadingPlantillas, setLoadingPlantillas] = useState(false);
  const [assigning, setAssigning] = useState(false);
  const [plan, setPlan] = useState(planLigado);

  const fetchPlantillas = useCallback(async () => {
    setLoadingPlantillas(true);
    try {
      const { data } = await api.get('/api/planes?tipo=base');
      setPlantillas(data?.data || data || []);
    } catch {
      toast({ title: 'Error', description: 'No se pudieron cargar las plantillas.', variant: 'destructive' });
    } finally {
      setLoadingPlantillas(false);
    }
  }, [toast]);

  const handleAsignar = async (plantillaId: string) => {
    setAssigning(true);
    try {
      const { data } = await api.post(`/api/planes/${plantillaId}/asignar`, { pacienteId, valoracionId });
      const newPlan = data?.data || data;
      setPlan(newPlan);
      setShowModal(false);
      toast({ title: 'Menú asignado correctamente' });
    } catch (err: any) {
      toast({ title: 'Error', description: err.response?.data?.message || 'No se pudo asignar.', variant: 'destructive' });
    } finally {
      setAssigning(false);
    }
  };

  return (
    <div className="space-y-4">
      {plan ? (
        <div className="flex flex-wrap items-center justify-between gap-4 p-4 bg-bg-elevated rounded-[10px] border border-border-default">
          <div>
            <p className="text-[12px] font-medium text-text-muted m-0">Plan asignado</p>
            <p className="text-[15px] font-semibold text-text-primary m-0">{plan.nombre || plan.tipoPlan || 'Menú'}</p>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => navigate(`/pacientes/${pacienteId}/planes/${plan.id}`)}
              className="flex items-center gap-2 px-4 py-2 bg-bg-surface border border-border-subtle rounded-[8px] text-[13px] font-medium text-text-primary hover:bg-[#222] transition-colors"
            >
              <FileText className="w-4 h-4" /> Ver plan
            </button>
            <button
              onClick={() => { setShowModal(true); fetchPlantillas(); }}
              className="flex items-center gap-2 px-4 py-2 bg-bg-elevated border border-border-subtle rounded-[8px] text-[13px] font-medium text-text-secondary hover:text-text-primary transition-colors"
            >
              Cambiar plan
            </button>
          </div>
        </div>
      ) : !hasEquivalencias ? (
        // ── BLOQUEADO: se requieren equivalencias primero ──────────────────────────────
        <div className="flex items-start gap-4 p-5 bg-amber-500/5 border border-amber-500/20 rounded-[10px]">
          <div className="shrink-0 mt-0.5 p-2 rounded-[8px] bg-amber-500/10 text-amber-400">
            <AlertCircle className="w-5 h-5" />
          </div>
          <div>
            <p className="text-[14px] font-semibold text-amber-400 m-0 mb-1">
              Se requieren equivalencias para agregar el plan
            </p>
            <p className="text-[13px] font-normal text-text-secondary m-0 leading-relaxed">
              Completa primero el <span className="font-semibold text-text-primary">Barrido de Equivalencias</span> de esta consulta y guárdalo. Una vez asignadas las equivalencias, podrás crear o asignar un menú.
            </p>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap gap-3">
          <button
            onClick={() => navigate(`/pacientes/${pacienteId}/planes/nuevo?valoracionId=${valoracionId}`)}
            className="flex items-center gap-2 px-5 py-2.5 bg-brand-primary text-bg-base rounded-[8px] text-[13px] font-bold hover:bg-[#e0e0e0] transition-all"
          >
            <Plus className="w-4 h-4" /> Crear nuevo plan
          </button>
        </div>
      )}

      {/* Modal plantillas */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
          <div className="bg-bg-surface border border-border-subtle rounded-[16px] w-full max-w-lg shadow-2xl animate-fade-in">
            <div className="flex items-center justify-between p-6 border-b border-border-subtle">
              <h3 className="text-[16px] font-bold text-text-primary m-0">Seleccionar menú base</h3>
              <button onClick={() => setShowModal(false)} className="p-2 text-text-muted hover:text-text-primary transition-colors">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-6 max-h-[60vh] overflow-y-auto space-y-3">
              {loadingPlantillas ? (
                <div className="flex justify-center py-10">
                  <div className="w-6 h-6 border-2 border-black/20 border-t-black dark:border-white/20 dark:border-t-white rounded-full animate-spin" />
                </div>
              ) : plantillas.length === 0 ? (
                <p className="text-[14px] text-text-secondary text-center py-8">No hay menús base disponibles</p>
              ) : (
                plantillas.map((p) => (
                  <button
                    key={p.id}
                    onClick={() => handleAsignar(p.id)}
                    disabled={assigning}
                    className="w-full text-left p-4 bg-bg-elevated hover:bg-[#1e1e1e] border border-border-subtle rounded-[10px] transition-colors disabled:opacity-50"
                  >
                    <p className="text-[14px] font-semibold text-text-primary m-0">{p.tipoPlan || p.nombre || 'Plan'}</p>
                    <p className="text-[12px] text-text-muted m-0 mt-0.5">{p.calorias ? `${p.calorias} kcal` : ''}</p>
                  </button>
                ))
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

// ─── AssessmentDetail principal ───────────────────────────────────────────────
const AssessmentDetail = () => {
  const { id: pacienteId, valoracionId } = useParams();
  const navigate = useNavigate();
  const { toast } = useToast();
  const { confirm, ConfirmDialogComponent } = useConfirm();
  const [val, setVal] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [pacienteCitas, setPacienteCitas] = useState<any[]>([]);
  const [pacienteInfo, setPacienteInfo] = useState<any>(null);

  // Barrido: estado controlado por el padre, se pasa al componente compartido
  const [barridoData, setBarridoData] = useState<BarridoCollection | null>(null);
  const [initialBarridoData, setInitialBarridoData] = useState<string | null>(null);
  const [showBarrido, setShowBarrido] = useState(true);
  const [savingBarrido, setSavingBarrido] = useState(false);
  const [showPreviousMenus, setShowPreviousMenus] = useState(false);

  const previousConsultationPlan = useMemo(
    () => findPreviousConsultationPlan(pacienteInfo?.valoraciones, valoracionId),
    [pacienteInfo?.valoraciones, valoracionId],
  );

  useEffect(() => {
    if (!previousConsultationPlan) setShowPreviousMenus(false);
  }, [previousConsultationPlan]);

  const assessmentDietetica = useMemo(
    () => resolveAssessmentDietetica(val, pacienteInfo?.habitos),
    [val, pacienteInfo?.habitos],
  );

  // A1: Soft delete
  const [deletingConsulta, setDeletingConsulta] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  // Cal.com Scheduling Independiente
  const [calcomData, setCalcomData] = useState<any>(null);
  const [isScheduling, setIsScheduling] = useState(false);

  // Helper para cargar las citas del paciente por separado
  const fetchPacienteCitas = async () => {
    try {
      const { data } = await api.get(`/api/pacientes/${pacienteId}`);
      const paciente = data?.data || data;
      setPacienteCitas(paciente?.citas || []);
      setPacienteInfo(paciente || null);
    } catch {
      // silenciar — las citas no son críticas para mostrar la valoración
    }
  };

  useEffect(() => {
    const fetchAll = async () => {
      try {
        // Cargar valoración y citas del paciente en paralelo
        const [valRes] = await Promise.all([
          api.get(`/api/pacientes/${pacienteId}/valoraciones/${valoracionId}`),
          fetchPacienteCitas(),
        ]);
        const serverData = valRes.data?.data || valRes.data;
        if (serverData) setVal(serverData);

        // Cargar barrido — el backend devuelve { data: null } si no existe
        try {
          const br = await api.get(`/api/pacientes/${pacienteId}/valoraciones/${valoracionId}/barrido`);
          const bd = br.data?.data || br.data;
          if (bd && (bd.tiempos || bd.kcalTotal)) {
            setBarridoData(bd as BarridoCollection);
            setInitialBarridoData(JSON.stringify(bd));
          }
        } catch {
          // Sin barrido previo, estado inicial null
          setInitialBarridoData(null);
        }
      } catch (err) {
        console.error('Error cargando valoración:', err);
      } finally {
        setLoading(false);
      }
    };
    fetchAll();
  }, [pacienteId, valoracionId]);

  const handleScheduleCita = async () => {
    if (!calcomData) return;
    const confirmed = await confirm({
      title: 'Confirmar cita de seguimiento',
      description: <AppointmentSummary data={calcomData} />,
      confirmLabel: 'Confirmar y agendar',
      cancelLabel: 'Volver',
      variant: 'info',
    });
    if (!confirmed) return;
    setIsScheduling(true);
    try {
      await api.post(
        '/api/citas/agendar',
        {
          pacienteId,
          valoracionId, // Vincula la cita a la valoración de la cual se origina
          name: calcomData.name,
          email: calcomData.email,
          phone: calcomData.phone,
          eventTypeId: calcomData.eventTypeId,
          modalidad: calcomData.modalidad,
          fecha: calcomData.fecha
        },
        {
          timeout: APPOINTMENT_REQUEST_TIMEOUT_MS,
          skipRetry: true
        }
      );
      toast({ title: 'Cita agendada correctamente', description: 'El paciente recibirá una invitación por correo.' });
      setCalcomData(null);

      // Refrescar valoración Y citas del paciente
      const [valRes] = await Promise.all([
        api.get(`/api/pacientes/${pacienteId}/valoraciones/${valoracionId}`),
        fetchPacienteCitas(),
      ]);
      setVal(valRes.data?.data || valRes.data);

    } catch (err: any) {
      const failureCopy = getBookingFailureCopy(err);
      toast({
        title: failureCopy.title,
        description: failureCopy.description,
        variant: 'destructive',
        duration: 8000
      });
    } finally {
      setIsScheduling(false);
    }
  };

  // A1: Soft delete de la consulta
  const handleSoftDelete = async () => {
    setDeletingConsulta(true);
    try {
      await api.delete(`/api/pacientes/${pacienteId}/valoraciones/${valoracionId}`);
      toast({ title: 'Consulta eliminada', description: 'El registro fue archivado correctamente.' });
      navigate(`/pacientes/${pacienteId}`);
    } catch (err: any) {
      toast({
        title: 'Error al eliminar',
        description: err.response?.data?.error || 'No se pudo archivar la consulta.',
        variant: 'destructive'
      });
    } finally {
      setDeletingConsulta(false);
      setShowDeleteConfirm(false);
    }
  };

  const handleGuardarBarrido = async () => {
    if (!barridoData) return;
    setSavingBarrido(true);
    try {
      await api.post(
        `/api/pacientes/${pacienteId}/valoraciones/${valoracionId}/barrido`,
        barridoData
      );
      setInitialBarridoData(JSON.stringify(barridoData));
      toast({ title: 'Barrido guardado correctamente' });
    } catch (err: any) {
      toast({
        title: 'Error al guardar',
        description: err.response?.data?.message || 'No se pudo guardar el barrido.',
        variant: 'destructive',
      });
    } finally {
      setSavingBarrido(false);
    }
  };

  if (loading) return (
    <div className="min-h-screen flex flex-col items-center justify-center">
      <NutritionLoader text="Cargando valoración..." />
    </div>
  );

  if (!val) return (
    <div className="min-h-screen flex flex-col items-center justify-center p-10 text-center">
      <h1 className="text-[20px] font-bold text-text-primary m-0 mb-6">Registro no localizado</h1>
      <button
        onClick={() => navigate(`/pacientes/${pacienteId}`)}
        className="px-[18px] py-[10px] bg-bg-surface border border-border-subtle text-text-primary hover:bg-bg-elevated text-[14px] font-medium rounded-[8px] transition-colors"
      >
        Volver al expediente
      </button>
    </div>
  );

  // IMC: validar que sea fisiológicamente posible (10–70).
  // Si el valor guardado es imposible, intentar recalcular desde peso y estatura.
  const imcRaw = parseFloat(val.imc) || 0;
  const imcNum = (() => {
    if (imcRaw >= 10 && imcRaw <= 70) return imcRaw;  // valor válido en BD
    // Intentar recalcular (el valor guardado era corrupto)
    const pesoKg = parseFloat(val.pesoActual || val.peso);
    const estatCm = parseFloat(val.estatura || val.talla);
    if (!pesoKg || !estatCm) return 0;
    const hm = estatCm < 3 ? estatCm : estatCm / 100;  // auto-detectar metros/cm
    const calc = pesoKg / (hm * hm);
    return calc >= 10 && calc <= 70 ? calc : 0;  // si sigue mal, mostrar —
  })();

  // Formato: 2 decimales para precisión
  const imcDisplay = imcNum > 0 ? imcNum.toFixed(2) : '—';
  const measurementText = (key: string, value: unknown, unit = '') => {
    if (val.medicionesEstado?.[key] === 'NO_APLICA') return 'No aplica';
    return value != null && value !== '' ? `${value}${unit}` : '—';
  };
  const isOnlineAssessment = val.medicionesEstado?.consultaEnLinea === true;

  const pacienteNombreCompleto = `${val.paciente?.nombre || ''} ${val.paciente?.apellido || ''}`.trim();
  const alimentosAEvitar = buildAvoidFoods(val?.evitar, pacienteInfo?.antecedentes?.alimentosNoGustan);
  const tiemposNombres = barridoData?.tiempos?.map((t) => t.nombre).filter(Boolean);

  return (
    <div className="flex gap-6 items-start">
    <div className="space-y-8 animate-fade-in pb-20 w-full min-w-0 flex-1">
      {ConfirmDialogComponent}

      {/* A1: Modal confirmación soft delete */}
      {showDeleteConfirm && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4 animate-fade-in">
          <div className="bg-[#111] border border-[#2e1a1a] rounded-[16px] p-8 max-w-sm w-full shadow-2xl text-center">
            <div className="w-14 h-14 rounded-full bg-[#2e1a1a] flex items-center justify-center mx-auto mb-5">
              <Trash2 className="w-6 h-6 text-accent-red" />
            </div>
            <h3 className="text-[18px] font-bold text-white m-0 mb-2">¿Archivar esta consulta?</h3>
            <p className="text-[13px] text-[#8a8a8a] mb-6 leading-relaxed">
              La consulta #{val.numeroValoracion} quedará oculta del expediente. Los datos se conservan y pueden recuperarse si es necesario.
            </p>
            <div className="flex flex-col gap-3">
              <button
                onClick={handleSoftDelete}
                disabled={deletingConsulta}
                className="w-full py-3 bg-accent-red text-white rounded-[10px] text-[14px] font-bold hover:bg-red-700 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {deletingConsulta ? <div className="w-4 h-4 border-2 border-white/20 border-t-white rounded-full animate-spin" /> : <Trash2 className="w-4 h-4" />}
                Sí, archivar consulta
              </button>
              <button
                onClick={() => setShowDeleteConfirm(false)}
                className="w-full py-3 bg-[#1a1a1a] text-[#8a8a8a] border border-[#333] rounded-[10px] text-[14px] font-medium hover:text-white transition-colors"
              >
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* HEADER */}
      <header className="flex flex-col md:flex-row justify-between items-start md:items-end gap-6 pt-6 pb-6 border-b border-border-subtle">
        <div className="space-y-2">
          <div className="flex items-center gap-4 mb-4">
            <button
              onClick={() => navigate(`/pacientes/${pacienteId}`)}
              className="flex items-center gap-2 text-[14px] font-medium text-text-secondary hover:text-text-primary transition-colors group"
            >
              <ArrowLeft className="h-[18px] w-[18px] group-hover:-translate-x-1 transition-transform" /> Volver al expediente
            </button>
          </div>
          <div className="animate-slide-up space-y-1">
            <div className="flex items-center gap-2 mb-2">
              <span className="px-2.5 py-1 bg-[#1a2e1a] text-accent-green rounded-[6px] text-[12px] font-medium">
                Historial Clínico
              </span>
              <span className={`px-2.5 py-1 rounded-[6px] text-[12px] font-medium border ${val.medicionesEstado?.consultaEnLinea === true ? 'border-blue-500/30 bg-blue-500/10 text-blue-300' : 'border-[#333] bg-[#181818] text-[#999]'}`}>
                {val.medicionesEstado?.consultaEnLinea === true
                  ? 'En línea'
                  : val.medicionesEstado?.consultaEnLinea === false
                    ? 'Presencial'
                    : 'Modalidad no registrada'}
              </span>
              <span className="text-text-muted text-[13px] font-normal">Consulta #{val.numeroValoracion || '—'}</span>
            </div>
            {val.paciente ? (
              <h1 className="text-[28px] font-bold text-text-primary tracking-tight m-0">
                {val.paciente.nombre} {val.paciente.apellido}
              </h1>
            ) : (
              <h1 className="text-[28px] font-bold text-text-primary tracking-tight m-0">Detalles de Consulta</h1>
            )}

            {val.paciente && (
              <p className="text-[18px] font-semibold text-text-primary mt-1 tracking-tight">
                Detalles de Consulta
              </p>
            )}

            <p className="text-text-secondary font-normal text-[14px] m-0 mt-2">
              {formatDate(val.fecha)} {val.hora ? `· ${val.hora}` : ''} · ID: {val.id?.slice(-12).toUpperCase()}
            </p>
          </div>
        </div>

        {/* A1: Acciones de la consulta */}
        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={() => navigate(`/pacientes/${pacienteId}/valoraciones/${valoracionId}/editar`)}
            className="flex items-center gap-2 px-4 py-2 bg-bg-elevated border border-border-subtle rounded-[8px] text-[13px] font-medium text-text-secondary hover:text-text-primary transition-colors"
          >
            <Edit2 className="w-4 h-4" /> Editar
          </button>
          <button
            onClick={() => setShowDeleteConfirm(true)}
            className="flex items-center gap-2 px-4 py-2 bg-[#1a0f0f] border border-accent-red/20 rounded-[8px] text-[13px] font-medium text-accent-red hover:bg-[#2e1a1a] transition-colors"
          >
            <Trash2 className="w-4 h-4" /> Archivar
          </button>
        </div>
      </header>

      {/* RESUMEN BÁSICO */}
      <div className="bg-bg-surface border border-border-subtle rounded-[12px] overflow-hidden">
        <div className={`grid grid-cols-1 ${isOnlineAssessment ? 'md:grid-cols-1' : 'md:grid-cols-3'} bg-bg-elevated border-b border-border-subtle p-6 md:p-8 gap-6`}>
          <div className="space-y-1">
            <p className="text-[12px] font-medium text-text-secondary m-0">Peso actual</p>
            <p className="text-[20px] font-bold text-text-primary m-0">
              {measurementText('peso', val.pesoActual ?? val.peso, ' kg')}
            </p>
          </div>
          {!isOnlineAssessment && (
            <>
              <div className="space-y-1">
                <p className="text-[12px] font-medium text-text-secondary m-0">Estatura</p>
                <p className="text-[20px] font-bold text-text-primary m-0">
                  {val.medicionesEstado?.estatura === 'NO_APLICA' ? 'No aplica' : (() => {
                    const raw = parseFloat(val.estatura || val.talla);
                    if (!raw) return '—';
                    return raw < 10 ? Math.round(raw * 100) : raw;
                  })()}{val.medicionesEstado?.estatura !== 'NO_APLICA' && (val.estatura || val.talla) ? <span className="text-[14px] font-medium text-text-muted ml-1">cm</span> : null}
                </p>
              </div>
              <div className="space-y-1">
                <p className="text-[12px] font-medium text-text-secondary m-0">IMC</p>
                <p className="text-[20px] font-bold m-0 text-text-primary">
                  {imcDisplay}
                </p>
              </div>
            </>
          )}
        </div>

        {isOnlineAssessment && (
          <div className="border-b border-border-subtle p-6 md:p-8">
            <p className="mb-5 text-[11px] font-bold uppercase tracking-widest text-text-muted">Medidas internas de consulta en línea</p>
            <div className="grid grid-cols-2 gap-6 md:grid-cols-4">
              {([
                ['Brazo relajado', val.perimetros?.brazoRelajado],
                ['Brazo contraído', val.perimetros?.brazoContraido],
                ['Cintura', val.perimetros?.cintura],
                ['Cadera', val.perimetros?.cadera],
              ] as [string, unknown][]).map(([label, value]) => (
                <div key={label} className="space-y-1">
                  <p className="m-0 text-[12px] font-medium text-text-secondary">{label}</p>
                  <p className="m-0 text-[18px] font-bold text-text-primary">
                    {value != null && value !== '' ? `${value} cm` : '—'}
                  </p>
                </div>
              ))}
            </div>
            <p className="mb-0 mt-4 text-[11px] text-text-muted">Información interna: estas medidas no se incluyen en el PDF del paciente.</p>
          </div>
        )}

        {!isOnlineAssessment && (val.pctGrasa || val.masaMagra || val.masaGrasaReal || Object.values(val.medicionesEstado || {}).includes('NO_APLICA')) && (
          <div className="grid grid-cols-2 md:grid-cols-3 p-6 md:p-8 gap-6 border-b border-border-subtle">
            {(val.pctGrasa || val.medicionesEstado?.pctGrasa === 'NO_APLICA') && (
              <div className="space-y-1">
                <p className="text-[12px] font-medium text-text-secondary m-0">% Grasa</p>
                <p className="text-[18px] font-bold text-text-primary m-0">{measurementText('pctGrasa', val.pctGrasa, '%')}</p>
              </div>
            )}
            {(val.masaGrasaReal || val.medicionesEstado?.kgGrasa === 'NO_APLICA') && (
              <div className="space-y-1">
                <p className="text-[12px] font-medium text-text-secondary m-0">Masa Grasa</p>
                <p className="text-[18px] font-bold text-text-primary m-0">
                  {measurementText('kgGrasa', val.masaGrasaReal, ' kg')}
                </p>
              </div>
            )}
            {(val.masaMagra || val.medicionesEstado?.masaMagra === 'NO_APLICA') && (
              <div className="space-y-1">
                <p className="text-[12px] font-medium text-text-secondary m-0">Masa Muscular</p>
                <p className="text-[18px] font-bold text-text-primary m-0">
                  {measurementText('masaMagra', val.masaMagra, ' kg')}
                </p>
              </div>
            )}
          </div>
        )}

        {(() => {
          if (isOnlineAssessment || pacienteInfo?.mostrarBioimpedancia === false) return null;
          const bio = val.bioimpedancia || {};
          const grasa = bio['Grasa %'];
          const agua = bio['Agua %'];
          const musculo = bio['Músculo (kg)'] ?? bio['Músculo %'];
          const energia = bio['Energía (kcal)'];
          const hasBio = [grasa, agua, musculo, energia].some(value => value != null && value !== '');
          if (!hasBio) return null;

          return (
            <div className="border-b border-border-subtle p-6 md:p-8">
              <p className="mb-5 text-[11px] font-bold uppercase tracking-widest text-text-muted">Resultados de bioimpedancia</p>
              <div className="grid grid-cols-2 gap-6 md:grid-cols-4">
                <div className="space-y-1">
                  <p className="m-0 text-[12px] font-medium text-text-secondary">Grasa corporal</p>
                  <p className="m-0 text-[18px] font-bold text-text-primary">{grasa ?? '—'}{grasa != null ? '%' : ''}</p>
                </div>
                <div className="space-y-1">
                  <p className="m-0 text-[12px] font-medium text-text-secondary">Agua corporal</p>
                  <p className="m-0 text-[18px] font-bold text-text-primary">{agua ?? '—'}{agua != null ? '%' : ''}</p>
                </div>
                <div className="space-y-1">
                  <p className="m-0 text-[12px] font-medium text-text-secondary">Músculo</p>
                  <p className="m-0 text-[18px] font-bold text-text-primary">{musculo ?? '—'}{musculo != null ? ' kg' : ''}</p>
                </div>
                <div className="space-y-1">
                  <p className="m-0 text-[12px] font-medium text-text-secondary">Energía</p>
                  <p className="m-0 text-[18px] font-bold text-text-primary">{energia ?? '—'}{energia != null ? ' kcal' : ''}</p>
                </div>
              </div>
            </div>
          );
        })()}

        {([
          ['Glucosa', val.glucosa],
          ['Triglicéridos', val.trigliceridos],
          ['Colesterol', val.colesterol],
          ['Creatinina', val.creatinina],
          ['Ácido úrico', val.acidoUrico],
        ] as const).some(([, value]) => value != null) || otrosBioquimicosFromValoracion(val).length > 0 ? (
          <div className="border-b border-border-subtle p-6 md:p-8">
            <p className="mb-5 text-[11px] font-bold uppercase tracking-widest text-text-muted">Bioquímica · Laboratorios</p>
            <div className="grid grid-cols-2 gap-6 md:grid-cols-3">
              {([
                ['Glucosa', val.glucosa],
                ['Triglicéridos', val.trigliceridos],
                ['Colesterol', val.colesterol],
                ['Creatinina', val.creatinina],
                ['Ácido úrico', val.acidoUrico],
              ] as const).filter(([, value]) => value != null).map(([label, value]) => (
                <div key={label} className="space-y-1">
                  <p className="m-0 text-[12px] font-medium text-text-secondary">{label}</p>
                  <p className="m-0 text-[18px] font-bold text-text-primary">{String(value)} mg/dL</p>
                </div>
              ))}
            </div>
            {otrosBioquimicosFromValoracion(val).length > 0 && (
              <div className="mt-5 space-y-1">
                <p className="m-0 text-[12px] font-medium text-text-secondary">Otros resultados</p>
                {otrosBioquimicosFromValoracion(val).map(item => (
                  <p key={item.id} className="m-0 text-[14px] text-text-primary">{item.nombre}: {item.valor}</p>
                ))}
              </div>
            )}
          </div>
        ) : null}

        {Array.isArray(val.dinamicaDeportiva?.disciplinas) && val.dinamicaDeportiva.disciplinas.length > 0 && (
          <div className="border-b border-border-subtle p-6 md:p-8">
            <p className="mb-3 text-[11px] font-bold uppercase tracking-widest text-text-muted">Dinámica deportiva</p>
            <p className="mb-4 text-[12px] text-text-secondary">Estado general: {val.dinamicaDeportiva.activo === false ? 'Pausado' : 'Activo'}</p>
            <div className="space-y-2">
              {val.dinamicaDeportiva.disciplinas.map((item: any, index: number) => (
                <div key={index} className="flex flex-wrap items-center justify-between gap-2 text-[13px]">
                  <span className="text-text-primary">{item.disciplina || 'Disciplina'} · {item.frecuencia || 'Sin frecuencia'} · {item.tiempo || 'Sin duración'}</span>
                  <span className={val.dinamicaDeportiva.activo === false || item.activo === false ? 'text-text-muted' : 'text-text-primary'}>{val.dinamicaDeportiva.activo === false || item.activo === false ? 'Pausada' : 'Activa'}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {val.comentarios && (
          <div className="p-6 md:p-8 border-b border-border-subtle">
            <p className="text-[12px] font-medium text-text-muted m-0 mb-2">Notas de consulta</p>
            <p className="text-[14px] leading-relaxed text-text-secondary font-normal m-0">{val.comentarios}</p>
          </div>
        )}

        {val.notasLibres && (
          <div className="p-6 md:p-8 border-b border-border-subtle">
            <p className="text-[12px] font-medium text-text-muted m-0 mb-2">Notas de Entrenamiento</p>
            <pre className="text-[13px] leading-relaxed text-text-secondary font-mono bg-bg-elevated/30 rounded-[8px] p-4 m-0 whitespace-pre-wrap overflow-x-auto">{val.notasLibres}</pre>
            {val.adjuntosJson && Array.isArray(val.adjuntosJson) && val.adjuntosJson.length > 0 && (
              <div className="mt-4 grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-3">
                {val.adjuntosJson.map((adj: any, i: number) => (
                  <div key={adj.id || i} className="rounded-[8px] overflow-hidden border border-border-subtle aspect-square">
                    <img src={adj.dataUrl} alt={adj.nombre} className="w-full h-full object-cover" />
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {val.temarioConsulta?.length > 0 && (() => {
          const COMP_MARKER = '__COMPETENCIA_NOTES__';
          const compItem = val.temarioConsulta.find((t: any) => t.tema === COMP_MARKER);
          const restItems = val.temarioConsulta.filter((t: any) => t.tema !== COMP_MARKER);
          let comp: { antes?: string; durante?: string; despues?: string } | null = null;
          if (compItem) {
            try { comp = JSON.parse(compItem.detalle || '{}'); } catch { comp = null; }
          }
          return (
            <>
              {restItems.length > 0 && (
                <div className="p-6 md:p-8 border-b border-border-subtle">
                  <div className="flex items-center gap-2 mb-6">
                    <div className="p-2 rounded-[8px] bg-bg-elevated text-text-muted">
                      <Brain className="h-4 w-4" />
                    </div>
                    <h3 className="text-[14px] font-semibold text-text-primary m-0">Notas en Consulta</h3>
                  </div>
                  <div className="space-y-4">
                    {restItems.map((tema: any, i: number) => (
                      <div key={tema.id || i} className="border-l-2 border-brand-primary pl-4 py-1">
                        <h4 className="text-[13px] font-semibold text-text-primary m-0 mb-1">{tema.tema}</h4>
                        <p className="text-[14px] text-text-secondary leading-relaxed m-0">{tema.detalle}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {comp && (comp.antes || comp.durante || comp.despues) && (
                <div className="p-6 md:p-8 border-b border-border-subtle">
                  <div className="flex items-center gap-2 mb-6">
                    <div className="p-2 rounded-[8px] bg-bg-elevated text-text-muted">
                      <Brain className="h-4 w-4" />
                    </div>
                    <h3 className="text-[14px] font-semibold text-text-primary m-0">Notas de Competencia</h3>
                  </div>
                  <div className="space-y-4">
                    {(['antes', 'durante', 'despues'] as const).map(fase => comp![fase] ? (
                      <div key={fase} className="border-l-2 border-brand-primary pl-4 py-1">
                        <h4 className="text-[13px] font-semibold text-text-primary m-0 mb-1 uppercase tracking-wider">
                          {fase === 'antes' ? 'Antes' : fase === 'durante' ? 'Durante' : 'Después'}
                        </h4>
                        <p className="text-[14px] text-text-secondary leading-relaxed m-0 whitespace-pre-wrap">{comp![fase]}</p>
                      </div>
                    ) : null)}
                  </div>
                </div>
              )}
            </>
          );
        })()}
      </div>

      {/* ESQUEMA DE SUPLEMENTACIÓN */}
      {val.suplementosDetalle && val.suplementosDetalle.length > 0 && (
        <div className="bg-bg-surface border border-border-subtle rounded-[12px] overflow-hidden animate-slide-up">
          <div className="flex items-center gap-3 p-6 border-b border-border-subtle">
            <div className="p-2 rounded-[8px] bg-brand-primary/10 text-brand-primary">
              <Activity className="w-4 h-4" />
            </div>
            <h3 className="text-[15px] font-bold text-text-primary m-0 uppercase tracking-wide">NORDER SUPS</h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-left min-w-[500px]">
              <thead>
                <tr className="bg-bg-elevated border-b border-border-subtle">
                  <th className="px-6 py-3 text-[11px] font-black text-text-muted uppercase tracking-widest w-[30%]">Suplemento</th>
                  <th className="px-6 py-3 text-[11px] font-black text-text-muted uppercase tracking-widest w-[40%]">Indicaciones</th>
                  <th className="px-6 py-3 text-[11px] font-black text-text-muted uppercase tracking-widest w-[30%] text-right">Tiempo de uso</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border-subtle">
                {[...val.suplementosDetalle]
                  .sort((a: any, b: any) => (b.activo ? 1 : 0) - (a.activo ? 1 : 0))
                  .map((sup: any, idx: number) => {
                    const endDate = sup.activo ? new Date() : (sup.fechaFin ? new Date(sup.fechaFin) : new Date());
                    const diasMs = endDate.getTime() - new Date(sup.fechaInicio).getTime();
                    const diasTotales = Math.max(0, Math.floor(diasMs / (1000 * 3600 * 24)));
                    const meses = Math.floor(diasTotales / 30);
                    const diasExtra = diasTotales % 30;
                    const tiempoStr = meses > 0
                      ? `${meses} mes${meses > 1 ? 'es' : ''}${diasExtra > 0 ? ` y ${diasExtra} d` : ''}`
                      : `${diasTotales} día${diasTotales !== 1 ? 's' : ''}`;

                    return (
                      <tr key={idx} className="group hover:bg-bg-elevated/50 transition-colors">
                        <td className="px-6 py-4 align-top">
                          <div className="flex items-start gap-2">
                            <div className={`mt-1.5 w-2 h-2 rounded-full shrink-0 ${sup.activo ? 'bg-accent-green' : 'bg-text-muted'}`} />
                            <div>
                              <span className={`text-[13px] font-bold leading-tight ${sup.activo ? 'text-text-primary' : 'text-text-muted line-through'}`}>
                                {sup.nombre}
                              </span>
                              <span className={`ml-2 text-[9px] font-black uppercase tracking-wider px-1.5 py-0.5 rounded-[4px] ${sup.activo
                                  ? 'bg-accent-green/10 text-accent-green border border-accent-green/20'
                                  : 'bg-bg-elevated text-text-muted border border-border-subtle'
                                }`}>
                                {sup.activo ? 'activo' : 'suspendido'}
                              </span>
                            </div>
                          </div>
                        </td>
                        <td className="px-6 py-4 align-top">
                          <p className="text-[12px] font-medium text-text-secondary m-0 leading-relaxed whitespace-pre-line">{sup.indicaciones}</p>
                        </td>
                        <td className="px-6 py-4 align-top text-right">
                          <div className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-brand-primary/10 rounded-[6px] border border-brand-primary/20">
                            <Clock className="w-3 h-3 text-brand-primary" />
                            <span className="text-[11px] font-bold uppercase tracking-wider text-brand-primary whitespace-nowrap">{tiempoStr}</span>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* BARRIDO DE EQUIVALENCIAS — componente compartido */}
      <div className="bg-bg-surface border border-border-subtle rounded-[12px] overflow-hidden">
        <div className="flex items-center gap-3 p-6 hover:bg-bg-elevated/50 transition-colors">
          <button
            type="button"
            onClick={() => setShowBarrido(!showBarrido)}
            className="flex min-w-0 flex-1 items-center justify-between text-left"
            aria-expanded={showBarrido}
          >
            <div className="flex min-w-0 items-center gap-3">
              <div className={`p-2 rounded-[8px] transition-all ${showBarrido ? 'bg-brand-primary/20 text-brand-primary' : 'bg-bg-elevated text-text-muted'}`}>
                <Layers className="w-4 h-4" />
              </div>
              <div className="min-w-0 text-left">
                <h3 className="text-[15px] font-semibold text-text-primary m-0">Barrido de Equivalencias</h3>
                <p className="text-[12px] text-text-muted m-0">
                  {barridoData ? `${Math.round(barridoData.kcalTotal || 0).toLocaleString()} kcal totales` : "Sin datos - haz clic para ingresar"}
                </p>
              </div>
            </div>
            {showBarrido ? <ChevronUp className="w-5 h-5 shrink-0 text-text-muted" /> : <ChevronDown className="w-5 h-5 shrink-0 text-text-muted" />}
          </button>

          <button
            type="button"
            onClick={() => setShowPreviousMenus((open) => !open)}
            disabled={!previousConsultationPlan}
            className="flex shrink-0 items-center gap-1.5 rounded-[7px] border border-[#333] bg-[#1b1b1b] px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-[#90c2ff] transition-colors hover:border-[#90c2ff]/50 hover:bg-[#90c2ff]/10 disabled:cursor-not-allowed disabled:opacity-35"
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

        {showBarrido && (
          <div className="p-6 border-t border-border-subtle animate-fade-in space-y-4">
            <BarridosEquivalenciasManager
              value={barridoData}
              onChange={(data) => setBarridoData(data)}
              habitos={assessmentDietetica}
            />
            {/* Botón "Guardar barrido" separado — POST upsert */}
            <div className="flex items-center justify-between pt-4 mt-2 border-t border-border-subtle">
              <div className="text-[12px] text-accent-red font-medium">
                {barridoData && getBarridoVariantes(barridoData).some(item => item.isValid === false) && (
                  <span className="flex items-center gap-1.5"><AlertCircle className="w-4 h-4" /> La distribución de comidas no de cuadra con las porciones planeadas.</span>
                )}
              </div>
              <button
                onClick={handleGuardarBarrido}
                disabled={savingBarrido
                  || (!!barridoData && getBarridoVariantes(barridoData).some(item => item.isValid === false))
                  || JSON.stringify(barridoData) === initialBarridoData}
                className="flex items-center gap-2 px-5 py-2.5 bg-brand-primary text-bg-base rounded-[8px] text-[13px] font-bold hover:bg-[#e0e0e0] transition-all disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {savingBarrido ? (
                  <div className="w-4 h-4 border-2 border-white/20 border-t-white dark:border-black/20 dark:border-t-black rounded-full animate-spin" />
                ) : (
                  <Check className="w-4 h-4" />
                )}
                Guardar barrido
              </button>
            </div>
          </div>
        )}
      </div>

      {/* PLAN ALIMENTICIO DE ESTA CONSULTA */}
      <div className="bg-bg-surface border border-border-subtle rounded-[12px] p-6 space-y-4">
        <div className="flex items-center gap-3 border-b border-border-subtle pb-4">
          <div className="p-2 rounded-[8px] bg-bg-elevated text-text-muted">
            <FileText className="w-4 h-4" />
          </div>
          <h3 className="text-[15px] font-semibold text-text-primary m-0">Menú de esta consulta</h3>
        </div>

        <PlanSection
          pacienteId={pacienteId!}
          valoracionId={valoracionId!}
          planLigado={val.plan || (val.planId ? { id: val.planId } : undefined)}
          hasEquivalencias={!!barridoData && ((barridoData.kcalTotal || 0) > 0 || Object.values(barridoData.porciones || {}).some((v: any) => Number(v) > 0))}
        />
      </div>

      {/* AGENDAR CITA DE SEGUIMIENTO */}
      <div className="bg-bg-surface border border-border-subtle rounded-[12px] p-6 space-y-4">
        {(() => {
          // val.paciente.citas ya viene filtrado por valoracionId desde el backend.
          // pacienteCitas es un fallback adicional por si acaso.
          const citasMap = new Map<string, any>();
          [...(val?.paciente?.citas || []), ...pacienteCitas].forEach((c: any) => {
            if (c?.id) citasMap.set(c.id, c);
          });
          const todasLasCitas = Array.from(citasMap.values());

          const citaDeEstaValoracion = todasLasCitas.find(
            (c: any) => c.valoracionId === valoracionId
          );

          if (citaDeEstaValoracion) {
            return (
              <div>
                <div className="flex items-center justify-between border-b border-border-subtle pb-4">
                  <div className="flex items-center gap-3">
                    <div className="p-2 rounded-[8px] bg-brand-primary/10 text-brand-primary">
                      <CalendarIcon className="w-4 h-4" />
                    </div>
                    <div>
                      <h3 className="text-[15px] font-semibold text-text-primary m-0">Seguimiento Programado</h3>
                      <p className="text-[12px] text-text-muted m-0 mt-0.5">Cita agendada para esta consulta</p>
                    </div>
                  </div>
                </div>
                <div className="mt-4 p-4 bg-bg-elevated rounded-[10px] border border-border-subtle">
                  <p className="text-[14px] font-medium text-text-primary m-0 opacity-80">Próxima sesión:</p>
                  <p className="text-[16px] font-bold text-brand-primary mt-1.5 mb-0">
                    {formatDate(citaDeEstaValoracion.fecha)} a las {new Date(citaDeEstaValoracion.fecha).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit', hour12: true })}
                  </p>
                  <p className="text-[13px] text-text-muted mt-1.5 mb-0 capitalize inline-block px-2 py-1 bg-bg-surface rounded-md border border-border-subtle">
                    Modalidad: {citaDeEstaValoracion.modalidad}
                  </p>
                </div>
              </div>
            );
          }

          return (
            <>
              <div className="flex items-center justify-between border-b border-border-subtle pb-4">
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-[8px] bg-bg-elevated text-text-muted">
                    <CalendarIcon className="w-4 h-4" />
                  </div>
                  <div>
                    <h3 className="text-[15px] font-semibold text-text-primary m-0">Agendar Seguimiento</h3>
                    <p className="text-[12px] text-text-muted m-0 mt-0.5">Envía una invitación formal al paciente usando Cal.com</p>
                  </div>
                </div>
              </div>

              <div className="pt-2">
                <CalcomScheduling
                  pacienteData={val?.paciente ? { nombre: val.paciente.nombre, apellido: val.paciente.apellido, email: val.paciente.email, telefono: val.paciente.telefono } : undefined}
                  onSelection={setCalcomData}
                />
              </div>

              {calcomData && (
                <div className="flex justify-end pt-4 border-t border-border-subtle mt-4">
                  <button
                    onClick={handleScheduleCita}
                    disabled={isScheduling}
                    className="flex items-center gap-2 px-6 py-2.5 bg-brand-primary text-bg-base rounded-[8px] text-[13px] font-bold hover:bg-[#e0e0e0] transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {isScheduling ? (
                      <div className="w-4 h-4 border-2 border-white/20 border-t-white dark:border-black/20 dark:border-t-black rounded-full animate-spin" />
                    ) : (
                      <Check className="w-4 h-4" />
                    )}
                    Confirmar y Enviar Invitación
                  </button>
                </div>
              )}
            </>
          );
        })()}
      </div>

    </div>

    {pacienteInfo && (
      <PacienteResumenSidebar
        className="hidden xl:block w-[260px] shrink-0 sticky top-[68px] self-start max-h-[calc(100vh-88px)] overflow-y-auto custom-scrollbar"
        pacienteNombre={pacienteNombreCompleto}
        pacienteInfo={pacienteInfo}
        alimentosAEvitar={alimentosAEvitar}
        tiemposNombres={tiemposNombres}
        suplementosDetalle={val.suplementosDetalle || []}
        comentarios={val.comentarios}
        esqueHidratacion={val.esqueHidratacion}
        notasLibres={val.notasLibres}
        mostrarTiemposComida
        reemplazarEjercicioPorGustan
      />
    )}
    </div>
  );
};

export default AssessmentDetail;
