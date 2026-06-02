import { expect, test } from '@playwright/test';

test.describe('n-payment Portal — happy path smoke', () => {
  test('landing page renders the hero and Connect button', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('h1')).toContainText('Publish a paid MCP');
    await expect(page.getByRole('button', { name: 'Connect wallet' })).toBeVisible();
    await expect(page.locator('text=Live demo')).toBeVisible();
  });

  test('GET /api/healthz returns ok', async ({ request }) => {
    const r = await request.get('/api/healthz');
    expect(r.status()).toBe(200);
    const body = (await r.json()) as { ok: boolean; service: string };
    expect(body.ok).toBe(true);
    expect(body.service).toBe('gateway');
  });

  test('POST /api/publish without session is unauthorized', async ({ request }) => {
    const r = await request.post('/api/publish', {
      data: { slug: 'x', originUrl: 'https://x.com', tool: { name: 'a', priceMicros: '1', chain: 'base-sepolia' } },
    });
    expect(r.status()).toBe(401);
  });

  test('POST /api/auth/siwe with bad params is 400', async ({ request }) => {
    const r = await request.post('/api/auth/siwe', { data: { message: '', signature: '' } });
    expect(r.status()).toBe(400);
  });
});
