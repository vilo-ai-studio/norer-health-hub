import { describe, expect, it } from 'vitest';
import { hasLaboratorio, laboratorioFromValoracion } from './laboratorio';

describe('herencia de laboratorio', () => {
  it('recupera los cinco análisis y otros sin convertir cero en vacío', () => {
    expect(laboratorioFromValoracion({
      glucosa: 0,
      trigliceridos: 130,
      colesterol: 180,
      creatinina: 0.9,
      acidoUrico: 5.2,
      otrosBioquimicos: 'Vitamina D: 35 ng/mL',
    })).toEqual({
      glucosa: '0',
      trigliceridos: '130',
      colesterol: '180',
      creatinina: '0.9',
      acidoUrico: '5.2',
      otrosDetalle: [{ id: 'otro-anterior', nombre: 'Otros', valor: 'Vitamina D: 35 ng/mL' }],
    });
  });

  it('deja vacía la bioquímica cuando no hay una consulta anterior', () => {
    expect(hasLaboratorio(null)).toBe(false);
    expect(laboratorioFromValoracion(null).otrosDetalle).toEqual([]);
  });

  it('recupera filas con nombre y valor de la consulta anterior', () => {
    expect(laboratorioFromValoracion({
      bioquimicosOtrosDetalle: [{ id: 'd', nombre: 'Vitamina D', valor: '35 ng/mL' }],
    }).otrosDetalle).toEqual([{ id: 'd', nombre: 'Vitamina D', valor: '35 ng/mL' }]);
  });
});
