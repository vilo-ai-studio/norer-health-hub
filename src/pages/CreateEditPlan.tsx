import React, { useCallback, useEffect, useState, useMemo, useRef } from 'react';
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { ArrowLeft, Save, Plus, PlusCircle, Search, ChevronDown, ChevronUp, Copy, BookOpen, Clock, Activity, AlertCircle, Edit3, Trash2, CheckCircle2, MoreHorizontal, ClipboardList, Settings, Bookmark, Droplets, Pill, FileText, X, GripVertical, RotateCcw } from 'lucide-react';
import { SmaeIngredientePicker } from '@/components/SmaeIngredientePicker';
import api from '@/lib/api';
import { Menu, TiempoComida, Ingrediente, Plan, Platillo } from '@/types';
import { formatDecimal } from '@/lib/format';
import { useToast } from '@/hooks/use-toast';
import { useQueryClient } from '@tanstack/react-query';
import { invalidateAfterPlanChange } from '@/lib/invalidation';
import { useConfirm } from '@/components/ui/ConfirmDialog';
import { Input } from '@/components/ui/input';
import { normalizeBarridoData, type BarridoData, type BarridoTiempo } from '@/components/BarridoEquivalencias';
import BarridosEquivalenciasManager, {
  buildBarridoCollection,
  getBarridoVariantes,
  type BarridoCollection,
  type BarridoVariante,
} from '@/components/BarridosEquivalenciasManager';
import { normalizeGroup, groupToBarridoKey, SMAE_GROUP_LABELS, CANONICAL_TO_BARRIDO_KEY } from '@/lib/smaeGroups';
import { formatMealTimeName } from '@/lib/mealTimes';
import { buildAvoidFoods } from '@/lib/avoidFoods';
import { getMexicoCityDateTimeParts } from '@/lib/dateTime';
import {
  appendMealTimeToMenus,
  removeMealTimeFromMenus,
  reorderMealTimes,
  restoreMealTimeToMenus,
  type RemovedMealTime,
} from '@/lib/mealTimeOrdering';
import {
  ingredientDragId,
  reorderDishGroups,
  reorderIngredientFromDrag,
  reorderIngredientWithinDish,
} from '@/lib/ingredientOrdering';
import { PacienteResumenSidebar } from '@/components/PacienteResumenSidebar';
import { Phase4Delivery } from './Phase4Delivery';
import { beginNativeDrag } from '@/lib/nativeDrag';

const defaultTiempos = ['Pre-entreno', 'Desayuno', 'Colación', 'Almuerzo', 'Colación', 'Cena'];

const emptyMenu = (name: string): Menu => ({
  nombre: name,
  tipoContenido: 'platillos',
  barridoEquivalencias: null,
  tiempos: defaultTiempos.map((t) => ({ nombre: t, ingredientes: [], nota: '', bebida: '', suplTiempo: '', suplNotas: '', ademas: '' })),
});

const emptyIngrediente = (): Ingrediente => ({
  id: Math.random().toString(36).substr(2, 9),
  descripcion: '',
  cantidad: 0,
  unidad: 'GR',
  eqCantidad: 0,
  eqGrupo: '',
  equivalencias: [],
  nota: ''
});

const newClientIngredientId = () =>
  typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `ingredient-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

/** Redondeo inteligente para porciones prácticas:
 *  - Parte decimal >= 0.5 → redondea arriba
 *  - Parte decimal < 0.5  → redondea abajo
 *  Nunca devuelve < 0. Si el valor es 0, devuelve 0.
 */
const smartRound = (val: number): number => {
  if (val <= 0) return 0;
  return Math.round(val); // Math.round ya hace >=0.5 up, <0.5 down
};

const SortableIngredientRow = ({
  id,
  children,
}: {
  id: string;
  children: (dragHandleProps: React.HTMLAttributes<HTMLButtonElement>, isDragging: boolean) => React.ReactNode;
}) => {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id });

  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        position: 'relative',
        zIndex: isDragging ? 30 : undefined,
      }}
      className={`flex items-start gap-2 rounded-[6px] transition-opacity ${isDragging ? 'opacity-45 shadow-lg' : ''}`}
    >
      {children({ ...attributes, ...listeners } as React.HTMLAttributes<HTMLButtonElement>, isDragging)}
    </div>
  );
};

export const CreateEditPlanForm = ({
  pacienteId: propPacienteId,
  planId: propPlanId,
  valoracionId: propValoracionId,
  onSaved,
  onCancel,
  initialProximaSesion,
}: {
  pacienteId?: string,
  planId?: string,
  valoracionId?: string,
  onSaved?: (planId: string) => void,
  onCancel?: () => void,
  initialProximaSesion?: string,
}) => {
  const navigate = useNavigate();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const isEdit = !!propPlanId;
  const isBasePlan = !propPacienteId;
  const initialSessionParts = getMexicoCityDateTimeParts(initialProximaSesion);

  const pacienteId = propPacienteId;
  const planId = propPlanId;
  const valoracionId = propValoracionId;

  const [saving, setSaving] = useState(false);
  const [loadingInitialData, setLoadingInitialData] = useState(true);
  const [pesoUltimo, setPesoUltimo] = useState(0);
  const [pacienteNombre, setPacienteNombre] = useState<string | null>(null);

  const [nombrePlan, setNombrePlan] = useState('');
  const [tipo, setTipo] = useState('Balanceada');
  const [calorias, setCalorias] = useState('1800');
  const [proteinas, setProteinas] = useState('30');
  const [carbohidratos, setCarbohidratos] = useState('40');
  const [grasas, setGrasas] = useState('30');
  const [proximaSesion, setProximaSesion] = useState(initialSessionParts?.date || '');
  const [proximaSesionHora, setProximaSesionHora] = useState(initialSessionParts?.time || '');
  const [notas, setNotas] = useState('');
  const [menus, setMenus] = useState<Menu[]>([emptyMenu('Menú 1'), emptyMenu('Menú 2')]);
  const [valData, setValData] = useState<any>(null);
  const [suplementosDetalle, setSuplementosDetalle] = useState<any[]>([]); // 💊 State independiente para persistencia
  const [showBarridoRef, setShowBarridoRef] = useState(false); // cerrado por defecto
  const [pacienteInfo, setPacienteInfo] = useState<any>(null); // antecedentes + datos clínicos del paciente
  // Borradores locales del nombre de platillo mientras se edita — evita que el grupo desaparezca al vaciar el input
  const [platilloDrafts, setPlatilloDrafts] = useState<Record<string, string>>({});
  const [removedMealTimes, setRemovedMealTimes] = useState<RemovedMealTime[]>([]);
  const [draggedTiempoIdx, setDraggedTiempoIdx] = useState<number | null>(null);
  const [dragOverTiempoIdx, setDragOverTiempoIdx] = useState<number | null>(null);
  const [draggedDish, setDraggedDish] = useState<{ menuIdx: number; tiempoIdx: number; groupIdx: number } | null>(null);
  const [dragOverDishIdx, setDragOverDishIdx] = useState<number | null>(null);
  const draggedDishRef = useRef<typeof draggedDish>(null);
  const [removedDishes, setRemovedDishes] = useState<Array<{ menuIdx: number; tiempoIdx: number; nombre: string; ingredientes: Ingrediente[] }>>([]);
  const [removedIngredients, setRemovedIngredients] = useState<Array<{ menuIdx: number; tiempoIdx: number; ingrediente: Ingrediente }>>([]);

  const [platilloLibrary, setPlatilloLibrary] = useState<Platillo[]>([]);
  const [showPlatilloSelector, setShowPlatilloSelector] = useState<{ mIdx: number, tIdx: number } | null>(null);
  const [platilloSearch, setPlatilloSearch] = useState('');
  const [platilloCatFilter, setPlatilloCatFilter] = useState<string | null>(null); // filtro activo por categoría
  const [platilloCategoryMenuOpen, setPlatilloCategoryMenuOpen] = useState(false);

  // ─── Save-as-Platillo modal ────────────────────────────────────────────────
  const [savePlatilloModal, setSavePlatilloModal] = useState<{
    mIdx: number; tIdx: number;
    nombre: string; categoria: string;
  } | null>(null);
  const [savingPlatillo, setSavingPlatillo] = useState(false);

  // ─── Presupuesto de equivalencias ─ siempre abierto por defecto ─────────────────
  // Budget panels are ALWAYS visible for Eyder to track progress in real-time
  const [showBudgetMap, setShowBudgetMap] = useState<Record<string, boolean>>({});

  // ─── Toggle agua natural en comidas principales ──────────────────────────────
  const [aguaNaturalDefault, setAguaNaturalDefault] = useState(true);

  const clearNativeDragState = useCallback(() => {
    draggedDishRef.current = null;
    setDraggedTiempoIdx(null);
    setDragOverTiempoIdx(null);
    setDraggedDish(null);
    setDragOverDishIdx(null);
  }, []);

  const ingredientSensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  useEffect(() => {
    const clearDrag = () => clearNativeDragState();
    document.addEventListener('dragend', clearDrag);
    document.addEventListener('drop', clearDrag);
    window.addEventListener('blur', clearDrag);
    return () => {
      document.removeEventListener('dragend', clearDrag);
      document.removeEventListener('drop', clearDrag);
      window.removeEventListener('blur', clearDrag);
    };
  }, [clearNativeDragState]);


  // Defensive sort: backend ya guarda `orden`, pero por si algún endpoint regresa sin ordenar
  const sortByOrden = <T extends { orden?: number }>(arr: T[]): T[] =>
    arr.map((item, idx) => ({ item, idx })).sort((a, b) => (a.item.orden ?? a.idx + 1) - (b.item.orden ?? b.idx + 1)).map(({ item }) => item);

  const mapMenusFromBackend = (backendMenus: any[]): Menu[] => {
    return (backendMenus ? sortByOrden(backendMenus) : backendMenus)?.map((m: any) => ({
      nombre: m.nombre,
      tipoContenido: (m.tipoContenido === 'equivalencias' ? 'equivalencias' : 'platillos') as Menu['tipoContenido'],
      barridoEquivalencias: m.barridoEquivalencias
        ? {
            ...normalizeBarridoData(m.barridoEquivalencias),
            id: m.barridoEquivalencias.id || 'principal',
            nombre: m.barridoEquivalencias.nombre || 'Barrido 1',
          }
        : null,
      tiempos: sortByOrden(m.tiemposComida || m.tiempos || []).map((t: any) => {
        // Parse metadata encoded in notaPie (fallback until backend adds columns)
        const rawNote = t.notaPie || t.nota || '';
        let nota = rawNote;
        let metaBebida = '';
        let metaSuplTiempo = '';
        let metaSuplNotas = '';
        let metaAdemas = '';
        const metaMatch = rawNote.match(/\n?<!--META:(.*?)-->/);
        if (metaMatch) {
          try {
            const parsed = JSON.parse(metaMatch[1]);
            metaBebida = parsed.bebida || '';
            metaSuplTiempo = parsed.suplTiempo || '';
            metaSuplNotas = parsed.suplNotas || '';
            metaAdemas = parsed.ademas || '';
          } catch { /* ignore parse errors */ }
          nota = rawNote.replace(/\n?<!--META:.*?-->/, '');
        }
        const rawBebida = t.bebida || metaBebida;
        // Si el tiempo no es comida principal (colación o pre-entreno) y tiene el agua por default guardada, limpiarla
        const isThisNonMain = /colaci[oó]n/i.test(t.nombre || '') || /pre.?entreno/i.test(t.nombre || '');
        const bebidaFinal = (isThisNonMain && rawBebida === 'Agua natural 500ml') ? '' : rawBebida;
        return {
          nombre: formatMealTimeName(t.nombre),
          barridoTiempoId: t.barridoTiempoId || undefined,
          nota,
          bebida: bebidaFinal,
          suplTiempo: t.suplTiempo || metaSuplTiempo,
          suplNotas: t.suplNotas || metaSuplNotas,
          ademas: t.ademas || metaAdemas,
          ingredientes: sortByOrden(t.ingredientes || []).map((i: any) => {
            let eqArray = [];
            if (Array.isArray(i.equivalencias)) {
              eqArray = i.equivalencias;
            } else if (typeof i.equivalencias === 'string' && i.equivalencias.trim() !== '') {
              try { eqArray = JSON.parse(i.equivalencias); } catch (e) { console.warn("Failed to parse equivalencias:", i.equivalencias); }
            }
            return {
              ...i,
              id: i.id || Math.random().toString(36).substr(2, 9),
              cantidad: parseFloat(i.cantidad) || 0,
              eqCantidad: i.eqCantidad != null ? parseFloat(String(i.eqCantidad)) : undefined,
              equivalencias: eqArray,
              platillo: i.platillo || ''
            };
          })
        };
      })
    })) || [emptyMenu('Menú 1'), emptyMenu('Menú 2')];
  };

  useEffect(() => {
    const fetchAllData = async () => {
      setLoadingInitialData(true);
      try {
        let pacientePromise = Promise.resolve(null);
        if (pacienteId) {
          pacientePromise = api.get(`/api/pacientes/${pacienteId}`);
        }

        let planPromise = Promise.resolve(null);
        let valPromise = Promise.resolve(null);
        let barridoPromise = Promise.resolve(null);

        if (isEdit) {
          const url = isBasePlan
            ? `/api/planes/${planId}`
            : `/api/pacientes/${pacienteId}/planes/${planId}`;
          planPromise = api.get(url).catch(() => null);
        }

        // Siempre cargar la valoración si está disponible para tener el conteo de equivalencias activo
        if (pacienteId && valoracionId) {
          valPromise = api.get(`/api/pacientes/${pacienteId}/valoraciones/${valoracionId}`).catch(() => null);
          barridoPromise = api.get(`/api/pacientes/${pacienteId}/valoraciones/${valoracionId}/barrido`).catch(() => null);
        }

        const platillosPromise = api.get('/api/platillos').catch(() => null);

        // Disparamos todas las peticiones en paralelo
        const [pacienteRes, planRes, valRes, barridoRes, platillosRes] = await Promise.all([
          pacientePromise,
          planPromise,
          valPromise,
          barridoPromise,
          platillosPromise
        ]);

        // Procesar paciente
        if (pacienteRes?.data) {
          const p = pacienteRes.data?.data || pacienteRes.data;
          if (p) {
            const fullName = `${p.nombre} ${p.apellido || ''}`.trim();
            setPacienteNombre(fullName);
            setPacienteInfo(p);
            if (!isEdit) {
              const hoy = new Date();
              const dd = String(hoy.getDate()).padStart(2, '0');
              const mm = String(hoy.getMonth() + 1).padStart(2, '0');
              const yyyy = hoy.getFullYear();
              setNombrePlan(`${fullName} ${dd}/${mm}/${yyyy}`);
            }
          }
        }

        // Procesar plan
        if (isEdit && planRes?.data) {
          const p = planRes.data.data || planRes.data;
          if (p) {
            setNombrePlan(p.nombre || '');
            setTipo(p.tipoPlan || p.tipo || 'Balanceada');
            setCalorias(p.calorias.toString());
            setProteinas((Number(p.proteinasPct ?? p.macros?.proteinas ?? 30)).toString());
            setCarbohidratos((Number(p.carbohidratosPct ?? p.macros?.carbohidratos ?? 40)).toString());
            setGrasas((Number(p.grasasPct ?? p.macros?.grasas ?? 30)).toString());

            if (p.proximaSesion) {
              const sessionParts = getMexicoCityDateTimeParts(p.proximaSesion);
              if (sessionParts) {
                setProximaSesion(sessionParts.date);
                setProximaSesionHora(sessionParts.time);
              }
            } else {
              setProximaSesion('');
              setProximaSesionHora('');
            }
            setNotas(p.notasGenerales || p.notas || '');
            const mappedMenus = mapMenusFromBackend(p.menus);
            setMenus(mappedMenus);
            setSuplementosDetalle(p.suplementosDetalle || []);
            // Guardar los menus mapeados para pasarlos a autoScaleIngredients
            // y evitar la race condition donde el estado React aún no se actualizó.
            (window as any).__pendingMappedMenus = mappedMenus;
          }
        }

        // Procesar valoración/barrido (tanto para NEW como para EDIT para el panel presupuestal)
        let vData = valRes?.data?.data || valRes?.data;
        let bData = barridoRes?.data;

        // RECUPERACIÓN DE EMERGENCIA: Si estamos editando y no teníamos valoracionId en URL,
        // pero el plan sí lo tiene, cargamos la valoración ahora.
        if (isEdit && !valoracionId && planRes?.data) {
          const p = planRes.data.data || planRes.data;
          const recoveredValId = p?.valoracionId;
          if (recoveredValId) {
            try {
              const [vRes, bRes] = await Promise.all([
                api.get(`/api/pacientes/${pacienteId}/valoraciones/${recoveredValId}`),
                api.get(`/api/pacientes/${pacienteId}/valoraciones/${recoveredValId}/barrido`)
              ]);
              vData = vRes.data?.data || vRes.data;
              bData = bRes.data;
            } catch (e) {
              console.warn("No se pudo recuperar la valoración del plan:", e);
            }
          }
        }

        if (vData) {
          const v = vData;
          let barrido = bData;
          while (barrido?.data) barrido = barrido.data;
          if (typeof barrido === 'string') {
            try { barrido = JSON.parse(barrido); } catch (e) { }
          }
          if (barrido?.barrido) barrido = barrido.barrido;
          if (typeof barrido === 'string') {
            try { barrido = JSON.parse(barrido); } catch (e) { }
          }

          const normalizedBarrido = barrido
            ? buildBarridoCollection(getBarridoVariantes(barrido))
            : barrido;
          setValData({ ...v, barridoEquivalencias: normalizedBarrido });
          // Siempre actualizar el último peso para los cálculos de G/kg (incluso en Edit)
          setPesoUltimo(v.peso || 0);

          // Sincroniza automáticamente un plan ya existente con el barrido ACTUAL de la valoración.
          // Sin esto, el plan se queda con el snapshot congelado que tenía cada menú al guardarse
          // la última vez, y el contador de faltantes nunca refleja cambios hechos en la valoración
          // después de crear el plan (había que editar a mano un campo del panel para que disparara).
          if (isEdit && normalizedBarrido) {
            // Usar los menus mapeados directamente para evitar race condition:
            // setMenus() del plan aún no se ha comprometido en React cuando llegamos aquí,
            // por lo que prevMenus en autoScaleIngredients tendría el estado vacío inicial.
            const syncMenus = (window as any).__pendingMappedMenus as Menu[] | undefined;
            delete (window as any).__pendingMappedMenus;
            autoScaleIngredients(normalizedBarrido, syncMenus);
          }

          // Logica especifica para crear uno nuevo (inicializar vacios, auto calcular macro iniciales)
          if (!isEdit) {
            // Merge: preservar suplementos ya en el plan + añadir los de la valoración que no estén duplicados
            setSuplementosDetalle(prev => {
              const valSups: any[] = v.suplementosDetalle || [];
              if (prev.length === 0) return valSups;
              const existingIds = new Set(prev.map((s: any) => s.id));
              const nuevos = valSups.filter((s: any) => !existingIds.has(s.id));
              return [...prev, ...nuevos];
            });
            if (v.getSedentario) setCalorias(Math.round(v.getSedentario).toString());

            if (normalizedBarrido?.tiempos?.length > 0) {
              const assessmentTiempos = normalizedBarrido.tiempos.map((t: BarridoTiempo) => ({
                barridoTiempoId: t.id,
                nombre: formatMealTimeName(t.nombre),
                ingredientes: [],
                nota: ''
              }));
              if (assessmentTiempos.length > 0) {
                const primaryBarrido = normalizedBarrido ? getBarridoVariantes(normalizedBarrido)[0] : null;
                setMenus([
                  { nombre: 'Menú 1', tipoContenido: 'platillos', barridoEquivalencias: primaryBarrido, tiempos: assessmentTiempos },
                  { nombre: 'Menú 2', tipoContenido: 'platillos', barridoEquivalencias: primaryBarrido ? JSON.parse(JSON.stringify(primaryBarrido)) : null, tiempos: JSON.parse(JSON.stringify(assessmentTiempos)) }
                ]);
              }
            }
          }
        }
        // Procesar platillos
        if (platillosRes?.data) {
          setPlatilloLibrary(platillosRes.data?.data || []);
        }

      } catch (e) {
        console.error("Error al cargar datos iniciales:", e);
      } finally {
        setLoadingInitialData(false);
      }
    };

    fetchAllData();
  }, [planId, isEdit, pacienteId, valoracionId, isBasePlan]);


  const cal = parseFloat(calorias) || 0;
  const pPct = parseFloat(proteinas) || 0;
  const cPct = parseFloat(carbohidratos) || 0;
  const gPct = parseFloat(grasas) || 0;
  const macroSum = pPct + cPct + gPct;

  // Energía del barrido — replica exactamente la lógica de BarridoEquivalencias.kcalTotalAuto:
  // por cada tiempo usa kcalManuales[tiempo] si existe, sino suma porciones × kcal/eq de la distribución
  const kcalBarrido = useMemo(() => {
    // Si la valoración ya fue guardada, el barrido vendrá poblado
    const b = valData?.barrido || valData?.barridoEquivalencias;
    if (!b) return 0;
    return b.kcalTotal || 0;
  }, [valData]);

  useEffect(() => {
    if (!isEdit && kcalBarrido && kcalBarrido > 0) {
      setCalorias(String(kcalBarrido));
    }
  }, [kcalBarrido, isEdit]);

  // Si ya existe una valoración y no es edición, forzamos que use el barrido
  useEffect(() => {
    if (valData?.barrido?.kcalTotal) {
      setCalorias(String(valData.barrido.kcalTotal));
    }
  }, [valData]);

  // Autofill agua natural — SOLO en comidas principales (Desayuno, Almuerzo, Comida, Cena)
  const isMainMeal = (nombre: string) =>
    /desayuno|almuerzo|comida|cena/i.test(nombre);
  useEffect(() => {
    if (!aguaNaturalDefault) return;
    if (!menus.length) return;
    let touched = false;
    const next = menus.map(menu => ({
      ...menu,
      tiempos: menu.tiempos.map(t => {
        if (!isMainMeal(t.nombre)) return t;
        if (!t.bebida || t.bebida.trim() === '') {
          touched = true;
          return { ...t, bebida: 'Agua natural 500ml' };
        }
        return t;
      })
    }));
    if (touched) setMenus(next);
  }, [menus, aguaNaturalDefault]);

  // Kcal por equivalente SMAE — acepta tanto el label de UI como la clave interna del backend
  const KCAL_EQ: Record<string, number> = {
    // Labels de UI (SmaeIngredientePicker los guarda así)
    'Verduras': 0, 'Frutas': 60, 'C y T sin grasa': 70, 'C y T con grasa': 115, 'Leguminosas': 120,
    'AOA muy bajo': 40, 'AOA bajo': 55, 'AOA moderado': 75, 'AOA alto': 100,
    'Leche descremada': 95, 'Leche semidescremada': 110, 'Leche entera': 150, 'Leche azucarada': 200,
    'A y G sin proteína': 45, 'A y G con proteína': 70, 'Az sin grasa': 40, 'Az con grasa': 85,
    // Claves internas del backend (planes precargados/editados)
    verduras: 0, frutas: 60, cerealSinGr: 70, cerealConGr: 115, leguminosas: 120,
    aoaMuyBajo: 40, aoaBajo: 55, aoaModerado: 75, aoaAlto: 100,
    lecheDesc: 95, lecheSemi: 110, lecheEntera: 150, lecheAz: 200,
    grasaSinProt: 45, grasaConProt: 70, azSinGr: 40, azConGr: 85,
    // Labels del SmaeIngredientePicker (GRUPO_LABELS - capitalized differently)
    'Cereal s/grasa': 70, 'Cereal c/grasa': 115,
    'AOA Muy Bajo': 40, 'AOA Bajo': 55, 'AOA Moderado': 75, 'AOA Alto': 100,
    'Leche Descrem.': 95, 'Leche Semi': 110, 'Leche Entera': 150, 'Leche Azucarada': 200,
    'Grasa s/prot': 45, 'Grasa c/prot': 70, 'Azúcar s/grasa': 40, 'Azúcar c/grasa': 85,
  };

  // Lookup tolerante a mayúsculas/minúsculas
  const lookupKcalEq = (grupo: string): number => {
    if (!grupo) return 0;
    if (KCAL_EQ[grupo] !== undefined) return KCAL_EQ[grupo];
    const lower = grupo.toLowerCase();
    const found = Object.keys(KCAL_EQ).find(k => k.toLowerCase() === lower);
    return found !== undefined ? KCAL_EQ[found] : 0;
  };

  // ─── LÓGICA DE MACROS DEL BARRIDO ───────────────────────────────────────────
  // Gramos aproximados por cada equivalente SMAE (P, C, G)
  const MACROS_SMAE: Record<string, { p: number; c: number; g: number }> = {
    verduras: { p: 2, c: 4, g: 0 },
    frutas: { p: 0, c: 15, g: 0 },
    cerealSinGr: { p: 2, c: 15, g: 0 },
    cerealConGr: { p: 2, c: 15, g: 5 },
    leguminosas: { p: 8, c: 20, g: 1 },
    aoaMuyBajo: { p: 7, c: 0, g: 1 },
    aoaBajo: { p: 7, c: 0, g: 3 },
    aoaModerado: { p: 7, c: 0, g: 5 },
    aoaAlto: { p: 7, c: 0, g: 8 },
    lecheDesc: { p: 9, c: 12, g: 2 },
    lecheSemi: { p: 9, c: 12, g: 4 },
    lecheEntera: { p: 9, c: 12, g: 8 },
    lecheAz: { p: 9, c: 30, g: 5 },
    grasaSinProt: { p: 0, c: 0, g: 5 },
    grasaConProt: { p: 3, c: 3, g: 5 },
    azSinGr: { p: 0, c: 10, g: 0 },
    azConGr: { p: 0, c: 10, g: 5 },
    // Aliases para nombres con espacios/mayúsculas del picker
    'Cereal s/grasa': { p: 2, c: 15, g: 0 }, 'Cereal c/grasa': { p: 2, c: 15, g: 5 },
    'AOA Muy Bajo': { p: 7, c: 0, g: 1 }, 'AOA Bajo': { p: 7, c: 0, g: 3 },
    'AOA Moderado': { p: 7, c: 0, g: 5 }, 'AOA Alto': { p: 7, c: 0, g: 8 },
    'Leche Descrem.': { p: 9, c: 12, g: 2 }, 'Leche Semi': { p: 9, c: 12, g: 4 },
    'Leche Entera': { p: 9, c: 12, g: 8 }, 'Leche Azucarada': { p: 9, c: 30, g: 5 },
    'Grasa s/prot': { p: 0, c: 0, g: 5 }, 'Grasa c/prot': { p: 3, c: 3, g: 5 },
    'Azúcar s/grasa': { p: 0, c: 10, g: 0 }, 'Azúcar c/grasa': { p: 0, c: 10, g: 5 },
  };

  const macrosBarridoResult = useMemo(() => {
    const b = valData?.barridoEquivalencias;
    if (!b?.porciones) return null;
    let p = 0; let c = 0; let g = 0;
    Object.entries(b.porciones).forEach(([grupo, cant]) => {
      const gNum = Number(cant) || 0;
      const m = MACROS_SMAE[grupo] || { p: 0, c: 0, g: 0 };
      p += gNum * m.p;
      c += gNum * m.c;
      g += gNum * m.g;
    });
    const totalKcal = (p * 4) + (c * 4) + (g * 9);
    if (totalKcal === 0) return null;
    return {
      pPct: Math.round((p * 4 / totalKcal) * 100),
      cPct: Math.round((c * 4 / totalKcal) * 100),
      gPct: Math.round((g * 9 / totalKcal) * 100),
    };
  }, [valData?.barridoEquivalencias?.porciones]);


  const menuKcalAverages = useMemo(() => ({ avg: 0, byMenu: [] }), []);

  const macroCalc = useMemo(() => ({
    pGr: (cal * pPct / 100) / 4, pGrKg: pesoUltimo > 0 ? ((cal * pPct / 100) / 4) / pesoUltimo : 0,
    cGr: (cal * cPct / 100) / 4, cGrKg: pesoUltimo > 0 ? ((cal * cPct / 100) / 4) / pesoUltimo : 0,
    gGr: (cal * gPct / 100) / 9, gGrKg: pesoUltimo > 0 ? ((cal * gPct / 100) / 9) / pesoUltimo : 0,
  }), [cal, pPct, cPct, gPct, pesoUltimo]);

  // Match plan tiempo ↔ columna de barrido por nombre + índice de ocurrencia,
  // para soportar dos tiempos con el mismo nombre (p.ej. dos "Colación"):
  // la 1ª Colación del plan toma la 1ª columna "Colación" del barrido, la 2ª toma la 2ª.
  const getBarridoTiempoNombre = (tiempo: unknown): string => {
    if (typeof tiempo === 'string' || typeof tiempo === 'number') return String(tiempo);
    if (tiempo && typeof tiempo === 'object') {
      const ref = tiempo as { id?: unknown; nombre?: unknown; label?: unknown };
      return String(ref.nombre ?? ref.label ?? ref.id ?? '');
    }
    return '';
  };

  const getBarridoTiempoKey = (tiempo: unknown): string => {
    if (tiempo && typeof tiempo === 'object') {
      const ref = tiempo as { id?: unknown; nombre?: unknown; label?: unknown };
      return String(ref.id ?? ref.nombre ?? ref.label ?? '');
    }
    return getBarridoTiempoNombre(tiempo);
  };

  const normalizeBarridoTiempo = (tiempo: unknown): string =>
    getBarridoTiempoNombre(tiempo).toLowerCase().trim();

  const findBarridoTiempo = (barridoTiempos: BarridoTiempo[], planTiempos: TiempoComida[], tiempoIdx: number): BarridoTiempo | undefined => {
    const norm = (s?: string) => (s || '').toLowerCase().trim();
    const planTiempo = planTiempos[tiempoIdx];
    if (planTiempo?.barridoTiempoId) {
      const byId = barridoTiempos.find(t => t.id === planTiempo.barridoTiempoId);
      if (byId) return byId;
    }
    const name = norm(planTiempo?.nombre);
    if (!name) return undefined;
    const occurrence = planTiempos.slice(0, tiempoIdx).filter(t => norm(t.nombre) === name).length;
    const candidates = barridoTiempos.filter(t => norm(t.nombre) === name);
    if (candidates[occurrence]) return candidates[occurrence];
    // Compatibilidad defensiva si un barrido histórico llega sin normalizar.
    if (occurrence > 0) {
      const altName = `${name} ${occurrence + 1}`;
      return barridoTiempos.find(t => norm(t.nombre) === altName);
    }
    return undefined;
  };

  const autoScaleIngredients = (nextBarridoData: BarridoCollection | BarridoData, baseMenus?: Menu[]) => {
    const variants = getBarridoVariantes(nextBarridoData);
    if (!variants.length) return;

    setMenus(prevMenus => (baseMenus ?? prevMenus).map(menu => {
      const assignedId = String(menu.barridoEquivalencias?.id || 'principal');
      const assignedBarrido = variants.find(item => item.id === assignedId) || variants[0];

      // ── PASO 1: reconciliar tiempos del menú con el barrido actualizado ──────
      // Se utiliza un conjunto de índices usados (usedIndices) para garantizar que NINGÚN
      // tiempo del menú sea reclamado más de una vez, evitando duplicación de platillos.
      const norm = (s?: string) => (s || '').toLowerCase().trim();
      const barridoTiempos = assignedBarrido.tiempos;
      const existingTiempos = menu.tiempos || [];
      const usedIndices = new Set<number>();

      const reconciliatedTiempos = barridoTiempos.map((barridoT, bIdx) => {
        // Intento 1: match por barridoTiempoId exacto
        let matchedIdx = barridoT.id
          ? existingTiempos.findIndex((t, i) => !usedIndices.has(i) && t.barridoTiempoId === barridoT.id)
          : -1;

        // Intento 2: match por nombre normalizado exacto
        if (matchedIdx === -1) {
          const bName = norm(barridoT.nombre);
          if (bName) {
            matchedIdx = existingTiempos.findIndex((t, i) => !usedIndices.has(i) && norm(t.nombre) === bName);
          }
        }

        // Intento 3: match por posición ordinal en la lista si la posición no ha sido tomada
        if (matchedIdx === -1 && bIdx < existingTiempos.length && !usedIndices.has(bIdx)) {
          matchedIdx = bIdx;
        }

        if (matchedIdx !== -1) {
          usedIndices.add(matchedIdx);
          const existing = existingTiempos[matchedIdx];
          return {
            ...existing,
            nombre: formatMealTimeName(barridoT.nombre),
            barridoTiempoId: barridoT.id,
            ingredientes: (existing.ingredientes || []).map(ing => ({
              ...ing,
              equivalencias: Array.isArray(ing.equivalencias) ? [...ing.equivalencias] : []
            }))
          };
        }

        // Nuevo tiempo en el barrido: se crea 100% vacío sin heredar platillos de otros tiempos
        return {
          barridoTiempoId: barridoT.id,
          nombre: formatMealTimeName(barridoT.nombre),
          ingredientes: [] as any[],
          nota: '',
          bebida: '',
          suplTiempo: '',
          suplNotas: '',
          ademas: '',
        };
      });

      // ── PASO 2: escalar ingredientes con el barrido nuevo ──────────────────
      const scaledTiempos = reconciliatedTiempos.map((tiempo, tIdx) => {
        const barridoTiempoKey = findBarridoTiempo(assignedBarrido.tiempos, reconciliatedTiempos, tIdx)?.id;

        if (!barridoTiempoKey) return tiempo;

        return {
          ...tiempo,
          ingredientes: tiempo.ingredientes.map((ing: any) => {
            // Determinar el grupo principal del ingrediente (legacy eqGrupo o primer item de equivalencias[])
            const mainGrupo = ing.eqGrupo ||
              (Array.isArray(ing.equivalencias) && ing.equivalencias.length > 0
                ? String(ing.equivalencias[0]?.grupo || '')
                : '');

            if (ing.platillo && mainGrupo) {
              const bKey = groupToBarridoKey(normalizeGroup(mainGrupo));
              const assignedEq = Number(assignedBarrido.distribucion[barridoTiempoKey]?.[bKey]) || 0;

              // Sin presupuesto (0) para este grupo en este tiempo = sin objetivo real, no "objetivo
              // cero". No hay número al cual escalar, así que no tocamos el ingrediente — ni lo
              // vaciamos ni lo multiplicamos. Se queda como venía del platillo; el contador lo marca
              // aparte como excedente/no presupuestado.
              if (assignedEq <= 0) {
                return ing;
              }

              // Ancla: si tenemos smaeGrPorEq (gramos por 1 eq del catálogo) la usamos directamente.
              // Solo aplica si la cantidad está en gramos: el ancla siempre es g/eq, así que en
              // unidades caseras (taza, pza…) desalinearía cantidad y unidad (ej. "300 taza").
              const unidadEsGramos = !ing.unidad || String(ing.unidad).toUpperCase().trim() === 'GR';
              const baseGrPorEq = unidadEsGramos && Number(ing.smaeGrPorEq) > 0
                ? Number(ing.smaeGrPorEq)
                : (unidadEsGramos && Number(ing.eqCantidad) > 0 ? Number(ing.cantidad) / Number(ing.eqCantidad) : 0);

              if (baseGrPorEq > 0) {
                const newCant = smartRound(baseGrPorEq * assignedEq);
                // Escalar equivalencias proporcionalmente. Si la cantidad original es 0/inválida no
                // hay proporción real que preservar — dejamos las secundarias sin tocar en vez de
                // dividir entre cero (eso producía Infinity/NaN y corrompía la BD al guardar).
                const origCant = Number(ing.cantidad) || 0;
                const factor = origCant > 0 ? newCant / origCant : 1;
                const newEquivs = Array.isArray(ing.equivalencias) && ing.equivalencias.length > 0
                  ? ing.equivalencias.map((e: any) => ({ ...e, cantidad: smartRound(Number(e.cantidad) * factor) }))
                  : (mainGrupo ? [{ cantidad: assignedEq, grupo: mainGrupo }] : []);
                return { ...ing, cantidad: newCant, eqCantidad: assignedEq, equivalencias: newEquivs };
              }

              const baseEq = Number(ing.eqCantidad) || 1;
              const rawCant = (Number(ing.cantidad) / baseEq) * Number(assignedEq);
              const newCant = smartRound(rawCant);
              return { ...ing, cantidad: newCant, eqCantidad: assignedEq };
            }
            return ing;
          })
        };
      });

      return {
        ...menu,
        barridoEquivalencias: assignedBarrido,
        tiempos: scaledTiempos,
      };
    }));
  };


  const updateMenu = (menuIdx: number, fn: (m: Menu) => Menu) => {
    setMenus(current => current.map((m, i) => i === menuIdx ? fn({ ...m }) : m));
  };

  const setMenuContentType = (menuIdx: number, tipoContenido: 'platillos' | 'equivalencias') => {
    updateMenu(menuIdx, menu => {
      if (tipoContenido === 'platillos') return { ...menu, tipoContenido };

      // Cada menú recibe su propia copia. Editar el barrido del Menú #1 no
      // modifica el del Menú #2 ni el barrido maestro de la valoración.
      const source = menu.barridoEquivalencias
        || getBarridoVariantes(valData?.barridoEquivalencias)[0]
        || null;
      return {
        ...menu,
        tipoContenido,
        barridoEquivalencias: {
          ...normalizeBarridoData(source ? JSON.parse(JSON.stringify(source)) : null),
          id: source?.id || 'principal',
          nombre: source?.nombre || 'Barrido 1',
        },
      };
    });
  };

  const assignBarridoToMenu = (menuIdx: number, variant: BarridoVariante) => {
    updateMenu(menuIdx, menu => ({
      ...menu,
      barridoEquivalencias: JSON.parse(JSON.stringify(variant)),
    }));
  };

  const updateTiempo = (menuIdx: number, tiempoIdx: number, fn: (t: TiempoComida) => TiempoComida) => {
    updateMenu(menuIdx, (m) => ({
      ...m,
      tiempos: m.tiempos.map((t, i) => i === tiempoIdx ? fn({ ...t }) : t),
    }));
  };

  const updateTiempoName = (tiempoIdx: number, nombre: string) => {
    const formatted = formatMealTimeName(nombre);
    setMenus(prev => prev.map(menu => ({
      ...menu,
      tiempos: menu.tiempos.map((tiempo, index) =>
        index === tiempoIdx ? { ...tiempo, nombre: formatted } : tiempo
      ),
    })));
  };

  const moveTiempo = (menuIdx: number, tiempoIdx: number, dir: -1 | 1) => {
    void menuIdx;
    setMenus(prev => reorderMealTimes(prev, tiempoIdx, tiempoIdx + dir));
  };

  const dropTiempo = (targetIdx: number) => {
    if (draggedTiempoIdx !== null) {
      setMenus(prev => reorderMealTimes(prev, draggedTiempoIdx, targetIdx));
    }
    setDraggedTiempoIdx(null);
    setDragOverTiempoIdx(null);
  };


  const movePlatillo = (menuIdx: number, tiempoIdx: number, groupIdx: number, dir: -1 | 1) => {
    updateTiempo(menuIdx, tiempoIdx, (t) => {
      return { ...t, ingredientes: reorderDishGroups(t.ingredientes, groupIdx, groupIdx + dir) };
    });
  };

  const moveIngredient = (menuIdx: number, tiempoIdx: number, ingredientIdx: number, dir: -1 | 1) => {
    updateTiempo(menuIdx, tiempoIdx, (t) => {
      const platillo = t.ingredientes[ingredientIdx]?.platillo || '';
      const groupIndices = t.ingredientes.map((item, index) => ({ item, index }))
        .filter(({ item }) => (item.platillo || '') === platillo)
        .map(({ index }) => index);
      const localIndex = groupIndices.indexOf(ingredientIdx);
      const targetIndex = groupIndices[localIndex + dir];
      if (targetIndex === undefined) return t;
      return { ...t, ingredientes: reorderIngredientWithinDish(t.ingredientes, ingredientIdx, targetIndex) };
    });
  };

  const dropIngredient = (menuIdx: number, tiempoIdx: number, event: DragEndEvent) => {
    if (!event.over || event.active.id === event.over.id) return;
    const overId = event.over.id;
    updateTiempo(menuIdx, tiempoIdx, (tiempo) => ({
      ...tiempo,
      ingredientes: reorderIngredientFromDrag(tiempo.ingredientes, event.active.id, overId),
    }));
  };

  // ─── Guardar tiempo como Platillo en la biblioteca ──────────────────────────
  const handleSaveTiempoAsPlatillo = async () => {
    if (!savePlatilloModal) return;
    const { mIdx, tIdx, nombre, categoria } = savePlatilloModal;
    const tiempo = menus[mIdx]?.tiempos[tIdx];
    if (!tiempo || !nombre.trim()) return;

    setSavingPlatillo(true);
    try {
      const ingredientes = tiempo.ingredientes.map(ing => {
        // Filtrar equivalencias vacías que se generan cuando el usuario escribe libre sin
        // seleccionar del catálogo SMAE. Si el array está vacío tras el filtro, reconstruir
        // desde eqGrupo/eqCantidad (legacy) si existen.
        const rawEquivs = (ing.equivalencias || []).filter(
          (e) => e.grupo && String(e.grupo).trim() !== '' && e.cantidad !== '' && e.cantidad != null
        );
        const equivalencias = rawEquivs.length > 0
          ? rawEquivs
          : ing.eqGrupo ? [{ cantidad: ing.eqCantidad, grupo: normalizeGroup(ing.eqGrupo) }] : [];

        return {
          descripcion: ing.descripcion,
          cantidad: ing.cantidad,
          unidad: ing.unidad,
          platillo: ing.platillo || '',
          equivalencias,
          eqCantidad: ing.eqCantidad,
          eqGrupo: ing.eqGrupo ? normalizeGroup(ing.eqGrupo) : '',
          smaeGrPorEq: ing.smaeGrPorEq,
          alimentoSmaeId: ing.alimentoSmaeId,
        };
      });

      const { data } = await api.post('/api/platillos', { nombre: nombre.trim(), categoria, ingredientes });
      const saved = data?.data || data;
      setPlatilloLibrary(prev => [...prev, saved]);
      setSavePlatilloModal(null);
      toast({ title: 'Platillo guardado ✅', description: `"${nombre}" está disponible en tu biblioteca.` });
    } catch (err: any) {
      const duplicado = err?.response?.status === 409;
      toast({
        title: duplicado ? 'Ya existe' : 'Error',
        description: err?.response?.data?.error || 'No se pudo guardar el platillo.',
        variant: 'destructive',
      });
    } finally {
      setSavingPlatillo(false);
    }
  };

  // ─── Presupuesto de equivalencias por tiempo (del barrido) ──────────────────
  const getBudgetForTiempo = (tiempo: TiempoComida, planTiempos?: TiempoComida[], tiempoIdx?: number, assignedBarrido?: any): { label: string; groupKey: string; used: number; budget: number; missing: number; isExtra?: boolean }[] => {
    const barridoData = assignedBarrido || getBarridoVariantes(valData?.barridoEquivalencias)[0];
    if (!barridoData?.tiempos || !barridoData?.distribucion) return [];

    // Con contexto del menú usamos matching por ocurrencia (soporta dos "Colación")
    const barridoTiempoKey = (planTiempos && tiempoIdx !== undefined)
      ? findBarridoTiempo(barridoData.tiempos, planTiempos, tiempoIdx)?.id
      : (
        barridoData.tiempos.find((t: BarridoTiempo) => t.id === tiempo.barridoTiempoId)?.id
        || barridoData.tiempos.find(
          (t: BarridoTiempo) => normalizeBarridoTiempo(t) === normalizeBarridoTiempo(tiempo.nombre)
        )?.id
      );
    if (!barridoTiempoKey) return [];
    const dist = barridoData.distribucion[barridoTiempoKey] || {};

    const budgetedKeys = new Set(Object.keys(dist).filter(k => Number(dist[k]) > 0));

    const helper = (barridoKey: string) => {
      let used = 0;
      tiempo.ingredientes.forEach(ing => {
        const eqs = ing.equivalencias && ing.equivalencias.length > 0
          ? ing.equivalencias
          : (ing.eqGrupo ? [{ cantidad: ing.eqCantidad, grupo: ing.eqGrupo }] : []);
        eqs.forEach((eq: any) => {
          if (groupToBarridoKey(normalizeGroup(String(eq.grupo))) === barridoKey) {
            used += Number(eq.cantidad) || 0;
          }
        });
      });
      return parseFloat(used.toFixed(2));
    };

    const canonLabel = (barridoKey: string) => {
      const entry = Object.entries(CANONICAL_TO_BARRIDO_KEY).find(([, v]) => v === barridoKey);
      return entry ? entry[0] : barridoKey;
    };

    const budgetedItems = Array.from(budgetedKeys).map(barridoKey => {
      const budget = Number(dist[barridoKey]);
      const used = helper(barridoKey);
      return { label: canonLabel(barridoKey), groupKey: barridoKey, used, budget, missing: parseFloat((budget - used).toFixed(2)) };
    });

    // Grupos extra: en ingredientes pero SIN presupuesto en este tiempo
    const extraTotals: Record<string, number> = {};
    tiempo.ingredientes.forEach(ing => {
      const eqs = ing.equivalencias && ing.equivalencias.length > 0
        ? ing.equivalencias
        : (ing.eqGrupo ? [{ cantidad: ing.eqCantidad, grupo: ing.eqGrupo }] : []);
      eqs.forEach((eq: any) => {
        if (!eq.grupo) return;
        const key = groupToBarridoKey(normalizeGroup(String(eq.grupo)));
        if (!budgetedKeys.has(key) && Number(eq.cantidad) > 0) {
          extraTotals[key] = (extraTotals[key] || 0) + (Number(eq.cantidad) || 0);
        }
      });
    });

    const extraItems = Object.entries(extraTotals).map(([barridoKey, used]) => ({
      label: canonLabel(barridoKey),
      groupKey: barridoKey,
      used: parseFloat(used.toFixed(2)),
      budget: 0,
      missing: parseFloat((-used).toFixed(2)),
      isExtra: true,
    }));

    return [...budgetedItems, ...extraItems];
  };

  const [savingBarrido, setSavingBarrido] = useState(false);

  const handleActualizarBarrido = async () => {
    if (!valData?.barridoEquivalencias || !pacienteId || !valoracionId) return;
    setSavingBarrido(true);
    try {
      await api.post(`/api/pacientes/${pacienteId}/valoraciones/${valoracionId}/barrido`, valData.barridoEquivalencias);
      autoScaleIngredients(valData.barridoEquivalencias);
      toast({ title: 'Barrido actualizado y sincronizado', description: 'Se guardaron los cambios en la valoración y se ajustaron los tiempos del menú.' });
    } catch (err: any) {
      toast({ title: 'Error al actualizar barrido', description: err.response?.data?.message || 'No se pudo guardar el barrido.', variant: 'destructive' });
    } finally {
      setSavingBarrido(false);
    }
  };

  const handleSave = async () => {
    if (macroSum !== 100) {
      toast({ title: 'ERROR ESTRATÉGICO', description: 'La distribución de macronutrientes debe sumar el 100% de la carga energética.', variant: 'destructive' });
      return;
    }
    // Mejora: validar nombre de plan si es base
    if (isBasePlan && !nombrePlan.trim()) {
      toast({ title: 'Nombre requerido', description: 'Por favor asigna un nombre al menú antes de guardarlo.', variant: 'destructive' });
      return;
    }
    setSaving(true);
    // Flush de renombres de platillo pendientes (el commit normal es onBlur;
    // si el usuario guarda sin blurear el input, el draft se perdería)
    let menusToSave = menus;
    const draftEntries = Object.entries(platilloDrafts);
    if (draftEntries.length > 0) {
      menusToSave = menus.map(m => ({ ...m, tiempos: m.tiempos.map(t => ({ ...t, ingredientes: [...t.ingredientes] })) }));
      for (const [key, draft] of draftEntries) {
        const finalName = (draft || '').trim();
        if (!finalName) continue;
        const [dMi, dTi, dPIndex] = key.split('-').map(Number);
        const tiempoDraft = menusToSave[dMi]?.tiempos?.[dTi];
        if (!tiempoDraft) continue;
        const names = Array.from(new Set(tiempoDraft.ingredientes.map(i => i.platillo || '')));
        const prevName = names[dPIndex];
        if (prevName === undefined || finalName === prevName) continue;
        tiempoDraft.ingredientes = tiempoDraft.ingredientes.map(ing =>
          (ing.platillo || '') === prevName ? { ...ing, platillo: finalName } : ing
        );
      }
      setMenus(menusToSave);
      setPlatilloDrafts({});
    }
    const body: any = {
      nombre: nombrePlan,
      tipoPlan: tipo,
      calorias: parseFloat(calorias),
      proteinasPct: parseFloat(proteinas),
      carbohidratosPct: parseFloat(carbohidratos),
      grasasPct: parseFloat(grasas),
      proximaSesion,
      proximaSesionHora,
      menus: menusToSave.map((m, mIdx) => ({
        nombre: m.nombre,
        orden: mIdx + 1,
        tipoContenido: m.tipoContenido === 'equivalencias' ? 'equivalencias' : 'platillos',
        barridoEquivalencias: m.barridoEquivalencias || null,
        tiemposComida: m.tiempos.map((t, tIdx) => {
          let injectedNota = t.nota || '';
          if (t.ademas && t.ademas.trim()) {
            injectedNota += `\n<!--META:${JSON.stringify({ ademas: t.ademas.trim() })}-->`;
          }
          return {
            nombre: t.nombre,
            barridoTiempoId: ((m.barridoEquivalencias?.tiempos
                || getBarridoVariantes(valData?.barridoEquivalencias)[0]?.tiempos)
                ? findBarridoTiempo(
                    (m.barridoEquivalencias?.tiempos
                      || getBarridoVariantes(valData?.barridoEquivalencias)[0]?.tiempos) as BarridoTiempo[],
                    m.tiempos,
                    tIdx
                  )?.id
                : undefined)
              || t.barridoTiempoId
              || null,
            orden: tIdx + 1,
            notaPie: injectedNota,
            bebida: t.bebida || '',
            suplTiempo: t.suplTiempo || '',
            suplNotas: t.suplNotas || '',
            ingredientes: t.ingredientes.map((i, iIdx) => ({
              ...i,
              orden: iIdx + 1,
              cantidad: String(i.cantidad),
              eqCantidad: String(i.eqCantidad || ''),
              smaeGrPorEq: Number(i.smaeGrPorEq) || 0,
              // Serializar explícitamente para no perder el array
              equivalencias: Array.isArray(i.equivalencias) ? i.equivalencias : []
            }))
          };
        })
      })),
      notasGenerales: notas,
      suplementosDetalle,
    };

    if (!isBasePlan) {
      body.valoracionId = valoracionId || undefined;
      body.getSeleccionado = cal;
      body.getSedentario = valData?.getSedentario || 0;
      body.getLeve = valData?.getLeve || 0;
      body.getModerado = valData?.getModerado || 0;
      body.getIntenso = valData?.getIntenso || 0;
    }

    try {
      let serverData;
      if (isEdit) {
        const url = isBasePlan ? `/api/planes/${planId}` : `/api/pacientes/${pacienteId}/planes/${planId}`;
        const { data } = await api.put(url, body);
        serverData = data?.data || data;
      } else {
        const url = isBasePlan ? `/api/planes` : `/api/pacientes/${pacienteId}/planes`;
        const { data } = await api.post(url, body);
        serverData = data?.data || data;
      }

      // Persistir cambios del barrido en la valoración si se modificó desde esta vista
      if (!isBasePlan && pacienteId && valoracionId && valData?.barridoEquivalencias) {
        try {
          await api.post(`/api/pacientes/${pacienteId}/valoraciones/${valoracionId}/barrido`, valData.barridoEquivalencias);
        } catch (e) {
          console.warn('No se pudo guardar el barrido actualizado en la valoración:', e);
        }
      }

      toast({ title: 'MENÚ GUARDADO' });

      // Invalidar cache para que Dashboard, Pendientes y perfil se actualicen
      invalidateAfterPlanChange(queryClient, pacienteId);

      if (onSaved) {
        onSaved(serverData?.id || planId);
      } else {
        const finalPlanId = serverData?.id || planId;
        navigate(isBasePlan ? '/planes' : `/pacientes/${pacienteId}/planes/${finalPlanId}`);
      }
    } catch (err: any) {
      toast({ title: 'Error de Persistencia', description: 'No se pudo sincronizar el menú maestro.', variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  const { confirm, ConfirmDialogComponent } = useConfirm();
  const alimentosAEvitar = buildAvoidFoods(
    valData?.evitar,
    pacienteInfo?.antecedentes?.alimentosNoGustan,
  );

  const handleRemoveMealTime = async (tiempoIdx: number, nombre: string) => {
    const ok = await confirm({
      title: `¿Eliminar ${nombre || 'este tiempo'}?`,
      description: 'Se quitará de ambos menús para conservar la alineación. Podrás recuperarlo desde el botón inferior sin perder sus alimentos.',
      confirmLabel: 'Eliminar tiempo',
      cancelLabel: 'Cancelar',
      variant: 'danger',
    });
    if (!ok) return;

    const result = removeMealTimeFromMenus(menus, tiempoIdx);
    setMenus(result.menus);
    if (result.removed) setRemovedMealTimes(stack => [...stack, result.removed!]);
  };

  const handleRestoreMealTime = () => {
    const removed = removedMealTimes.at(-1);
    if (!removed) return;
    setMenus(prev => restoreMealTimeToMenus(prev, removed));
    setRemovedMealTimes(stack => stack.slice(0, -1));
    toast({ title: 'TIEMPO RECUPERADO', description: 'Se agregó al final de ambos menús. Puedes arrastrarlo a cualquier posición.' });
  };

  const handleAppendMealTime = (nombre = 'Nuevo tiempo', barridoTiempoId?: string) => {
    setMenus(prev => appendMealTimeToMenus(prev, nombre, barridoTiempoId));
  };

  const handleRemoveDish = async (menuIdx: number, tiempoIdx: number, nombre: string) => {
    const ok = await confirm({
      title: `¿Eliminar el platillo “${nombre}”?`,
      description: 'Se quitarán sus ingredientes, pero podrás recuperarlos desde este mismo tiempo de comida.',
      confirmLabel: 'Eliminar platillo',
      cancelLabel: 'Cancelar',
      variant: 'danger',
    });
    if (!ok) return;
    const ingredientes = menus[menuIdx]?.tiempos[tiempoIdx]?.ingredientes.filter(item => (item.platillo || '') === nombre) || [];
    if (!ingredientes.length) return;
    setRemovedDishes(stack => [...stack, { menuIdx, tiempoIdx, nombre, ingredientes }]);
    updateTiempo(menuIdx, tiempoIdx, tiempo => ({
      ...tiempo,
      ingredientes: tiempo.ingredientes.filter(item => (item.platillo || '') !== nombre),
    }));
  };

  const handleRestoreDish = (removedIndex: number) => {
    const removed = removedDishes[removedIndex];
    if (!removed) return;
    updateTiempo(removed.menuIdx, removed.tiempoIdx, tiempo => ({
      ...tiempo,
      ingredientes: [...tiempo.ingredientes, ...removed.ingredientes],
    }));
    setRemovedDishes(stack => stack.filter((_, index) => index !== removedIndex));
  };

  const handleRemoveIngredient = (menuIdx: number, tiempoIdx: number, ingredientIdx: number) => {
    const ingrediente = menus[menuIdx]?.tiempos[tiempoIdx]?.ingredientes[ingredientIdx];
    if (!ingrediente) return;
    setRemovedIngredients(stack => [...stack, { menuIdx, tiempoIdx, ingrediente }]);
    updateTiempo(menuIdx, tiempoIdx, tiempo => ({
      ...tiempo,
      ingredientes: tiempo.ingredientes.filter((_, index) => index !== ingredientIdx),
    }));
  };

  const handleRestoreIngredient = (removedIndex: number) => {
    const removed = removedIngredients[removedIndex];
    if (!removed) return;
    updateTiempo(removed.menuIdx, removed.tiempoIdx, tiempo => ({
      ...tiempo,
      ingredientes: [...tiempo.ingredientes, removed.ingrediente],
    }));
    setRemovedIngredients(stack => stack.filter((_, index) => index !== removedIndex));
  };

  const handleDelete = async () => {
    const ok = await confirm({
      title: '¿Eliminar Menú?',
      description: 'Esta acción eliminará permanentemente el menú. No se puede deshacer.',
      confirmLabel: 'Sí, Eliminar',
      cancelLabel: 'Cancelar',
      variant: 'danger',
    });
    if (!ok) return;
    try {
      await api.delete(`/api/planes/${planId}`);
      toast({ title: 'MENÚ ELIMINADO' });
      invalidateAfterPlanChange(queryClient, pacienteId);
      navigate('/planes');
    } catch (err) {
      toast({ title: 'Error al eliminar', variant: 'destructive' });
    }
  };

  if (loadingInitialData) {
    return (
      <div className="space-y-8 animate-fade-in pb-20 max-w-none w-full mt-2">
        <div className="flex flex-col md:flex-row justify-between items-start md:items-end gap-6 pt-6 -mt-8 mb-4">
          <div className="space-y-4 w-full md:w-1/3">
            <div className="h-4 w-24 bg-[#111] animate-pulse rounded" />
            <div className="h-8 w-64 bg-[#111] animate-pulse rounded" />
            <div className="h-4 w-48 bg-[#111] animate-pulse rounded" />
          </div>
          <div className="h-10 w-32 bg-[#111] animate-pulse rounded" />
        </div>
        <div className="bg-[#111] rounded-[12px] h-64 border border-[#2a2a2a] animate-pulse" />
        <div className="grid md:grid-cols-2 gap-8 items-start">
          <div className="bg-[#111] rounded-[12px] h-96 border border-[#2a2a2a] animate-pulse" />
          <div className="bg-[#111] rounded-[12px] h-96 border border-[#2a2a2a] animate-pulse" />
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="animate-fade-in max-w-none w-full mt-2">
        <div className="sticky top-0 z-30 -mx-4 md:-mx-8 px-4 md:px-8 pt-3 -mt-8 mb-4 pb-3 bg-[#0a0a0a]/95 backdrop-blur-md border-b border-[#1a1a1a] flex flex-col md:flex-row justify-between items-start md:items-end gap-6">
          <div className="space-y-2">
            {(!onSaved || onCancel) && (
              <button onClick={() => onCancel ? onCancel() : navigate(isBasePlan ? '/planes' : `/pacientes/${pacienteId}`)} className="flex items-center gap-2 text-[14px] font-medium text-[#c0c0c0] hover:text-white transition-colors w-fit group mb-4">
                <ArrowLeft className="h-[18px] w-[18px] group-hover:-translate-x-1 transition-transform" /> {onCancel ? 'Salir Sin Guardar' : 'Volver'}
              </button>
            )}
            <div className="animate-slide-up space-y-1">
              <h1 className="text-[26px] font-bold text-white m-0 tracking-tight">
                {pacienteNombre ? pacienteNombre : isBasePlan ? (isEdit ? 'Editar Menú' : 'Nuevo Menú') : (isEdit ? 'Personalizar Menú' : 'Configurar Menú')}
              </h1>
              <p className="text-[#c0c0c0] font-normal text-[14px] m-0 uppercase tracking-widest">
                {pacienteNombre ? (isEdit ? 'Personalizar Menú' : 'Configurar Menú') : isBasePlan ? 'Definición de menú base para la biblioteca' : 'Ajuste de requerimientos y personalización de tiempos'}
              </p>
            </div>
          </div>

          <div className="flex flex-col sm:flex-row items-center gap-3 w-full sm:w-auto">
            {/* Botón Guardar Cambios / Generar Menú arriba - Ahora siempre visible */}
            <button
              onClick={handleSave}
              disabled={saving || macroSum !== 100}
              className="w-full sm:w-auto px-[18px] py-[10px] bg-brand-primary text-bg-base rounded-[8px] text-[14px] font-bold transition-all hover:bg-white flex items-center justify-center gap-2 shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {saving ? (
                <div className="w-[18px] h-[18px] border-2 border-white/20 border-t-white rounded-full animate-spin" />
              ) : (
                <Save className="h-[18px] w-[18px]" />
              )}
              {isEdit ? 'Guardar Cambios' : 'Guardar Menú'}
            </button>

          </div>

          {isBasePlan && isEdit && (
            <button
              onClick={handleDelete}
              className="px-[18px] py-[10px] bg-[#2e1a1a] text-accent-red border border-accent-red/20 text-[14px] font-medium rounded-[8px] hover:bg-[#3d1a1a] transition-colors flex items-center gap-2"
            >
              <Trash2 className="h-[18px] w-[18px]" /> Eliminar menú
            </button>
          )}
        </div>

        <div className="flex gap-5 items-start pb-20 pt-2">
          <div className="flex-1 min-w-0 space-y-6">
            {/* DASHBOARD DE REQUERIMIENTOS: Unificado en la parte superior */}
            <div className="bg-[#111111] p-8 rounded-[12px] animate-slide-up border border-[#2a2a2a] shadow-xl">
              <div className="flex flex-col gap-10">
                {/* CABECERA DE REQUERIMIENTOS: Unificada y Simplificada */}
                <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 items-center border-b border-[#2a2a2a] pb-8">
                  {/* Parte 1: Perfil Energético */}
                  <div className="lg:col-span-5 lg:border-r border-[#2a2a2a] lg:pr-10">
                    {isBasePlan ? (
                      <div className="space-y-4">
                        <div className="space-y-2">
                          <label className="text-[10px] font-bold text-[#666] uppercase tracking-widest ml-1">Nombre Menú</label>
                          <input
                            type="text"
                            value={nombrePlan}
                            onChange={(e) => setNombrePlan(e.target.value)}
                            placeholder="Ej: Balanceado 1800"
                            className="w-full bg-transparent text-[16px] font-bold text-white outline-none border-b border-transparent focus:border-brand-primary pb-1 transition-colors"
                          />
                        </div>
                        <div className="grid grid-cols-2 gap-4 pt-2">
                          <div className="space-y-1">
                            <span className="text-[9px] font-bold text-[#555] uppercase block">Kcal</span>
                            <input
                              type="number"
                              value={calorias}
                              onChange={(e) => setCalorias(e.target.value)}
                              className="w-full bg-transparent text-[28px] font-black text-brand-primary outline-none"
                            />
                          </div>
                          <div className="space-y-1">
                            <span className="text-[9px] font-bold text-[#555] uppercase block">Tipo</span>
                            <select
                              value={tipo}
                              onChange={(e) => setTipo(e.target.value)}
                              className="w-full bg-transparent text-[14px] font-bold text-white outline-none appearance-none cursor-pointer"
                            >
                              <option value="Balanceada">Balanceada</option>
                              <option value="Keto / Low Carb">Keto / Low Carb</option>
                              <option value="Vegetariana">Vegetariana</option>
                              <option value="Hipercalórica">Hipercalórica</option>
                              <option value="Hipocalórica">Hipocalórica</option>
                              <option value="Personalizada">Personalizada</option>
                            </select>
                          </div>
                        </div>
                      </div>
                    ) : (
                      <div className="space-y-4">
                        <div className="flex flex-col items-center lg:items-start group">
                          <span className="text-[10px] font-black text-[#666] uppercase tracking-widest mb-1 group-hover:text-brand-primary transition-colors">Meta Calórica Diaria</span>
                          <div className="flex items-baseline gap-2">
                            <span className="text-[44px] font-black text-white leading-none tracking-tighter">
                              {calorias || '—'}
                            </span>
                            <span className="text-[18px] font-bold text-brand-primary">kcal</span>
                          </div>
                          <div className="mt-3 flex items-center gap-2 bg-[#181818] px-3 py-1.5 rounded-full border border-[#333]">
                            <div className="w-1.5 h-1.5 rounded-full bg-brand-primary shadow-[0_0_8px_rgba(144,194,255,0.5)]" />
                            <span className="text-[10px] text-[#8a8a8a] font-bold uppercase tracking-tight">
                              {valData ? `Objetivo Estratégico Barrido #${valData.numeroValoracion}` : 'Asignación Manual'}
                            </span>
                          </div>
                        </div>
                      </div>
                    )}

                  </div>

                  {/* Parte 2: Requerimientos Esenciales (Macros y Objetivo) */}
                  <div className="lg:col-span-7">
                    {/* Dial de % Prot/Carb/Gras oculto en esta vista — se mantiene el estado
                        (proteinas/carbohidratos/grasas) para el guardado, solo no se edita aquí. */}
                    <div className="hidden grid-cols-3 gap-6">
                      {[
                        { label: 'Prot %', key: 'pPct', val: proteinas, set: setProteinas, color: '#ef8c8c', bg: 'rgba(239, 140, 140, 0.1)' },
                        { label: 'Carb %', key: 'cPct', val: carbohidratos, set: setCarbohidratos, color: '#90c2ff', bg: 'rgba(144, 194, 255, 0.1)' },
                        { label: 'Gras %', key: 'gPct', val: grasas, set: setGrasas, color: '#f5c842', bg: 'rgba(245, 200, 66, 0.1)' },
                      ].map((m) => (
                        <div key={m.label} className="group flex flex-col items-center">
                          <label
                            className="text-[10px] font-black uppercase tracking-[0.2em] mb-4 transition-colors"
                            style={{ color: m.color }}
                          >
                            {m.label}
                          </label>
                          <div className="relative w-full aspect-square max-w-[80px]">
                            {/* Círculo decorativo de fondo */}
                            <div className="absolute inset-0 rounded-full border-2 border-white/5 bg-[#111111] overflow-hidden">
                              <div className="absolute inset-0 opacity-20 blur-xl" style={{ backgroundColor: m.color }} />
                            </div>

                            <input
                              type="number"
                              value={m.val}
                              onChange={(e) => m.set(e.target.value)}
                              className="absolute inset-0 w-full h-full bg-transparent text-[20px] font-black text-center text-white outline-none z-10 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                            />

                            {/* Indicador de progreso circular (visual) */}
                            <svg className="absolute inset-0 w-full h-full -rotate-90 pointer-events-none" viewBox="0 0 100 100">
                              <circle
                                cx="50" cy="50" r="46"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="4"
                                className="text-white/5"
                              />
                              <circle
                                cx="50" cy="50" r="46"
                                fill="none"
                                stroke={m.color}
                                strokeWidth="4"
                                strokeDasharray={289}
                                strokeDashoffset={289 - (289 * (Number(m.val) || 0)) / 100}
                                strokeLinecap="round"
                                className="transition-all duration-1000 ease-out"
                              />
                            </svg>
                          </div>

                          {/* Objetivo del Barrido (Solo porcentaje) */}
                          {macrosBarridoResult && (
                            <div className="mt-3 flex flex-col items-center gap-0.5">
                              <span className="text-[8px] font-bold text-[#444] uppercase tracking-widest">Barrido</span>
                              <span className="text-[14px] font-black text-white/80 leading-none">
                                {macrosBarridoResult[m.key as keyof typeof macrosBarridoResult]}%
                              </span>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>

                    {macroSum !== 100 && (
                      <div className="mt-6 flex items-center justify-center gap-2 text-rose-500 bg-rose-500/5 py-2 rounded-lg border border-rose-500/10">
                        <div className="w-1.5 h-1.5 rounded-full bg-rose-500 animate-pulse" />
                        <span className="text-[10px] font-black uppercase tracking-widest">Suma {macroSum}% (Ajuste a 100%)</span>
                      </div>
                    )}

                    {/* Toggle agua natural en comidas principales */}
                    <div className="mt-6 flex items-center justify-between px-4 py-3 bg-[#0e1a2a] rounded-[10px] border border-[#1a3050] transition-all">
                      <div className="flex items-center gap-2">
                        <Droplets className="w-4 h-4 text-[#3a9eff]" />
                        <span className="text-[12px] font-bold text-[#c0c0c0] uppercase tracking-wider">Agua natural en todos los tiempos</span>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          const newVal = !aguaNaturalDefault;
                          setAguaNaturalDefault(newVal);
                          if (newVal) {
                            // Auto-fill bebida SOLO en comidas principales (no colaciones)
                            setMenus(prev => prev.map(menu => ({
                              ...menu,
                              tiempos: menu.tiempos.map(t => {
                                if (!isMainMeal(t.nombre)) return t; // B3: colaciones sin bebida
                                if (!t.bebida || t.bebida.trim() === '') {
                                  return { ...t, bebida: 'Agua natural 500ml' };
                                }
                                return t;
                              })
                            })));
                          }
                        }}
                        className={`relative w-11 h-6 rounded-full transition-colors duration-300 ease-in-out ${aguaNaturalDefault ? 'bg-[#3a9eff]' : 'bg-[#333]'}`}
                      >
                        <div className={`absolute top-[2px] left-[2px] w-[20px] h-[20px] bg-white rounded-full transition-transform duration-300 ${aguaNaturalDefault ? 'translate-x-[20px]' : 'translate-x-0'}`} />
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* TABLA DE EQUIVALENCIAS (BARRIDO) */}
            {!isBasePlan && valData?.barridoEquivalencias && (
              <div className="bg-[#111] rounded-[12px] border border-[#2a2a2a] overflow-hidden">
                <div
                  className="bg-[#181818] px-6 py-4 flex items-center justify-between cursor-pointer hover:bg-[#1d1d1d] transition-all"
                  onClick={() => setShowBarridoRef(!showBarridoRef)}
                >
                  <div className="flex items-center gap-3">
                    <div className="p-2 bg-brand-primary/10 rounded-lg">
                      <Activity className="h-4 w-4 text-brand-primary" />
                    </div>
                    <div>
                      <h3 className="text-[14px] font-bold text-white uppercase tracking-wider">Carga Estratégica de Equivalencias (Barrido)</h3>
                      <p className="text-[11px] text-[#8a8a8a]">Sincronización automática con porciones asignadas</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <ChevronDown className={`h-5 w-5 text-[#555] transition-transform duration-300 ${showBarridoRef ? 'rotate-180' : ''}`} />
                  </div>
                </div>

                {showBarridoRef && (
                  <div className="p-6 border-t border-[#2a2a2a] animate-in fade-in slide-in-from-top-2 duration-300 space-y-4">
                    <BarridosEquivalenciasManager
                      value={valData.barridoEquivalencias}
                      onChange={(data) => {
                        setValData({ ...valData, barridoEquivalencias: data });
                        autoScaleIngredients(data);
                      }}
                    />
                    <div className="flex items-center justify-between pt-4 mt-2 border-t border-[#2a2a2a]">
                      <div className="text-[12px] text-accent-red font-medium">
                        {valData?.barridoEquivalencias && getBarridoVariantes(valData.barridoEquivalencias).some(item => item.isValid === false) && (
                          <span className="flex items-center gap-1.5"><AlertCircle className="w-4 h-4" /> La distribución de comidas no descuadra con las porciones planeadas.</span>
                        )}
                      </div>
                      <button
                        type="button"
                        onClick={handleActualizarBarrido}
                        disabled={savingBarrido || !valData?.barridoEquivalencias}
                        className="flex items-center gap-2 px-5 py-2.5 bg-brand-primary text-bg-base rounded-[8px] text-[13px] font-bold hover:bg-[#e0e0e0] transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {savingBarrido ? (
                          <div className="w-4 h-4 border-2 border-white/20 border-t-white dark:border-black/20 dark:border-t-black rounded-full animate-spin" />
                        ) : (
                          <CheckCircle2 className="w-4 h-4" />
                        )}
                        Actualizar barrido
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* SECCIÓN DE MENÚS */}
            <div className="grid md:grid-cols-2 gap-8 items-start">
              {menus.map((menu, mi) => (
                <div key={mi} className="bg-[#111111] rounded-[12px] animate-slide-up border border-[#2a2a2a] flex flex-col h-full ring-1 ring-border-default hover:ring-border-subtle transition-all" style={{ animationDelay: `${mi * 0.1}s` }}>
                  <div className="bg-[#181818] border-b border-[#2a2a2a] px-6 py-4 space-y-3">
                    <div className="flex items-center justify-between gap-3">
                      <input
                        value={menu.nombre}
                        onChange={(e) => updateMenu(mi, (m) => ({ ...m, nombre: e.target.value }))}
                        className="text-[16px] font-semibold bg-transparent border-none outline-none w-full text-white selection:bg-brand-primary placeholder:text-[#8a8a8a]"
                        placeholder="Nombre del menú"
                      />
                      <button
                        onClick={() => setMenus(menus.filter((_, i) => i !== mi))}
                        className="p-2 text-[#8a8a8a] hover:text-accent-red hover:bg-[#2e1a1a] rounded-[6px] transition-colors"
                        title="Eliminar menú"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>

                    {!isBasePlan && (
                      <div className="space-y-2">
                        <div className="flex items-center gap-1 rounded-[8px] bg-[#0d0d0d] border border-[#2a2a2a] p-1">
                          <button
                            type="button"
                            onClick={() => setMenuContentType(mi, 'platillos')}
                            className={`flex-1 px-3 py-2 rounded-[6px] text-[11px] font-bold uppercase tracking-wide transition-colors ${
                              menu.tipoContenido !== 'equivalencias'
                                ? 'bg-brand-primary text-black'
                                : 'text-[#8a8a8a] hover:text-white hover:bg-[#202020]'
                            }`}
                          >
                            Platillos
                          </button>
                          <button
                            type="button"
                            onClick={() => setMenuContentType(mi, 'equivalencias')}
                            className={`flex-1 px-3 py-2 rounded-[6px] text-[11px] font-bold uppercase tracking-wide transition-colors ${
                              menu.tipoContenido === 'equivalencias'
                                ? 'bg-brand-primary text-black'
                                : 'text-[#8a8a8a] hover:text-white hover:bg-[#202020]'
                            }`}
                          >
                            Solo equivalencias
                          </button>
                        </div>
                        {getBarridoVariantes(valData?.barridoEquivalencias).length > 1 && (
                          <label className="flex items-center gap-2 rounded-[8px] border border-[#2a2a2a] bg-[#0d0d0d] px-3 py-2">
                            <span className="text-[10px] font-bold uppercase tracking-wide text-[#8a8a8a]">
                              Barrido asignado
                            </span>
                            <select
                              value={String(menu.barridoEquivalencias?.id || 'principal')}
                              onChange={event => {
                                const selected = getBarridoVariantes(valData?.barridoEquivalencias)
                                  .find(item => item.id === event.target.value);
                                if (selected) assignBarridoToMenu(mi, selected);
                              }}
                              className="ml-auto rounded-[6px] border border-[#333] bg-[#181818] px-2 py-1.5 text-[11px] font-semibold text-white outline-none"
                            >
                              {getBarridoVariantes(valData?.barridoEquivalencias).map(variant => (
                                <option key={variant.id} value={variant.id}>{variant.nombre}</option>
                              ))}
                            </select>
                          </label>
                        )}
                      </div>
                    )}
                  </div>

                  <div className="p-6 space-y-6 flex-1 flex flex-col">
                    {menu.tiempos.map((tiempo, ti) => (
                      <div
                        key={ti}
                        onDragOver={(event) => {
                          if (draggedTiempoIdx === null) return;
                          event.preventDefault();
                          setDragOverTiempoIdx(ti);
                        }}
                        onDrop={(event) => {
                          if (draggedTiempoIdx === null) return;
                          event.preventDefault();
                          dropTiempo(ti);
                        }}
                        className={`p-4 rounded-[8px] border bg-[#181818] group relative transition-all ${
                          dragOverTiempoIdx === ti && draggedTiempoIdx !== ti
                            ? 'border-brand-primary ring-1 ring-brand-primary/50'
                            : 'border-[#2a2a2a]'
                        } ${draggedTiempoIdx === ti ? 'opacity-45' : ''}`}
                      >
                        <div className="flex items-center gap-3 mb-4">
                          <div className="flex items-center gap-1 shrink-0 pr-3 border-r border-[#3a3a3a]">
                            <button
                              type="button"
                              draggable
                              onDragStart={(event) => {
                                setDraggedTiempoIdx(ti);
                                event.dataTransfer.effectAllowed = 'move';
                                event.dataTransfer.setData('text/plain', String(ti));
                              }}
                              onDragEnd={() => {
                                setDraggedTiempoIdx(null);
                                setDragOverTiempoIdx(null);
                              }}
                              className="p-1.5 text-[#b0b0b0] bg-[#222] border border-[#3a3a3a] hover:text-white hover:border-[#666] rounded-[6px] cursor-grab active:cursor-grabbing transition-colors"
                              title="Arrastrar para reordenar en ambos menús"
                              aria-label={`Arrastrar ${tiempo.nombre} para reordenar`}
                            >
                              <GripVertical className="h-4 w-4" />
                            </button>
                            <button type="button" onClick={() => moveTiempo(mi, ti, -1)} disabled={ti === 0} className="p-1.5 text-[#a0a0a0] disabled:opacity-20 hover:text-white rounded-[6px] hover:bg-[#333] transition-colors" title="Subir tiempo">
                              <ChevronUp className="h-3.5 w-3.5" />
                            </button>
                            <button type="button" onClick={() => moveTiempo(mi, ti, 1)} disabled={ti === menu.tiempos.length - 1} className="p-1.5 text-[#a0a0a0] disabled:opacity-20 hover:text-white rounded-[6px] hover:bg-[#333] transition-colors" title="Bajar tiempo">
                              <ChevronDown className="h-3.5 w-3.5" />
                            </button>
                          </div>
                          <input
                            value={formatMealTimeName(tiempo.nombre)}
                            onChange={(e) => updateTiempoName(ti, e.target.value)}
                            className="text-[14px] font-semibold text-white bg-transparent border-none outline-none min-w-0 flex-1 uppercase tracking-wide"
                            placeholder="NOMBRE DEL TIEMPO"
                          />
                          <button
                            type="button"
                            onClick={() => void handleRemoveMealTime(ti, tiempo.nombre)}
                            className="ml-auto p-2 text-[#d57a7a] border border-[#5a2929] bg-[#281818] hover:text-white hover:bg-[#7f1d1d] rounded-[6px] transition-colors shrink-0"
                            title="Eliminar este tiempo de ambos menús"
                            aria-label={`Eliminar ${tiempo.nombre}`}
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>

                        {/* ─── Bebida y Suplemento alineados al título del tiempo ─── */}
                        <div className="flex flex-col gap-1 mb-3 px-1">
                          <div className="flex items-center gap-2">
                            <Droplets className="w-3.5 h-3.5 text-[#3a9eff] shrink-0" />
                            <input
                              type="text"
                              placeholder="Bebida (ej: 500ml agua con limón)"
                              value={tiempo.bebida || ''}
                              onFocus={(e) => {
                                if (e.target.value === 'Agua natural 500ml') {
                                  updateTiempo(mi, ti, t => ({ ...t, bebida: '' }));
                                }
                              }}
                              onChange={(e) => updateTiempo(mi, ti, t => ({ ...t, bebida: e.target.value }))}
                              onBlur={(e) => {
                                // B3: solo restaurar agua en comidas principales, no en colaciones
                                if (!e.target.value.trim() && aguaNaturalDefault && isMainMeal(tiempo.nombre)) {
                                  updateTiempo(mi, ti, t => ({ ...t, bebida: 'Agua natural 500ml' }));
                                }
                              }}
                              className={`flex-1 bg-transparent text-[13px] font-bold placeholder:text-[#999] placeholder:font-medium outline-none border-b border-transparent focus:border-[#3a9eff]/40 transition-colors py-0.5 ${tiempo.bebida === 'Agua natural 500ml'
                                  ? 'text-[#888]'    // B6: autofill opaco para diferenciarlo del valor personalizado
                                  : 'text-white'     // valor personalizado: blanco
                                }`}
                            />
                          </div>
                          <div className="flex items-center gap-2">
                            <Pill className="w-3.5 h-3.5 text-[#a97fff] shrink-0" />
                            <input
                              type="text"
                              placeholder="Suplemento del tiempo (ej: 1 scoop Whey)"
                              value={tiempo.suplTiempo || ''}
                              onChange={(e) => updateTiempo(mi, ti, t => ({ ...t, suplTiempo: e.target.value }))}
                              className="flex-1 bg-transparent text-[13px] font-bold text-white placeholder:text-[#999] placeholder:font-medium outline-none border-b border-transparent focus:border-[#a97fff]/40 transition-colors py-0.5"
                            />
                          </div>
                        </div>

                        {/* ─── Panel Presupuesto Colapsable ─── */}
                        {(() => {
                          const budgetKey = `${mi}-${ti}`;
                          const budgetItems = getBudgetForTiempo(tiempo, menu.tiempos, ti, menu.barridoEquivalencias);
                          if (budgetItems.length === 0) return null;
                          const isOpen = showBudgetMap[budgetKey] !== false; // Abierto por defecto
                          return (
                            <div className="mb-3 rounded-[6px] border border-[#2a2a2a] overflow-hidden">
                              <button
                                onClick={() => setShowBudgetMap(prev => ({ ...prev, [budgetKey]: !prev[budgetKey] }))}
                                className="w-full flex items-center justify-between px-3 py-2 text-[9px] font-black text-[#555] uppercase tracking-widest hover:bg-[#181818] transition-colors"
                              >
                                <span>Presupuesto de Equivalencias</span>
                                <ChevronDown className={`h-3 w-3 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
                              </button>
                              {isOpen && (
                                <div className="px-3 pb-3 space-y-2 bg-[#111]">
                                  {budgetItems.map(({ label, used, budget: bdgt, isExtra }) => {
                                    if (isExtra) {
                                      return (
                                        <div key={`extra-${label}`}>
                                          <div className="flex items-center justify-between mb-0.5">
                                            <span className="text-[11px] font-semibold text-red-400">{label}</span>
                                            <span className="text-[10px] font-bold tabular-nums text-red-400">+{used} eq · No presupuestado</span>
                                          </div>
                                          <div className="w-full h-1.5 bg-[#2e1a1a] rounded-full overflow-hidden">
                                            <div className="h-full rounded-full bg-red-500 transition-all duration-300" style={{ width: '100%' }} />
                                          </div>
                                        </div>
                                      );
                                    }
                                    const pct = Math.min((used / bdgt) * 100, 100);
                                    const over = used > bdgt;
                                    const done = !over && pct >= 85;
                                    const barColor = over ? '#ef4444' : done ? '#22c55e' : '#555';
                                    const textColor = over ? 'text-red-400' : done ? 'text-green-400' : 'text-[#8a8a8a]';
                                    return (
                                      <div key={label}>
                                        <div className="flex items-center justify-between mb-0.5">
                                          <span className="text-[11px] font-semibold text-white">{label}</span>
                                          <span className={`text-[10px] font-bold tabular-nums ${textColor}`}>
                                            {used} / {bdgt} eq {over ? `⚠ +${parseFloat((used - bdgt).toFixed(2))} extra` : done ? '✓' : ''}
                                          </span>
                                        </div>
                                        <div className="w-full h-1.5 bg-[#222] rounded-full overflow-hidden">
                                          <div className="h-full rounded-full transition-all duration-300" style={{ width: `${pct}%`, background: barColor }} />
                                        </div>
                                      </div>
                                    );
                                  })}
                                </div>
                              )}
                            </div>
                          );
                        })()}

                        <div className="space-y-6">
                          {Array.from(new Set(tiempo.ingredientes.map(i => i.platillo || ''))).map((pName, pIndex) => (
                            <div
                              key={`${mi}-${ti}-${pIndex}`}
                              onDragOver={(event) => {
                                const activeDish = draggedDishRef.current || draggedDish;
                                if (!activeDish || activeDish.menuIdx !== mi || activeDish.tiempoIdx !== ti) return;
                                event.preventDefault();
                                setDragOverDishIdx(pIndex);
                              }}
                              onDrop={(event) => {
                                const activeDish = draggedDishRef.current || draggedDish;
                                if (!activeDish || activeDish.menuIdx !== mi || activeDish.tiempoIdx !== ti) return;
                                event.preventDefault();
                                updateTiempo(mi, ti, current => ({
                                  ...current,
                                  ingredientes: reorderDishGroups(current.ingredientes, activeDish.groupIdx, pIndex),
                                }));
                                clearNativeDragState();
                              }}
                              className={pName ? `p-3 bg-[#111111] border rounded-[8px] transition-all ${draggedDish?.menuIdx === mi && draggedDish?.tiempoIdx === ti && dragOverDishIdx === pIndex && draggedDish.groupIdx !== pIndex ? 'border-brand-primary ring-1 ring-brand-primary/40' : 'border-[#333]'}` : ''}
                            >
                              {pName ? (<div className="flex items-center gap-2 mb-3 pb-2 border-b border-[#2a2a2a] border-dashed">
                                <div className="flex items-center gap-1 shrink-0 pr-2 border-r border-[#333]">
                                  <button
                                    type="button"
                                    draggable
                                    onDragStart={(event) => {
                                      const activeDish = { menuIdx: mi, tiempoIdx: ti, groupIdx: pIndex };
                                      draggedDishRef.current = activeDish;
                                      setDraggedDish(activeDish);
                                      beginNativeDrag(event.dataTransfer, 'dish', activeDish);
                                    }}
                                    onDragEnd={clearNativeDragState}
                                    className="p-1.5 text-[#b0b0b0] bg-[#222] border border-[#3a3a3a] hover:text-white rounded-[5px] cursor-grab active:cursor-grabbing"
                                    title="Arrastrar platillo"
                                  >
                                    <GripVertical className="h-3.5 w-3.5" />
                                  </button>
                                  <button type="button" onClick={() => movePlatillo(mi, ti, pIndex, -1)} disabled={pIndex === 0} className="p-1 text-[#999] disabled:opacity-20 hover:text-white rounded-[4px] hover:bg-[#2a2a2a]" title="Subir platillo">
                                    <ChevronUp className="h-3 w-3" />
                                  </button>
                                  <button type="button" onClick={() => movePlatillo(mi, ti, pIndex, 1)} disabled={pIndex === Array.from(new Set(tiempo.ingredientes.map(i => i.platillo || ''))).length - 1} className="p-1 text-[#999] disabled:opacity-20 hover:text-white rounded-[4px] hover:bg-[#2a2a2a]" title="Bajar platillo">
                                    <ChevronDown className="h-3 w-3" />
                                  </button>
                                </div>
                                <span className="text-white text-[11px] font-bold uppercase tracking-wider shrink-0">Platillo:</span>
                                {(() => {
                                  const draftKey = `${mi}-${ti}-${pIndex}`;
                                  const displayValue = platilloDrafts[draftKey] ?? pName;
                                  return (
                                    <input
                                      className="bg-transparent border-none outline-none font-bold text-white placeholder:text-[#999] text-[14px] w-full min-w-0"
                                      value={displayValue}
                                      onChange={(e) => {
                                        setPlatilloDrafts(prev => ({ ...prev, [draftKey]: e.target.value }));
                                      }}
                                      onBlur={(e) => {
                                        const finalName = e.target.value.trim();
                                        setPlatilloDrafts(prev => {
                                          const next = { ...prev };
                                          delete next[draftKey];
                                          return next;
                                        });
                                        // Si quedó vacío, conservar nombre anterior — no permitimos colapsar el grupo
                                        if (!finalName) return;
                                        if (finalName === pName) return;
                                        updateTiempo(mi, ti, t => ({
                                          ...t,
                                          ingredientes: t.ingredientes.map(ing => (ing.platillo || '') === pName ? { ...ing, platillo: finalName } : ing)
                                        }));
                                      }}
                                      onKeyDown={(e) => {
                                        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                                        if (e.key === 'Escape') {
                                          setPlatilloDrafts(prev => {
                                            const next = { ...prev };
                                            delete next[draftKey];
                                            return next;
                                          });
                                          (e.target as HTMLInputElement).blur();
                                        }
                                      }}
                                      placeholder="Ej: Sándwich de Pollo (Opcional)"
                                    />
                                  );
                                })()}

                                <button
                                  type="button"
                                  onClick={() => void handleRemoveDish(mi, ti, pName)}
                                  className="ml-auto shrink-0 p-1.5 text-[#d57a7a] border border-[#5a2929] bg-[#281818] hover:text-white hover:bg-[#7f1d1d] rounded-[5px]"
                                  title="Eliminar platillo y sus ingredientes"
                                  aria-label={`Eliminar platillo ${pName}`}
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                </button>
                              </div>) : null}
                              <div className="space-y-4">
                                {(() => {
                                  const groupIndices = tiempo.ingredientes.map((item, index) => ({ item, index }))
                                    .filter(({ item }) => (item.platillo || '') === pName)
                                    .map(({ index }) => index);
                                  const sortableIds = groupIndices.map(ingredientDragId);

                                  return (
                                    <DndContext
                                      sensors={ingredientSensors}
                                      collisionDetection={closestCenter}
                                      onDragEnd={(event) => dropIngredient(mi, ti, event)}
                                    >
                                      <SortableContext items={sortableIds} strategy={verticalListSortingStrategy}>
                                        <div className="space-y-4">
                                          {groupIndices.map((ii, localIngredientIdx) => {
                                            const ing = tiempo.ingredientes[ii];
                                            const sortableId = ingredientDragId(ii);
                                            return (
                                              <SortableIngredientRow key={ing.id || `${sortableId}-${ing.descripcion}`} id={sortableId}>
                                                {(dragHandleProps) => (<>
                                      <div className="flex flex-col items-center gap-1 pt-1 shrink-0">
                                        <button
                                          type="button"
                                          {...dragHandleProps}
                                          className="p-1.5 text-[#aaa] bg-[#222] border border-[#3a3a3a] hover:text-white rounded-[5px] cursor-grab active:cursor-grabbing"
                                          title="Arrastrar ingrediente"
                                          aria-label={`Arrastrar ingrediente ${ing.descripcion || localIngredientIdx + 1}`}
                                        >
                                          <GripVertical className="h-3.5 w-3.5" />
                                        </button>
                                        <div className="flex">
                                          <button type="button" onClick={() => moveIngredient(mi, ti, ii, -1)} disabled={localIngredientIdx === 0} className="p-1 text-[#999] disabled:opacity-20 hover:text-white" title="Subir ingrediente"><ChevronUp className="h-3 w-3" /></button>
                                          <button type="button" onClick={() => moveIngredient(mi, ti, ii, 1)} disabled={localIngredientIdx === groupIndices.length - 1} className="p-1 text-[#999] disabled:opacity-20 hover:text-white" title="Bajar ingrediente"><ChevronDown className="h-3 w-3" /></button>
                                        </div>
                                      </div>
                                      <div className="min-w-0 flex-1">
                                        <SmaeIngredientePicker
                                          ingrediente={ing}
                                          index={ii}
                                          readonlyCatalog={true}
                                          gapByGroup={getBudgetForTiempo(tiempo, menu.tiempos, ti, menu.barridoEquivalencias).reduce((acc, b) => ({ ...acc, [b.groupKey]: b.missing > 0 ? b.missing : 0 }), {} as Record<string, number>)}
                                          onUpdate={(updates) =>
                                            updateTiempo(mi, ti, (t) => ({
                                              ...t,
                                              ingredientes: t.ingredientes.map((x, j) => j === ii ? { ...x, ...updates } : x),
                                            }))
                                          }
                                          onRemove={() => handleRemoveIngredient(mi, ti, ii)}
                                        />
                                      </div>
                                                </>)}
                                              </SortableIngredientRow>
                                            );
                                          })}
                                        </div>
                                      </SortableContext>
                                    </DndContext>
                                  );
                                })()}

                                <button
                                  onClick={() => updateTiempo(mi, ti, (t) => ({ ...t, ingredientes: [...t.ingredientes, { ...emptyIngrediente(), platillo: pName }] }))}
                                  className="w-full py-2 bg-transparent border border-dashed border-[#2a2a2a] hover:border-[#333] text-[#c0c0c0] hover:text-white text-[12px] font-medium rounded-[6px] transition-colors"
                                >
                                  + Agregar Alimento
                                </button>
                              </div>
                            </div>
                          ))}

                          <div className="flex gap-2">
                            <button
                              onClick={() => updateTiempo(mi, ti, (t) => ({ ...t, ingredientes: [...t.ingredientes, { ...emptyIngrediente(), platillo: '' }] }))}
                              className="flex-1 py-2 bg-transparent border border-dashed border-[#2a2a2a] hover:border-[#555] text-[#8a8a8a] hover:text-white text-[12px] font-medium rounded-[6px] transition-colors"
                            >
                              + Agregar Ingrediente
                            </button>
                            <button
                              onClick={() => {
                                let nuevoNombreBase = "Nuevo Platillo";
                                let nuevoNombre = nuevoNombreBase;
                                let cnt = 1;
                                while (tiempo.ingredientes.some(i => i.platillo === nuevoNombre)) {
                                  nuevoNombre = `${nuevoNombreBase} ${cnt}`;
                                  cnt++;
                                }
                                updateTiempo(mi, ti, (t) => ({ ...t, ingredientes: [...t.ingredientes, { ...emptyIngrediente(), platillo: nuevoNombre }] }))
                              }}
                              className="flex-1 py-2 bg-transparent border border-dashed border-[#333] text-brand-primary hover:text-brand-primary/80 text-[12px] font-bold rounded-[6px] transition-colors uppercase tracking-wider"
                            >
                              + Crear Platillo
                            </button>
                          </div>

                          {(() => {
                            const dishRecovery = removedDishes.map((item, index) => ({ item, index }))
                              .filter(({ item }) => item.menuIdx === mi && item.tiempoIdx === ti)
                              .at(-1);
                            const ingredientRecovery = removedIngredients.map((item, index) => ({ item, index }))
                              .filter(({ item }) => item.menuIdx === mi && item.tiempoIdx === ti)
                              .at(-1);
                            if (!dishRecovery && !ingredientRecovery) return null;
                            return (
                              <div className="flex flex-wrap justify-end gap-2 pt-1">
                                {ingredientRecovery && (
                                  <button type="button" onClick={() => handleRestoreIngredient(ingredientRecovery.index)} className="flex items-center gap-1.5 px-3 py-2 text-[11px] font-bold text-emerald-200 bg-emerald-950/40 border border-emerald-700/60 rounded-[6px] hover:bg-emerald-900/50">
                                    <RotateCcw className="h-3.5 w-3.5" /> Recuperar ingrediente
                                  </button>
                                )}
                                {dishRecovery && (
                                  <button type="button" onClick={() => handleRestoreDish(dishRecovery.index)} className="flex items-center gap-1.5 px-3 py-2 text-[11px] font-bold text-emerald-200 bg-emerald-950/40 border border-emerald-700/60 rounded-[6px] hover:bg-emerald-900/50">
                                    <RotateCcw className="h-3.5 w-3.5" /> Recuperar “{dishRecovery.item.nombre}”
                                  </button>
                                )}
                              </div>
                            );
                          })()}

                          <div className="relative">
                            <div className="flex gap-2 mt-3">
                              <button
                                onClick={() => {
                                  setShowPlatilloSelector(showPlatilloSelector?.mIdx === mi && showPlatilloSelector?.tIdx === ti ? null : { mIdx: mi, tIdx: ti });
                                  setPlatilloCategoryMenuOpen(false);
                                }}
                                className="flex-1 py-2.5 px-4 bg-[#1a1a1a] border border-[#333] text-[#90c2ff] hover:text-white hover:border-[#90c2ff]/40 hover:bg-[#1d2536] text-[12px] font-bold rounded-[8px] transition-all uppercase tracking-wider flex items-center justify-center gap-2"
                              >
                                <BookOpen className="w-4 h-4" /> Importar Alimentos
                              </button>
                              {tiempo.ingredientes.length > 0 && (
                                <button
                                  onClick={() => setSavePlatilloModal({ mIdx: mi, tIdx: ti, nombre: tiempo.nombre, categoria: 'PERSONALIZADO' })}
                                  className="py-2.5 px-3.5 bg-[#1a1a1a] border border-[#333] text-[#a97fff] hover:text-white hover:border-[#a97fff]/40 hover:bg-[#251d36] text-[12px] font-bold rounded-[8px] transition-all uppercase tracking-wider flex items-center gap-1.5"
                                  title="Guardar tiempo como Platillo"
                                >
                                  <Bookmark className="w-4 h-4" /> Guardar
                                </button>
                              )}
                            </div>

                            {showPlatilloSelector?.mIdx === mi && showPlatilloSelector?.tIdx === ti && (
                              <div className="absolute z-50 left-0 right-0 bottom-full mb-2 bg-[#111] border border-[#444] rounded-[12px] shadow-[0_8px_32px_rgba(0,0,0,0.6)] p-4 animate-in fade-in slide-in-from-bottom-2">
                                {/* Controles de búsqueda y filtros combinados */}
                                <div className="space-y-2 mb-3">
                                  <Input
                                    placeholder="🔍 Buscar por nombre de platillo..."
                                    className="h-9 text-xs bg-[#0a0a0a] border-[#333] focus:border-[#90c2ff] rounded-[8px]"
                                    autoFocus
                                    value={platilloSearch}
                                    onChange={(e) => setPlatilloSearch(e.target.value)}
                                  />
                                  {(() => {
                                    const categories = Array.from(new Set(platilloLibrary.map(p => p.categoria))).sort();
                                    const selectedLabel = platilloCatFilter
                                      ? `${platilloCatFilter} (${platilloLibrary.filter(p => p.categoria === platilloCatFilter).length})`
                                      : `TODOS (${platilloLibrary.length})`;

                                    return (
                                      <div className="relative">
                                        <button
                                          type="button"
                                          aria-haspopup="listbox"
                                          aria-expanded={platilloCategoryMenuOpen}
                                          onClick={() => setPlatilloCategoryMenuOpen(open => !open)}
                                          onKeyDown={(event) => {
                                            if (event.key === 'Escape') setPlatilloCategoryMenuOpen(false);
                                          }}
                                          className="flex h-9 w-full items-center justify-between gap-2 rounded-[8px] border border-[#333] bg-[#0a0a0a] px-3 text-left text-xs text-white outline-none transition-colors hover:border-[#555] focus:border-[#90c2ff]"
                                        >
                                          <span className="truncate">{selectedLabel}</span>
                                          <ChevronDown className={`h-4 w-4 shrink-0 text-[#777] transition-transform ${platilloCategoryMenuOpen ? 'rotate-180' : ''}`} />
                                        </button>

                                        {platilloCategoryMenuOpen && (
                                          <div
                                            role="listbox"
                                            aria-label="Categoría de alimentos"
                                            className="absolute left-0 right-0 top-full z-20 mt-1 max-h-52 overflow-y-auto rounded-[8px] border border-[#3d3d3d] bg-[#0d0d0d] p-1 shadow-[0_12px_28px_rgba(0,0,0,0.75)] custom-scrollbar"
                                          >
                                            <button
                                              type="button"
                                              role="option"
                                              aria-selected={!platilloCatFilter}
                                              onClick={() => {
                                                setPlatilloCatFilter(null);
                                                setPlatilloCategoryMenuOpen(false);
                                              }}
                                              className={`flex w-full items-center justify-between rounded-[6px] px-3 py-2 text-left text-[11px] transition-colors ${!platilloCatFilter ? 'bg-[#1d4ed8] text-white' : 'text-[#d8d8d8] hover:bg-[#1a1a1a] hover:text-white'}`}
                                            >
                                              <span>TODOS</span>
                                              <span className="text-[10px] opacity-70">{platilloLibrary.length}</span>
                                            </button>
                                            {categories.map(cat => {
                                              const count = platilloLibrary.filter(p => p.categoria === cat).length;
                                              const isSelected = platilloCatFilter === cat;

                                              return (
                                                <button
                                                  key={cat}
                                                  type="button"
                                                  role="option"
                                                  aria-selected={isSelected}
                                                  onClick={() => {
                                                    setPlatilloCatFilter(cat);
                                                    setPlatilloCategoryMenuOpen(false);
                                                  }}
                                                  className={`flex w-full items-center justify-between rounded-[6px] px-3 py-2 text-left text-[11px] transition-colors ${isSelected ? 'bg-[#1d4ed8] text-white' : 'text-[#d8d8d8] hover:bg-[#1a1a1a] hover:text-white'}`}
                                                >
                                                  <span className="truncate">{cat}</span>
                                                  <span className="ml-3 text-[10px] opacity-70">{count}</span>
                                                </button>
                                              );
                                            })}
                                          </div>
                                        )}
                                      </div>
                                    );
                                  })()}
                                </div>

                                {/* Lista de platillos renderizada siempre por defecto (TODOS) */}
                                <div className="max-h-[260px] overflow-y-auto space-y-1 custom-scrollbar">
                                  {(() => {
                                    const results = platilloLibrary.filter(p => {
                                      if (platilloSearch) {
                                        return p.nombre.toLowerCase().includes(platilloSearch.toLowerCase()) ||
                                          p.categoria.toLowerCase().includes(platilloSearch.toLowerCase());
                                      }
                                      return !platilloCatFilter || p.categoria === platilloCatFilter;
                                    });

                                    if (results.length === 0) return <p className="text-center py-4 text-[10px] text-[#555]">Sin resultados.</p>;

                                    return results.map(p => (
                                      <button
                                        key={p.id}
                                        onClick={() => {
                                          const assignedMenuBarrido = menu.barridoEquivalencias
                                            || getBarridoVariantes(valData?.barridoEquivalencias)[0];
                                          const d = assignedMenuBarrido?.distribucion;
                                          // Encontrar el tiempo del barrido que coincide con este tiempo de comida
                                          const barridoTiempo = assignedMenuBarrido?.tiempos
                                            ? findBarridoTiempo(assignedMenuBarrido.tiempos, menu.tiempos, ti)
                                            : undefined;
                                          const distTiempo = d && barridoTiempo ? d[barridoTiempo.id] : null;

                                          const ings = p.ingredientes.map((i: any, idx: number) => {
                                            let scaledCant = Number(i.cantidad);
                                            let scaledEq = Number(i.eqCantidad);

                                            // Parsear equivalencias si vienen como string
                                            let eqArray: any[] = [];
                                            if (Array.isArray(i.equivalencias)) {
                                              eqArray = i.equivalencias;
                                            } else if (typeof i.equivalencias === 'string' && i.equivalencias.trim() !== '') {
                                              try { eqArray = JSON.parse(i.equivalencias); } catch (e) { }
                                            }

                                            // Sanitizar equivalencias: eliminar entradas fantasma con grupo vacío
                                            const rawEquivs = eqArray.filter(
                                              (e: any) => e.grupo && String(e.grupo).trim() !== '' && e.cantidad !== '' && e.cantidad != null
                                            );

                                            // Grupo principal: preferir eqGrupo (legacy) o primer item del array de equivalencias
                                            const mainGrupo = i.eqGrupo ||
                                              (rawEquivs.length > 0 ? String(rawEquivs[0]?.grupo || '') : '');

                                            if (mainGrupo && distTiempo) {
                                              // Traduce el label al key canónico del barrido usando la función centralizada
                                              const barridoKey = groupToBarridoKey(normalizeGroup(mainGrupo));
                                              const assigned = Number(distTiempo[barridoKey]);

                                              if (assigned > 0) {
                                                // Ancla: usamos smaeGrPorEq si existe, si no derivamos de cantidad/eqCantidad.
                                                // El ancla siempre está en gramos por 1 eq — solo aplica si la unidad
                                                // del ingrediente es GR. En cualquier otra unidad (pieza, taza, paquete,
                                                // lata...) usarla desalinearía cantidad↔unidad (ej. "300 taza"), así
                                                // que ahí se cae al fallback proporcional (regla de tres, ya siempre
                                                // redondeado a entero por smartRound).
                                                const unidadEsGramos = !i.unidad || String(i.unidad).toUpperCase().trim() === 'GR';
                                                const smaeAnchor = unidadEsGramos ? Number(i.smaeGrPorEq) : 0;
                                                const baseGrPorEq = smaeAnchor > 0
                                                  ? smaeAnchor
                                                  : (unidadEsGramos && Number(i.eqCantidad) > 0 ? Number(i.cantidad) / Number(i.eqCantidad) : 0);

                                                if (baseGrPorEq > 0) {
                                                  // Escalar: gramos = ancla × eq asignadas por barrido
                                                  scaledCant = smartRound(baseGrPorEq * assigned);
                                                  scaledEq = assigned;
                                                } else {
                                                  // Fallback si no hay ancla: escalar por proporción
                                                  const baseEq = Number(i.eqCantidad) || 1;
                                                  scaledCant = smartRound((Number(i.cantidad) / baseEq) * assigned);
                                                  scaledEq = assigned;
                                                }
                                              }
                                            }

                                            // Factor de escala para propagar a equivalencias adicionales
                                            const origCant = Number(i.cantidad) || 0;
                                            const scaleFactor = (scaledCant !== origCant && origCant > 0) ? (scaledCant / origCant) : 1;

                                            const cleanEquivencias = rawEquivs.length > 0
                                              ? rawEquivs.map((e: any) => ({
                                                grupo: e.grupo,
                                                // Escalar cada grupo proporcionalmente al mismo factor que la cantidad física
                                                cantidad: scaleFactor !== 1 ? smartRound(Number(e.cantidad) * scaleFactor) : Number(e.cantidad),
                                              }))
                                              : (i.eqGrupo ? [{ cantidad: scaledEq, grupo: i.eqGrupo }] : []);

                                            return {
                                              ...i,
                                              // El id de la biblioteca no pertenece al ingrediente del plan. Una clave
                                              // nueva evita duplicados de React al importar el mismo platillo más de una vez.
                                              id: newClientIngredientId(),
                                              cantidad: scaledCant,
                                              eqCantidad: scaledEq,
                                              smaeGrPorEq: Number(i.smaeGrPorEq) || 0,
                                              equivalencias: cleanEquivencias,
                                              platillo: p.nombre,
                                              orden: (tiempo.ingredientes.length || 0) + idx + 1
                                            };
                                          });

                                          updateTiempo(mi, ti, (t) => ({ ...t, ingredientes: [...t.ingredientes, ...ings] }));
                                          setShowPlatilloSelector(null);
                                          setPlatilloSearch('');
                                          setPlatilloCatFilter(null);
                                          setPlatilloCategoryMenuOpen(false);
                                        }}
                                        className="w-full text-left px-3 py-2 hover:bg-[#1a1a1a] rounded-lg transition-colors flex items-center justify-between group"
                                      >
                                        <div>
                                          <p className="text-[12px] font-bold text-white group-hover:text-[#90c2ff]">{p.nombre}</p>
                                          <p className="text-[10px] text-[#555]">{p.categoria}</p>
                                        </div>
                                        <Plus className="w-3 h-3 text-[#555] group-hover:text-[#90c2ff]" />
                                      </button>
                                    ));
                                  })()}
                                </div>
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    ))}

                    <div className="flex-1" />

                  </div>
                </div>
              ))}

              <div className="md:col-span-2 flex flex-col items-end gap-3 pt-1">
                {(() => {
                  const barridoTiempos: BarridoTiempo[] = valData?.barridoEquivalencias?.tiempos || valData?.barrido?.tiempos || [];
                  if (!barridoTiempos.length) return null;
                  const referenceTimes = menus[0]?.tiempos || [];
                  const existingIds = new Set(referenceTimes.map((tiempo, index) => (
                    tiempo.barridoTiempoId || findBarridoTiempo(barridoTiempos, referenceTimes, index)?.id
                  )).filter(Boolean));
                  const faltantes = barridoTiempos.filter(tiempo => !existingIds.has(tiempo.id));
                  if (!faltantes.length) return null;

                  return (
                    <div className="w-full sm:w-auto p-3 rounded-[8px] border border-[#2a2a2a] bg-[#0f1620]">
                      <p className="text-[10px] font-bold text-[#8a8a8a] uppercase tracking-widest m-0 mb-2">Importar de barrido en ambos menús</p>
                      <div className="flex flex-wrap justify-end gap-2">
                        {faltantes.map((tiempoRef) => {
                          const nombre = tiempoRef.nombre;
                          return (
                            <button
                              key={getBarridoTiempoKey(tiempoRef)}
                              type="button"
                              onClick={() => handleAppendMealTime(formatMealTimeName(nombre), tiempoRef.id)}
                              className="flex items-center gap-1 text-[11px] font-bold text-[#90c2ff] bg-[#1a2640] hover:bg-[#22324f] border border-[#3a5680] px-3 py-1.5 rounded-[6px] uppercase tracking-wider transition-colors"
                              title={`Agregar "${nombre}" a ambos menús`}
                            >
                              <Plus className="w-3 h-3" /> {nombre}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  );
                })()}

                <div className="flex flex-wrap justify-end gap-3">
                  {removedMealTimes.length > 0 && (
                    <button
                      type="button"
                      onClick={handleRestoreMealTime}
                      className="flex items-center gap-2 px-4 py-3 text-[12px] font-bold text-emerald-200 bg-emerald-950/40 hover:bg-emerald-900/50 border border-emerald-700/60 rounded-[8px] transition-colors"
                    >
                      <RotateCcw className="h-4 w-4" />
                      Recuperar “{removedMealTimes.at(-1)?.label}”
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => handleAppendMealTime()}
                    className="flex items-center gap-2 px-5 py-3 border border-dashed border-[#555] hover:border-brand-primary bg-[#151515] rounded-[8px] text-[13px] font-semibold text-[#b0b0b0] hover:text-white transition-colors"
                  >
                    <Plus className="h-4 w-4" /> Agregar tiempo de comida
                  </button>
                </div>
              </div>
            </div>
          </div>{/* closes flex-1 main col */}

          {/* ─── Resumen clínico sidebar ─── */}
          {!isBasePlan && pacienteInfo && (
            <PacienteResumenSidebar
              className="hidden xl:block w-[260px] shrink-0 sticky top-[140px] self-start max-h-[calc(100vh-160px)] overflow-y-auto custom-scrollbar"
              pacienteNombre={pacienteNombre}
              pacienteInfo={pacienteInfo}
              alimentosAEvitar={alimentosAEvitar}
              tiemposNombres={valData?.barridoEquivalencias?.tiempos?.map(getBarridoTiempoNombre)}
              suplementosDetalle={suplementosDetalle}
              comentarios={valData?.comentarios}
              esqueHidratacion={valData?.esqueHidratacion}
              notasLibres={valData?.notasLibres}
              ocultarSeccionesMenu
              reemplazarEjercicioPorGustan
            />
          )}
        </div>{/* closes flex wrapper */}

      </div>
      {/* ─── Save-as-Platillo Modal ─── */}
      {savePlatilloModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="bg-[#111] border border-[#2a2a2a] rounded-[16px] p-6 w-full max-w-sm shadow-2xl">
            <h3 className="text-[16px] font-bold text-white mb-1">Guardar como Platillo</h3>
            <p className="text-[12px] text-[#8a8a8a] mb-4">Los ingredientes de este tiempo se guardarán en tu biblioteca como un platillo reutilizable.</p>
            <div className="space-y-3">
              <div>
                <label className="text-[10px] font-black text-[#555] uppercase tracking-widest block mb-1">Nombre</label>
                <input
                  autoFocus
                  className="w-full bg-[#1a1a1a] border border-[#333] rounded-[8px] px-3 py-2 text-[14px] text-white outline-none focus:border-brand-primary"
                  value={savePlatilloModal.nombre}
                  onChange={e => setSavePlatilloModal(p => p ? { ...p, nombre: e.target.value } : p)}
                  placeholder="Ej: Desayuno proteico"
                />
              </div>
              <div>
                <label className="text-[10px] font-black text-[#555] uppercase tracking-widest block mb-1">Categoría</label>
                <select
                  className="w-full bg-[#1a1a1a] border border-[#333] rounded-[8px] px-3 py-2 text-[14px] text-white outline-none focus:border-brand-primary"
                  value={savePlatilloModal.categoria}
                  onChange={e => setSavePlatilloModal(p => p ? { ...p, categoria: e.target.value } : p)}
                >
                  <option value="DESAYUNO">Desayuno</option>
                  <option value="ALMUERZO">Almuerzo</option>
                  <option value="COLACIÓN">Colación</option>
                  <option value="PRE-ENTRENO">Pre-Entreno</option>
                  <option value="POST-ENTRENO">Post-Entreno</option>
                  <option value="CENA">Cena</option>
                  <option value="PROCESADO">Procesado</option>
                  <option value="PERSONALIZADO">Personalizado</option>
                </select>
              </div>
            </div>
            <div className="flex gap-3 mt-5">
              <button
                onClick={() => setSavePlatilloModal(null)}
                className="flex-1 py-2 border border-[#333] rounded-[8px] text-[13px] text-[#8a8a8a] hover:text-white transition-colors"
              >
                Cancelar
              </button>
              <button
                onClick={handleSaveTiempoAsPlatillo}
                disabled={savingPlatillo}
                className="flex-1 py-2 bg-brand-primary text-black rounded-[8px] text-[13px] font-bold hover:opacity-90 transition-opacity disabled:opacity-50"
              >
                {savingPlatillo ? 'Guardando...' : 'Guardar Platillo'}
              </button>
            </div>
          </div>
        </div>
      )}

      {ConfirmDialogComponent}

      {/* B7: Barra sticky inferior — visible solo en mobile cuando el header queda fuera del viewport */}
      <div className="md:hidden fixed bottom-0 left-0 right-0 z-40 bg-[#0a0a0a]/95 backdrop-blur-md border-t border-[#1a1a1a] px-4 py-3 flex items-center gap-3">
        {macroSum !== 100 && (
          <span className="text-[11px] font-bold text-rose-400 flex items-center gap-1 flex-1 min-w-0 truncate">
            <span className="w-1.5 h-1.5 rounded-full bg-rose-400 shrink-0 animate-pulse" />
            Macros: {macroSum}% / 100%
          </span>
        )}
        <button
          onClick={handleSave}
          disabled={saving || macroSum !== 100}
          className="ml-auto flex items-center gap-2 px-5 py-3 bg-brand-primary text-bg-base rounded-[10px] text-[14px] font-bold transition-all hover:bg-white disabled:opacity-50 disabled:cursor-not-allowed shadow-lg shadow-black/30"
        >
          {saving
            ? <div className="w-4 h-4 border-2 border-white/20 border-t-white rounded-full animate-spin" />
            : <Save className="h-4 w-4" />
          }
          {isEdit ? 'Guardar' : 'Guardar Menú'}
        </button>
      </div>

    </>
  );
};

export default function CreateEditPlan() {
  const { id, planId } = useParams<{ id: string, planId: string }>();
  const pacienteId = id;
  const location = useLocation();
  const navigate = useNavigate();
  const searchParams = new URLSearchParams(location.search);
  const valoracionId = searchParams.get('valoracionId') || undefined;
  const isBasePlan = !pacienteId;

  // Igual que en el paso 3 del wizard de Nueva Consulta: al guardar, el panel de vista
  // previa/envío aparece debajo en esta misma pantalla en vez de navegar a otra pantalla aparte.
  const [planIdGuardado, setPlanIdGuardado] = useState<string | null>(planId || null);
  const [previewRefreshKey, setPreviewRefreshKey] = useState(0);

  return (
    <div className="space-y-6">
      <CreateEditPlanForm
        pacienteId={pacienteId}
        planId={planId}
        valoracionId={valoracionId}
        onSaved={isBasePlan ? undefined : (savedPlanId) => {
          setPlanIdGuardado(savedPlanId);
          setPreviewRefreshKey((k) => k + 1);
        }}
        onCancel={isBasePlan ? undefined : () => navigate(`/pacientes/${pacienteId}`)}
      />
      {!isBasePlan && planIdGuardado && (
        <div className="max-w-none w-full pt-2 border-t border-[#1a1a1a]">
          <Phase4Delivery
            key={previewRefreshKey}
            pacienteId={pacienteId!}
            planId={planIdGuardado}
            onFinish={() => navigate('/dashboard')}
          />
        </div>
      )}
    </div>
  );
}
