import type { EquivalenciaItem } from '@/types';

const positive = (value: unknown): number => {
  const parsed = Number(String(value ?? '').replace(',', '.'));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
};

const roundMeasure = (value: number): number => parseFloat(value.toFixed(2));

/** Physical amount represented by one equivalent of the base group. */
export const amountPerBaseEquivalent = (referenceAmount: unknown, referenceEquivalents: unknown): number => {
  const amount = positive(referenceAmount);
  const equivalents = positive(referenceEquivalents) || 1;
  // Keep full precision for later conversions (1 serv / 3 eq must return to 1 serv).
  // Round only the physical quantity shown/saved, never the conversion ratio.
  return amount > 0 ? amount / equivalents : 0;
};

/**
 * Extra food groups belong to the complete reference portion. When the menu
 * requests only part (or several copies) of that portion, every group uses the
 * same factor as the base group.
 */
export const buildScaledCatalogEquivalences = (
  baseGroup: string,
  referenceBaseEquivalents: unknown,
  targetBaseEquivalents: unknown,
  extras: EquivalenciaItem[] | undefined,
): EquivalenciaItem[] => {
  const base = positive(referenceBaseEquivalents) || 1;
  const target = positive(targetBaseEquivalents) || base;
  const factor = target / base;

  return [
    { grupo: baseGroup, cantidad: roundMeasure(target) },
    ...(extras || [])
      .filter(item => item?.grupo && positive(item.cantidad) > 0)
      .map(item => ({
        ...item,
        cantidad: roundMeasure(positive(item.cantidad) * factor),
      })),
  ];
};
