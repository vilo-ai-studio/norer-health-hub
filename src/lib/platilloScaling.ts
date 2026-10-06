import type { EquivalenciaItem, Ingrediente } from '@/types';
import { groupToBarridoKey } from './smaeGroups';
import { normalizeSmaeUnit } from './smaeUnits';

const number = (value: unknown): number => {
  const parsed = Number(String(value ?? '').replace(',', '.'));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
};
const round = (value: number): number => Number(value.toFixed(2));

export const ingredientEquivalences = (ingredient: Ingrediente): EquivalenciaItem[] => {
  let raw: unknown = ingredient.equivalencias;
  if (typeof raw === 'string') {
    try { raw = JSON.parse(raw); } catch { raw = []; }
  }
  const valid = Array.isArray(raw)
    ? raw.filter(item => item?.grupo?.trim() && item.cantidad !== '' && item.cantidad != null
      && Number.isFinite(Number(String(item.cantidad).replace(',', '.')))
      && Number(String(item.cantidad).replace(',', '.')) >= 0)
      .map(item => ({ grupo: item.grupo, cantidad: number(item.cantidad) }))
    : [];
  return valid.length ? valid : ingredient.eqGrupo
    ? [{ grupo: ingredient.eqGrupo, cantidad: number(ingredient.eqCantidad) }]
    : [];
};

/** Share the remaining meal budget among ingredients of each base group. */
export const scaleIngredientsToBarrido = (
  ingredients: Ingrediente[],
  budget: Record<string, unknown>,
  existing: Ingrediente[] = [],
): Ingrediente[] => {
  const used: Record<string, number> = {};
  for (const ingredient of existing) {
    for (const eq of ingredientEquivalences(ingredient)) {
      const key = groupToBarridoKey(eq.grupo);
      used[key] = (used[key] || 0) + number(eq.cantidad);
    }
  }
  const equivalences = ingredients.map(ingredientEquivalences);
  const totals: Record<string, number> = {};
  ingredients.forEach((ingredient, index) => {
    const base = equivalences[index][0];
    if (!base) return;
    const key = groupToBarridoKey(base.grupo);
    if (ingredient.fijarEq || !ingredient.platillo && existing.length === 0) {
      for (const eq of equivalences[index]) {
        const eqKey = groupToBarridoKey(eq.grupo);
        used[eqKey] = (used[eqKey] || 0) + number(eq.cantidad);
      }
    } else {
      totals[key] = (totals[key] || 0) + number(base.cantidad);
    }
  });
  return ingredients.map((ingredient, index) => {
    const eqs = equivalences[index];
    const base = eqs[0];
    const normalized = { ...ingredient, equivalencias: eqs,
      eqGrupo: base?.grupo || ingredient.eqGrupo,
      eqCantidad: base ? number(base.cantidad) : ingredient.eqCantidad };
    if (!base || ingredient.fijarEq || !ingredient.platillo && existing.length === 0) return normalized;
    const key = groupToBarridoKey(base.grupo);
    const target = number(budget[key]);
    const total = totals[key];
    // An absent/zero budget has no scaling target; keep the editable source portion.
    if (!target || !total || !number(base.cantidad)) return normalized;
    const factor = Math.max(0, target - (used[key] || 0)) / total;
    const nextEq = round(number(base.cantidad) * factor);
    const amountPerEq = normalizeSmaeUnit(ingredient.unidad) === 'GR' && number(ingredient.smaeGrPorEq)
      ? number(ingredient.smaeGrPorEq)
      : number(ingredient.cantidad) / number(base.cantidad);
    if (!(amountPerEq > 0)) return normalized;
    return { ...normalized,
      cantidad: round(amountPerEq * nextEq),
      eqCantidad: nextEq,
      equivalencias: eqs.map((eq, idx) => ({ ...eq, cantidad: idx === 0 ? nextEq : round(number(eq.cantidad) * factor) })),
    };
  });
};
