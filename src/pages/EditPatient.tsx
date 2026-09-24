import { useEffect, useState, useMemo, useRef } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Save, User, Activity, Heart, Shield, Clock, BookOpen, Plus, Trash2 } from 'lucide-react';
import api from '@/lib/api';
import { useToast } from '@/hooks/use-toast';
import { useQueryClient } from '@tanstack/react-query';
import { invalidateAfterPacienteChange } from '@/lib/invalidation';
import { NutritionLoader } from '@/components/ui/NutritionLoader';
import { encodeDisciplinas, decodeDisciplinas, type DisciplinaItem } from '@/lib/disciplinas';
import { DEFAULT_RECALL_24, normalizeRecall24, type Recall24Row } from '@/lib/recall24';
import DietTable from '@/components/DietTable';

const Input = ({ label, value, onChange, placeholder, type = 'text', readOnly = false, inputRef }: any) => (
  <div className="space-y-2 group">
    <label className="text-[12px] font-medium text-text-secondary uppercase tracking-widest ml-1 leading-none">{label}</label>
    <input
      ref={inputRef}
      type={type}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      readOnly={readOnly}
      className={`w-full bg-bg-elevated rounded-[8px] px-4 py-3 text-[14px] font-normal text-text-primary tracking-tight outline-none focus:border-[#444] transition-all border border-border-subtle ${readOnly ? 'opacity-60 cursor-not-allowed' : 'hover:border-border-default'}`}
      placeholder={placeholder}
    />
  </div>
);

const LADAS = [
  { code: '52', label: '🇲🇽 +52 (MX)' },
  { code: '1', label: '🇺🇸 +1 (US/CA)' },
  { code: '33', label: '🇫🇷 +33 (FR)' },
  { code: '34', label: '🇪🇸 +34 (ES)' },
  { code: '54', label: '🇦🇷 +54 (AR)' },
  { code: '57', label: '🇨🇴 +57 (CO)' },
  { code: '56', label: '🇨🇱 +56 (CL)' },
  { code: '51', label: '🇵🇪 +51 (PE)' },
];

const PhoneInput = ({ label, ladaValue, onLadaChange, phoneValue, onPhoneChange, placeholder }: any) => (
  <div className="space-y-2 group">
    <label className="text-[12px] font-medium text-text-secondary uppercase tracking-widest ml-1 leading-none">{label}</label>
    <div className="flex gap-2">
      <select
        value={ladaValue}
        onChange={(e) => onLadaChange(e.target.value)}
        className="w-[120px] bg-bg-elevated rounded-[8px] px-2 py-3 text-[14px] font-normal text-text-primary tracking-tight outline-none focus:border-[#444] transition-all border border-border-subtle hover:border-border-default appearance-none cursor-pointer text-center"
      >
        {LADAS.map(l => <option key={l.code} value={l.code}>{l.label}</option>)}
      </select>
      <input
        type="tel"
        value={phoneValue}
        onChange={(e) => onPhoneChange(e.target.value)}
        className="flex-1 bg-bg-elevated rounded-[8px] px-4 py-3 text-[14px] font-normal text-text-primary tracking-tight outline-none focus:border-[#444] transition-all border border-border-subtle hover:border-border-default"
        placeholder={placeholder}
      />
    </div>
  </div>
);

const Select = ({ label, value, onChange, options }: any) => (
  <div className="space-y-2 group">
    <label className="text-[12px] font-medium text-text-secondary uppercase tracking-widest ml-1 leading-none">{label}</label>
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="w-full bg-bg-elevated rounded-[8px] px-4 py-3 text-[14px] font-normal text-text-primary tracking-tight outline-none focus:border-[#444] transition-all border border-border-subtle hover:border-border-default appearance-none cursor-pointer"
      style={{ backgroundImage: 'url("data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' fill=\'none\' viewBox=\'0 0 24 24\' stroke=\'%238a8a8a\'%3E%3Cpath stroke-linecap=\'round\' stroke-linejoin=\'round\' stroke-width=\'2\' d=\'M19 9l-7 7-7-7\' /%3E%3C/svg%3E")', backgroundRepeat: 'no-repeat', backgroundPosition: 'right 1rem center', backgroundSize: '1rem' }}
    >
      {options.map((o: string) => <option key={o} value={o}>{o}</option>)}
    </select>
  </div>
);

const TextArea = ({ label, value, onChange, placeholder }: any) => (
  <div className="space-y-2 col-span-full group">
    <label className="text-[12px] font-medium text-text-secondary uppercase tracking-widest ml-1 leading-none">{label}</label>
    <textarea
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="w-full bg-bg-elevated rounded-[8px] p-4 text-[14px] font-normal text-text-primary tracking-tight outline-none focus:border-[#444] transition-all border border-border-subtle hover:border-border-default min-h-[120px] resize-y"
      placeholder={placeholder}
    />
  </div>
);

const FormSection = ({ title, icon: Icon, children }: { title: string, icon: any, children: React.ReactNode }) => (
  <div className="bg-bg-surface p-8 rounded-[12px] border border-border-subtle shadow-none animate-slide-up">
    <div className="flex items-center gap-3 mb-8 border-b border-border-subtle pb-4">
      <div className="p-2 bg-bg-elevated border border-border-default rounded-[8px]">
        <Icon className="h-[18px] w-[18px] text-text-secondary" />
      </div>
      <h3 className="text-[16px] font-semibold text-text-primary m-0">
        {title}
      </h3>
    </div>
    <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
      {children}
    </div>
  </div>
);

const EditPatient = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [suplementosIniciales, setSuplementosIniciales] = useState<{ id: string; nombre: string; indicaciones: string; activo: boolean }[]>([]);
  const [habitos, setHabitos] = useState<Recall24Row[]>(DEFAULT_RECALL_24.map((row) => ({ ...row })));

  const [form, setForm] = useState({
    nombre: '', apellido: '', lada: '52', telefono: '', email: '',
    fechaNacimiento: '', sexo: 'F' as 'M' | 'F',
    objetivo: '', gymOrigen: '', horaEntrenamiento: '',
    nivelActividad: 'Sedentario',
    porcentajeSedentario: '', porcentajeLeve: '', porcentajeModerado: '', porcentajeIntenso: '',
    historialProductos: '', recomSuplementos: '', // legacy — ya no se usan en UI, se mantienen por compat
    alimentosNoGusta: '', alimentosGusta: '', alergico: '',
    patologia: '', cirugias: '', farmacos: '', cicloMenstrual: '', estrenimiento: 'No',
    alcohol: 'No', tabaco: 'No', agua: '',
    signosSintomas: '',
    talla: '',
    peso: '',
    complexion: '',
  });

  useEffect(() => {
    const fetchPatient = async () => {
      try {
        const { data } = await api.get(`/api/pacientes/${id}`);
        const p = data?.data || data;
        if (p) {
          const ej = p.ejercicio || p.datosEjercicio || {};
          const ant = p.antecedentes || {};
          const hab = p.habitos || p.consumoCalorico || {};
          setHabitos(normalizeRecall24(hab));

          setForm({
            nombre: p.nombre || '',
            apellido: p.apellido || '',
            // parse lada from stored number (e.g. "529993670065" -> lada="52", telefono="9993670065")
            ...(() => {
              const raw = (p.telefono || '').replace(/\D/g, '');
              const knownLadas = ['52', '1', '33', '34', '54', '57', '56', '51'];
              const matched = knownLadas.find(l => raw.startsWith(l));
              return matched
                ? { lada: matched, telefono: raw.slice(matched.length) }
                : { lada: '52', telefono: raw };
            })(),
            email: p.email || '',
            fechaNacimiento: p.fechaNacimiento ? p.fechaNacimiento.split('T')[0] : '',
            sexo: p.sexo || 'F',
            talla: (() => {
              const raw = parseFloat(p.estatura || p.talla || '0');
              if (!raw) return '';
              return String(raw < 10 ? Math.round(raw * 100) : raw);
            })(),
            peso: (() => {
              // Prioridad 1: pesoActual de la última valoración
              const pesoValoracion = p.ultimaValoracion?.pesoActual;
              if (pesoValoracion != null && pesoValoracion !== '') return pesoValoracion.toString();
              // Prioridad 2: peso guardado en el expediente del paciente
              if (p.peso != null && p.peso !== '') return p.peso.toString();
              return '';
            })(),

            objetivo: ej.objetivo || '',
            gymOrigen: ej.gymOrigen || '',
            horaEntrenamiento: ej.horaEntrenamiento || '',
            nivelActividad: ej.nivelActividad || 'Sedentario',
            porcentajeSedentario: ej.porcentajeSedentario?.toString() || '',
            porcentajeLeve: ej.porcentajeLeve?.toString() || '',
            porcentajeModerado: ej.porcentajeModerado?.toString() || '',
            porcentajeIntenso: ej.porcentajeIntenso?.toString() || '',


            historialProductos: ant.historialProductos || '',
            recomSuplementos: ant.recomendacionSuplementos || ant.recomSuplementos || '',
            alimentosNoGusta: ant.alimentosNoGustan || ant.alimentosNoGusta || '',
            alimentosGusta: ant.alimentosGustan || ant.alimentosGusta || '',
            alergico: ant.alergias || ant.alergico || '',
            patologia: ant.patologia || '',
            cirugias: ant.cirugias || '',
            farmacos: ant.farmacos || '',
            cicloMenstrual: ant.cicloMenstrual || '',
            estrenimiento: ant.estrenimiento || 'No',
            alcohol: ant.consumoAlcohol || ant.alcohol || 'No',
            tabaco: ant.tabaco || 'No',
            agua: ant.agua || '',
            signosSintomas: ant.signosYSintomas || ant.signosSintomas || '',
            complexion: (() => {
              const c = p.complexion;
              if (c == 1) return 'Ectomorfo';
              if (c == 2) return 'Mesomorfo';
              if (c == 3) return 'Endomorfo';
              return '';
            })(),
          });
          setDisciplinas(decodeDisciplinas(ej.disciplina, { frecuencia: ej.frecuencia, tiempo: ej.tiempo }, ej.disciplinasDetalle));
          if (ant.suplementosDetalle && Array.isArray(ant.suplementosDetalle)) {
            setSuplementosIniciales(ant.suplementosDetalle.map((s: any) => ({ ...s, id: s.id || Math.random().toString() })));
          }
        }
      } catch (err) {
        toast({ title: 'Error', description: 'No se pudo cargar la información del paciente', variant: 'destructive' });
      } finally {
        setLoading(false);
      }
    };
    fetchPatient();
  }, [id, toast]);

  const update = (field: string, value: any) => setForm({ ...form, [field]: value });

  const [disciplinas, setDisciplinas] = useState<DisciplinaItem[]>([{ disciplina: '', frecuencia: '', tiempo: '', activo: true }]);
  const firstDisciplinaInputRef = useRef<HTMLInputElement>(null);
  const addDisciplina = () => {
    setDisciplinas(prev => [{ disciplina: '', frecuencia: '', tiempo: '', activo: true }, ...prev]);
    requestAnimationFrame(() => firstDisciplinaInputRef.current?.focus());
  };
  const removeDisciplina = (idx: number) => setDisciplinas(disciplinas.length > 1 ? disciplinas.filter((_, i) => i !== idx) : disciplinas);
  const updateDisciplina = (idx: number, field: 'disciplina' | 'frecuencia' | 'tiempo', val: string) =>
    setDisciplinas(disciplinas.map((d, i) => i === idx ? { ...d, [field]: val } : d));

  const edad = useMemo(() => {
    if (!form.fechaNacimiento) return 0;
    const birth = new Date(form.fechaNacimiento);
    const today = new Date();
    let age = today.getFullYear() - birth.getFullYear();
    const m = today.getMonth() - birth.getMonth();
    if (m < 0 || (m === 0 && today.getDate() < birth.getDate())) age--;
    return age;
  }, [form.fechaNacimiento]);

  const handleSave = async () => {
    if (!form.nombre || !form.apellido || !form.telefono) {
      toast({ title: 'Error de Validación', description: 'Nombre, apellido y teléfono son requeridos.', variant: 'destructive' });
      return;
    }
    setSaving(true);

    const payload = {
      nombre: form.nombre,
      apellido: form.apellido,
      telefono: form.lada + form.telefono.replace(/\D/g, ''),
      email: form.email,
      fechaNacimiento: form.fechaNacimiento,
      sexo: form.sexo,
      edad,
      estatura: form.talla,
      peso: parseFloat(form.peso) || null,
      complexion: form.complexion === 'Ectomorfo' ? 1
        : (form.complexion === 'Mesomorfo' || form.complexion === 'Mesomorfico') ? 2
          : form.complexion === 'Endomorfo' ? 3 : null,

      ejercicio: {
        objetivo: form.objetivo,
        gymOrigen: form.gymOrigen,
        horaEntrenamiento: form.horaEntrenamiento,
        ...encodeDisciplinas(disciplinas),
        nivelActividad: form.nivelActividad,
        porcentajeSedentario: parseFloat(form.porcentajeSedentario) || 0,
        porcentajeLeve: parseFloat(form.porcentajeLeve) || 0,
        porcentajeModerado: parseFloat(form.porcentajeModerado) || 0,
        porcentajeIntenso: parseFloat(form.porcentajeIntenso) || 0,
      },

      antecedentes: {
        patologia: form.patologia,
        cirugias: form.cirugias,
        farmacos: form.farmacos,
        cicloMenstrual: form.cicloMenstrual,
        alergias: form.alergico,
        alimentosGustan: form.alimentosGusta,
        alimentosNoGustan: form.alimentosNoGusta,
        estrenimiento: form.estrenimiento,
        signosYSintomas: form.signosSintomas,
        consumoAlcohol: form.alcohol,
        tabaco: form.tabaco,
        agua: form.agua,
        suplementosDetalle: suplementosIniciales.filter(s => s.nombre.trim())
      },
      habitos,
    };

    try {
      await api.put(`/api/pacientes/${id}`, payload);
      invalidateAfterPacienteChange(queryClient, id);
      toast({ title: 'Expediente actualizado correctamente' });
      navigate(`/pacientes/${id}`);
    } catch (err: any) {
      const msg = err.response?.data?.error || err.response?.data?.message || err.message || '';
      if (err.response?.status === 409 || msg.toLowerCase().includes('teléfono') || msg.toLowerCase().includes('telefono') || msg.toLowerCase().includes('correo') || msg.toLowerCase().includes('email')) {
        toast({ title: 'Dato Duplicado', description: msg, variant: 'destructive', duration: 8000 });
      } else {
        toast({ title: 'Error de Sistema', description: msg || 'No se pudo actualizar el expediente.', variant: 'destructive' });
      }
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center h-[calc(100vh-120px)]">
        <NutritionLoader text="Cargando expediente para edición..." />
      </div>
    );
  }

  return (
    <div className="space-y-10 animate-fade-in max-w-none pb-24">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-end gap-6 pt-6">
        <div className="space-y-2">
          <button onClick={() => navigate(`/pacientes/${id}`)} className="flex items-center gap-2 text-[14px] font-medium text-text-secondary hover:text-text-primary transition-colors w-fit group mb-4">
            <ArrowLeft className="h-[18px] w-[18px] group-hover:-translate-x-1 transition-transform" /> Volver al perfil
          </button>
          <div className="space-y-1">
            <h1 className="text-[26px] font-bold text-text-primary m-0 tracking-tight">Editar Expediente</h1>
            <p className="text-text-secondary font-normal text-[14px] m-0">Actualización de datos de paciente</p>
          </div>
        </div>
      </div>

      <div className="space-y-8">
        <FormSection title="Identificación del Paciente" icon={User}>
          <Input label="Nombre(s) *" value={form.nombre} onChange={(v: string) => update('nombre', v)} placeholder="Juan Manuel" />
          <Input label="Apellidos *" value={form.apellido} onChange={(v: string) => update('apellido', v)} placeholder="González" />
          <Input label="Fecha de Nacimiento" value={form.fechaNacimiento} onChange={(v: string) => update('fechaNacimiento', v)} type="date" />
          <Input label="E-mail" value={form.email} onChange={(v: string) => update('email', v)} placeholder="paciente@ejemplo.com" />
          <PhoneInput label="Teléfono (Lada + Número) *" ladaValue={form.lada} onLadaChange={(v: string) => update('lada', v)} phoneValue={form.telefono} onPhoneChange={(v: string) => update('telefono', v)} placeholder="999 000 0000" />
          <div className="space-y-2">
            <label className="text-[12px] font-medium text-text-secondary uppercase tracking-widest ml-1 leading-none">Edad (Cálculo)</label>
            <div className="bg-bg-elevated rounded-[8px] px-4 py-3 text-[14px] font-normal text-text-muted border border-border-subtle flex items-center justify-between">
              {edad} Años <Clock className="h-[18px] w-[18px] text-text-muted" />
            </div>
          </div>
          <Select label="Sexo Biológico" value={form.sexo} onChange={(v: string) => update('sexo', v)} options={['F', 'M']} />
          <Input label="Estatura (cm)" value={form.talla} onChange={(v: string) => update('talla', v)} placeholder="175" />
          <Input label="Peso Actual (kg)" value={form.peso} onChange={(v: string) => update('peso', v)} placeholder="70.5" type="number" />
          <Select label="Somatotipo" value={form.complexion} onChange={(v: string) => update('complexion', v)} options={['', 'Ectomorfo', 'Mesomorfo', 'Endomorfo']} />
        </FormSection>

        <FormSection title="Dinámica Deportiva" icon={Activity}>
          <Input label="Objetivo" value={form.objetivo} onChange={(v: string) => update('objetivo', v)} placeholder="Recomposición corporal" />
          <Input label="Gimnasio de Origen" value={form.gymOrigen} onChange={(v: string) => update('gymOrigen', v)} placeholder="Nombre del club" />
          <Input label="Hora de Entrenamiento" value={form.horaEntrenamiento} onChange={(v: string) => update('horaEntrenamiento', v)} placeholder="Ej: 7:00am / Tarde" />
          <div className="col-span-full space-y-3">
            <div className="flex flex-col items-start gap-2">
              <label className="text-[12px] font-medium text-text-secondary uppercase tracking-widest ml-1">Disciplinas</label>
              <button
                type="button"
                onClick={addDisciplina}
                className="flex items-center gap-1 text-[11px] font-bold text-text-secondary hover:text-text-primary bg-bg-elevated border border-border-subtle hover:border-border-default px-3 py-1.5 rounded-[6px] uppercase tracking-wider transition-colors"
              >
                <Plus className="w-3 h-3" /> Agregar disciplina
              </button>
            </div>
            {disciplinas.map((d, idx) => (
              <div key={idx} className="grid sm:grid-cols-3 gap-3 items-end p-3 bg-bg-elevated/40 border border-border-subtle rounded-[8px] relative">
                <Input inputRef={idx === 0 ? firstDisciplinaInputRef : undefined} label={`Disciplina ${disciplinas.length > 1 ? idx + 1 : ''}`} value={d.disciplina} onChange={(v: string) => updateDisciplina(idx, 'disciplina', v)} placeholder="Crossfit / Pesas / Correr" />
                <Input label="Frecuencia" value={d.frecuencia} onChange={(v: string) => updateDisciplina(idx, 'frecuencia', v)} placeholder="EJ: 5 días a la semana" />
                <div className="flex gap-2 items-end">
                  <div className="flex-1">
                    <Input label="Duración" value={d.tiempo} onChange={(v: string) => updateDisciplina(idx, 'tiempo', v)} placeholder="EJ: 60-90 min" />
                  </div>
                  {disciplinas.length > 1 && (
                    <button
                      type="button"
                      onClick={() => removeDisciplina(idx)}
                      className="p-3 text-text-muted hover:text-accent-red rounded-[8px] hover:bg-bg-elevated transition-colors"
                      title="Eliminar disciplina"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>

        </FormSection>

        <FormSection title="Anamnesis y Suplementación" icon={Shield}>
          <div className="col-span-full space-y-3">
            <label className="text-[12px] font-medium text-text-secondary uppercase tracking-widest ml-1 leading-none block">
              Suplementos Actuales del Paciente
            </label>
            <div className="bg-[#111111] border border-[#2a2a2a] rounded-[12px] p-4 space-y-2">
              {suplementosIniciales.length > 0 && (
                <div className="grid grid-cols-[1.5fr_2fr_48px_40px] gap-3 items-center px-2 py-1 text-[10px] font-bold text-[#8a8a8a] uppercase tracking-widest border-b border-[#2a2a2a] mb-2">
                  <div>Suplemento</div><div>Indicaciones / Dosis</div><div className="text-center">Activo</div><div></div>
                </div>
              )}
              <div className="flex justify-start pb-1">
                <button type="button"
                  onClick={() => setSuplementosIniciales([{ id: Date.now().toString(), nombre: '', indicaciones: '', activo: true }, ...suplementosIniciales])}
                  className="flex items-center gap-2 text-[12px] font-bold text-[#0a0a0a] bg-[#f0f0f0] hover:bg-white px-4 py-2 rounded-[8px] transition-colors uppercase tracking-wider">
                  <Plus className="w-4 h-4" /> Agregar Suplemento
                </button>
              </div>
              <div className="space-y-2 max-h-[200px] overflow-y-auto">
                {suplementosIniciales.map((sup, idx) => (
                  <div key={sup.id} className="grid grid-cols-[1.5fr_2fr_48px_40px] gap-3 items-center bg-[#181818] p-3 rounded-[8px] border border-[#2a2a2a] animate-fade-in">
                    <input type="text" value={sup.nombre}
                      onChange={(e) => { const a = [...suplementosIniciales]; a[idx] = { ...a[idx], nombre: e.target.value }; setSuplementosIniciales(a); }}
                      placeholder="Ej. Creatina"
                      className="w-full bg-transparent text-[13px] font-semibold text-white outline-none placeholder-[#555] p-1 border-b border-transparent focus:border-[#444] transition-colors" />
                    <input type="text" value={sup.indicaciones}
                      onChange={(e) => { const a = [...suplementosIniciales]; a[idx] = { ...a[idx], indicaciones: e.target.value }; setSuplementosIniciales(a); }}
                      placeholder="Ej. 5g pre-entreno"
                      className="w-full bg-transparent text-[13px] text-[#c0c0c0] outline-none placeholder-[#555] p-1 border-b border-transparent focus:border-[#444] transition-colors" />
                    <div className="flex justify-center">
                      <button type="button"
                        onClick={() => { const a = [...suplementosIniciales]; a[idx] = { ...a[idx], activo: !a[idx].activo }; setSuplementosIniciales(a); }}
                        className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${sup.activo ? 'bg-accent-green' : 'bg-[#333]'}`}>
                        <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${sup.activo ? 'translate-x-4' : 'translate-x-1'}`} />
                      </button>
                    </div>
                    <button type="button" onClick={() => setSuplementosIniciales(suplementosIniciales.filter((_, i) => i !== idx))}
                      className="p-2 text-[#555] hover:text-[#ff6b6b] hover:bg-[#ff6b6b]/10 rounded-[6px] transition-colors flex justify-center items-center">
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                ))}
                {suplementosIniciales.length === 0 && <p className="text-[12px] text-[#8a8a8a] text-center py-4">Sin suplementos registrados.</p>}
              </div>
            </div>
          </div>
        </FormSection>

        <FormSection title="Perfil Clínico" icon={Heart}>
          <Input label="Patologías" value={form.patologia} onChange={(v: string) => update('patologia', v)} placeholder="Diabetes, Hipertensión..." />
          <Input label="Cirugías o Traumas" value={form.cirugias} onChange={(v: string) => update('cirugias', v)} placeholder="Ninguna" />
          <Input label="Fármacos / Medicamentos" value={form.farmacos} onChange={(v: string) => update('farmacos', v)} placeholder="Metformina 500mg, Eutirox..." />
          <Input label="Ciclo Menstrual" value={form.cicloMenstrual} onChange={(v: string) => update('cicloMenstrual', v)} placeholder="Regular / Irregular / N/A" />
          <Select label="Tránsito Intestinal" value={form.estrenimiento} onChange={(v: string) => update('estrenimiento', v)} options={['No', 'Leve', 'Frecuente']} />
          <Select label="Consumo de Alcohol" value={form.alcohol} onChange={(v: string) => update('alcohol', v)} options={['No', 'Social', 'Frecuente']} />
          <Select label="Hábito Tabáquico" value={form.tabaco} onChange={(v: string) => update('tabaco', v)} options={['No', 'Ocasional', 'Frecuente']} />
          <Input label="Ingesta de Agua (L)”" value={form.agua} onChange={(v: string) => update('agua', v)} placeholder="Ej. 2.5 Lts" />
          <TextArea label="Signos y Síntomas Adicionales" value={form.signosSintomas} onChange={(v: string) => update('signosSintomas', v)} placeholder="Cansancio crónico, dolor de cabeza..." />
        </FormSection>

        <FormSection title="Recordatorio 24 Horas" icon={Clock}>
          <div className="col-span-full space-y-4">
            <p className="text-[13px] text-text-secondary m-0">Registro de horarios y alimentos del paciente. Esta información pertenece únicamente al expediente.</p>
            <div className="flex justify-start">
              <button
                type="button"
                onClick={() => setHabitos((rows) => [{ id: `diet-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, label: '', hora: '', notas: '' }, ...rows])}
                className="flex items-center gap-1.5 text-[11px] font-bold text-text-secondary hover:text-text-primary bg-bg-elevated border border-border-subtle hover:border-border-default px-3 py-1.5 rounded-[6px] uppercase tracking-wider transition-colors shrink-0"
              >
                <Plus className="w-3 h-3" /> Agregar tiempo
              </button>
            </div>
              <DietTable habitos={habitos} setHabitos={setHabitos} variant="default" />
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <Input label="Alergias" value={form.alergico} onChange={(v: string) => update('alergico', v)} placeholder="Ej. Nueces, Mariscos, Lactosa" />
              <Input label="Aversiones (No Gusta)" value={form.alimentosNoGusta} onChange={(v: string) => update('alimentosNoGusta', v)} placeholder="Ej. Pescado, Brócoli" />
            </div>
          </div>
        </FormSection>

      </div>

      {/* Barra guardar sticky */}
      <div className="sticky -bottom-6 -ml-3 sm:-ml-4 md:-ml-6 lg:-ml-8 -mr-3 sm:-mr-4 md:-mr-6 lg:-mr-[37px] pl-3 sm:pl-4 md:pl-6 lg:pl-8 pr-3 sm:pr-4 md:pr-6 lg:pr-[37px] pt-3 pb-9 bg-[#0a0a0a]/95 backdrop-blur-md border-t border-[#1a1a1a] flex items-center justify-between z-20">
        <p className="text-[13px] text-text-muted hidden sm:block">Revisa los datos antes de guardar</p>
        <button
          onClick={handleSave}
          disabled={saving}
          className="flex items-center gap-2 bg-brand-primary text-bg-base px-[24px] py-[11px] rounded-[8px] text-[14px] font-bold transition-colors hover:bg-[#e0e0e0] disabled:opacity-50 ml-auto"
        >
          {saving ? <div className="w-[18px] h-[18px] border-2 border-black/20 border-t-black rounded-full animate-spin" /> : <Save className="h-[18px] w-[18px]" />}
          {saving ? 'Guardando...' : 'Actualizar información'}
        </button>
      </div>
    </div>
  );
};

export default EditPatient;
