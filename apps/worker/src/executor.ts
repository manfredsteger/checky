import { Browser, BrowserContext, Page, Locator } from 'playwright';
import path from 'path';
import fs from 'fs';
import { jsonSchemaToZod, type AIProvider } from '@checky/shared';
import { launchBrowser, createContext, isAllowedUrl } from './browser.js';
import { dismissConsent } from './consent.js';

// Ein Ergebnisfeld kann ein schlichter Selektor sein ODER eine Feldspezifikation.
// Letztere ist der Schlüssel für Ergebnislisten (Flug-/Preisvergleiche): dort
// stehen dutzende Preise auf der Seite und wir wollen gezielt den günstigsten.
export interface FieldSpec {
  selector: string;
  attr?: string;                                    // statt Textinhalt ein Attribut lesen
  regex?: string;                                   // erste Fundstelle (bzw. Gruppe 1) übernehmen
  index?: number;                                   // n-tes Element (Default 0)
  reduce?: 'first' | 'min_number' | 'max_number';   // über ALLE Treffer reduzieren
  as?: 'text' | 'number';                           // 'number' -> deutsche Zahl parsen
  // Teiler, z.B. "{{pax_total}}": manche Quellen nennen nur den Gesamtpreis,
  // vergleichbar ist aber der Preis pro Person.
  divide_by?: string | number;
  round?: number;                                   // Nachkommastellen (Default 2)
}

export interface Step {
  action: 'goto' | 'click' | 'fill' | 'select' | 'waitFor' | 'extract' | 'press' | 'wait' | 'scroll' | 'consent' | 'click_until';
  selector?: string;
  url?: string;
  value?: string;
  key?: string;
  ms?: number;                 // wait / waitFor-Timeout / Pause zwischen Wiederholungen
  repeat?: number;             // click: n-mal klicken (Zaehler-Widgets)
  until?: string;              // click_until: Zielselektor, bis zu dem geklickt wird
  max?: number;                // click_until: Sicherheitsdeckel (Default 24)
  optional?: boolean;
  note?: string;
  mode?: 'dom_map' | 'ai_json';
  fallback?: 'ai_json' | string;
  map?: Record<string, string | FieldSpec>;
}

export interface Recipe {
  version: number;
  steps: Step[];
}

export interface RunResult {
  resultData: Record<string, any>;
  stepsLog: any[];
  error?: string;
  screenshotBefore?: string;
  screenshotAfter?: string;
  healed?: boolean;       // true, wenn ein Selektor per KI repariert wurde
  newSteps?: Step[];      // reparierte Steps (für neue Recipe-Version)
  aiTokens?: number;      // in diesem Run verbrauchte KI-Tokens
}

// Subsitute parameters in text: {{key}} -> value
function substitute(text: string, params: Record<string, any>): string {
  if (!text) return '';
  return text.replace(/\{\{(.*?)\}\}/g, (_, key) => {
    return params[key] !== undefined ? String(params[key]) : '';
  });
}

// „1.175 €", „889 € /Person", „1 175,50" -> 1175 / 889 / 1175.5
export function parseGermanNumber(text: string): number | null {
  if (!text) return null;
  const m = text.replace(/\u00a0/g, ' ').match(/-?\d{1,3}(?:[.\s]\d{3})+(?:,\d+)?|-?\d+(?:,\d+)?|-?\d+(?:\.\d+)?/);
  if (!m) return null;
  let t = m[0].replace(/\s/g, '');
  if (t.includes(',')) t = t.replace(/\./g, '').replace(',', '.');       // 1.175,50 -> 1175.50
  else if (/\.\d{3}(?:\D|$)/.test(t) || /^\d{1,3}(\.\d{3})+$/.test(t)) t = t.replace(/\./g, ''); // 1.175 -> 1175
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

// Parse string selectors safely
export function getLocator(page: Page, selectorStr: string): Locator {
  if (!selectorStr) throw new Error('Selector is required');

  if (selectorStr.startsWith('getByRole(')) {
    const match = selectorStr.match(/getByRole\(['"](.+?)['"](?:,\s*\{\s*name:\s*(.+?)\s*\})?\)/);
    if (match) {
      const role = match[1];
      let nameObj: string | RegExp | undefined;
      if (match[2]) {
        const nameStr = match[2];
        if (nameStr.startsWith('/') && nameStr.endsWith('/')) {
          nameObj = new RegExp(nameStr.slice(1, -1));
        } else if (nameStr.startsWith('/') && nameStr.endsWith('/i')) {
          nameObj = new RegExp(nameStr.slice(1, -2), 'i');
        } else {
          nameObj = nameStr.replace(/^['"]|['"]$/g, '');
        }
      }
      return page.getByRole(role as any, nameObj ? { name: nameObj, exact: true } : undefined);
    }
  }
  if (selectorStr.startsWith('getByLabel(')) {
    const match = selectorStr.match(/getByLabel\(['"](.+?)['"]\)/);
    if (match) return page.getByLabel(match[1]);
  }
  if (selectorStr.startsWith('getByPlaceholder(')) {
    const match = selectorStr.match(/getByPlaceholder\(['"](.+?)['"]\)/);
    if (match) return page.getByPlaceholder(match[1]);
  }
  if (selectorStr.startsWith('getByTestId(')) {
    const match = selectorStr.match(/getByTestId\(['"](.+?)['"]\)/);
    if (match) return page.getByTestId(match[1]);
  }
  
  // Default to CSS/XPath
  return page.locator(selectorStr);
}

// Check Guardrails: Prevent password / cc fills and denylisted buttons
async function checkGuardrails(locator: Locator, action: string) {
  // .first() + kurzer Timeout: der Guardrail soll pruefen, nicht minutenlang auf
  // ein fehlendes Element warten. Ohne das kostete ein falscher Selektor 120 s,
  // bevor ueberhaupt jemand den eigentlichen Fehler zu sehen bekam.
  const isSafe = await locator.first().evaluate((el: HTMLElement | HTMLInputElement, act) => {
    if (el instanceof HTMLInputElement) {
      if (el.type === 'password') return false;
      if (el.autocomplete && el.autocomplete.startsWith('cc-')) return false;
    }
    if (act === 'click') {
      const text = (el.textContent || el.innerText || el.getAttribute('value') || '').toLowerCase();
      if (/(buchen|kaufen|bezahlen|anmelden|bestellen)/i.test(text)) {
        return false;
      }
    }
    return true;
  }, action, { timeout: 15000 });

  if (!isSafe) {
    throw new Error(`Guardrail blocked interaction with selector. Action: ${action} is denied for security reasons.`);
  }
}

export async function executeRecipe(
  agent: { site: string, params: Record<string, any>, result_schema?: any },
  recipe: Recipe,
  runId: string,
  aiProvider?: AIProvider
): Promise<RunResult> {
  const resultData: Record<string, any> = {};
  const stepsLog: any[] = [];
  // Arbeitskopie der Steps – wird bei Selbstheilung angepasst (Original bleibt unangetastet)
  const workingSteps: Step[] = JSON.parse(JSON.stringify(recipe.steps));
  let aiTokens = 0;
  let healed = false;
  
  const screenshotsDir = process.env.SCREENSHOT_DIR || path.join(process.cwd(), 'data', 'screenshots');
  if (!fs.existsSync(screenshotsDir)) {
    fs.mkdirSync(screenshotsDir, { recursive: true });
  }

  const screenshotBeforePath = path.join(screenshotsDir, `${runId}-before.png`);
  const screenshotAfterPath = path.join(screenshotsDir, `${runId}-after.png`);
  
  let browser: Browser | null = null;
  let context: BrowserContext | null = null;
  let page: Page | null = null;
  
  try {
    browser = await launchBrowser();
    context = await createContext(browser, { viewport: { width: 1440, height: 900 } });

    // Global Timeout of 120s
    context.setDefaultTimeout(120000);
    context.setDefaultNavigationTimeout(120000);
    
    page = await context.newPage();

    // Guardrail: Domain-Allowlist NUR für Seitenwechsel (Dokument-Navigationen).
    // Subressourcen (CDN-Skripte, Fonts, XHR zu API-Hosts) müssen durch — sonst
    // bleibt die Seite kaputt bzw. lädt ihre Ergebnisse nie nach, und das
    // Blockieren aller Drittanbieter ist selbst ein Bot-Erkennungsmerkmal.
    const urlObj = new URL(agent.site);
    const allowedDomain = urlObj.hostname;
    await page.route('**/*', route => {
      const req = route.request();
      if (req.resourceType() !== 'document' || !req.isNavigationRequest()) return route.continue();
      isAllowedUrl(req.url(), allowedDomain) ? route.continue() : route.abort();
    });

    // KI-Fallback: Haupttext der Seite (max 15k Zeichen) -> extractJson gegen result_schema.
    const runAiJson = async () => {
      if (!aiProvider) throw new Error('ai_json Fallback angefordert, aber kein AIProvider konfiguriert');
      const text = (await page!.locator('body').innerText()).slice(0, 15000);
      const r = await aiProvider.extractJson(text, agent.result_schema ?? {});
      aiTokens += r.tokens;
      const parsed = jsonSchemaToZod(agent.result_schema).safeParse(r.data);
      if (!parsed.success) {
        throw new Error('ai_json Ergebnis passt nicht zum result_schema: ' + parsed.error.issues.map(e => `${e.path.join('.')}: ${e.message}`).join(', '));
      }
      Object.assign(resultData, parsed.data as Record<string, any>);
    };

    // Liest ein Feld gemäß Spezifikation aus der Seite.
    const readField = async (specIn: string | FieldSpec): Promise<any> => {
      const spec: FieldSpec = typeof specIn === 'string' ? { selector: specIn } : specIn;
      const loc = getLocator(page!, substitute(spec.selector, agent.params));

      // Rohwerte einsammeln: bei reduce über ALLE Treffer, sonst nur einer.
      let raw: string[];
      if (spec.reduce && spec.reduce !== 'first') {
        const n = Math.min(await loc.count(), 400);   // Deckel gegen Monsterlisten
        raw = [];
        for (let i = 0; i < n; i++) {
          const el = loc.nth(i);
          const v = spec.attr ? await el.getAttribute(spec.attr) : await el.textContent();
          if (v) raw.push(v);
        }
      } else {
        const el = loc.nth(spec.index ?? 0);
        const v = spec.attr ? await el.getAttribute(spec.attr) : await el.textContent();
        raw = v ? [v] : [];
      }
      raw = raw.map(v => v.replace(/\s+/g, ' ').trim()).filter(Boolean);
      if (!raw.length) return null;

      if (spec.regex) {
        const re = new RegExp(spec.regex);
        raw = raw.map(v => { const m = v.match(re); return m ? (m[1] ?? m[0]) : ''; }).filter(Boolean);
        if (!raw.length) return null;
      }

      const wantsNumber = spec.as === 'number' || spec.reduce === 'min_number' || spec.reduce === 'max_number';
      if (!wantsNumber) return raw[0];

      const nums = raw.map(parseGermanNumber).filter((n): n is number => n !== null);
      if (!nums.length) return null;
      let value = spec.reduce === 'min_number' ? Math.min(...nums)
        : spec.reduce === 'max_number' ? Math.max(...nums)
        : nums[0];

      if (spec.divide_by !== undefined) {
        const div = Number(substitute(String(spec.divide_by), agent.params));
        if (!Number.isFinite(div) || div === 0) {
          throw new Error(`divide_by „${spec.divide_by}" ergibt keinen brauchbaren Teiler`);
        }
        const f = Math.pow(10, spec.round ?? 2);
        value = Math.round((value / div) * f) / f;
      }
      return value;
    };

    // Extraktion: dom_map (mit optionalem ai_json-Fallback) oder direkt ai_json.
    const runExtract = async (step: Step) => {
      if (step.mode === 'dom_map' && step.map) {
        try {
          for (const [field, sel] of Object.entries(step.map)) {
            resultData[field] = await readField(sel);
          }
          // Ein dom_map, das nur leere Felder liefert, ist ein stiller Fehlschlag.
          if (Object.values(resultData).every(v => v === null || v === '')) {
            throw new Error('dom_map lieferte keine Werte (alle Selektoren leer)');
          }
        } catch (e) {
          if (step.fallback === 'ai_json' && aiProvider) await runAiJson();
          else throw e;
        }
      } else if (step.mode === 'ai_json' && aiProvider) {
        await runAiJson();
      }
    };

    // Führt die eigentliche Aktion eines Steps aus ({{param}} auch in Selektoren).
    const runAction = async (step: Step) => {
      if (step.action === 'goto' && step.url) {
        await page!.goto(substitute(step.url, agent.params), { waitUntil: 'domcontentloaded' });
        // Kurz atmen lassen: Consent-Banner werden meist erst nachgeschoben.
        await page!.waitForTimeout(1200);
        // Cookie-Layer wegräumen — er verdeckt sonst jeden folgenden Klick.
        await dismissConsent(page!);
      } else if (step.action === 'consent') {
        await dismissConsent(page!);
      } else if (step.action === 'wait') {
        await page!.waitForTimeout(Math.min(step.ms ?? 2000, 120000));
      } else if (step.action === 'scroll') {
        await page!.evaluate(() => window.scrollBy(0, window.innerHeight * 2));
        await page!.waitForTimeout(500);
      } else if (step.action === 'click' && step.selector) {
        const loc = getLocator(page!, substitute(step.selector, agent.params));
        await checkGuardrails(loc, 'click');
        // repeat: fuer Zaehler-Widgets (Reisende +/-), die bei jedem Seitenaufruf
        // beim selben Startwert stehen — die Klickzahl ist damit deterministisch.
        // repeat kann bewusst 0 sein (z.B. „keine Kinder") — dann gar nicht klicken.
        const times = step.repeat === undefined
          ? 1
          : Math.min(Math.max(Number(substitute(String(step.repeat), agent.params)) || 0, 0), 20);
        for (let c = 0; c < times; c++) {
          await loc.first().click();
          if (c < times - 1) await page!.waitForTimeout(step.ms ?? 250);
        }
      } else if (step.action === 'fill' && step.selector && step.value !== undefined) {
        const loc = getLocator(page!, substitute(step.selector, agent.params));
        await checkGuardrails(loc, 'fill');
        // Symmetrisch zum Recorder: echte Tastenanschläge, damit Autocomplete-
        // Listen auch beim Abspielen aufgehen und aufgezeichnete press-Schritte
        // (ArrowDown/Enter) den Vorschlag übernehmen.
        await loc.first().click();
        try { await loc.first().fill(''); } catch { /* ignore */ }
        await loc.first().pressSequentially(substitute(step.value, agent.params), { delay: 40 });
      } else if (step.action === 'press' && step.key) {
        if (step.selector) {
          await getLocator(page!, substitute(step.selector, agent.params)).first().press(step.key);
        } else {
          await page!.keyboard.press(step.key);
        }
      } else if (step.action === 'click_until' && step.selector && step.until) {
        // Klickt (z.B. „naechster Monat"), bis das Ziel im DOM ist. Eine feste
        // Klickzahl waere zeitabhaengig: der Abstand von heute bis zum Reisedatum
        // schrumpft mit jedem Tag, und das Recipe wuerde still danebengreifen.
        const untilSel = substitute(step.until, agent.params);
        const clickSel = substitute(step.selector, agent.params);
        const max = Math.min(step.max ?? 24, 60);
        let hit = false;
        for (let c = 0; c <= max; c++) {
          if (await getLocator(page!, untilSel).count() > 0) { hit = true; break; }
          await getLocator(page!, clickSel).first().click();
          await page!.waitForTimeout(step.ms ?? 350);
        }
        if (!hit && await getLocator(page!, untilSel).count() === 0) {
          throw new Error(`click_until: „${untilSel}" nach ${max} Klicks auf „${clickSel}" nicht erreicht`);
        }
      } else if (step.action === 'waitFor' && step.selector) {
        await getLocator(page!, substitute(step.selector, agent.params))
          .first().waitFor({ state: 'visible', timeout: step.ms ?? 60000 });
      } else if (step.action === 'extract') {
        await runExtract(step);
      }
    };

    let takenBeforeScreenshot = false;

    for (let i = 0; i < workingSteps.length; i++) {
      const step = workingSteps[i];
      const startTimer = Date.now();
      let stepError: string | null = null;
      let stepHealed = false;

      try {
        // "before"-Screenshot direkt vor dem letzten Schritt
        if (i === workingSteps.length - 1 && !takenBeforeScreenshot) {
          await page.screenshot({ path: screenshotBeforePath });
          takenBeforeScreenshot = true;
        }

        try {
          await runAction(step);
        } catch (err: any) {
          // Selbstheilung: max. 1x pro Run, nur für einzelne Selektor-Schritte
          const isSelectorStep = step.action === 'click' || step.action === 'fill' || step.action === 'waitFor';
          if (aiProvider && !healed && isSelectorStep && step.selector) {
            const aria = await page.locator('body').ariaSnapshot();
            const heal = await aiProvider.healSelector(step, aria);
            aiTokens += heal.tokens;
            const healedStep: Step = { ...step, selector: heal.locator };
            await runAction(healedStep);   // neuen Locator testen: Aktion erneut ausführen
            workingSteps[i] = healedStep;  // fließt in neue Recipe-Version ein
            healed = true;
            stepHealed = true;
          } else {
            throw err;
          }
        }
      } catch (err: any) {
        stepError = err.message || String(err);
        if (!step.optional) throw err;
      } finally {
        stepsLog.push({ step: workingSteps[i], duration: Date.now() - startTimer, error: stepError, healed: stepHealed });
      }
    }

    // "after"-Screenshot
    await page.screenshot({ path: screenshotAfterPath });

    // Ergebnis gegen result_schema validieren
    if (agent.result_schema) {
      const zodSchema = jsonSchemaToZod(agent.result_schema);
      const parsed = zodSchema.safeParse(resultData);
      if (!parsed.success) {
        throw new Error('Result schema validation failed: ' + parsed.error.issues.map(e => `${e.path.join('.')}: ${e.message}`).join(', '));
      }
    }

    return {
      resultData,
      stepsLog,
      healed,
      newSteps: healed ? workingSteps : undefined,
      aiTokens,
      screenshotBefore: `/data/screenshots/${runId}-before.png`,
      screenshotAfter: `/data/screenshots/${runId}-after.png`
    };

  } catch (error: any) {
    return {
      resultData,
      stepsLog,
      error: error.message || String(error),
      screenshotBefore: fs.existsSync(screenshotBeforePath) ? `/data/screenshots/${runId}-before.png` : undefined,
      screenshotAfter: fs.existsSync(screenshotAfterPath) ? `/data/screenshots/${runId}-after.png` : undefined
    };
  } finally {
    if (context) await context.close();
    if (browser) await browser.close();
  }
}
