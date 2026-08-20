import { query, tool, createSdkMcpServer } from '@anthropic-ai/claude-agent-sdk';
import { Browser, BrowserContext, Page } from 'playwright';
import { z } from 'zod';
import path from 'path';
import fs from 'fs';
import type { Pool } from 'pg';
import { getLocator } from './executor.js';
import { launchBrowser, createContext } from './browser.js';

// Buttons/Links, die der Anlern-Agent NIEMALS auslösen darf (SPEC §A.5).
const DENY_ACTION = /(buchen|kaufen|bezahlen|anmelden|bestellen|einkauf|checkout|\bbuy\b|purchase|\bpay\b|log[- ]?in|sign[- ]?in|anmelden|registrieren|sign[- ]?up)/i;
// Klicks, die als optionaler Consent-Schritt gelten.
const CONSENT = /(akzeptier|ablehnen|accept|reject|consent|cookie|einverstanden|zustimmen|verstanden|ok)/i;

const SCREENSHOT_DIR = process.env.SCREENSHOT_DIR || path.join(process.cwd(), 'data', 'screenshots');

interface RecorderCtx {
  events: Array<{ ts: number; tool: string; input?: any; result?: string; isSubmit?: boolean }>;
  resultFields: Record<string, string>;   // Feldname -> Selektor (für dom_map)
  allowedHost: string;
  actionBudget: number;
  aborted: boolean;
}

function hostAllowed(urlStr: string, allowedHost: string): boolean {
  try {
    const h = new URL(urlStr).hostname;
    return h === allowedHost || h.endsWith('.' + allowedHost);
  } catch {
    return false;
  }
}

function ok(text: string) {
  return { content: [{ type: 'text' as const, text }] };
}
function err(text: string) {
  return { content: [{ type: 'text' as const, text }], isError: true };
}

// Baut den In-Process-MCP-Server mit den erlaubten Browser-Werkzeugen.
function buildRecorderServer(getPage: () => Page, ctx: RecorderCtx) {
  const budgetGuard = () => {
    if (ctx.aborted) return err('Session abgebrochen.');
    if (ctx.events.filter(e => ['navigate', 'click', 'type', 'extract_field'].includes(e.tool)).length >= ctx.actionBudget) {
      return err('Aktions-Budget erschöpft. Bitte jetzt mit report_result abschließen.');
    }
    return null;
  };

  const snapshot = tool(
    'snapshot',
    'Liefert einen ARIA-Snapshot (Rollen, Namen, Texte) der aktuellen Seite, damit du weißt, was anklickbar/lesbar ist.',
    {},
    async () => {
      if (ctx.aborted) return err('Session abgebrochen.');
      const aria = await getPage().locator('body').ariaSnapshot();
      return ok(aria.slice(0, 12000));
    }
  );

  const navigate = tool(
    'navigate',
    'Navigiere zu einer URL (nur innerhalb der erlaubten Domain).',
    { url: z.string().describe('Vollständige URL') },
    async (args: any) => {
      const g = budgetGuard(); if (g) return g;
      if (!hostAllowed(args.url, ctx.allowedHost)) {
        return err(`Domain nicht erlaubt. Bleibe auf ${ctx.allowedHost}.`);
      }
      await getPage().goto(args.url, { waitUntil: 'domcontentloaded' });
      ctx.events.push({ ts: Date.now(), tool: 'navigate', input: { url: args.url } });
      return ok(`Navigiert zu ${args.url}`);
    }
  );

  const click = tool(
    'click',
    'Klicke ein Element per Playwright-Locator, z.B. getByRole(\'link\', { name: \'Travel\' }) oder ein CSS-Selektor.',
    { selector: z.string().describe('Playwright-Locator oder CSS-Selektor') },
    async (args: any) => {
      const g = budgetGuard(); if (g) return g;
      const loc = getLocator(getPage(), args.selector).first();
      // Guardrail: gefährliche Buttons/Felder hart blocken.
      try {
        const info = await loc.evaluate((el: any) => ({
          text: (el.textContent || el.value || '').slice(0, 120),
          type: (el.getAttribute && el.getAttribute('type')) || '',
          autocomplete: (el.getAttribute && el.getAttribute('autocomplete')) || '',
        }));
        if (info.type === 'password' || /^cc-/.test(info.autocomplete)) {
          return err('Blockiert: Passwort-/Zahlungsfeld.');
        }
        if (DENY_ACTION.test(info.text)) {
          return err(`Blockiert: „${info.text.trim()}" ist eine Kauf/Login/Bestell-Aktion und darf nicht ausgelöst werden.`);
        }
      } catch { /* Element evtl. nicht auslesbar -> trotzdem versuchen */ }
      await loc.click();
      ctx.events.push({
        ts: Date.now(), tool: 'click', input: { selector: args.selector },
        isSubmit: DENY_ACTION.test(args.selector),
      });
      return ok(`Geklickt: ${args.selector}`);
    }
  );

  const type = tool(
    'type',
    'Tippe Text in ein Eingabefeld (kein Passwort-/Zahlungsfeld).',
    { selector: z.string(), text: z.string() },
    async (args: any) => {
      const g = budgetGuard(); if (g) return g;
      const loc = getLocator(getPage(), args.selector).first();
      try {
        const t = await loc.getAttribute('type');
        const ac = await loc.getAttribute('autocomplete');
        if (t === 'password' || (ac && /^cc-/.test(ac))) return err('Blockiert: Passwort-/Zahlungsfeld.');
      } catch { /* ignore */ }
      await loc.fill(args.text);
      ctx.events.push({ ts: Date.now(), tool: 'type', input: { selector: args.selector, text: args.text } });
      return ok(`Getippt in ${args.selector}`);
    }
  );

  const readText = tool(
    'read_text',
    'Liest den sichtbaren Text der Seite (oder eines Selektors), um Werte zu prüfen. Wird NICHT ins Recipe übernommen.',
    { selector: z.string().optional() },
    async (args: any) => {
      if (ctx.aborted) return err('Session abgebrochen.');
      const target = args.selector ? getLocator(getPage(), args.selector).first() : getPage().locator('body');
      const text = ((await target.textContent().catch(() => '')) || '').replace(/\s+/g, ' ').trim();
      return ok(text.slice(0, 4000));
    }
  );

  const extractField = tool(
    'extract_field',
    'Definiere ein Ergebnisfeld: gib Feldname + Selektor an, der den Wert enthält. Der Wert wird zur Kontrolle zurückgegeben. Für JEDES Ergebnisfeld einmal aufrufen.',
    { name: z.string().describe('Feldname, z.B. title/price'), selector: z.string().describe('Selektor, der genau den Wert enthält') },
    async (args: any) => {
      const g = budgetGuard(); if (g) return g;
      const loc = getLocator(getPage(), args.selector).first();
      const value = ((await loc.textContent().catch(() => null)) || '').trim();
      if (!value) return err(`Selektor „${args.selector}" liefert keinen Text. Anderen Selektor wählen.`);
      ctx.resultFields[args.name] = args.selector;
      ctx.events.push({ ts: Date.now(), tool: 'extract_field', input: { name: args.name, selector: args.selector }, result: value });
      return ok(`Feld "${args.name}" = "${value}" (per ${args.selector})`);
    }
  );

  return createSdkMcpServer({
    name: 'recorder',
    version: '1.0.0',
    tools: [snapshot, navigate, click, type, readText, extractField],
  });
}

// Ersetzt bekannte Parameterwerte durch {{key}}-Platzhalter.
function paramize(str: string, params: Record<string, any>): string {
  let out = str;
  for (const [k, v] of Object.entries(params || {})) {
    if (v && typeof v === 'string' && v.length > 1) {
      out = out.split(v).join(`{{${k}}}`);
    }
  }
  return out;
}

// Destilliert aus dem Mitschnitt ein deterministisches Recipe.
export function distillRecipe(
  events: RecorderCtx['events'],
  resultFields: Record<string, string>,
  params: Record<string, any>,
): any[] {
  const steps: any[] = [];
  for (const e of events) {
    if (e.tool === 'navigate') {
      steps.push({ action: 'goto', url: paramize(e.input.url, params) });
    } else if (e.tool === 'click') {
      const step: any = { action: 'click', selector: e.input.selector };
      if (CONSENT.test(e.input.selector)) { step.optional = true; step.note = 'Consent: optional'; }
      steps.push(step);
    } else if (e.tool === 'type') {
      steps.push({ action: 'fill', selector: e.input.selector, value: paramize(e.input.text, params) });
    }
  }
  // Extraktion als dom_map (mit ai_json-Fallback, falls Selektoren brechen).
  if (Object.keys(resultFields).length > 0) {
    steps.push({ action: 'extract', mode: 'dom_map', map: { ...resultFields }, fallback: 'ai_json' });
  } else {
    steps.push({ action: 'extract', mode: 'ai_json' });
  }
  return steps;
}

function buildSystemPrompt(agent: any): string {
  return [
    'Du bist ein Anlern-Agent für ein Website-Monitoring-Tool. Führe die folgende Recherche EINMAL vollständig aus,',
    'ausschließlich mit den bereitgestellten Browser-Werkzeugen. Danach ist Schluss.',
    '',
    `ZIEL: ${agent.goal_text}`,
    agent.params && Object.keys(agent.params).length ? `PARAMETER: ${JSON.stringify(agent.params)}` : '',
    `START-SEITE: ${agent.site}`,
    '',
    'VORGEHEN:',
    '1. navigate zur Start-Seite, dann snapshot, um die Struktur zu sehen.',
    '2. Klicke/tippe dich zum Ziel. Nach jeder Navigation erneut snapshot.',
    '3. Nutze read_text, um Werte zu prüfen.',
    '4. Rufe für JEDES Ergebnisfeld extract_field(name, selector) auf – der Selektor muss genau den Wert enthalten.',
    '5. Beende dann mit einer kurzen Zusammenfassung, welche Felder das Ergebnis bilden.',
    '',
    'HARTE REGELN (GUARDRAILS):',
    '- Bleibe ausschließlich auf der erlaubten Domain.',
    '- Niemals Buttons wie Buchen/Kaufen/Bezahlen/Anmelden/Bestellen anklicken.',
    '- Niemals Passwort- oder Zahlungsfelder ausfüllen. Keine Logins, keine Downloads, keine CAPTCHA-Umgehung.',
    '- Bevorzuge stabile Locators: getByRole(...) > getByLabel(...) > getByPlaceholder(...) > CSS. Kein XPath.',
  ].filter(Boolean).join('\n');
}

// Führt eine komplette Recorder-Session aus.
export async function runRecorderSession(sessionId: string, agent: any, pool: Pool): Promise<void> {
  if (!fs.existsSync(SCREENSHOT_DIR)) fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
  const shotPath = path.join(SCREENSHOT_DIR, `recorder-${sessionId}.png`);
  const shotRel = `/data/screenshots/recorder-${sessionId}.png`;

  const ctx: RecorderCtx = {
    events: [],
    resultFields: {},
    allowedHost: new URL(agent.site).hostname,
    actionBudget: 40,
    aborted: false,
  };

  let browser: Browser | null = null;
  let context: BrowserContext | null = null;
  let page: Page | null = null;
  let ticker: NodeJS.Timeout | null = null;

  const persist = async (extra: Record<string, any> = {}) => {
    const cols = ['events = $2', 'updated_at = NOW()'];
    const vals: any[] = [sessionId, JSON.stringify(ctx.events)];
    let i = 3;
    for (const [k, v] of Object.entries(extra)) { cols.push(`${k} = $${i++}`); vals.push(v); }
    await pool.query(`UPDATE recorder_sessions SET ${cols.join(', ')} WHERE id = $1`, vals);
  };

  try {
    browser = await launchBrowser();
    context = await createContext(browser, { viewport: { width: 1440, height: 900 } });
    context.setDefaultTimeout(30000);
    page = await context.newPage();
    // Domain-Allowlist als zweite Verteidigungslinie.
    await page.route('**/*', route => {
      hostAllowed(route.request().url(), ctx.allowedHost) ? route.continue() : route.abort();
    });
    await page.goto(agent.site, { waitUntil: 'domcontentloaded' }).catch(() => {});

    const getPage = () => page!;

    // 2s-Screenshot-Loop + Abbruch-/Fortschritts-Persistenz.
    ticker = setInterval(async () => {
      try {
        const { rows } = await pool.query('SELECT status FROM recorder_sessions WHERE id = $1', [sessionId]);
        if (rows[0]?.status === 'aborted') { ctx.aborted = true; }
        await page!.screenshot({ path: shotPath }).catch(() => {});
        await persist({ screenshot_path: shotRel });
      } catch { /* ignore */ }
    }, 2000);

    const server = buildRecorderServer(getPage, ctx);

    // 5-Minuten-Timeout via Race.
    const timeout = new Promise<void>((resolve) => setTimeout(() => { ctx.aborted = true; resolve(); }, 5 * 60 * 1000));

    const agentRun = (async () => {
      for await (const message of query({
        prompt: `Beginne jetzt mit der Recherche. Startseite ist bereits geladen: ${agent.site}`,
        options: {
          model: 'sonnet',
          systemPrompt: buildSystemPrompt(agent),
          mcpServers: { recorder: server },
          allowedTools: ['mcp__recorder__snapshot', 'mcp__recorder__navigate', 'mcp__recorder__click', 'mcp__recorder__type', 'mcp__recorder__read_text', 'mcp__recorder__extract_field'],
          maxTurns: 60,
        } as any,
      })) {
        if (ctx.aborted) break;
      }
    })();

    await Promise.race([agentRun, timeout]);

    if (ctx.aborted) {
      await persist({ status: 'aborted' });
      return;
    }

    // Destillation -> Vorschau, auf Bestätigung warten.
    const recipe = distillRecipe(ctx.events, ctx.resultFields, agent.params || {});
    await persist({
      status: 'awaiting_confirm',
      recipe_preview: JSON.stringify(recipe),
      result_fields: JSON.stringify(Object.keys(ctx.resultFields)),
    });
  } catch (e: any) {
    await persist({ status: 'failed', error: String(e?.message || e) }).catch(() => {});
  } finally {
    if (ticker) clearInterval(ticker);
    if (context) await context.close().catch(() => {});
    if (browser) await browser.close().catch(() => {});
  }
}
