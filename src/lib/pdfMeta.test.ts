import { describe, expect, it } from 'vitest';
import { buildPdfMeta, buildPdfMetaFromPlanResponse, defaultShowDistribucionForMenus, getGlobalPdfPreferences, parsePdfPreferences, togglePdfMetaFlag } from './pdfMeta';

describe('configuración del PDF', () => {
  it('usa letra estándar por defecto y conserva el tamaño elegido solo para el menú', () => {
    expect(buildPdfMeta({ menuFontSize: 13.5 }).menuFontSize).toBe(11);
    expect(buildPdfMeta({}, { menuFontSize: 12 }).menuFontSize).toBe(12);
    expect(buildPdfMeta({}, { menuFontSize: 13.5 }).menuFontSize).toBe(13.5);
    expect(buildPdfMeta({}, { menuFontSize: '13.5px' }).menuFontSize).toBe(11);
    expect(getGlobalPdfPreferences({ menuFontSize: 13.5 })).not.toHaveProperty('menuFontSize');
  });
  it('muestra el menú completo por defecto aunque exista una preferencia global antigua', () => {
    const meta = buildPdfMeta({ soloEquivalencias: true });

    expect(meta.soloEquivalencias).toBe(false);
  });

  it('fuerza ambas opciones a false cuando el plan contiene platillos', () => {
    const meta = buildPdfMeta(
      {},
      {
        soloEquivalencias: true,
        showDistribucionPorciones: true,
        _manualPdfKeys: ['soloEquivalencias', 'showDistribucionPorciones'],
      },
      false,
      false,
    );

    expect(meta.soloEquivalencias).toBe(false);
    expect(meta.showDistribucionPorciones).toBe(false);
    expect(meta).not.toHaveProperty('_manualPdfKeys');
  });

  it('fuerza ambas opciones a true cuando todos los menús son de solo equivalencias', () => {
    const meta = buildPdfMeta(
      {},
      {
        soloEquivalencias: false,
        showDistribucionPorciones: false,
        _manualPdfKeys: ['soloEquivalencias', 'showDistribucionPorciones'],
      },
      true,
      true,
    );

    expect(meta.soloEquivalencias).toBe(true);
    expect(meta.showDistribucionPorciones).toBe(true);
    expect(meta).not.toHaveProperty('_manualPdfKeys');
  });

  it('solo activa ambas opciones cuando todos los menús usan equivalencias', () => {
    expect(defaultShowDistribucionForMenus([
      { tipoContenido: 'equivalencias' },
      { tipoContenido: 'equivalencias' },
    ])).toBe(true);
    expect(defaultShowDistribucionForMenus([
      { tipoContenido: 'equivalencias' },
      { tipoContenido: 'platillos' },
    ])).toBe(false);
    expect(defaultShowDistribucionForMenus([])).toBe(false);
    expect(defaultShowDistribucionForMenus(undefined)).toBe(false);
  });

  it('lee los menús dentro del envelope real de la API en la fase de entrega', () => {
    const meta = buildPdfMetaFromPlanResponse({}, {
      success: true,
      data: {
        menus: [
          { tipoContenido: 'platillos' },
          { tipoContenido: 'platillos' },
        ],
        pdfCustomMeta: {
          soloEquivalencias: true,
          showDistribucionPorciones: true,
        },
      },
    });

    expect(meta.soloEquivalencias).toBe(false);
    expect(meta.showDistribucionPorciones).toBe(false);
  });

  it('activa ambas opciones desde el envelope cuando todos los menús son equivalencias', () => {
    const meta = buildPdfMetaFromPlanResponse({}, {
      success: true,
      data: {
        menus: [
          { tipoContenido: 'equivalencias' },
          { tipoContenido: 'equivalencias' },
        ],
        pdfCustomMeta: {
          soloEquivalencias: false,
          showDistribucionPorciones: false,
        },
      },
    });

    expect(meta.soloEquivalencias).toBe(true);
    expect(meta.showDistribucionPorciones).toBe(true);
  });

  it('elimina la marca legacy al cambiar un toggle', () => {
    const toggled = togglePdfMetaFlag(
      { soloEquivalencias: false, _manualPdfKeys: ['soloEquivalencias'] },
      'soloEquivalencias',
    );

    expect(toggled.soloEquivalencias).toBe(true);
    expect(toggled.showDistribucionPorciones).toBe(true);
    expect(toggled).not.toHaveProperty('_manualPdfKeys');
  });

  it('no guarda solo equivalencias como preferencia global', () => {
    const preferences = getGlobalPdfPreferences({ soloEquivalencias: true });

    expect(preferences).not.toHaveProperty('soloEquivalencias');
  });

  it('permite mostrar contacto y alimentos a evitar al mismo tiempo', () => {
    const meta = buildPdfMeta(
      { showContacto: true, showAlimentosEvitar: true },
      {},
    );

    expect(meta.showContacto).toBe(true);
    expect(meta.showAlimentosEvitar).toBe(true);
  });

  it('ignora preferencias almacenadas con JSON inválido', () => {
    expect(parsePdfPreferences('{')).toEqual({});
  });
});
