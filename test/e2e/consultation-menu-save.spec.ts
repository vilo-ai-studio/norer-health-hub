import { expect, test } from '@playwright/test';

test.use({ viewport: { width: 1440, height: 900 }, serviceWorkers: 'block' });

for (const editing of [false, true]) {
  test(`cabecera sticky al ${editing ? 'editar' : 'crear'} menú dentro de consulta`, async ({ page, context, baseURL }, testInfo) => {
    await context.addCookies([
      { name: 'norder_token', value: 'local-test', url: baseURL! },
      { name: 'norder_user', value: JSON.stringify({ id: 'local-test', nombre: 'Prueba local', rol: 'admin' }), url: baseURL! },
    ]);
    let saves = 0;
    await page.route('**/api/**', route => {
      const url = new URL(route.request().url()).pathname;
      const method = route.request().method();
      let data: unknown = [];
      if (url === '/api/pacientes/local-test') {
        data = { id: 'local-test', nombre: 'Paciente ficticio', apellido: 'Prueba', valoraciones: [] };
      } else if (url.endsWith('/valoraciones') && method === 'POST') {
        data = { id: 'valoracion-local' };
      } else if (url.endsWith('/valoraciones/valoracion-local')) {
        data = { id: 'valoracion-local', numeroValoracion: 1, getSedentario: 1800, plan: editing ? { id: 'plan-local' } : null };
      } else if (url.endsWith('/barrido')) {
        data = null;
      } else if (url.endsWith('/planes/plan-local') || (url.endsWith('/planes') && method === 'POST')) {
        if (method === (editing ? 'PUT' : 'POST')) saves++;
        data = { id: 'plan-local', nombre: 'Menú ficticio', calorias: 1800, proteinasPct: 30, carbohidratosPct: 40, grasasPct: 30 };
      }
      return route.fulfill({ status: 200, json: { success: true, data } });
    });
    await page.goto(editing
      ? '/pacientes/local-test/valoraciones/valoracion-local/editar'
      : '/pacientes/local-test/valoracion/nueva');
    await page.getByRole('button', { name: 'Equivalencias', exact: true }).click();
    await page.getByRole('button', { name: editing ? /Guardar y Editar Plan/ : /Guardar y Crear Plan/ }).click();
    const headerSave = page.getByRole('button', { name: editing ? 'Guardar Cambios' : 'Guardar Menú', exact: true }).first();
    await expect(headerSave).toBeVisible();
    // Dejar terminar la animación de entrada y cerrar el aviso anterior.
    await page.locator('[toast-close]').click();
    const main = page.locator('main');
    await main.evaluate(el => { el.style.scrollBehavior = 'auto'; el.scrollTop = el.scrollHeight; });
    await expect.poll(() => main.evaluate(el => el.scrollTop)).toBeGreaterThan(500);
    const header = headerSave.locator('xpath=../..');
    await expect(header).toHaveCSS('position', 'sticky');
    await expect.poll(async () => (await header.boundingBox())?.y).toBeCloseTo(0, 0);
    await expect(headerSave).toBeInViewport({ ratio: 1 });
    expect(await headerSave.evaluate(el => {
      const box = el.getBoundingClientRect();
      return el.contains(document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2));
    })).toBe(true);
    await expect(page.locator('body > .fixed.bottom-0')).toBeHidden();
    await page.screenshot({ path: testInfo.outputPath('cabecera-computadora.png') });

    await page.setViewportSize({ width: 390, height: 844 });
    await main.evaluate(el => { el.scrollTop = el.scrollHeight; });
    const mobileSave = page.locator('body > .fixed.bottom-0').getByRole('button');
    await expect(mobileSave).toBeInViewport({ ratio: 1 });
    await page.screenshot({ path: testInfo.outputPath('guardar-movil.png') });

    await page.setViewportSize({ width: 1440, height: 900 });
    await headerSave.click();
    await expect.poll(() => saves).toBe(1);
    await expect(headerSave).toHaveCount(0);
  });
}
