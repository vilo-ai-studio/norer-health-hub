import { useState, useEffect, useRef, useCallback } from 'react';
import { Search, X, Check, Plus } from 'lucide-react';
import api from '@/lib/api';
import { useToast } from '@/components/ui/use-toast';
import type { Ingrediente, EquivalenciaItem } from '@/types';
import { normalizeGroup, SMAE_GROUP_LABELS } from '@/lib/smaeGroups';
import { normalizeSmaeUnit } from '@/lib/smaeUnits';
import { amountPerBaseEquivalent, buildScaledCatalogEquivalences } from '@/lib/smaeCatalogScaling';

// ─── Label legible por grupo SMAE ─────────────────────────────────────────────
const GRUPO_LABELS: Record<string, string> = {
  verduras: 'Verduras',
  frutas: 'Frutas',
  cerealSinGr: 'Cereal s/grasa',
  cerealConGr: 'Cereal c/grasa',
  leguminosas: 'Leguminosas',
  aoaMuyBajo: 'AOA Muy Bajo',
  aoaBajo: 'AOA Bajo',
  aoaModerado: 'AOA Moderado',
  aoaAlto: 'AOA Alto',
  lecheDesc: 'Leche Descrem.',
  lecheSemi: 'Leche Semi',
  lecheEntera: 'Leche Entera',
  lecheAz: 'Leche Azucarada',
  grasaSinProt: 'Grasa s/prot',
  grasaConProt: 'Grasa c/prot',
  azSinGr: 'Azúcar s/grasa',
  azConGr: 'Azúcar c/grasa',
};

const GRUPO_COLORS: Record<string, string> = {
  verduras: '#22c55e', frutas: '#f59e0b',
  cerealSinGr: '#a78bfa', cerealConGr: '#7c3aed',
  leguminosas: '#84cc16',
  aoaMuyBajo: '#38bdf8', aoaBajo: '#0ea5e9', aoaModerado: '#0284c7', aoaAlto: '#0369a1',
  lecheDesc: '#f472b6', lecheSemi: '#e879f9', lecheEntera: '#d946ef', lecheAz: '#c026d3',
  grasaSinProt: '#fb923c', grasaConProt: '#ef4444',
  azSinGr: '#fbbf24', azConGr: '#d97706',
};

// 'GR' es el código histórico para "unidad ancla en gramos" (la inmensa mayoría del catálogo).
// Alimentos con otra unidad base (ml, pz, serv...) usan ese código en mayúsculas como su propio
// "ancla" — así toda la lógica de auto-conversión gramos↔eq sigue funcionando igual, solo que
// comparada contra la unidad ancla real del alimento en vez de 'GR' fijo.
const unidadBaseToCode = (base?: string): string => normalizeSmaeUnit(base || 'g');

interface SmaeAlimento {
  id: string;
  nombre: string;
  grupo: string;
  equivalentesBase?: number; // cuántos eq del grupo base vale la porción (default 1)
  pesoGramos: number;       // valor ancla (gramos o cualquier unidad base)
  unidadBase?: string;      // ej. 'g', 'botellita', 'paquete'
  porcionCasera?: string;
  cantidadPorcion?: number;
  unidadPorcion?: string;
  equivalencias?: { grupo: string; cantidad: number | string }[]; // Multi-grupo
}

interface Props {
  ingrediente: Ingrediente;
  index: number;
  gapByGroup?: Record<string, number>;
  onUpdate: (updated: Partial<Ingrediente>) => void;
  onRemove: () => void;
  /** Si es true, oculta el botón de guardar en catálogo SMAE.
   *  Usar cuando el picker se renderiza desde CreateEditPlan (menú de paciente)
   *  para evitar creaciones accidentales en el catálogo global. */
  readonlyCatalog?: boolean;
}

// ─── Caché en módulo ─────────────────────────────────────────────────────────
// TTL de 5 minutos como red de seguridad automática.
// Además, se puede invalidar explícitamente llamando a invalidateSmaeCache()
// (por ejemplo, desde EquivalenciasSMAE al guardar un cambio).
const SMAE_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutos
let _smaeCache: SmaeAlimento[] | null = null;
let _smaeCacheTimestamp = 0;

export const invalidateSmaeCache = () => {
  _smaeCache = null;
  _smaeCacheTimestamp = 0;
};

const loadSmae = async (): Promise<SmaeAlimento[]> => {
  const now = Date.now();
  if (_smaeCache && (now - _smaeCacheTimestamp) < SMAE_CACHE_TTL_MS) {
    return _smaeCache;
  }
  const { data } = await api.get('/api/alimentos-smae');
  _smaeCache = data?.data || data || [];
  _smaeCacheTimestamp = now;
  return _smaeCache!;
};

// ─── Componente ───────────────────────────────────────────────────────────────
export const SmaeIngredientePicker = ({ ingrediente: ing, index, gapByGroup, onUpdate, onRemove, readonlyCatalog = true }: Props) => {
  const { toast } = useToast();
  const [allAlimentos, setAllAlimentos] = useState<SmaeAlimento[]>([]);
  const [query, setQuery] = useState(ing.descripcion || '');
  const [results, setResults] = useState<SmaeAlimento[]>([]);
  const [showDropdown, setShowDropdown] = useState(false);

  // ─── Estado de cantidades ──────────────────────────────────────────────────
  const [cantidad, setCantidad] = useState<string>(ing.cantidad?.toString() || '');
  // Estado interno SIEMPRE en mayúsculas: la lógica de conversión compara contra 'GR'
  // (la BD puede traer unidades en minúsculas; el display se hace lowercase vía CSS)
  const [unidad, setUnidad] = useState(normalizeSmaeUnit(ing.unidad || 'GR'));

  // ─── smaeGrPorEq: gramos por 1 equivalencia (persiste en BD) ──────────────
  // Si el ingrediente ya tiene este valor (reload desde BD), lo usamos directamente.
  // Si no, lo derivamos del catálogo cuando el usuario selecciona.
  const [smaeGrPorEq, setSmaeGrPorEq] = useState<number>(ing.smaeGrPorEq || 0);
  const [smaePiezasPorEq, setSmaePiezasPorEq] = useState<number>(0); // piezas/porción casera por 1 eq (catálogo)
  const [smaeGrupoKey, setSmaeGrupoKey] = useState<string>(''); // clave interna del grupo (ej. 'aoaMuyBajo')
  const [smaeUnidadBase, setSmaeUnidadBase] = useState<string>('g'); // unidad del ancla (g, ml, etc.) — viene del catálogo
  const [smaeUnidadPorcion, setSmaeUnidadPorcion] = useState<string>('');
  // Código de la unidad ancla para ESTE alimento (ej. 'GR' o 'ML'). Reemplaza el 'GR' fijo
  // que antes se usaba en toda la lógica de auto-conversión gramos↔eq.
  const anchorUnit = unidadBaseToCode(smaeUnidadBase);

  // ─── Multi-equivalencias ───────────────────────────────────────────────────
  const initEquivs = (): EquivalenciaItem[] => {
    // Filtramos equivalencias vacías (sin grupo) que se pudieron haber guardado
    // cuando el usuario escribió un alimento libre sin seleccionar del catálogo SMAE.
    const validEquivs = (ing.equivalencias || []).filter(
      (e) => e.grupo && String(e.grupo).trim() !== ''
    );
    if (validEquivs.length > 0) return validEquivs;
    if (ing.eqCantidad !== undefined && ing.eqGrupo && ing.eqGrupo.trim() !== '') {
      return [{ cantidad: ing.eqCantidad, grupo: ing.eqGrupo }];
    }
    return [{ cantidad: '', grupo: '' }];
  };
  const [equivalencias, setEquivalencias] = useState<EquivalenciaItem[]>(initEquivs);

  // ─── Combobox state for grupo equivalencia inputs ──────────────────────────
  const [focusedEquivIdx, setFocusedEquivIdx] = useState<number | null>(null);
  const [grupoInputValues, setGrupoInputValues] = useState<Record<number, string>>({});
  const equivRefs = useRef<Record<number, HTMLDivElement | null>>({});

  // Close grupo dropdown on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (focusedEquivIdx !== null) {
        const ref = equivRefs.current[focusedEquivIdx];
        if (ref && !ref.contains(e.target as Node)) {
          setFocusedEquivIdx(null);
        }
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [focusedEquivIdx]);

  // ─── Quick Modal ───────────────────────────────────────────────────────────
  const [showQuickModal, setShowQuickModal] = useState(false);
  const [quickGrupo, setQuickGrupo] = useState('verduras');
  const [quickGramos, setQuickGramos] = useState('');
  const [quickPorcion, setQuickPorcion] = useState('');
  const [isSavingQuick, setIsSavingQuick] = useState(false);

  const wrapperRef = useRef<HTMLDivElement>(null);
  const hasUserTyped = useRef(false);
  const lastSentUpdate = useRef<string>('');
  const isFocused = useRef(false); // Bloqueo de sincronización mientras se escribe
  // Guard: evita que el efecto de sincronización del catálogo se dispare más de una vez
  // por descripción de ingrediente, previniendo el loop de re-renders que crashea en Windows.
  const catalogSyncedFor = useRef<string>('');

  // ─── Carga catálogo una sola vez ───────────────────────────────────────────
  useEffect(() => { loadSmae().then(setAllAlimentos); }, []);

  // Load conversion metadata without rewriting the saved amount on opening a plan.
  useEffect(() => {
    if (allAlimentos.length === 0 || !ing.descripcion) return;
    // Guard: si ya sincronizamos este ingrediente, no volver a hacerlo para evitar
    // el loop onUpdate → prop change → useEffect → onUpdate en navegadores Windows.
    if (catalogSyncedFor.current === ing.descripcion) return;
    const match = ing.alimentoSmaeId
      ? allAlimentos.find(a => a.id === ing.alimentoSmaeId)
      : allAlimentos.find(a => a.nombre === ing.descripcion);
    if (match) {
      // Marcar como sincronizado ANTES de hacer cualquier setState/onUpdate
      catalogSyncedFor.current = ing.descripcion;

      const baseEq = match.equivalentesBase && match.equivalentesBase > 0 ? match.equivalentesBase : 1;
      if (smaePiezasPorEq === 0 && match.cantidadPorcion && match.unidadPorcion?.trim()) {
        setSmaePiezasPorEq(amountPerBaseEquivalent(match.cantidadPorcion, baseEq));
      }
      if (!smaeGrupoKey && match.grupo) setSmaeGrupoKey(match.grupo);
      if (match.unidadBase && match.unidadBase !== smaeUnidadBase) setSmaeUnidadBase(match.unidadBase);
      if (match.unidadPorcion) setSmaeUnidadPorcion(normalizeSmaeUnit(match.unidadPorcion));

      const catalogAnchor = amountPerBaseEquivalent(match.pesoGramos, baseEq);
      if (catalogAnchor > 0 && !ing.smaeGrPorEq) setSmaeGrPorEq(catalogAnchor);

    }
  }, [allAlimentos, ing.descripcion]);

  // ─── Cerrar dropdown al hacer clic afuera ─────────────────────────────────
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setShowDropdown(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // ─── Sincronizar con props cuando el padre actualiza (importar/escalar) ───
  useEffect(() => {
    // Si el usuario está activamente editando este ingrediente, NO sincronizamos
    // cantidad o equivalencias desde props para evitar el "congelamiento" o saltos.
    if (isFocused.current) return;

    const propCant = ing.cantidad?.toString() || '';
    if (propCant !== cantidad) setCantidad(propCant);
    if (normalizeSmaeUnit(ing.unidad || 'GR') !== unidad.toUpperCase()) setUnidad(normalizeSmaeUnit(ing.unidad || 'GR'));

    const effectiveGrPorEq = ing.smaeGrPorEq || 0;
    if (effectiveGrPorEq > 0 && effectiveGrPorEq !== smaeGrPorEq) setSmaeGrPorEq(effectiveGrPorEq);

    if (ing.descripcion !== query) {
      setQuery(ing.descripcion || '');
      hasUserTyped.current = false;
    }

    const nextEquivs = initEquivs();
    if (JSON.stringify(nextEquivs) !== JSON.stringify(equivalencias)) {
      setEquivalencias(nextEquivs);
    }
  }, [ing]);

  // ─── Filtro de búsqueda ────────────────────────────────────────────────────
  useEffect(() => {
    if (!hasUserTyped.current) return;
    if (!query || query.length < 2) { setResults([]); return; }
    const q = query.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    const filtered = allAlimentos.filter(a => {
      const name = a.nombre.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
      return name.includes(q);
    }).slice(0, 12);
    setResults(filtered);
    setShowDropdown(filtered.length > 0);
  }, [query, allAlimentos]);

  // Keep proportional equivalents to the same two decimal precision as quantities.
  const roundEq = (val: number): number => Number(val.toFixed(2));

  // ─── Función núcleo: calcular eq a partir de gramos ───────────────────────
  // Usa la referencia por EQ y conserva centésimas.
  const grToEq = (gr: number, grxeq: number): number =>
    grxeq > 0 ? roundEq(gr / grxeq) : 0;

  // ─── Función inversa: calcular gramos a partir de eq ─────────────────────
  const eqToGr = (eq: number, grxeq: number): number =>
    grxeq > 0 ? parseFloat((eq * grxeq).toFixed(2)) : 0;

  // ─── Seleccionar alimento del catálogo ────────────────────────────────────
  const handleSelect = (alimento: SmaeAlimento) => {
    const reference = amountPerBaseEquivalent(alimento.pesoGramos, alimento.equivalentesBase);
    if (!(reference > 0) || !Number.isFinite(reference)) {
      toast({ title: 'Referencia SMAE incompleta', description: 'Se conservó el ingrediente original. Revisa la cantidad de referencia del alimento en el catálogo SMAE.' });
      return;
    }
    setQuery(alimento.nombre);
    setShowDropdown(false);

    const baseEq = alimento.equivalentesBase && alimento.equivalentesBase > 0 ? alimento.equivalentesBase : 1;
    const grPorEq = amountPerBaseEquivalent(alimento.pesoGramos, baseEq);
    const grupoKey = alimento.grupo;
    const eqLabel = GRUPO_LABELS[grupoKey] || grupoKey;
    const grupoColor = GRUPO_COLORS[grupoKey] || '#8a8a8a';

    // Porción por defecto: porción casera si existe, si no la unidad ancla del alimento
    const hasHouseholdPortion = Number(alimento.cantidadPorcion) > 0 && Boolean(alimento.unidadPorcion?.trim()) &&
      normalizeSmaeUnit(alimento.unidadPorcion) !== unidadBaseToCode(alimento.unidadBase);
    const baseCant = hasHouseholdPortion ? Number(alimento.cantidadPorcion) : alimento.pesoGramos;
    const uFinal = hasHouseholdPortion ? normalizeSmaeUnit(alimento.unidadPorcion) : unidadBaseToCode(alimento.unidadBase);

    // eq que aporta 1 porción del grupo base (editable en catálogo, default 1)
    let eqVal = baseEq;
    let finalCant = baseCant;

    // Auto-escalado a la carta (Eliminamos el bloqueo de "unidades discretas" porque al
    // agregar alimentos individuales sí queremos que multiplique la porción, ej: 1 eq = 17 fresas -> 2 eq = 34 fresas)
    if (gapByGroup && gapByGroup[grupoKey] !== undefined && gapByGroup[grupoKey] > 0) {
      const missing = gapByGroup[grupoKey];
      const portions = missing / baseEq;   // cuántas porciones llenan el faltante
      eqVal = missing;
      finalCant = parseFloat((baseCant * portions).toFixed(2));
    }

    const eqsExtra = Array.isArray(alimento.equivalencias) ? alimento.equivalencias : [];
    const allEquivs = buildScaledCatalogEquivalences(eqLabel, baseEq, eqVal, eqsExtra);

    setSmaeGrPorEq(grPorEq);
    setSmaePiezasPorEq(hasHouseholdPortion ? amountPerBaseEquivalent(alimento.cantidadPorcion, baseEq) : 0);
    setSmaeGrupoKey(grupoKey);
    setSmaeUnidadBase(alimento.unidadBase || 'g');
    setSmaeUnidadPorcion(normalizeSmaeUnit(alimento.unidadPorcion));
    setCantidad(finalCant.toString());
    setUnidad(uFinal);
    setEquivalencias(allEquivs);
    const updates: Partial<Ingrediente> = {
      descripcion: alimento.nombre,
      cantidad: finalCant,
      unidad: uFinal,
      smaeGrPorEq: grPorEq,
      alimentoSmaeId: alimento.id,
      equivalencias: allEquivs,
      eqCantidad: eqVal,
      eqGrupo: eqLabel,
    };

    onUpdate(updates);

    // Guardar lo que enviamos para no sobrescribirnos en el useEffect
    lastSentUpdate.current = JSON.stringify({
      cantidad: updates.cantidad,
      unidad: updates.unidad,
      descripcion: updates.descripcion,
      equivalencias: updates.equivalencias,
      smaeGrPorEq: updates.smaeGrPorEq
    });
  };

  // ─── Cambio en GRAMOS (o cualquier cantidad) → recalcular eq ─────────────
  // Prioridad: 1) ancla smaeGrPorEq en GR  2) ancla inferida  3) sin ancla
  const handleCantidadChange = (val: string) => {
    const num = Number(val.trim().replace(',', '.'));
    setCantidad(val);

    if (!Number.isFinite(num) || num < 0) {
      toast({ title: 'Cantidad no válida', description: 'Introduce una cantidad mayor o igual a cero.' });
      setCantidad(cantidad);
      return;
    }

    // Leer ancla actual
    const activeAnchor = smaeGrPorEq;
    const workingUnidad = unidad;
    const firstEqNum = parseFloat(equivalencias[0]?.cantidad?.toString() || '0');

    const portionPerEq = workingUnidad === anchorUnit ? activeAnchor
      : (workingUnidad === smaeUnidadPorcion ? smaePiezasPorEq : 0);
    if (!(portionPerEq > 0)) {
      toast({ title: 'Cantidad ajustada manualmente', description: 'No hay una conversión válida para esta unidad. Se conservaron las equivalencias; revisa la porción en el catálogo SMAE.' });
      onUpdate({ cantidad: num, unidad });
      return;
    }

    if (portionPerEq > 0) {
      let eqVal: number;

      if (workingUnidad === anchorUnit) {
        // Canónico: gramos ÷ ancla = eq  (siempre exacto)
        eqVal = grToEq(num, activeAnchor);
      } else {
        // Unidad casera (PZA, taza…)
        // Preferimos el ancla fija del catálogo (smaePiezasPorEq) para que no se contamine
        // tras cambios de unidad. No inferimos relaciones desde cantidades guardadas.
        if (smaePiezasPorEq > 0 && workingUnidad === smaeUnidadPorcion) {
          eqVal = roundEq(num / smaePiezasPorEq);
        } else {
          eqVal = firstEqNum; // fallback: no cambia eq
        }
      }

      const scale = firstEqNum > 0 ? eqVal / firstEqNum : 0;
      const newEquivs = equivalencias.map((e, i) => {
        if (i === 0) return { ...e, cantidad: eqVal };
        const oldVal = parseFloat(e.cantidad?.toString() || '0');
        if (oldVal <= 0 || scale <= 0) return e;
        return { ...e, cantidad: roundEq(oldVal * scale) };
      });
      setEquivalencias(newEquivs);
      onUpdate({
        cantidad: num, unidad: workingUnidad,
        equivalencias: newEquivs,
        eqCantidad: eqVal,
        eqGrupo: newEquivs[0]?.grupo,
        smaeGrPorEq: activeAnchor,
      });
      lastSentUpdate.current = JSON.stringify({ cantidad: num, unidad: workingUnidad, descripcion: query, equivalencias: newEquivs, smaeGrPorEq: activeAnchor });
    } else {
      // Sin ancla: guardamos solo la cantidad sin tocar las eq
      onUpdate({ cantidad: num, unidad: workingUnidad, smaeGrPorEq: 0 });
      lastSentUpdate.current = JSON.stringify({ cantidad: num, unidad: workingUnidad, descripcion: query, equivalencias, smaeGrPorEq: 0 });
    }
  };

  // ─── Cambio en EQ (primer grupo o cualquiera) ─────────────────────────────
  // Si idx === 0 y tiene ancla SMAE, el cambio regenera la cantidad con exactitud
  const handleEqChange = (idx: number, val: string) => {
    const eqNum = val.trim() ? Number(val.trim().replace(',', '.')) : NaN;
    if (val.trim() && (!Number.isFinite(eqNum) || eqNum < 0)) {
      toast({ title: 'Equivalencias no válidas', description: 'Introduce un valor mayor o igual a cero.' });
      return;
    }
    const oldEquivs = [...equivalencias];
    const oldEq0 = parseFloat(oldEquivs[0]?.cantidad?.toString() || '0');
        if (idx === 0 && Number.isFinite(eqNum) && eqNum >= 0 &&
      !((unidad === anchorUnit && smaeGrPorEq > 0) ||
        (unidad === smaeUnidadPorcion && smaePiezasPorEq > 0))) {
      toast({ title: 'No se puede convertir esta unidad', description: 'Se conservó la cantidad original. Revisa la relación de porción en el catálogo SMAE o ajusta la cantidad manualmente.' });
      return;
    }

    // Guardamos el valor raw mientras el usuario escribe; si es número lo almacenamos como tal
    // Si el cambio es en idx 0, escalamos también las equivalencias secundarias proporcionalmente
    const scaleSecondary = idx === 0 && Number.isFinite(eqNum) && eqNum >= 0 && oldEq0 > 0;
    const newEquivs = oldEquivs.map((e, i) => {
      if (i === idx) return { ...e, cantidad: isNaN(eqNum) ? val : eqNum };
      if (scaleSecondary) {
        const oldVal = parseFloat(e.cantidad?.toString() || '0');
        if (oldVal > 0) return { ...e, cantidad: roundEq(oldVal * (eqNum / oldEq0)) };
      }
      return e;
    });
    setEquivalencias(newEquivs);

    // Leer ancla actual
    const activeAnchor = smaeGrPorEq;

    const updates: Partial<Ingrediente> = {
      equivalencias: newEquivs,
      eqCantidad: Number(newEquivs[0]?.cantidad) || 0,
      eqGrupo: newEquivs[0].grupo,
      smaeGrPorEq: activeAnchor,
    };

    // Si es el primer grupo y el número es válido, recalculamos la cantidad
    if (idx === 0 && !isNaN(eqNum) && eqNum >= 0) {
      if (activeAnchor > 0) {
        if (unidad === anchorUnit) {
          // ✅ Canónico (GR/ML/etc.): ancla × eq = cantidad EXACTA (nunca deriva)
          const newGr = eqToGr(eqNum, activeAnchor);
          setCantidad(newGr.toString());
          updates.cantidad = newGr;
          updates.unidad = anchorUnit;
        } else {
          // Unidad casera: rescalamos proporcionalmente (piezas_por_eq × eqNum).
          // Preferimos smaePiezasPorEq (ancla estable del catálogo, ej. "0.5 taza = 1 eq")
          // sobre oldCant/oldEq0: si el usuario borró el campo antes de escribir el nuevo
          // valor (ej. Backspace y luego "3"), oldEq0 quedaría en 0 momentáneamente y
          // rompería el ratio — smaePiezasPorEq no se ve afectado por ese estado transitorio.
          const piezasPorEq = unidad === smaeUnidadPorcion ? smaePiezasPorEq : 0;
          if (piezasPorEq > 0) {
            const newCant = parseFloat((piezasPorEq * eqNum).toFixed(2));
            setCantidad(newCant.toString());
            updates.cantidad = newCant;
          }
        }
      }
    }

    onUpdate(updates);

    lastSentUpdate.current = JSON.stringify({
      cantidad: updates.cantidad ?? Number(cantidad),
      unidad: updates.unidad ?? unidad,
      descripcion: query,
      equivalencias: updates.equivalencias ?? equivalencias,
      smaeGrPorEq: activeAnchor
    });
  };

  const updateEquiv = (idx: number, field: 'cantidad' | 'grupo', val: string, shouldNormalize = false) => {
    if (field === 'cantidad') {
      handleEqChange(idx, val);
      return;
    }
    const finalVal = shouldNormalize ? normalizeGroup(val) : val;
    const newEquivs = equivalencias.map((e, i) =>
      i === idx ? { ...e, [field]: finalVal } : e
    );
    setEquivalencias(newEquivs);
    onUpdate({
      equivalencias: newEquivs,
      eqCantidad: parseFloat(newEquivs[0].cantidad.toString()) || 0,
      eqGrupo: newEquivs[0].grupo,
    });
  };

  /** Select a grupo from the dropdown suggestions */
  const selectGrupoForEquiv = (idx: number, grupo: string) => {
    // Clear the input override
    setGrupoInputValues(prev => { const next = { ...prev }; delete next[idx]; return next; });
    updateEquiv(idx, 'grupo', grupo, true);
    setFocusedEquivIdx(null);
  };

  /** Commit the current grupo input value (normalize on blur) */
  const commitGrupoInput = (idx: number) => {
    const rawVal = grupoInputValues[idx] ?? equivalencias[idx]?.grupo ?? '';
    if (rawVal.trim()) {
      updateEquiv(idx, 'grupo', rawVal, true);
    }
    setGrupoInputValues(prev => { const next = { ...prev }; delete next[idx]; return next; });
    // Delay closing to allow click on dropdown items
    setTimeout(() => setFocusedEquivIdx(null), 150);
  };

  /** Get the display value for grupo input */
  const getGrupoDisplayValue = (idx: number): string => {
    if (grupoInputValues[idx] !== undefined) return grupoInputValues[idx];
    return equivalencias[idx]?.grupo?.toString() ?? '';
  };

  /** Get filtered suggestions for the grupo input */
  const getGrupoSuggestions = (idx: number): string[] => {
    const raw = (grupoInputValues[idx] ?? '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    if (!raw) return SMAE_GROUP_LABELS;
    return SMAE_GROUP_LABELS.filter(label =>
      label.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').includes(raw)
    );
  };

  const addEquiv = () => setEquivalencias(prev => [...prev, { cantidad: '', grupo: '' }]);

  const removeEquiv = (idx: number) => {
    if (equivalencias.length <= 1) return;
    const newEquivs = equivalencias.filter((_, i) => i !== idx);
    setEquivalencias(newEquivs);
    setGrupoInputValues(prev => { const next = { ...prev }; delete next[idx]; return next; });
    onUpdate({ equivalencias: newEquivs, eqCantidad: parseFloat(newEquivs[0].cantidad.toString()) || 0, eqGrupo: newEquivs[0].grupo });
  };

  // ─── Quick Save al catálogo SMAE ──────────────────────────────────────────
  const handleSaveQuickFood = async () => {
    if (readonlyCatalog) return;
    if (!quickGramos || parseFloat(quickGramos) <= 0) return;
    setIsSavingQuick(true);
    try {
      const payload = {
        nombre: query,
        grupo: quickGrupo,
        pesoGramos: parseFloat(quickGramos),
        esPersonalizado: true,
        porcionCasera: quickPorcion || '',
        cantidadPorcion: null,
        unidadPorcion: '',
      };
      const { data } = await api.post('/api/alimentos-smae', payload);
      const newFood = data?.data || data;
      if (_smaeCache) _smaeCache.push(newFood);
      setAllAlimentos(prev => [...prev, newFood]);
      handleSelect(newFood);
      setShowQuickModal(false);
      setQuickGramos(''); setQuickPorcion('');
    } catch (err: any) {
      const duplicado = err?.response?.status === 409;
      toast({
        title: duplicado ? 'Ya existe' : 'Error',
        description: err?.response?.data?.error || 'No se pudo guardar el alimento.',
        variant: 'destructive',
      });
      console.error('Error al guardar alimento rápido:', err);
    } finally {
      setIsSavingQuick(false);
    }
  };

  // ─── Datos derivados para el badge del grupo ───────────────────────────────
  const grupoColor = smaeGrupoKey ? (GRUPO_COLORS[smaeGrupoKey] || '#8a8a8a') : '#8a8a8a';
  const grupoLabel = smaeGrupoKey ? (GRUPO_LABELS[smaeGrupoKey] || smaeGrupoKey) : null;
  const hasSmae = smaeGrPorEq > 0;

  return (
    <div className="relative space-y-2 pb-4 border-b border-border-default last:border-0 last:pb-0">

      {/* ─── Búsqueda de alimento ─── */}
      <div ref={wrapperRef} className="relative">
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-text-muted pointer-events-none" />
            <input
              type="text"
              value={query}
              onChange={(e) => {
                hasUserTyped.current = true;
                const val = e.target.value;
                setQuery(val);

                if (val.trim() === '') {
                  // Limpieza total: borra cantidad, suelta presupuesto y resetea tabla
                  setSmaeGrPorEq(0);
                  setSmaePiezasPorEq(0);
                  setCantidad('');
                  setUnidad('GR');
                  setEquivalencias([]);
                  setSmaeGrupoKey('');
                  onUpdate({
                    descripcion: '', cantidad: '', unidad: 'GR', smaeGrPorEq: 0,
                    equivalencias: [], eqCantidad: 0, eqGrupo: ''
                  });
                } else if (smaeGrPorEq > 0) {
                  // Soltó el ancla SMAE escribiendo otra cosa: suelta el presupuesto para re-escala
                  setSmaeGrPorEq(0);
                  setSmaePiezasPorEq(0);
                  setEquivalencias([]);
                  setSmaeGrupoKey('');
                  onUpdate({
                    descripcion: val, smaeGrPorEq: 0, equivalencias: [],
                    eqCantidad: 0, eqGrupo: ''
                  });
                } else {
                  onUpdate({ descripcion: val });
                }
              }}
              onFocus={() => hasUserTyped.current && results.length > 0 && setShowDropdown(true)}
              placeholder="Buscar en catálogo SMAE o escribir libre..."
              className="w-full pl-8 pr-28 py-2 bg-bg-base rounded-[6px] text-[13px] font-semibold text-white outline-none border border-border-subtle focus:border-[#555] transition-colors placeholder:text-[#999] placeholder:font-medium"
            />
            {grupoLabel && (
              <span
                className="absolute right-2 top-1/2 -translate-y-1/2 px-1.5 py-0.5 rounded text-[10px] font-bold"
                style={{ background: grupoColor + '22', color: grupoColor, border: `1px solid ${grupoColor}44` }}
              >
                {grupoLabel}
              </span>
            )}
          </div>
          <button
            type="button"
            onClick={onRemove}
            className="shrink-0 p-2 text-[#d57a7a] border border-[#5a2929] bg-[#281818] hover:text-white hover:bg-[#7f1d1d] rounded-[6px] transition-colors"
            title="Eliminar ingrediente"
            aria-label="Eliminar ingrediente"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Dropdown */}
        {showDropdown && (
          <div className="absolute z-50 left-0 right-8 mt-1 bg-[#111] border border-[#333] rounded-[8px] shadow-2xl flex flex-col overflow-hidden">
            <div className="max-h-56 overflow-y-auto w-full">
              {results.length > 0 ? results.map((a) => {
                const col = GRUPO_COLORS[a.grupo] || '#8a8a8a';
                const lbl = GRUPO_LABELS[a.grupo] || a.grupo;
                return (
                  <button
                    key={a.id} type="button"
                    onMouseDown={(e) => { e.preventDefault(); handleSelect(a); }}
                    className="w-full text-left px-3 py-2 hover:bg-[#1a1a1a] transition-colors flex items-center justify-between gap-3 border-b border-[#222] last:border-0"
                  >
                    <div>
                      <p className="text-[13px] font-bold text-white m-0">{a.nombre}</p>
                      <p className="text-[11px] font-medium text-[#b0b0b0] m-0">
                        {Number(amountPerBaseEquivalent(a.pesoGramos, a.equivalentesBase).toFixed(2))} {a.unidadBase || 'g'} = 1 eq · {a.pesoGramos} {a.unidadBase || 'g'} = {a.equivalentesBase || 1} eq por porción
                      </p>
                    </div>
                    <span className="text-[10px] font-bold px-1.5 py-0.5 rounded whitespace-nowrap flex-shrink-0"
                      style={{ background: col + '22', color: col, border: `1px solid ${col}44` }}>
                      {lbl}
                    </span>
                  </button>
                );
              }) : (
                <div className="p-3 text-[12px] text-[#888] text-center w-full">No se encontraron resultados</div>
              )}
            </div>
            {query.trim().length >= 2 && !readonlyCatalog && (
              <button type="button"
                onMouseDown={(e) => { e.preventDefault(); setShowQuickModal(true); setShowDropdown(false); }}
                className="w-full text-center px-3 py-2.5 hover:bg-[#1a1a1a] transition-colors border-t border-[#333] text-[#90c2ff] font-medium text-[12px] flex items-center justify-center bg-[#111]">
                ⭐ Guardar "{query}" en Catálogo SMAE
              </button>
            )}
          </div>
        )}

        {/* Quick Modal — solo visible cuando el catálogo NO es readonly */}
        {showQuickModal && !readonlyCatalog && (
          <div className="bg-[#1a1a1a] border border-[#333] rounded-[8px] p-3 mt-2 space-y-3 animate-slide-up relative z-40 shadow-xl">
            <p className="text-[12px] font-bold text-white mb-2">⭐ Añadir "{query}" al Catálogo SMAE</p>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-[10px] text-text-muted uppercase tracking-wider block mb-1">Grupo SMAE</label>
                <select value={quickGrupo} onChange={(e) => setQuickGrupo(e.target.value)}
                  className="w-full bg-[#111] px-2 py-1.5 rounded-[4px] text-[12px] text-white border border-[#333] outline-none">
                  {Object.entries(GRUPO_LABELS).map(([k, v]) => (
                    <option key={k} value={k}>{v}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-[10px] text-text-muted uppercase tracking-wider block mb-1">Gramos × 1 eq</label>
                <input type="number" value={quickGramos} onChange={(e) => setQuickGramos(e.target.value)}
                  placeholder="Ej. 30"
                  className="w-full bg-[#111] px-2 py-1.5 rounded-[4px] text-[12px] text-white border border-[#333] outline-none placeholder:text-[#555]" />
              </div>
              <div className="col-span-2">
                <label className="text-[10px] text-text-muted uppercase tracking-wider block mb-1">Porción Casera (Opcional)</label>
                <input type="text" value={quickPorcion} onChange={(e) => setQuickPorcion(e.target.value)}
                  placeholder="Ej. 1 taza, 1 pieza, 2 cdas"
                  className="w-full bg-[#111] px-2 py-1.5 rounded-[4px] text-[12px] text-white border border-[#333] outline-none placeholder:text-[#555]" />
              </div>
            </div>
            <div className="flex items-center justify-between pt-1 mt-2">
              <span className="text-[10px] text-[#777] italic">Se guardará permanentemente en el catálogo</span>
              <div className="flex items-center gap-2">
                <button type="button" onClick={() => setShowQuickModal(false)}
                  className="text-[11px] text-[#8a8a8a] hover:text-white px-2 py-1 rounded transition-colors border border-transparent hover:border-[#444]">
                  Cancelar
                </button>
                <button type="button" onClick={handleSaveQuickFood}
                  disabled={isSavingQuick || !quickGramos || parseFloat(quickGramos) <= 0}
                  className="text-[11px] font-bold bg-brand-primary text-bg-base px-3 py-1.5 rounded-[4px] hover:bg-white transition-colors disabled:opacity-50 flex items-center gap-1 shadow-sm">
                  {isSavingQuick ? 'Guardando...' : <><Check className="w-3 h-3" /> Guardar y Usar</>}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ─── Cantidad / Unidad ─── */}
      <div className="grid grid-cols-2 gap-2 mb-2">
        <div>
          <label className="text-[10px] text-text-muted uppercase tracking-wider block mb-1">
            Cantidad{unidad ? ` (${unidad.toLowerCase()})` : ''}
          </label>
          <input
            type="text"
            inputMode="decimal"
            value={cantidad}
            onChange={(e) => handleCantidadChange(e.target.value)}
            onFocus={() => isFocused.current = true}
            onBlur={() => isFocused.current = false}
            className={`w-full bg-bg-base px-2 py-2 rounded-[6px] text-[13px] font-bold text-center outline-none border transition-colors ${hasSmae ? 'text-[#90c2ff] border-[#90c2ff]/30 focus:border-[#90c2ff]' : 'text-white border-border-subtle focus:border-[#444]'}`}
            placeholder="0"
          />
        </div>
        <div>
          <label className="text-[10px] text-text-muted uppercase tracking-wider block mb-1">Unidad</label>
          {hasSmae ? (
            <select
              value={unidad.toUpperCase().trim()}
              onChange={(e) => {
                const nextUnit = e.target.value;
                const currentEq = Number(equivalencias[0]?.cantidad) || 0;
                const amountPerEq = nextUnit === anchorUnit ? smaeGrPorEq : (nextUnit === smaeUnidadPorcion ? smaePiezasPorEq : 0);
                setUnidad(nextUnit);
                if (currentEq > 0 && amountPerEq > 0) {
                  const nextAmount = parseFloat((currentEq * amountPerEq).toFixed(2));
                  setCantidad(nextAmount.toString());
                  onUpdate({ unidad: nextUnit, cantidad: nextAmount });
                } else {
                  onUpdate({ unidad: nextUnit });
                }
              }}
              className="w-full bg-bg-base px-2 py-2 rounded-[6px] text-[13px] font-bold text-white text-center outline-none border border-border-subtle focus:border-[#444]"
            >
              {[...new Set([anchorUnit, ...(smaePiezasPorEq > 0 && smaeUnidadPorcion ? [smaeUnidadPorcion] : []), unidad.toUpperCase().trim()])].map(code => (
                <option key={code} value={code}>{code}</option>
              ))}
            </select>
          ) : (
            <input
              value={unidad}
              onChange={(e) => { const code = normalizeSmaeUnit(e.target.value); setUnidad(code); onUpdate({ unidad: code }); }}
              className="w-full bg-bg-base px-2 py-2 rounded-[6px] text-[13px] font-bold text-white text-center outline-none border border-border-subtle focus:border-[#444] lowercase"
              placeholder="gr"
            />
          )}
        </div>
      </div>

      {/* ─── EQUIVALENCIAS ─── */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between mb-1">
          <label className="text-[10px] uppercase tracking-wider text-text-muted">
            Equivalencias{hasSmae ? ` (auto ↔ ${anchorUnit.toLowerCase()})` : ' (manual)'}
          </label>
          <button type="button" onClick={addEquiv}
            className="flex items-center gap-1 text-[10px] text-[#90c2ff] hover:text-white transition-colors px-1.5 py-0.5 rounded hover:bg-[#1a2a3a]">
            <Plus className="w-3 h-3" /> Añadir grupo
          </button>
        </div>

        {equivalencias.map((eq, idx) => {
          const grupoDisplay = getGrupoDisplayValue(idx);
          const isGrupoFocused = focusedEquivIdx === idx;
          const suggestions = isGrupoFocused ? getGrupoSuggestions(idx) : [];

          return (
            <div key={idx} className="flex items-center gap-1.5">
              {idx > 0 && <span className="text-[11px] font-black text-[#888] w-4 text-center flex-shrink-0">+</span>}
              {idx === 0 && <span className="w-4 flex-shrink-0" />}

              {/* Cantidad eq — si es idx 0 y tiene ancla SMAE, el cambio regenera los gramos */}
              <input
                type="text"
                inputMode="decimal"
                value={eq.cantidad.toString()}
                onChange={(e) => handleEqChange(idx, e.target.value)}
                onFocus={() => { isFocused.current = true; }}
                onBlur={() => { isFocused.current = false; }}
                className={`w-16 bg-bg-base px-2 py-1.5 rounded-[6px] text-[13px] font-bold text-center outline-none border transition-colors flex-shrink-0 ${hasSmae && idx === 0 ? 'text-[#90c2ff] border-[#90c2ff]/30' : 'text-white border-border-subtle focus:border-[#444]'
                  }`}
                placeholder="0"
              />
              <span className="text-[11px] font-bold text-[#999] flex-shrink-0">eq</span>

              {/* Grupo combobox con sugerencias */}
              <div className="relative flex-1" ref={el => { equivRefs.current[idx] = el; }}>
                <input
                  value={grupoDisplay}
                  onChange={(e) => {
                    setGrupoInputValues(prev => ({ ...prev, [idx]: e.target.value }));
                    setFocusedEquivIdx(idx);
                  }}
                  onFocus={() => setFocusedEquivIdx(idx)}
                  onBlur={() => commitGrupoInput(idx)}
                  className={`w-full bg-bg-base px-2 py-1.5 rounded-[6px] text-[13px] font-bold outline-none border transition-colors ${hasSmae && idx === 0 ? 'text-[#90c2ff] border-[#90c2ff]/30' : 'text-white border-border-subtle focus:border-[#444]'
                    }`}
                  placeholder="Grupo (ej. AOA Muy Bajo)"
                />
                {isGrupoFocused && suggestions.length > 0 && (
                  <div className="absolute z-50 left-0 right-0 bottom-full mb-1 bg-[#111] border border-[#444] rounded-[8px] shadow-[0_4px_16px_rgba(0,0,0,0.5)] max-h-[180px] overflow-y-auto custom-scrollbar">
                    {suggestions.map(label => {
                      const col = GRUPO_COLORS[Object.entries(GRUPO_LABELS).find(([, v]) => v === label)?.[0] || ''] || '#8a8a8a';
                      return (
                        <button
                          key={label}
                          type="button"
                          onMouseDown={(e) => { e.preventDefault(); selectGrupoForEquiv(idx, label); }}
                          className="w-full text-left px-3 py-2 text-[12px] font-semibold text-white hover:bg-[#1a1a1a] transition-colors flex items-center gap-2 border-b border-[#222] last:border-0"
                        >
                          <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: col }} />
                          {label}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>

              {equivalencias.length > 1 && (
                <button type="button" onClick={() => removeEquiv(idx)}
                  className="text-[#555] hover:text-accent-red transition-colors p-1 flex-shrink-0">
                  <X className="w-3 h-3" />
                </button>
              )}
            </div>
          );
        })}

        {/* Chip de ancla SMAE — muestra cuántos g = 1 eq */}
        {hasSmae && (
          <p className="text-[10px] text-[#555] italic">
            📐 {Number(smaeGrPorEq.toFixed(2))} {smaeUnidadBase} = 1 eq · cambia cantidad o EQ y el otro se ajusta automático
          </p>
        )}

        {/* Preview de la fórmula completa */}
        {equivalencias.some(e => e.cantidad && e.grupo) && (
          <p className="text-[11px] text-text-muted bg-bg-base px-2 py-1 rounded-[4px] border border-border-default inline-block m-0 mt-1">
            {cantidad} {unidad} {query} →{' '}
            <span className="font-bold text-[#90c2ff]">
              {equivalencias
                .filter(e => e.cantidad && e.grupo)
                .map(e => `${e.cantidad} Eq ${e.grupo}`)
                .join(' + ')}
            </span>
          </p>
        )}
      </div>
    </div>
  );
};

export default SmaeIngredientePicker;
