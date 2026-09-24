export interface Laboratorio {
  glucosa: string;
  trigliceridos: string;
  colesterol: string;
  creatinina: string;
  acidoUrico: string;
  otrosDetalle: LaboratorioOtro[];
}

export interface LaboratorioOtro {
  id: string;
  nombre: string;
  valor: string;
}

export const otrosBioquimicosFromValoracion = (val: Record<string, unknown> | null | undefined): LaboratorioOtro[] => {
  if (Array.isArray(val?.bioquimicosOtrosDetalle)) {
    return val.bioquimicosOtrosDetalle.map((item: any, index: number) => ({
      id: typeof item?.id === 'string' ? item.id : `otro-${index}`,
      nombre: typeof item?.nombre === 'string' ? item.nombre : '',
      valor: typeof item?.valor === 'string' ? item.valor : String(item?.valor ?? ''),
    }));
  }
  const legacy = typeof val?.otrosBioquimicos === 'string' ? val.otrosBioquimicos.trim() : '';
  return legacy ? [{ id: 'otro-anterior', nombre: 'Otros', valor: legacy }] : [];
};

export const laboratorioFromValoracion = (val: Record<string, unknown> | null | undefined): Laboratorio => ({
  glucosa: val?.glucosa != null ? String(val.glucosa) : '',
  trigliceridos: val?.trigliceridos != null ? String(val.trigliceridos) : '',
  colesterol: val?.colesterol != null ? String(val.colesterol) : '',
  creatinina: val?.creatinina != null ? String(val.creatinina) : '',
  acidoUrico: val?.acidoUrico != null ? String(val.acidoUrico) : '',
  otrosDetalle: otrosBioquimicosFromValoracion(val),
});

export const hasLaboratorio = (val: Record<string, unknown> | null | undefined): boolean =>
  Object.entries(laboratorioFromValoracion(val)).some(([key, value]) =>
    key === 'otrosDetalle' ? (value as LaboratorioOtro[]).length > 0 : (value as string).trim() !== ''
  );
