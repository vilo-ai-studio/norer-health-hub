import { describe, expect, it } from 'vitest';
import { decodeDisciplinas, encodeDisciplinas } from './disciplinas';

describe('pausas de disciplinas', () => {
  it('conserva una disciplina pausada al guardar y volver a abrir el expediente', () => {
    const saved = encodeDisciplinas([{ disciplina: 'Correr', frecuencia: '2 días', tiempo: '30 min', activo: false }]);
    expect(saved.disciplina).toBe('Correr');
    expect(decodeDisciplinas(saved.disciplina, { frecuencia: saved.frecuencia, tiempo: saved.tiempo }, saved.disciplinasDetalle))
      .toEqual([{ disciplina: 'Correr', frecuencia: '2 días', tiempo: '30 min', activo: false }]);
  });

  it('considera activas las disciplinas guardadas antes de introducir las pausas', () => {
    expect(decodeDisciplinas('Pesas', { frecuencia: '3 días', tiempo: '60 min' }))
      .toEqual([{ disciplina: 'Pesas', frecuencia: '3 días', tiempo: '60 min', activo: true }]);
  });
});
