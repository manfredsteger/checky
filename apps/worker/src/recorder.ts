import { query, tool, createSdkMcpServer } from '@anthropic-ai/claude-agent-sdk';
import { Browser, BrowserContext, Page } from 'playwright';
import { z } from 'zod';
import path from 'path';
import fs from 'fs';
import type { Pool } from 'pg';
import { getLocator } from './executor.js';
import { launchBrowser, createContext } from './browser.js';
import { dismissConsent } from './consent.js';
import { isAllowedUrl, createPage } from './browser.js';

// Buttons/Links, die der Anlern-Agent NIEMALS auslösen darf (SPEC §A.5).
const DENY_ACTION = /(buchen|kaufen|bezahlen|anmelden|bestellen|einkauf|checkout|\bbuy\b|purchase|\bpay\b|log[- ]?in|sign[- ]?in|anmelden|registrieren|sign[- ]?up)/i;
// Klicks, die als optionaler Consent-Schritt gelten.
const CONSENT = /(akzeptier|ablehnen|accept|reject|consent|cookie|einverstanden|zustimmen|verstanden|ok)/i;

// Freigegebene Werkzeuge. press/wait/dismiss_consent fehlten hier früher —
// die Tools existierten, waren für das Modell aber unerreichbar.
const RECORDER_TOOLS = [
  'mcp__recorder__snapshot',
  'mcp__recorder__navigate',
  'mcp__recorder__click',
  'mcp__recorder__type',
  'mcp__recorder__press',
  'mcp__recorder__read_text',
  'mcp__recorder__extract_field',
  'mcp__recorder__wait',
  'mcp__recorder__dismiss_consent',
];

const SCREENSHOT_DIR = process.env.SCREENSHOT_DIR || path.join(process.cwd(), 'data', 'screenshots');

interface RecorderCtx {
  events: Array<{ ts: number; tool: string; input?: any; result?: string; isSubmit?: boolean }>;
  /** letzte Klartext-Antwort des Anlern-Agenten (Begründung bei Fehlschlag) */
  lastText?: string;
  resultFields: Record<string, string>;   // Feldname -> Selektor (für dom_map)
  allowedHost: string;
  actionBudget: number;
  aborted: boolean;
}

function hostAllowed(urlStr: string, allowedHost: string): boolean {
  return isAllowedUrl(urlStr, allowedHost);
}

// Wertet den Nachrichtenstrom des Agent-SDK aus: Klartext des Modells und das
// Abschluss-Ergebnis landen im Mitschnitt. Ohne das endete ein Lauf, in dem das
// Modell gar nichts tat (Auth-Fehler, Weigerung, Turn-Limit), stumm in einer
// leeren „Bitte bestätigen"-Vorschau.
function absorbMessage(msg: any, ctx: RecorderCtx): void {
  if (msg?.type === 'assistant') {
    const text = (msg.message?.content || [])
      .filter((b: any) => b?.type === 'text').map((b: any) => b.text).join(' ').trim();
    if (text) {
      ctx.lastText = text;
      ctx.events.push({ ts: Date.now(), tool: 'note', result: text.slice(0, 2000) });
    }
  } else if (msg?.type === 'result') {
    const parts = [`subtype=${msg.subtype}`, `turns=${msg.num_turns ?? '?'}`];
    if (msg.is_error) parts.push('FEHLER');
    if (typeof msg.result === 'string' && msg.result.trim()) ctx.lastText = msg.result.trim();
    ctx.events.push({ ts: Date.now(), tool: 'agent_result', result: parts.join(' ') + (msg.is_error ? ': ' + String(msg.result ?? '').slice(0, 500) : '') });
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
    if (ctx.events.filter(e => ['navigate', 'click', 'type', 'press', 'extract_field', 'waitFor', 'wait'].includes(e.tool)).length >= ctx.actionBudget) {
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
      const consent = await dismissConsent(getPage());
      ctx.events.push({ ts: Date.now(), tool: 'navigate', input: { url: args.url } });
      return ok(`Navigiert zu ${args.url} (Consent: ${consent}). Laden Ergebnisse nach? Dann 'wait' nutzen.`);
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
    'Tippe Text in ein Eingabefeld (kein Passwort-/Zahlungsfeld). Löscht vorhandenen Inhalt und tippt mit echten Tastenanschlägen — löst dadurch Autocomplete-/Vorschlagslisten aus.',
    { selector: z.string(), text: z.string() },
    async (args: any) => {
      const g = budgetGuard(); if (g) return g;
      const loc = getLocator(getPage(), args.selector).first();
      try {
        const t = await loc.getAttribute('type');
        const ac = await loc.getAttribute('autocomplete');
        if (t === 'password' || (ac && /^cc-/.test(ac))) return err('Blockiert: Passwort-/Zahlungsfeld.');
      } catch { /* ignore */ }
      // Echte Tastenanschläge statt fill(): fokussieren, leeren, sequentiell tippen.
      // Viele Suchfelder (Flughäfen, PLZ) öffnen ihre Vorschlagsliste nur so.
      await loc.click();
      try { await loc.fill(''); } catch { /* manche Felder mögen kein fill('') */ }
      await loc.pressSequentially(args.text, { delay: 50 });
      ctx.events.push({ ts: Date.now(), tool: 'type', input: { selector: args.selector, text: args.text } });
      return ok(`Getippt in ${args.selector} (echte Tasten, Vorschläge sollten offen sein — mit snapshot prüfen, dann press ArrowDown/Enter oder click auf den Vorschlag)`);
    }
  );

  const press = tool(
    'press',
    'Drücke eine Taste — z.B. Enter, ArrowDown, ArrowUp, Tab, Escape. Ideal für Autocomplete-Listen (ArrowDown dann Enter) und Datepicker. Mit optionalem Selektor wird die Taste auf diesem Element ausgelöst, sonst global.',
    { key: z.string().describe("Taste, z.B. 'ArrowDown', 'Enter', 'Tab', 'Escape'"), selector: z.string().optional().describe('optional: Element, das die Taste erhält') },
    async (args: any) => {
      const g = budgetGuard(); if (g) return g;
      if (args.selector) {
        await getLocator(getPage(), args.selector).first().press(args.key);
      } else {
        await getPage().keyboard.press(args.key);
      }
      ctx.events.push({ ts: Date.now(), tool: 'press', input: { key: args.key, selector: args.selector } });
      return ok(`Taste gedrückt: ${args.key}${args.selector ? ' auf ' + args.selector : ''}`);
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

  const wait = tool(
    'wait',
    'Warte, bis ein Selektor sichtbar ist (bevorzugt) oder eine feste Zeit. Ergebnislisten von Vergleichsportalen laden asynchron nach — ohne Warten siehst du eine leere Seite.',
    { selector: z.string().optional().describe('Selektor, auf den gewartet wird'), ms: z.number().optional().describe('Millisekunden (max 60000), wenn kein Selektor') },
    async (args: any) => {
      if (ctx.aborted) return err('Session abgebrochen.');
      const ms = Math.min(args.ms ?? 5000, 60000);
      if (args.selector) {
        try {
          await getLocator(getPage(), args.selector).first().waitFor({ state: 'visible', timeout: Math.max(ms, 30000) });
        } catch {
          return err(`Selektor „${args.selector}" wurde nicht sichtbar. Mit snapshot prüfen, was wirklich da ist.`);
        }
        ctx.events.push({ ts: Date.now(), tool: 'waitFor', input: { selector: args.selector, ms: Math.max(ms, 30000) } });
        return ok(`Sichtbar: ${args.selector}`);
      }
      await getPage().waitForTimeout(ms);
      ctx.events.push({ ts: Date.now(), tool: 'wait', input: { ms } });
      return ok(`${ms} ms gewartet.`);
    }
  );

  const consentTool = tool(
    'dismiss_consent',
    'Räumt ein Cookie-/Consent-Banner weg (auch in geschlossenem Shadow-DOM, wo Klicken nicht geht). Nach jeder navigate automatisch — nur nötig, wenn später noch ein Layer auftaucht.',
    {},
    async () => {
      if (ctx.aborted) return err('Session abgebrochen.');
      const note = await dismissConsent(getPage());
      ctx.events.push({ ts: Date.now(), tool: 'consent', input: {} });
      return ok(`Consent: ${note}`);
    }
  );

  return createSdkMcpServer({
    name: 'recorder',
    version: '1.0.0',
    tools: [snapshot, navigate, click, type, press, readText, extractField, wait, consentTool],
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
    } else if (e.tool === 'press') {
      steps.push({ action: 'press', key: e.input.key, ...(e.input.selector ? { selector: e.input.selector } : {}) });
    } else if (e.tool === 'waitFor') {
      steps.push({ action: 'waitFor', selector: e.input.selector, ms: e.input.ms, optional: true });
    } else if (e.tool === 'wait') {
      steps.push({ action: 'wait', ms: e.input.ms });
    } else if (e.tool === 'consent') {
      steps.push({ action: 'consent', optional: true });
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
  const params = agent.params && Object.keys(agent.params).length ? agent.params : null;
  return [
    'Du bist ein Anlern-Agent für ein Website-Monitoring-Tool. Du führst die Recherche EINMAL vollständig aus.',
    'Dein Ergebnis ist kein Text, sondern ein WIEDERHOLBARER WEG: die Schritte, die du gehst, werden',
    'mitgeschnitten und später täglich ohne KI abgespielt. Bevorzuge deshalb den kürzesten stabilen Weg.',
    '',
    `ZIEL: ${agent.goal_text}`,
    params ? `PARAMETER (verbindlich, genau diese Werte verwenden): ${JSON.stringify(params)}` : '',
    `START-SEITE: ${agent.site}`,
    '',
    'STRATEGIE — in dieser Reihenfolge:',
    '1. SUCH-URL STATT FORMULAR. Die meisten Vergleichsportale nehmen die komplette Suche in der URL entgegen',
    '   (z.B. /flights/BER-JFK/2027-01-01/2027-01-15/2adults). Steht die Start-Seite schon auf so',
    '   einer Ergebnis-URL, ist die Arbeit fast getan. Sonst: führe die Suche EINMAL von Hand aus und schau dir',
    '   danach die URL an (read_text/snapshot zeigen die Seite; die URL steht im navigate-Ergebnis) — enthält sie',
    '   die Suchparameter, navigiere direkt dorthin und verwirf den Formularweg. Formulare mit Autocomplete und',
    '   Datumswählern sind beim Abspielen fragil; eine URL ist es nicht.',
    '2. WARTEN. Ergebnislisten laden asynchron nach. Nach dem Laden IMMER wait(selector) auf das erste',
    '   Ergebnis-Element — ohne das siehst (und speicherst) du eine leere Seite.',
    '3. PRÜFEN. Mit snapshot/read_text sicherstellen, dass wirklich Ergebnisse zur gesuchten Route/zum gesuchten',
    '   Datum dastehen — nicht nur Werbung, Startseite oder „keine Treffer".',
    '4. EXTRAHIEREN. Für JEDES Ergebnisfeld extract_field(name, selector). Der Selektor muss genau den Wert',
    '   enthalten und stabil sein: Klassen-Teiltreffer wie [class*="price-text"] sind besser als generierte',
    '   Klassen wie .css-1x2y3z. Steht der gesuchte Wert mehrfach auf der Seite (Preisliste!), reicht der',
    '   Selektor auf ALLE Treffer — die Auswertung nimmt später den günstigsten.',
    '5. Zum Schluss kurz zusammenfassen, welche Felder das Ergebnis bilden und welcher Wert herauskam.',
    '',
    'WENN ES NICHT GEHT: Erkläre am Ende klar, WORAN es lag (Captcha, Bot-Sperre, keine Treffer, Feld nicht',
    'bedienbar). Erfinde nichts und rufe extract_field NICHT auf einem Platzhalter/Werbepreis auf — ein falsch',
    'angelerntes Recipe liefert täglich falsche Zahlen und ist schlimmer als gar keins.',
    '',
    'HARTE REGELN (GUARDRAILS):',
    '- Bleibe ausschließlich auf der erlaubten Domain.',
    '- Niemals Buttons wie Buchen/Kaufen/Bezahlen/Anmelden/Bestellen anklicken.',
    '- Niemals Passwort- oder Zahlungsfelder ausfüllen. Keine Logins, keine Downloads, keine CAPTCHA-Umgehung.',
    '- Bevorzuge stabile Locators: getByRole(...) > getByLabel(...) > getByPlaceholder(...) > CSS. Kein XPath.',
  ].filter(Boolean).join('\n');
}

// Schließt eine Session ab — und meldet einen Fehlschlag als Fehlschlag.
// Ein Mitschnitt ohne Ergebnisfelder ergibt ein Recipe, das nichts ausliest;
// den Nutzer damit in einen „Bitte bestätigen"-Dialog zu schicken, war der
// Hauptgrund für den Eindruck, das Anlernen „macht nur Mist".
async function finishSession(
  ctx: RecorderCtx,
  agent: any,
  persist: (extra?: Record<string, any>) => Promise<void>,
): Promise<void> {
  const actions = ctx.events.filter(e => ['navigate', 'click', 'type', 'press'].includes(e.tool)).length;
  const fields = Object.keys(ctx.resultFields).length;

  if (fields === 0) {
    const why = ctx.lastText
      ? `Der Anlern-Agent hat kein Ergebnisfeld festgelegt. Seine letzte Rückmeldung: „${ctx.lastText.slice(0, 600)}"`
      : 'Der Anlern-Agent hat kein Ergebnisfeld festgelegt und keine Rückmeldung geliefert (Modell nicht erreichbar oder sofort abgebrochen?).';
    const hint = actions === 0
      ? ' Es wurde keine einzige Aktion ausgeführt — bitte prüfen, ob CLAUDE_CODE_OAUTH_TOKEN gültig ist und die Seite erreichbar war.'
      : ` Ausgeführte Aktionen: ${actions}. Tipp: Seite mit Suchparametern direkt als URL öffnen (Deep-Link) statt das Formular zu bedienen, oder den assistierten Modus nutzen.`;
    await persist({ status: 'failed', error: why + hint });
    return;
  }

  const recipe = distillRecipe(ctx.events, ctx.resultFields, agent.params || {});
  await persist({
    status: 'awaiting_confirm',
    recipe_preview: JSON.stringify(recipe),
    result_fields: JSON.stringify(Object.keys(ctx.resultFields)),
  });
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
    page = await createPage(browser, context);
    // Domain-Allowlist als zweite Verteidigungslinie.
    // Allowlist NUR für Seitenwechsel. Subressourcen (CDN, Fonts, XHR der
    // Ergebnis-API auf fremden Hosts) müssen durch, sonst bleibt die Seite leer
    // bzw. kaputt — genau das ließ Anlern-Läufe bisher ins Leere laufen.
    await page.route('**/*', route => {
      const req = route.request();
      if (req.resourceType() !== 'document' || !req.isNavigationRequest()) return route.continue();
      hostAllowed(req.url(), ctx.allowedHost) ? route.continue() : route.abort();
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
      try {
      for await (const message of query({
        prompt: `Beginne jetzt mit der Recherche. Startseite ist bereits geladen: ${agent.site}`,
        options: {
          model: 'sonnet',
          systemPrompt: buildSystemPrompt(agent),
          mcpServers: { recorder: server },
          allowedTools: RECORDER_TOOLS,
          maxTurns: 60,
        } as any,
      })) {
        absorbMessage(message, ctx);
        if (ctx.aborted) break;
      }
      } catch (e: any) {
        // Fehler des Agent-SDK (Auth, Netz, Turn-Limit) nicht verschlucken.
        ctx.lastText = `Anlern-Agent abgebrochen: ${String(e?.message || e).slice(0, 400)}`;
        ctx.events.push({ ts: Date.now(), tool: 'error', result: ctx.lastText });
      }
    })();

    await Promise.race([agentRun, timeout]);

    if (ctx.aborted) {
      await persist({ status: 'aborted' });
      return;
    }

    await finishSession(ctx, agent, persist);
  } catch (e: any) {
    await persist({ status: 'failed', error: String(e?.message || e) }).catch(() => {});
  } finally {
    if (ticker) clearInterval(ticker);
    if (context) await context.close().catch(() => {});
    if (browser) await browser.close().catch(() => {});
  }
}

function buildAssistedSystemPrompt(agent: any): string {
  return [
    'Du bist ein Anlern-Assistent für ein Website-Monitoring-Tool und steuerst einen bereits geöffneten Browser.',
    'Der Nutzer gibt dir jeweils EINE Anweisung. Führe GENAU diese eine Anweisung aus – nicht mehr, nicht weiter.',
    'Mache zuerst bei Bedarf snapshot, um die aktuelle Seite zu sehen. Führe dann die passenden Aktionen aus und stoppe.',
    `ZIEL (Gesamtkontext): ${agent.goal_text}`,
    agent.params && Object.keys(agent.params).length ? `PARAMETER: ${JSON.stringify(agent.params)}` : '',
    '',
    'REGELN:',
    '- Bleibe ausschließlich auf der erlaubten Domain.',
    '- Niemals Buchen/Kaufen/Bezahlen/Anmelden/Bestellen anklicken; keine Passwort-/Zahlungsfelder.',
    '- Stabile Locators bevorzugen: getByRole > getByLabel > getByPlaceholder > CSS. Kein XPath.',
    '- Bei Autocomplete-Feldern: tippen, kurz warten, dann den passenden Vorschlag anklicken.',
    '- Wenn der Nutzer ein Ergebnisfeld benennt (z.B. Preis), nutze extract_field(name, selector).',
    '- Ist die Anweisung unklar/riskant, tu nichts Riskantes und erkläre kurz das Problem.',
  ].filter(Boolean).join('\n');
}

// Assistierter Modus: Browser bleibt offen, der Nutzer steuert per Anweisungen.
export async function runAssistedRecorderSession(sessionId: string, agent: any, pool: Pool): Promise<void> {
  if (!fs.existsSync(SCREENSHOT_DIR)) fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
  const shotPath = path.join(SCREENSHOT_DIR, `recorder-${sessionId}.png`);
  const shotRel = `/data/screenshots/recorder-${sessionId}.png`;

  const ctx: RecorderCtx = {
    events: [], resultFields: {},
    allowedHost: new URL(agent.site).hostname,
    actionBudget: 500, aborted: false,
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
    page = await createPage(browser, context);
    // Allowlist NUR für Seitenwechsel. Subressourcen (CDN, Fonts, XHR der
    // Ergebnis-API auf fremden Hosts) müssen durch, sonst bleibt die Seite leer
    // bzw. kaputt — genau das ließ Anlern-Läufe bisher ins Leere laufen.
    await page.route('**/*', route => {
      const req = route.request();
      if (req.resourceType() !== 'document' || !req.isNavigationRequest()) return route.continue();
      hostAllowed(req.url(), ctx.allowedHost) ? route.continue() : route.abort();
    });
    await page.goto(agent.site, { waitUntil: 'domcontentloaded' }).catch(() => {});

    const getPage = () => page!;
    const server = buildRecorderServer(getPage, ctx);
    const systemPrompt = buildAssistedSystemPrompt(agent);
    const allowed = RECORDER_TOOLS;

    ticker = setInterval(async () => {
      try { await page!.screenshot({ path: shotPath }).catch(() => {}); await persist({ screenshot_path: shotRel }); } catch { /* ignore */ }
    }, 2000);

    await page.screenshot({ path: shotPath }).catch(() => {});
    await persist({ status: 'awaiting_instruction', screenshot_path: shotRel });

    const deadline = Date.now() + 30 * 60 * 1000;   // 30 Min Gesamtlimit
    while (Date.now() < deadline) {
      const { rows } = await pool.query('SELECT status, pending_instruction FROM recorder_sessions WHERE id = $1', [sessionId]);
      const row = rows[0];
      if (!row || row.status === 'aborted') { ctx.aborted = true; break; }

      const instr = (row.pending_instruction || '').trim();
      if (!instr) { await new Promise(r => setTimeout(r, 1500)); continue; }

      await pool.query(`UPDATE recorder_sessions SET pending_instruction = NULL, status = 'running', updated_at = NOW() WHERE id = $1`, [sessionId]);

      if (instr === '__FINISH__') {
        await finishSession(ctx, agent, persist);
        return;
      }

      ctx.events.push({ ts: Date.now(), tool: 'instruction', input: { text: instr } });
      try {
        for await (const message of query({
          prompt: instr,
          options: { model: 'sonnet', systemPrompt, mcpServers: { recorder: server }, allowedTools: allowed, maxTurns: 15 } as any,
        })) {
          absorbMessage(message, ctx);
          if (ctx.aborted) break;
        }
      } catch (e: any) {
        ctx.events.push({ ts: Date.now(), tool: 'error', result: String(e?.message || e) });
      }
      await persist({ status: 'awaiting_instruction' });
    }

    if (ctx.aborted) { await persist({ status: 'aborted' }); return; }
    await finishSession(ctx, agent, persist);
  } catch (e: any) {
    await persist({ status: 'failed', error: String(e?.message || e) }).catch(() => {});
  } finally {
    if (ticker) clearInterval(ticker);
    if (context) await context.close().catch(() => {});
    if (browser) await browser.close().catch(() => {});
  }
}
