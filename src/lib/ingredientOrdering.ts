import type { Ingrediente } from '@/types';

export const reorderDishGroups = (
  ingredientes: Ingrediente[],
  fromGroupIndex: number,
  toGroupIndex: number,
): Ingrediente[] => {
  const names = Array.from(new Set(ingredientes.map((item) => item.platillo || '')));
  if (fromGroupIndex === toGroupIndex || fromGroupIndex < 0 || toGroupIndex < 0 || fromGroupIndex >= names.length || toGroupIndex >= names.length) {
    return ingredientes;
  }
  const [moved] = names.splice(fromGroupIndex, 1);
  names.splice(toGroupIndex, 0, moved);
  return names.flatMap((name) => ingredientes.filter((item) => (item.platillo || '') === name));
};

export const reorderIngredientWithinDish = (
  ingredientes: Ingrediente[],
  fromIndex: number,
  toIndex: number,
): Ingrediente[] => {
  if (fromIndex === toIndex || !ingredientes[fromIndex] || !ingredientes[toIndex]) return ingredientes;
  if ((ingredientes[fromIndex].platillo || '') !== (ingredientes[toIndex].platillo || '')) return ingredientes;
  const result = [...ingredientes];
  const [moved] = result.splice(fromIndex, 1);
  result.splice(toIndex, 0, moved);
  return result;
};

export const ingredientDragId = (ingredientIndex: number) => `ingredient-${ingredientIndex}`;

export const reorderIngredientFromDrag = (
  ingredientes: Ingrediente[],
  activeId: string | number,
  overId: string | number,
): Ingrediente[] => {
  const parseIndex = (id: string | number) => {
    const match = /^ingredient-(\d+)$/.exec(String(id));
    return match ? Number(match[1]) : null;
  };
  const fromIndex = parseIndex(activeId);
  const toIndex = parseIndex(overId);
  if (fromIndex === null || toIndex === null) return ingredientes;
  return reorderIngredientWithinDish(ingredientes, fromIndex, toIndex);
};
