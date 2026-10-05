/** Normalize spelling aliases only; never infer a conversion between different units. */
export const normalizeSmaeUnit = (unit?: string): string => {
  const value = (unit || '').trim().toUpperCase();
  const aliases: Record<string, string> = {
    G: 'GR', GR: 'GR', GRAMO: 'GR', GRAMOS: 'GR',
    ML: 'ML', MILILITRO: 'ML', MILILITROS: 'ML',
    PZ: 'PIEZA', PZA: 'PIEZA', PZAS: 'PIEZA', PIEZA: 'PIEZA', PIEZAS: 'PIEZA',
    TZ: 'TAZA', TAZA: 'TAZA', TAZAS: 'TAZA',
  };
  return aliases[value] || value;
};
