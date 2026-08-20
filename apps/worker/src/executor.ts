import { chromium, Browser, BrowserContext, Page, Locator } from 'playwright';
import path from 'path';
import fs from 'fs';
import { jsonSchemaToZod } from '@checky/shared';

export interface Step {
  action: 'goto' | 'click' | 'fill' | 'select' | 'waitFor' | 'extract';
  selector?: string;
  url?: string;
  value?: string;
  optional?: boolean;
  note?: string;
  mode?: 'dom_map';
  fallback?: string;
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
}

// Subsitute parameters in text: {{key}} -> value
function substitute(text: string, params: Record<string, any>): string {
  if (!text) return '';
  return text.replace(/\{\{(.*?)\}\}/g, (_, key) => {
    return params[key] !== undefined ? String(params[key]) : '';
  });
}

// Parse string selectors safely
function getLocator(page: Page, selectorStr: string): Locator {
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
  runId: string
): Promise<RunResult> {
  const resultData: Record<string, any> = {};
  const stepsLog: any[] = [];
  
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
    browser = await chromium.launch({ headless: true });
    context = await browser.newContext({
      locale: 'de-DE',
      timezoneId: 'Europe/Berlin',
      viewport: { width: 1440, height: 900 }
    });
    
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

    let takenBeforeScreenshot = false;

    for (let i = 0; i < recipe.steps.length; i++) {
      const step = recipe.steps[i];
      const startTimer = Date.now();
      let stepError: string | null = null;

      try {
        // Take "before" screenshot right before the last interaction/extraction step
        if (i === recipe.steps.length - 1 && !takenBeforeScreenshot) {
          await page.screenshot({ path: screenshotBeforePath });
          takenBeforeScreenshot = true;
        }

        if (step.action === 'goto' && step.url) {
          const finalUrl = substitute(step.url, agent.params);
          await page.goto(finalUrl, { waitUntil: 'domcontentloaded' });
        } 
        else if (step.action === 'click' && step.selector) {
          const loc = getLocator(page, step.selector);
          await checkGuardrails(loc, 'click');
          await loc.click();
        } 
        else if (step.action === 'fill' && step.selector && step.value !== undefined) {
          const loc = getLocator(page, step.selector);
          await checkGuardrails(loc, 'fill');
          await loc.fill(substitute(step.value, agent.params));
        } 
        else if (step.action === 'waitFor' && step.selector) {
          const loc = getLocator(page, step.selector);
          await loc.waitFor({ state: 'visible' });
        } 
        else if (step.action === 'extract' && step.mode === 'dom_map' && step.map) {
          for (const [field, sel] of Object.entries(step.map)) {
            const loc = getLocator(page, sel as string);
            resultData[field] = (await loc.textContent())?.trim() || null;
          }
        }
      } catch (err: any) {
        stepError = err.message || String(err);
        if (!step.optional) throw err;
      } finally {
        stepsLog.push({ step, duration: Date.now() - startTimer, error: stepError });
      }
    }

    // Take "after" screenshot
    await page.screenshot({ path: screenshotAfterPath });
    
    // Optional schema validation
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
