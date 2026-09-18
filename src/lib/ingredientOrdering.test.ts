import { describe, expect, it } from 'vitest';
import type { Ingrediente } from '@/types';
import {
  ingredientDragId,
  reorderDishGroups,
  reorderIngredientFromDrag,
  reorderIngredientWithinDish,
} from './ingredientOrdering';

const item = (descripcion: string, platillo: string): Ingrediente => ({ descripcion, platillo, cantidad: 1, unidad: 'PZA' });

describe('ingredientOrdering', () => {
  it('mueve el platillo completo sin separar sus ingredientes', () => {
    const result = reorderDishGroups([item('Pan', 'Sándwich'), item('Pollo', 'Sándwich'), item('Leche', 'Licuado')], 1, 0);
    expect(result.map((i) => i.descripcion)).toEqual(['Leche', 'Pan', 'Pollo']);
  });

  it('reordena ingredientes únicamente dentro del mismo platillo', () => {
    const source = [item('Pan', 'Sándwich'), item('Pollo', 'Sándwich'), item('Leche', 'Licuado')];
    expect(reorderIngredientWithinDish(source, 1, 0).map((i) => i.descripcion)).toEqual(['Pollo', 'Pan', 'Leche']);
    expect(reorderIngredientWithinDish(source, 0, 2)).toBe(source);
  });

  it('conserva el bloque del platillo importado al mover uno de sus ingredientes', () => {
    const source = [
      { ...item('Tortilla', 'Tacos importados'), id: 'library-1' },
      { ...item('Pollo', 'Tacos importados'), id: 'library-2' },
      { ...item('Aguacate', 'Tacos importados'), id: 'library-3' },
      item('Yogur', 'Colación'),
    ];

    const reordered = reorderIngredientWithinDish(source, 2, 0);

    expect(reordered.map((i) => i.descripcion)).toEqual(['Aguacate', 'Tortilla', 'Pollo', 'Yogur']);
    expect(reordered.slice(0, 3).every((i) => i.platillo === 'Tacos importados')).toBe(true);
  });

  it('resuelve los identificadores del sortable sin mover ingredientes de otro platillo', () => {
    const source = [item('Pan', 'Sándwich'), item('Pollo', 'Sándwich'), item('Leche', 'Licuado')];

    expect(reorderIngredientFromDrag(source, ingredientDragId(1), ingredientDragId(0)).map((i) => i.descripcion))
      .toEqual(['Pollo', 'Pan', 'Leche']);
    expect(reorderIngredientFromDrag(source, ingredientDragId(0), ingredientDragId(2))).toBe(source);
    expect(reorderIngredientFromDrag(source, 'invalid', ingredientDragId(0))).toBe(source);
  });
});
