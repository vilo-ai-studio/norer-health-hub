import { useState, useEffect, useMemo } from 'react';
import { Search, Plus, Edit2, Trash2, X, Check, BookOpen, SlidersHorizontal, Minus } from 'lucide-react';
import api from '@/lib/api';
import { useToast } from '@/hooks/use-toast';
import { NutritionLoader } from '@/components/ui/NutritionLoader';
import { invalidateSmaeCache } from '@/components/SmaeIngredientePicker';

// ─── Tipos ────────────────────────────────────────────────────────────────────
interface EquivalenciaExtra {
  grupo: string;
  cantidad: number | string;
}

interface AlimentoSMAE {
  id: string;
  nombre: string;
  grupo: string;
  equivalentesBase?: number;   // cuántos eq del grupo base vale la porción (default 1)
  pesoGramos: number;
  unidadBase: string;          // unidad del valor ancla: g, ml, oz, pz, etc.
  porcionCasera: string | null;
  cantidadPorcion: number | null;
  unidadPorcion: string | null;
  notas: string | null;
  esPersonalizado: boolean;
  equivalencias?: EquivalenciaExtra[] | string | null; // Grupos SMAE adicionales
}

const UNIDADES_BASE = [
  { value: 'g',         label: 'g — gramos' },
  { value: 'ml',        label: 'ml — mililitros' },
  { value: 'oz',        label: 'oz — onzas' },
  { value: 'pz',        label: 'pz — pieza' },
  { value: 'serv',      label: 'serv — servicio/scoop' },
  { value: 'medida',    label: 'medida — medida/scoop' },
  { value: 'paquete',   label: 'paquete' },
  { value: 'botellita', label: 'botellita' },
  { value: 'lata',      label: 'lata' },
  { value: 'tz',        label: 'tz — taza' },
  { value: 'cdas',      label: 'cdas — cucharadas' },
  { value: 'cdta',      label: 'cdta — cucharadita' },
  { value: 'sobre',     label: 'sobre' },
];

const PRESET_UNIDADES = UNIDADES_BASE.map(u => u.value);
const CUSTOM_UNIT = '__custom__';

// Grupos SMAE con colores
const GRUPOS_CONFIG: Record<string, { label: string; color: string; bg: string }> = {
  verduras:     { label: 'Verduras',               color: 'text-green-400',  bg: 'bg-green-900/30 border-green-700/30' },
  frutas:       { label: 'Frutas',                 color: 'text-yellow-400', bg: 'bg-yellow-900/30 border-yellow-700/30' },
  cerealSinGr:  { label: 'C y T sin grasa',        color: 'text-amber-400',  bg: 'bg-amber-900/30 border-amber-700/30' },
  cerealConGr:  { label: 'C y T con grasa',        color: 'text-orange-400', bg: 'bg-orange-900/30 border-orange-700/30' },
  leguminosas:  { label: 'Leguminosas',             color: 'text-lime-400',   bg: 'bg-lime-900/30 border-lime-700/30' },
  aoaMuyBajo:   { label: 'AOA muy bajo',            color: 'text-sky-400',    bg: 'bg-sky-900/30 border-sky-700/30' },
  aoaBajo:      { label: 'AOA bajo',                color: 'text-blue-400',   bg: 'bg-blue-900/30 border-blue-700/30' },
  aoaModerado:  { label: 'AOA moderado',            color: 'text-indigo-400', bg: 'bg-indigo-900/30 border-indigo-700/30' },
  aoaAlto:      { label: 'AOA alto',               color: 'text-violet-400', bg: 'bg-violet-900/30 border-violet-700/30' },
  lecheDesc:    { label: 'Leche descremada',        color: 'text-cyan-400',   bg: 'bg-cyan-900/30 border-cyan-700/30' },
  lecheSemi:    { label: 'Leche semi descremada',   color: 'text-teal-400',   bg: 'bg-teal-900/30 border-teal-700/30' },
  lecheEntera:  { label: 'Leche entera',            color: 'text-emerald-400',bg: 'bg-emerald-900/30 border-emerald-700/30' },
  lecheAz:      { label: 'Leche con azúcar',        color: 'text-pink-400',   bg: 'bg-pink-900/30 border-pink-700/30' },
  grasaSinProt: { label: 'A y G sin proteína',      color: 'text-rose-400',   bg: 'bg-rose-900/30 border-rose-700/30' },
  grasaConProt: { label: 'A y G con proteína',      color: 'text-red-400',    bg: 'bg-red-900/30 border-red-700/30' },
  azSinGr:      { label: 'Azúcares sin grasa',      color: 'text-fuchsia-400',bg: 'bg-fuchsia-900/30 border-fuchsia-700/30' },
  azConGr:      { label: 'Azúcares con grasa',      color: 'text-purple-400', bg: 'bg-purple-900/30 border-purple-700/30' },
};

const GRUPOS_KEYS = Object.keys(GRUPOS_CONFIG);

const EMPTY_FORM: Omit<AlimentoSMAE, 'id'> = {
  nombre: '',
  grupo: 'verduras',
  equivalentesBase: 1,
  pesoGramos: 0,
  unidadBase: 'g',
  porcionCasera: '',
  cantidadPorcion: null,
  unidadPorcion: '',
  notas: '',
  esPersonalizado: true,
  equivalencias: [],
};

// ─── Badge de grupo ──────────────────────────────────────────────────────────
const GrupoBadge = ({ grupo, cantidad }: { grupo: string; cantidad?: number }) => {
  const g = GRUPOS_CONFIG[grupo];
  const prefix = cantidad != null && cantidad !== 1 ? `${cantidad} ` : '';
  if (!g) return <span className="text-text-muted text-[12px]">{prefix}{grupo}</span>;
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-[5px] text-[11px] font-medium border ${g.bg} ${g.color}`}>
      {prefix}{g.label}
    </span>
  );
};

// ─── Componentes auxiliares ───────────────────────────────────────────────────
const parseEquivs = (raw: AlimentoSMAE['equivalencias']): EquivalenciaExtra[] => {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw.filter(e => e.grupo);
  if (typeof raw === 'string') {
    try { const arr = JSON.parse(raw); return Array.isArray(arr) ? arr.filter((e: any) => e.grupo) : []; } catch { return []; }
  }
  return [];
};

// ─── Modal Alimento ──────────────────────────────────────────────────────────
const ModalAlimento = ({
  inicial,
  onClose,
  onSave,
}: {
  inicial?: AlimentoSMAE | null;
  onClose: () => void;
  onSave: (data: Omit<AlimentoSMAE, 'id'>) => Promise<void>;
}) => {
  const [form, setForm] = useState<Omit<AlimentoSMAE, 'id'>>(
    inicial ? { ...inicial } : { ...EMPTY_FORM }
  );
  const [saving, setSaving] = useState(false);

  // ─── Unidad personalizada (libertad para crear unidades propias) ────
  const [unitMode, setUnitMode] = useState<'preset' | 'custom'>(
    inicial?.unidadBase && !PRESET_UNIDADES.includes(inicial.unidadBase) ? 'custom' : 'preset'
  );

  // ─── Equivalencias adicionales (multi-grupo) ────────────────────────

  const [extraEquivs, setExtraEquivs] = useState<EquivalenciaExtra[]>(
    parseEquivs(inicial?.equivalencias)
  );

  const addEquiv   = () => setExtraEquivs(prev => [...prev, { grupo: '', cantidad: '' }]);
  const removeEquiv = (i: number) => setExtraEquivs(prev => prev.filter((_, idx) => idx !== i));
  const updateEquiv = (i: number, field: keyof EquivalenciaExtra, val: string) =>
    setExtraEquivs(prev => prev.map((e, idx) => idx === i ? { ...e, [field]: field === 'cantidad' ? (parseFloat(val) || val) : val } : e));

  const set = (k: keyof typeof form, v: any) => setForm(f => ({ ...f, [k]: v }));

  const handleSubmit = async () => {
    if (!form.nombre.trim()) return;
    if (!form.pesoGramos || form.pesoGramos <= 0) return;
    if (!form.equivalentesBase || form.equivalentesBase <= 0) return;
    if (!form.unidadBase.trim()) return;
    if (Number(form.cantidadPorcion) > 0 && !form.unidadPorcion?.trim()) return;
    setSaving(true);
    try {
      const validEquivs = extraEquivs.filter(e => e.grupo.trim());
      await onSave({ ...form, equivalencias: validEquivs.length > 0 ? validEquivs : [] });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4">
      <div className="bg-bg-surface border border-border-subtle rounded-[16px] w-full max-w-xl shadow-2xl animate-fade-in max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-border-subtle sticky top-0 bg-bg-surface rounded-t-[16px] z-10">
          <div>
            <h3 className="text-[16px] font-bold text-text-primary m-0">
              {inicial ? 'Editar alimento' : 'Nuevo alimento'}
            </h3>
            <p className="text-[12px] text-text-muted m-0">Catálogo SMAE</p>
          </div>
          <button onClick={onClose} className="p-2 text-text-muted hover:text-text-primary rounded-[8px] hover:bg-bg-elevated transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="p-6 space-y-5">
          {/* Nombre */}
          <div className="space-y-1.5">
            <label className="text-[12px] font-medium text-text-secondary m-0">Nombre del alimento *</label>
            <input
              autoFocus
              type="text"
              value={form.nombre}
              onChange={(e) => set('nombre', e.target.value)}
              placeholder="Ej. Pechuga de pollo cocida"
              className="w-full bg-bg-elevated rounded-[8px] px-3 py-2.5 text-[14px] text-text-primary border border-border-subtle focus:border-[#444] outline-none transition-colors"
            />
          </div>

          {/* Grupo base + cantidad de equivalentes */}
          <div className="space-y-1.5">
            <label className="text-[12px] font-medium text-text-secondary m-0">Grupo SMAE base *</label>
            <div className="flex gap-2">
              <input
                type="number"
                value={form.equivalentesBase ?? 1}
                onChange={(e) => set('equivalentesBase', parseFloat(e.target.value) || 0)}
                placeholder="1"
                min="0"
                step="0.5"
                title="Cuántos equivalentes de este grupo vale la porción"
                className="w-20 bg-bg-elevated rounded-[8px] px-3 py-2.5 text-[14px] text-text-primary border border-border-subtle focus:border-[#444] outline-none text-center [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none"
              />
              <span className="self-center text-[11px] text-text-muted flex-shrink-0">eq de</span>
              <select
                value={form.grupo}
                onChange={(e) => set('grupo', e.target.value)}
                className="flex-1 bg-bg-elevated rounded-[8px] px-3 py-2.5 text-[14px] text-text-primary border border-border-subtle focus:border-[#444] outline-none transition-colors"
              >
                {GRUPOS_KEYS.map(k => (
                  <option key={k} value={k}>{GRUPOS_CONFIG[k].label}</option>
                ))}
              </select>
            </div>
            <p className="text-[11px] text-text-muted m-0">
              Cuántos equivalentes del grupo base aporta la porción. Default 1. Ej. 1 serv de proteína = 2 eq AOA.
            </p>
          </div>

          {/* Cantidad ancla por 1 equivalente */}
          <div className="space-y-1.5">
            <label className="text-[12px] font-medium text-text-secondary m-0">Cantidad de referencia *</label>
            <div className="flex gap-2">
              <input
                type="number"
                value={form.pesoGramos || ''}
                onChange={(e) => set('pesoGramos', parseFloat(e.target.value) || 0)}
                placeholder="Ej. 240"
                min="0"
                step="0.1"
                className="flex-1 bg-bg-elevated rounded-[8px] px-3 py-2.5 text-[14px] text-text-primary border border-border-subtle focus:border-[#444] outline-none transition-colors [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none"
              />
              <select
                value={unitMode === 'custom' ? CUSTOM_UNIT : (form.unidadBase || 'g')}
                onChange={(e) => {
                  if (e.target.value === CUSTOM_UNIT) {
                    setUnitMode('custom');
                    set('unidadBase', '');
                  } else {
                    setUnitMode('preset');
                    set('unidadBase', e.target.value);
                  }
                }}
                className="bg-bg-elevated rounded-[8px] px-3 py-2.5 text-[14px] text-text-primary border border-border-subtle focus:border-[#444] outline-none transition-colors"
              >
                {UNIDADES_BASE.map(u => (
                  <option key={u.value} value={u.value}>{u.label}</option>
                ))}
                <option value={CUSTOM_UNIT}>Otra unidad…</option>
              </select>
            </div>
            {unitMode === 'custom' && (
              <input
                autoFocus
                type="text"
                value={form.unidadBase}
                onChange={(e) => set('unidadBase', e.target.value)}
                placeholder="Escribe tu unidad. Ej. serv, scoop, barra, cápsula"
                className="w-full bg-bg-elevated rounded-[8px] px-3 py-2.5 text-[14px] text-text-primary border border-border-subtle focus:border-[#444] outline-none transition-colors"
              />
            )}
            <p className="text-[11px] text-text-muted m-0">
              {form.unidadBase === 'g' || form.unidadBase === 'ml'
                ? `Cuántos ${form.unidadBase} equivalen a 1 porción del grupo seleccionado`
                : `Cuántas unidades (${form.unidadBase || 'unidad'}) equivalen a 1 porción del grupo seleccionado`}
            </p>
          </div>

          {/* Equivalencias adicionales */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <label className="text-[12px] font-medium text-text-secondary m-0">Equivalencias adicionales <span className="text-text-muted font-normal">(opcional)</span></label>
              <button
                type="button"
                onClick={addEquiv}
                className="flex items-center gap-1 text-[11px] text-[#90c2ff] hover:text-white transition-colors px-2 py-1 rounded-[6px] hover:bg-[#1a2a3a] border border-[#90c2ff]/20"
              >
                <Plus className="w-3 h-3" /> Añadir grupo
              </button>
            </div>
            {extraEquivs.length === 0 && (
              <p className="text-[11px] text-text-muted italic">
                Usa esto si el alimento cuenta como más de 1 grupo SMAE. Ej: leche entera = 1 eq leche + 1 eq grasa.
              </p>
            )}
            {extraEquivs.map((eq, idx) => (
              <div key={idx} className="flex items-center gap-2">
                <input
                  type="number"
                  value={eq.cantidad.toString()}
                  onChange={e => updateEquiv(idx, 'cantidad', e.target.value)}
                  placeholder="Cant."
                  min="0"
                  step="0.5"
                  className="w-20 bg-bg-elevated rounded-[8px] px-2 py-2 text-[13px] text-text-primary border border-border-subtle focus:border-[#444] outline-none text-center [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none"
                />
                <span className="text-[11px] text-text-muted flex-shrink-0">eq</span>
                <select
                  value={eq.grupo}
                  onChange={e => updateEquiv(idx, 'grupo', e.target.value)}
                  className="flex-1 bg-bg-elevated rounded-[8px] px-2 py-2 text-[13px] text-text-primary border border-border-subtle focus:border-[#444] outline-none"
                >
                  <option value="">Selecciona grupo...</option>
                  {GRUPOS_KEYS.map(k => (
                    <option key={k} value={GRUPOS_CONFIG[k].label}>{GRUPOS_CONFIG[k].label}</option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() => removeEquiv(idx)}
                  className="p-1.5 text-text-muted hover:text-accent-red rounded-[6px] hover:bg-[#2e1a1a] transition-colors"
                >
                  <Minus className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
          </div>

          {/* Porción casera */}
          <div className="space-y-3">
            <label className="text-[12px] font-medium text-text-secondary m-0">Porción casera (opcional)</label>
            <div className="grid grid-cols-3 gap-2">
              <input
                type="number"
                value={form.cantidadPorcion || ''}
                onChange={(e) => set('cantidadPorcion', parseFloat(e.target.value) || null)}
                placeholder="Ej. 1"
                min="0"
                step="0.25"
                className="bg-bg-elevated rounded-[8px] px-3 py-2.5 text-[14px] text-text-primary border border-border-subtle focus:border-[#444] outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none"
              />
              <input
                type="text"
                value={form.unidadPorcion || ''}
                onChange={(e) => set('unidadPorcion', e.target.value)}
                placeholder="Unidad"
                className="bg-bg-elevated rounded-[8px] px-3 py-2.5 text-[14px] text-text-primary border border-border-subtle focus:border-[#444] outline-none"
              />
              <input
                type="text"
                value={form.porcionCasera || ''}
                onChange={(e) => set('porcionCasera', e.target.value)}
                placeholder="Descripción"
                className="bg-bg-elevated rounded-[8px] px-3 py-2.5 text-[14px] text-text-primary border border-border-subtle focus:border-[#444] outline-none"
              />
            </div>
            <p className="text-[11px] text-text-muted m-0">Si agregas una cantidad casera, indica también su unidad. Ejemplo: 1 · pieza · pieza mediana.</p>
          </div>

          {/* Notas */}
          <div className="space-y-1.5">
            <label className="text-[12px] font-medium text-text-secondary m-0">Notas (opcional)</label>
            <textarea
              value={form.notas || ''}
              onChange={(e) => set('notas', e.target.value)}
              rows={2}
              placeholder="Ej. Cocido sin piel, peso neto drenado, etc."
              className="w-full bg-bg-elevated rounded-[8px] px-3 py-2.5 text-[13px] text-text-primary border border-border-subtle focus:border-[#444] outline-none resize-none"
            />
          </div>

        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-6 pb-6 gap-3">
          <div className="flex items-center gap-2 flex-1">
            {form.pesoGramos > 0 && (
              <div className="flex flex-wrap items-center gap-2 text-[12px] text-text-muted">
                → <strong className="text-text-primary">{form.pesoGramos}{form.unidadBase || 'g'}</strong> = {form.equivalentesBase ?? 1} eq · <GrupoBadge grupo={form.grupo} />
                {extraEquivs.filter(e => e.grupo && e.cantidad).map((eq, i) => (
                  <div key={i} className="flex items-center gap-1.5 bg-[#1a1a1a] px-2 py-1 rounded-[6px] border border-[#333]">
                    <span className="text-[11px] font-bold text-brand-primary">+{eq.cantidad}</span>
                    <span className="text-[10px] font-semibold text-[#8a8a8a] uppercase tracking-wider">{eq.grupo}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
          <div className="flex gap-2">
            <button onClick={onClose} className="px-4 py-2 text-[13px] font-medium text-text-secondary hover:text-text-primary border border-border-subtle rounded-[8px] hover:bg-bg-elevated transition-colors">
              Cancelar
            </button>
            <button
              onClick={handleSubmit}
              disabled={saving || !form.nombre.trim() || !form.pesoGramos || Number(form.equivalentesBase) <= 0 || !form.unidadBase.trim() || (Number(form.cantidadPorcion) > 0 && !form.unidadPorcion?.trim())}
              className="flex items-center gap-2 px-5 py-2 bg-brand-primary text-bg-base rounded-[8px] text-[13px] font-bold hover:bg-[#e0e0e0] transition-all disabled:opacity-50"
            >
              {saving ? <div className="w-4 h-4 border-2 border-white/20 border-t-white dark:border-black/20 dark:border-t-black rounded-full animate-spin" /> : <Check className="w-4 h-4" />}
              {inicial ? 'Actualizar' : 'Agregar'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

// ─── Página principal ─────────────────────────────────────────────────────────
const EquivalenciasSMAE = () => {
  const { toast } = useToast();
  const [alimentos, setAlimentos] = useState<AlimentoSMAE[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [grupoFiltro, setGrupoFiltro] = useState('todos');
  const [soloPersonalizados, setSoloPersonalizados] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [editando, setEditando] = useState<AlimentoSMAE | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<AlimentoSMAE | null>(null);

  // Cargar catálogo
  const fetchAlimentos = async () => {
    setLoading(true);
    try {
      const { data } = await api.get('/api/alimentos-smae');
      setAlimentos(data?.data || data || []);
    } catch (err) {
      toast({ title: 'Error al cargar', description: 'No se pudo obtener el catálogo SMAE.', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchAlimentos(); }, []);

  // Filtros
  const filtrados = useMemo(() => {
    return alimentos.filter((a) => {
      const matchQ = !query || a.nombre.toLowerCase().includes(query.toLowerCase());
      const matchG = grupoFiltro === 'todos' || a.grupo === grupoFiltro;
      const matchP = !soloPersonalizados || a.esPersonalizado;
      return matchQ && matchG && matchP;
    });
  }, [alimentos, query, grupoFiltro, soloPersonalizados]);

  // Stats por grupo
  const statsPorGrupo = useMemo(() => {
    const counts: Record<string, number> = {};
    alimentos.forEach(a => { counts[a.grupo] = (counts[a.grupo] || 0) + 1; });
    return counts;
  }, [alimentos]);

  // CRUD
  const handleSave = async (form: Omit<AlimentoSMAE, 'id'>) => {
    try {
      if (editando) {
        await api.put(`/api/alimentos-smae/${editando.id}`, form);
        setAlimentos(prev => prev.map(a => a.id === editando.id ? { ...a, ...form } : a));
        invalidateSmaeCache(); // Fuerza recarga del catálogo en SmaeIngredientePicker
        toast({ title: 'Alimento actualizado' });
      } else {
        const { data } = await api.post('/api/alimentos-smae', form);
        const nuevo = data?.data || data;
        setAlimentos(prev => [nuevo, ...prev]);
        invalidateSmaeCache(); // Fuerza recarga del catálogo en SmaeIngredientePicker
        toast({ title: 'Alimento agregado al catálogo' });
      }
      setShowModal(false);
      setEditando(null);
    } catch (err: any) {
      const duplicado = err?.response?.status === 409;
      toast({
        title: duplicado ? 'Ya existe' : 'Error',
        description: err.response?.data?.error || 'No se pudo guardar.',
        variant: 'destructive',
      });
      throw err;
    }
  };

  const handleDelete = async (a: AlimentoSMAE) => {
    try {
      await api.delete(`/api/alimentos-smae/${a.id}`);
      setAlimentos(prev => prev.filter(x => x.id !== a.id));
      invalidateSmaeCache(); // Fuerza recarga del catálogo en SmaeIngredientePicker
      toast({ title: 'Alimento eliminado del catálogo' });
    } catch (err: any) {
      toast({ title: 'Error', description: 'No se pudo eliminar.', variant: 'destructive' });
    } finally {
      setConfirmDelete(null);
    }
  };

  return (
    <div className="space-y-8 animate-fade-in pb-20 pt-6">
      {/* HEADER */}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 border-b border-border-subtle pb-6">
        <div className="space-y-1">
          <div className="flex items-center gap-3 mb-1">
            <BookOpen className="w-5 h-5 text-text-muted" />
            <h1 className="text-[26px] font-bold text-text-primary m-0 tracking-tight">Equivalencias SMAE</h1>
          </div>
          <p className="text-[14px] text-text-secondary m-0">
            {alimentos.length.toLocaleString()} alimentos cargados · {alimentos.filter(a => a.esPersonalizado).length} personalizados
          </p>
        </div>
        <button
          onClick={() => { setEditando(null); setShowModal(true); }}
          className="flex items-center gap-2 px-5 py-2.5 bg-brand-primary text-bg-base rounded-[8px] text-[13px] font-bold hover:bg-[#e0e0e0] transition-all"
        >
          <Plus className="w-4 h-4" /> Agregar alimento
        </button>
      </div>

      {/* FILTROS */}
      <div className="flex flex-col md:flex-row gap-3">
        {/* Búsqueda */}
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar alimento..."
            className="w-full bg-bg-surface border border-border-subtle rounded-[8px] pl-9 pr-4 py-2.5 text-[14px] text-text-primary outline-none focus:border-[#444] transition-colors"
          />
          {query && (
            <button onClick={() => setQuery('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-primary">
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        {/* Filtro por grupo */}
        <div className="relative">
          <SlidersHorizontal className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted pointer-events-none" />
          <select
            value={grupoFiltro}
            onChange={(e) => setGrupoFiltro(e.target.value)}
            className="bg-bg-surface border border-border-subtle rounded-[8px] pl-9 pr-4 py-2.5 text-[14px] text-text-primary outline-none focus:border-[#444] transition-colors appearance-none"
          >
            <option value="todos">Todos los grupos ({alimentos.length})</option>
            {GRUPOS_KEYS.map(k => (
              <option key={k} value={k}>
                {GRUPOS_CONFIG[k].label} ({statsPorGrupo[k] || 0})
              </option>
            ))}
          </select>
        </div>

        {/* Toggle personalizados */}
        <button
          onClick={() => setSoloPersonalizados(!soloPersonalizados)}
          className={`flex items-center gap-2 px-4 py-2.5 rounded-[8px] text-[13px] font-medium border transition-colors ${
            soloPersonalizados
              ? 'bg-brand-primary/10 border-brand-primary/30 text-brand-primary'
              : 'bg-bg-surface border-border-subtle text-text-secondary hover:text-text-primary hover:bg-bg-elevated'
          }`}
        >
          Solo personalizados
        </button>
      </div>

      {/* TABLA */}
      {loading ? (
        <div className="flex flex-col items-center justify-center py-24">
          <NutritionLoader text="Cargando catálogo SMAE..." />
        </div>
      ) : filtrados.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-24 border border-dashed border-border-subtle rounded-[12px] text-center">
          <BookOpen className="w-8 h-8 text-text-muted mb-4" />
          <p className="text-[14px] font-medium text-text-secondary">
            {query || grupoFiltro !== 'todos' ? 'Sin resultados para esta búsqueda' : 'Sin alimentos en el catálogo'}
          </p>
        </div>
      ) : (
        <div className="bg-bg-surface border border-border-subtle rounded-[12px] overflow-hidden">
          {/* Conteo */}
          <div className="px-6 py-3 border-b border-border-subtle bg-bg-elevated flex items-center justify-between">
            <p className="text-[12px] font-medium text-text-muted">
              Mostrando {filtrados.length} de {alimentos.length} alimentos
            </p>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr className="border-b border-border-subtle">
                  <th className="px-6 py-3 text-[11px] font-medium text-text-muted uppercase tracking-wider">Alimento</th>
                  <th className="px-4 py-3 text-[11px] font-medium text-text-muted uppercase tracking-wider">Grupo</th>
                  <th className="px-4 py-3 text-[11px] font-medium text-text-muted uppercase tracking-wider text-center">1 eq =</th>
                  <th className="px-4 py-3 text-[11px] font-medium text-text-muted uppercase tracking-wider">Porción casera</th>
                  <th className="px-4 py-3 text-[11px] font-medium text-text-muted uppercase tracking-wider w-20"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border-subtle">
                {filtrados.map((a) => (
                  <tr key={a.id} className="hover:bg-bg-elevated/40 transition-colors group">
                    <td className="px-6 py-3">
                      <div className="flex items-center gap-2">
                        <p className="text-[14px] font-medium text-text-primary m-0">{a.nombre}</p>
                        {a.esPersonalizado && (
                          <span className="text-[10px] font-bold text-brand-primary border border-brand-primary/30 rounded-[4px] px-1.5 py-0.5 bg-brand-primary/10">
                            CUSTOM
                          </span>
                        )}
                      </div>
                      {a.notas && <p className="text-[12px] text-text-muted m-0 mt-0.5 italic">{a.notas}</p>}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <GrupoBadge grupo={a.grupo} cantidad={a.equivalentesBase} />
                        {parseEquivs(a.equivalencias).map((eq, i) => (
                          <div key={i} className="flex items-center gap-1.5 bg-[#1a1a1a] px-2 py-1 rounded-[6px] border border-[#333]">
                            <span className="text-[11px] font-bold text-brand-primary">+{eq.cantidad}</span>
                            <span className="text-[10px] font-semibold text-[#8a8a8a] uppercase tracking-wider">{eq.grupo}</span>
                          </div>
                        ))}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span className="text-[14px] font-bold text-text-primary">{a.pesoGramos}</span>
                      <span className="text-[12px] text-text-muted ml-1">{a.unidadBase || 'g'}</span>
                    </td>
                    <td className="px-4 py-3">
                      {a.porcionCasera ? (
                        <span className="text-[13px] text-text-secondary">
                          {a.cantidadPorcion && a.unidadPorcion && !a.porcionCasera.startsWith(String(a.cantidadPorcion))
                            ? `${a.cantidadPorcion} ${a.unidadPorcion} (${a.porcionCasera})`
                            : a.porcionCasera
                          }
                        </span>
                      ) : a.cantidadPorcion && a.unidadPorcion ? (
                        <span className="text-[13px] text-text-secondary">
                          {a.cantidadPorcion} {a.unidadPorcion}
                        </span>
                      ) : (
                        <span className="text-[12px] text-text-muted">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button
                          onClick={() => { setEditando(a); setShowModal(true); }}
                          className="p-2 text-text-muted hover:text-text-primary hover:bg-bg-elevated rounded-[6px] transition-colors"
                          title="Editar"
                        >
                          <Edit2 className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => setConfirmDelete(a)}
                          className="p-2 text-text-muted hover:text-accent-red hover:bg-[#2e1a1a] rounded-[6px] transition-colors"
                          title="Eliminar"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ─── Referencia de Abreviaciones (mismo formato que la tabla de alimentos) ─── */}
      <div className="bg-bg-surface border border-border-subtle rounded-[12px] overflow-hidden">
        <div className="px-6 py-3 border-b border-border-subtle bg-bg-elevated flex items-center justify-between">
          <p className="text-[12px] font-medium text-text-muted">
            Referencia de Abreviaciones — {GRUPOS_KEYS.length} grupos SMAE
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="border-b border-border-subtle">
                <th className="px-6 py-3 text-[11px] font-medium text-text-muted uppercase tracking-wider">Clave</th>
                <th className="px-4 py-3 text-[11px] font-medium text-text-muted uppercase tracking-wider">Grupo</th>
                <th className="px-4 py-3 text-[11px] font-medium text-text-muted uppercase tracking-wider">Descripción</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border-subtle">
              {GRUPOS_KEYS.map((key) => {
                const g = GRUPOS_CONFIG[key];
                const descriptions: Record<string, string> = {
                  verduras: 'Todas las verduras y hortalizas',
                  frutas: 'Frutas frescas y secas',
                  cerealSinGr: 'Cereales y tubérculos sin grasa añadida',
                  cerealConGr: 'Cereales y tubérculos con grasa añadida',
                  leguminosas: 'Frijol, lenteja, garbanzo, habas, etc.',
                  aoaMuyBajo: 'Alimentos de origen animal con muy bajo contenido graso',
                  aoaBajo: 'Alimentos de origen animal con bajo contenido graso',
                  aoaModerado: 'Alimentos de origen animal con moderado contenido graso',
                  aoaAlto: 'Alimentos de origen animal con alto contenido graso',
                  lecheDesc: 'Leche y yogurt descremados',
                  lecheSemi: 'Leche y yogurt semidescremados',
                  lecheEntera: 'Leche y yogurt enteros',
                  lecheAz: 'Leche y yogurt con azúcar añadida',
                  grasaSinProt: 'Aceites, mantequilla, aguacate sin proteína',
                  grasaConProt: 'Oleaginosas, semillas con proteína',
                  azSinGr: 'Azúcares, mermeladas, miel sin grasa',
                  azConGr: 'Chocolates, pasteles con grasa añadida',
                };
                return (
                  <tr key={key} className="hover:bg-bg-elevated/40 transition-colors group">
                    <td className="px-6 py-3">
                      <span className="text-[14px] font-mono font-medium text-text-primary">{key}</span>
                    </td>
                    <td className="px-4 py-3">
                      <GrupoBadge grupo={key} />
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-[13px] text-text-secondary">{descriptions[key] || g.label}</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Modal crear/editar */}
      {showModal && (
        <ModalAlimento
          inicial={editando}
          onClose={() => { setShowModal(false); setEditando(null); }}
          onSave={handleSave}
        />
      )}

      {/* Modal confirmar eliminar */}
      {confirmDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
          <div className="bg-bg-surface border border-border-subtle rounded-[16px] w-full max-w-sm p-6 shadow-2xl animate-fade-in space-y-4">
            <h3 className="text-[16px] font-bold text-text-primary m-0">¿Eliminar alimento?</h3>
            <p className="text-[14px] text-text-secondary m-0">
              Se eliminará <strong className="text-text-primary">{confirmDelete.nombre}</strong> del catálogo.
              {!confirmDelete.esPersonalizado && (
                <span className="block mt-2 text-accent-red text-[12px]">
                  ⚠ Este es un alimento del SMAE oficial. Se puede volver a cargar con el seed.
                </span>
              )}
            </p>
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => setConfirmDelete(null)}
                className="px-4 py-2 text-[13px] text-text-secondary border border-border-subtle rounded-[8px] hover:bg-bg-elevated transition-colors"
              >
                Cancelar
              </button>
              <button
                onClick={() => handleDelete(confirmDelete)}
                className="px-4 py-2 text-[13px] font-bold text-white bg-accent-red rounded-[8px] hover:bg-red-700 transition-colors"
              >
                Sí, eliminar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default EquivalenciasSMAE;
