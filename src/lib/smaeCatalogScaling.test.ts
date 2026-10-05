import { describe, expect, it } from 'vitest';
import { amountPerBaseEquivalent, buildScaledCatalogEquivalences } from './smaeCatalogScaling';

describe('SMAE catalog multigroup scaling', () => {
  it('scales the physical amount from the base equivalents only', () => {
    expect(amountPerBaseEquivalent(120, 2)).toBe(60);
    expect(amountPerBaseEquivalent(150, 1)).toBe(150);
    expect(amountPerBaseEquivalent(30, 1)).toBe(30);
  });

  it.each([
    ['g', 90, 3, 30], ['ml', 240, 2, 120], ['pz', 2, 2, 1],
    ['serv', 1, 3, 1 / 3], ['botellita', 1, 2, 0.5],
  ])('preserves the reference ratio for %s', (_unit, amount, equivalents, expected) => {
    const perEquivalent = amountPerBaseEquivalent(amount, equivalents);
    expect(perEquivalent).toBeCloseTo(expected, 12);
    expect(perEquivalent * equivalents).toBeCloseTo(amount, 12);
  });

  it('keeps and scales every extra group with the base-group factor', () => {
    expect(buildScaledCatalogEquivalences('Cereal c/grasa', 2, 1, [
      { grupo: 'Leguminosas', cantidad: 1 },
      { grupo: 'Cereal s/grasa', cantidad: 4 },
    ])).toEqual([
      { grupo: 'Cereal c/grasa', cantidad: 1 },
      { grupo: 'Leguminosas', cantidad: 0.5 },
      { grupo: 'Cereal s/grasa', cantidad: 2 },
    ]);
  });
});
