import { expect, test } from '@playwright/test';

test.use({ serviceWorkers: 'block' });

test('usa la misma animación mientras descarga la pantalla y sus datos', async ({ page, context, baseURL }) => {
  await context.addCookies([
    { name: 'norder_token', value: 'local-test', url: baseURL! },
    { name: 'norder_user', value: JSON.stringify({ id: 'local-test', nombre: 'Prueba', rol: 'admin' }), url: baseURL! },
  ]);
  let allowScreen!: () => void;
  let allowData!: () => void;
  const screen = new Promise<void>(resolve => { allowScreen = resolve; });
  const data = new Promise<void>(resolve => { allowData = resolve; });
  await page.route('**/src/pages/Patients.tsx', async route => { await screen; await route.continue(); });
  await page.route('**/api/pacientes?**', async route => {
    await data;
    await route.fulfill({ json: { success: true, data: [] } });
  });
  await page.goto('/pacientes', { waitUntil: 'domcontentloaded' });
  const loader = page.getByRole('status');
  await expect(loader).toHaveAttribute('aria-label', 'Cargando...');
  await expect(loader.locator('svg')).toBeVisible();
  allowScreen();
  await expect(loader).toHaveAttribute('aria-label', 'Cargando Directorio Clínico...');
  await expect(loader.locator('svg')).toBeVisible();
  allowData();
  await expect(page.getByRole('heading', { name: 'Directorio Clínico' })).toBeVisible();
  await expect(loader).toHaveCount(0);
});

test('carga Inter sin solicitudes a Google Fonts', async ({ page }) => {
  const externalFonts: string[] = [];
  await page.route(/https:\/\/fonts\.(googleapis|gstatic)\.com\//, route => {
    externalFonts.push(route.request().url());
    return route.abort();
  });
  await page.goto('/login');
  await expect(page.locator('input[type="password"]')).toBeVisible();
  await expect.poll(() => page.evaluate(async () => {
    await document.fonts.load('400 14px Inter', 'Nutrición áéíóúñ');
    return document.fonts.check('400 14px Inter', 'Nutrición áéíóúñ');
  })).toBe(true);
  expect(externalFonts).toEqual([]);
});
