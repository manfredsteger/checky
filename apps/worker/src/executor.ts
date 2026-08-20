import { Browser, BrowserContext, Page, Locator } from 'playwright';
import path from 'path';
import fs from 'fs';
import { jsonSchemaToZod, type AIProvider } from '@checky/shared';
import { launchBrowser, createContext } from './browser.js';

export interface Step {
  action: 'goto' | 'click' | 'fill' | 'select' | 'waitFor' | 'extract';
  selector?: string;
  url?: string;
  value?: string;
  optional?: boolean;
  note?: string;
  mode?: 'dom_map' | 'ai_json';
  fallback?: 'ai_json' | string;
  map?: Record<string, string>;
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
  const isSafe = await locator.evaluate((el: HTMLElement | HTMLInputElement, act) => {
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
  }, action);

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

    // Guardrail: Route allowlist
    const urlObj = new URL(agent.site);
    const allowedDomain = urlObj.hostname;
    await page.route('**/*', route => {
      const reqUrl = new URL(route.request().url());
      if (reqUrl.hostname === allowedDomain || reqUrl.hostname.endsWith('.' + allowedDomain)) {
        route.continue();
      } else {
        route.abort();
      }
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

    // Extraktion: dom_map (mit optionalem ai_json-Fallback) oder direkt ai_json.
    const runExtract = async (step: Step) => {
      if (step.mode === 'dom_map' && step.map) {
        try {
          for (const [field, sel] of Object.entries(step.map)) {
            const loc = getLocator(page!, substitute(sel as string, agent.params));
            resultData[field] = (await loc.textContent())?.trim() || null;
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
      } else if (step.action === 'click' && step.selector) {
        const loc = getLocator(page!, substitute(step.selector, agent.params));
        await checkGuardrails(loc, 'click');
        await loc.click();
      } else if (step.action === 'fill' && step.selector && step.value !== undefined) {
        const loc = getLocator(page!, substitute(step.selector, agent.params));
        await checkGuardrails(loc, 'fill');
        await loc.fill(substitute(step.value, agent.params));
      } else if (step.action === 'waitFor' && step.selector) {
        await getLocator(page!, substitute(step.selector, agent.params)).waitFor({ state: 'visible' });
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
