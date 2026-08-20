import { test, expect, request } from '@playwright/test';

const API = process.env.E2E_API || 'http://api:8080';
const WEB = process.env.E2E_WEB || 'http://web:3000';

test('E2E: Projekt anlegen + geseedeter Agent liefert Ergebnis auf der Ergebnis-Seite', async ({ page }) => {
  const api = await request.newContext();

  // 1. Projekt anlegen
  const projRes = await api.post(`${API}/api/projects`, { data: { name: `E2E-${Date.now()}` } });
  expect(projRes.status(), 'Projekt anlegen -> 201').toBe(201);

  // 2. Geseedeten Bücher-Agent finden
  const projects = await (await api.get(`${API}/api/projects`)).json();
  let agentId: string | undefined;
  for (const p of projects) {
    const agents = await (await api.get(`${API}/api/projects/${p.id}/agents`)).json();
    const a = agents.find((x: any) => x.name === 'Bücher-Preis-Check');
    if (a) { agentId = a.id; break; }
  }
  expect(agentId, 'Seed-Agent Bücher-Preis-Check vorhanden').toBeTruthy();

  // 3. Lauf triggern
  const trig = await api.post(`${API}/api/agents/${agentId}/trigger`);
  expect(trig.status(), 'Trigger -> 201').toBe(201);

  // 4. Auf succeeded pollen
  let succeeded = false;
  for (let i = 0; i < 45; i++) {
    const runs = await (await api.get(`${API}/api/agents/${agentId}/runs?limit=5`)).json();
    if (runs.some((r: any) => r.status === 'succeeded')) { succeeded = true; break; }
    if (runs.some((r: any) => r.status === 'failed')) throw new Error('Lauf fehlgeschlagen');
    await new Promise((r) => setTimeout(r, 2000));
  }
  expect(succeeded, 'Lauf erreicht succeeded').toBeTruthy();

  // 5. Ergebnis-Seite zeigt die extrahierten Daten
  await page.goto(`${WEB}/agents/${agentId}/results`);
  await expect(page.getByText('A Light in the Attic').first()).toBeVisible({ timeout: 20_000 });
});
