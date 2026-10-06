import { describe, expect, it } from 'vitest';
import type { Ingrediente } from '@/types';
import { scaleIngredientsToBarrido } from './platilloScaling';

const salmon: Ingrediente = {
  descripcion: 'Salmón de prueba', platillo: 'Salmón con arroz de prueba',
  cantidad: 60, unidad: 'gramos', smaeGrPorEq: 30,
  eqCantidad: 1, eqGrupo: 'AOA Bajo',
  equivalencias: [{ grupo: 'AOA Moderado', cantidad: 2 }],
};
describe('importación y actualización de platillos con barrido', () => {
  it('usa las EQ visibles, escala 5 EQ a 150 g y conserva el original', () => {
    const [result] = scaleIngredientsToBarrido([salmon], { aoaModerado: 5 });
    expect(result).toMatchObject({ cantidad: 150, eqCantidad: 5, eqGrupo: 'AOA Moderado', equivalencias: [{ grupo: 'AOA Moderado', cantidad: 5 }] });
    expect(salmon.cantidad).toBe(60);
  });
  it('escala salmón y arroz por separado con las EQ de sus respectivos grupos', () => {
    const rice = { ...salmon, descripcion: 'Arroz de prueba', cantidad: 40, unidad: 'g', smaeGrPorEq: 20,
      equivalencias: [{ grupo: 'Cereal s/grasa', cantidad: 2 }] };
    const result = scaleIngredientsToBarrido([salmon, rice], { aoaModerado: 5, cerealSinGr: 3.5 });
    expect(result.map(ing => [ing.cantidad, ing.eqCantidad])).toEqual([[150, 5], [70, 3.5]]);
  });
  it('reparte el presupuesto entre ingredientes del mismo grupo y descuenta lo existente', () => {
    const [first, second] = scaleIngredientsToBarrido([salmon, salmon], { aoaModerado: 5 }, [{ ...salmon, equivalencias: [{ grupo: 'AOA Moderado', cantidad: 1 }] }]);
    expect([first.eqCantidad, second.eqCantidad]).toEqual([2, 2]);
    expect([first.cantidad, second.cantidad]).toEqual([60, 60]);
  });
  it('conserva fracciones de cantidades caseras y equivalencias secundarias', () => {
    const ingredient = { ...salmon, unidad: 'taza', cantidad: 0.5, equivalencias: [{ grupo: 'Cereal s/grasa', cantidad: 1 }, { grupo: 'Grasa s/prot', cantidad: 0.5 }] };
    const [result] = scaleIngredientsToBarrido([ingredient], { cerealSinGr: 0.5 });
    expect(result.cantidad).toBe(0.25);
    expect(result.equivalencias?.map(eq => eq.cantidad)).toEqual([0.5, 0.25]);
  });
  it('actualizar dos veces el barrido conserva los valores sin multiplicar el presupuesto', () => {
    const first = scaleIngredientsToBarrido([salmon, salmon], { aoaModerado: 5 });
    const second = scaleIngredientsToBarrido(first, { aoaModerado: 5 });
    expect(second).toEqual(first);
    expect(second.map(ing => ing.eqCantidad)).toEqual([2.5, 2.5]);
  });
  it('conserva grupos no presupuestados y resta ingredientes manuales al actualizar', () => {
    expect(scaleIngredientsToBarrido([salmon], {})[0]?.cantidad).toBe(60);
    const result = scaleIngredientsToBarrido([{ ...salmon, platillo: '' }, salmon], { aoaModerado: 5 });
    expect(result.map(ing => ing.cantidad)).toEqual([60, 90]);
  });
});
