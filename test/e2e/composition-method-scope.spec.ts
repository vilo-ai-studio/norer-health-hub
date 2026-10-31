import { expect, test } from '@playwright/test';

test.use({ serviceWorkers: 'block' });

for (const scenario of ['new', 'today', 'previous'] as const) {
  test(`métodos de composición por valoración: ${scenario}`, async ({ page, context, baseURL }) => {
    await context.addCookies([
      { name: 'norder_token', value: 'local-test', url: baseURL! },
      { name: 'norder_user', value: JSON.stringify({ id: 'local-test', nombre: 'Prueba local', rol: 'admin' }), url: baseURL! },
    ]);
    await page.route('**/api/**', route => {
      const path = new URL(route.request().url()).pathname;
      let data: unknown = [];
      if (path === '/api/pacientes/local-test') {
        data = { id: 'local-test', nombre: 'Paciente ficticio', apellido: 'Prueba', mostrarBioimpedancia: false, valoraciones: [] };
      } else if (path.endsWith('/valoraciones/local-assessment')) {
        data = { id: 'local-assessment', fecha: '2026-10-31', numeroValoracion: 1,
          medicionesEstado: { consultaEnLinea: false, metodoComposicion: 'ANTROPOMETRIA',
            ...(scenario === 'previous' ? { mostrarBioimpedancia: false } : {}) } };
      } else if (path.endsWith('/barrido')) data = null;
      return route.fulfill({ status: 200, json: { success: true, data } });
    });
    await page.goto(scenario === 'new'
      ? '/pacientes/local-test/valoracion/nueva'
      : '/pacientes/local-test/valoraciones/local-assessment/editar');
    await expect(page.getByRole('button', { name: 'Mediciones corporales', exact: true })).toBeVisible();
    const antropometria = page.getByRole('button', { name: 'Antropometría', exact: true });
    const bioimpedancia = page.getByRole('button', { name: 'Bioimpedancia', exact: true });
    if (scenario === 'previous') {
      await expect(antropometria).toHaveCount(0);
      await expect(bioimpedancia).toHaveCount(0);
      await expect(page.getByText('% Grasa Corp.', { exact: true })).toBeVisible();
    } else {
      await expect(antropometria).toBeVisible();
      await expect(bioimpedancia).toBeVisible();
      await bioimpedancia.click();
      await expect(page.getByText('Agua corporal (%)', { exact: true })).toBeVisible();
      await expect(page.getByText('Músculo (kg)', { exact: true })).toBeVisible();
      await antropometria.click();
      await expect(page.getByText('% Grasa Corp.', { exact: true })).toBeVisible();
      await expect(page.getByText('Agua corporal (%)', { exact: true })).toHaveCount(0);
    }
  });
}
