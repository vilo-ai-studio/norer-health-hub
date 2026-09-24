export interface DisciplinaItem {
  disciplina: string;
  frecuencia: string;
  tiempo: string;
  activo: boolean;
}

export const encodeDisciplinas = (arr: DisciplinaItem[]): { disciplina: string; frecuencia: string; tiempo: string; disciplinasDetalle: DisciplinaItem[] } => {
  const clean = arr.filter(d => d.disciplina || d.frecuencia || d.tiempo).map(d => ({ ...d, activo: d.activo !== false }));
  if (clean.length === 0) return { disciplina: '', frecuencia: '', tiempo: '', disciplinasDetalle: [] };
  if (clean.length === 1) return { disciplina: clean[0].disciplina, frecuencia: clean[0].frecuencia, tiempo: clean[0].tiempo, disciplinasDetalle: clean };
  return {
    disciplina: JSON.stringify(clean),
    frecuencia: clean[0].frecuencia,
    tiempo: clean[0].tiempo,
    disciplinasDetalle: clean,
  };
};

export const decodeDisciplinas = (raw: string | undefined | null, fallback: { frecuencia?: string; tiempo?: string }, detalle?: unknown): DisciplinaItem[] => {
  if (Array.isArray(detalle)) {
    return detalle.map((p: any) => ({
      disciplina: typeof p?.disciplina === 'string' ? p.disciplina : '',
      frecuencia: typeof p?.frecuencia === 'string' ? p.frecuencia : '',
      tiempo: typeof p?.tiempo === 'string' ? p.tiempo : '',
      activo: p?.activo !== false,
    }));
  }
  if (typeof raw === 'string' && raw.trim().startsWith('[')) {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed.map((p: any) => ({
          disciplina: p.disciplina || '',
          frecuencia: p.frecuencia || '',
          tiempo: p.tiempo || '',
          activo: p.activo !== false,
        }));
      }
    } catch {
      // fall through
    }
  }
  return [{ disciplina: raw || '', frecuencia: fallback.frecuencia || '', tiempo: fallback.tiempo || '', activo: true }];
};

export const formatDisciplinasForDisplay = (raw: string | undefined | null, fallback: { frecuencia?: string; tiempo?: string }, detalle?: unknown): string => {
  const arr = decodeDisciplinas(raw, fallback, detalle);
  if (arr.length === 0 || (arr.length === 1 && !arr[0].disciplina)) return 'N/A';
  return arr.map(d => {
    const parts = [d.disciplina].filter(Boolean);
    if (d.frecuencia) parts.push(d.frecuencia);
    if (d.tiempo) parts.push(d.tiempo);
    if (!d.activo) parts.push('Pausada');
    return parts.join(' · ');
  }).join('  |  ');
};
