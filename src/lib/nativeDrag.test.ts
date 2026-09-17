import { describe, expect, it, vi } from 'vitest';
import { beginNativeDrag } from './nativeDrag';

describe('beginNativeDrag', () => {
  it('registra un payload compatible y configura el movimiento', () => {
    const setData = vi.fn();
    const dataTransfer = { effectAllowed: 'none', setData } as unknown as DataTransfer;
    const payload = { menuIdx: 0, tiempoIdx: 1, groupIdx: 2 };

    beginNativeDrag(dataTransfer, 'dish', payload);

    expect(dataTransfer.effectAllowed).toBe('move');
    expect(setData).toHaveBeenCalledWith('application/x-norder-dish', JSON.stringify(payload));
    expect(setData).toHaveBeenCalledWith('text/plain', JSON.stringify(payload));
  });

  it('registra el arrastre de un ingrediente importado para que pueda soltarse', () => {
    const setData = vi.fn();
    const dataTransfer = { effectAllowed: 'none', setData } as unknown as DataTransfer;
    const payload = { menuIdx: 0, tiempoIdx: 2, ingredientIdx: 1 };

    beginNativeDrag(dataTransfer, 'ingredient', payload);

    expect(dataTransfer.effectAllowed).toBe('move');
    expect(setData).toHaveBeenCalledWith('application/x-norder-ingredient', JSON.stringify(payload));
    expect(setData).toHaveBeenCalledWith('text/plain', JSON.stringify(payload));
  });
});
