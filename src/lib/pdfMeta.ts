export const DEFAULT_PDF_META = {
  showPageHistorial: true,
  showPageMenus: true,
  showPageIntercambio: true,
  showPageExtras: true,
  showContacto: false,
  showAlimentosEvitar: true,
  showDistribucionPorciones: false,
  soloEquivalencias: false,
  menuFontSize: 11,
};

type PdfMeta = Record<string, unknown>;

export function parsePdfPreferences(saved: string | null): PdfMeta {
  if (!saved) return {};

  try {
    const parsed = JSON.parse(saved);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

/**
 * @param defaultShowDistribucionPorciones Default para "Distribución de porciones" cuando el plan
 * se calcula a partir de si el plan es de platillos (false) o de solo equivalencias (true).
 * Si se omite, cae al default general (true).
 * @param defaultSoloEquivalencias Default para "Solo equivalencias" — calculado igual que
 * distribución de porciones. Si se omite, cae al default general (false).
 */
export function buildPdfMeta(globalPreferences: PdfMeta = {}, planMeta: PdfMeta = {}, defaultShowDistribucionPorciones?: boolean, defaultSoloEquivalencias?: boolean): PdfMeta {
  // Estas dos opciones siempre siguen el tipo de contenido actual del plan. No deben quedar
  // fijadas por preferencias globales, valores guardados ni la marca legacy `_manualPdfKeys`.
  const { soloEquivalencias: _ignoredGlobalValue, showDistribucionPorciones: _ignoredGlobalDist, menuFontSize: _ignoredGlobalFontSize, ...safeGlobalPreferences } = globalPreferences;
  const {
    soloEquivalencias: _ignoredPlanSolo,
    showDistribucionPorciones: _ignoredPlanDist,
    _manualPdfKeys: _ignoredManualKeys,
    ...safePlanMeta
  } = planMeta;

  return {
    ...DEFAULT_PDF_META,
    ...safeGlobalPreferences,
    ...safePlanMeta,
    menuFontSize: [11, 12, 13.5].includes(planMeta.menuFontSize as number) ? planMeta.menuFontSize : 11,
    soloEquivalencias: defaultSoloEquivalencias ?? DEFAULT_PDF_META.soloEquivalencias,
    showDistribucionPorciones: defaultShowDistribucionPorciones ?? DEFAULT_PDF_META.showDistribucionPorciones,
  };
}

/** true solo cuando NINGÚN menú del plan usa platillos (todos son de solo equivalencias). */
export function defaultShowDistribucionForMenus(menus?: { tipoContenido?: string }[] | null): boolean {
  // Sin menús confirmados, el estado seguro es apagado. Solo se activan cuando
  // hay evidencia de que todos los menús actuales usan equivalencias.
  if (!menus || menus.length === 0) return false;
  return menus.every((m) => m.tipoContenido === 'equivalencias');
}

/**
 * Construye la configuración del PDF desde la respuesta real de GET /api/planes/:id.
 * La API usa el envelope `{ success, data }`, aunque se conserva compatibilidad con
 * respuestas directas para no romper ambientes o mocks antiguos.
 */
export function buildPdfMetaFromPlanResponse(globalPreferences: PdfMeta, responseData: PdfMeta): PdfMeta {
  const planData = responseData?.data && typeof responseData.data === 'object'
    ? responseData.data as PdfMeta
    : responseData;
  const menus = Array.isArray(planData?.menus)
    ? planData.menus as { tipoContenido?: string }[]
    : undefined;
  const menuDefault = defaultShowDistribucionForMenus(menus);
  const planMeta = planData?.pdfCustomMeta && typeof planData.pdfCustomMeta === 'object'
    ? planData.pdfCustomMeta as PdfMeta
    : {};

  return buildPdfMeta(globalPreferences, planMeta, menuDefault, menuDefault);
}

/**
 * Aplica un toggle del panel de configuración de PDF. Activar "Solo equivalencias"
 * a mano fuerza también "Distribución de porciones" a ON — un plan de solo
 * equivalencias siempre la necesita. Desactivar "Solo equivalencias" apaga
 * "Distribución de porciones". El resto de toggles cambian normal.
 */
export function togglePdfMetaFlag(meta: PdfMeta, key: string): PdfMeta {
  const { _manualPdfKeys: _ignoredManualKeys, ...cleanMeta } = meta;
  const newMeta: PdfMeta = { ...cleanMeta, [key]: !meta[key] };
  if (key === 'soloEquivalencias') {
    newMeta.showDistribucionPorciones = newMeta.soloEquivalencias === true;
  }
  return newMeta;
}

export function getGlobalPdfPreferences(meta: PdfMeta): PdfMeta {
  return {
    showPageHistorial: meta.showPageHistorial !== false,
    showPageMenus: meta.showPageMenus !== false,
    showPageIntercambio: meta.showPageIntercambio !== false,
    showPageExtras: meta.showPageExtras !== false,
    showContacto: meta.showContacto === true,
    showAlimentosEvitar: meta.showAlimentosEvitar !== false,
    showDistribucionPorciones: meta.showDistribucionPorciones !== false,
  };
}
