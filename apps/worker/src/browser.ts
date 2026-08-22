import { chromium, Browser, BrowserContext } from 'playwright';

// Zentraler, tarnender Browser-Start für Executor UND Recorder.
// Stufe 1 der Anti-Detection: Headful (Xvfb), Launch-Args, realistischer
// Fingerprint + Inline-Evasions – ohne Fork-Pakete. (rebrowser-patches = Stufe 2.)

const STEALTH = process.env.STEALTH !== 'false';

// Linux-Chrome-UA (passt zum tatsächlichen Plattform-Fingerprint des jammy-Images;
// ein Windows-UA auf Linux-Plattform wäre selbst ein Erkennungsmerkmal).
const DEFAULT_UA =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36';
const UA = process.env.STEALTH_UA || DEFAULT_UA;

const STEALTH_ARGS = [
  '--disable-blink-features=AutomationControlled',
  '--no-sandbox',
  '--disable-dev-shm-usage',
  '--disable-gpu',
  '--no-first-run',
  '--no-default-browser-check',
  '--disable-extensions',
  '--disable-component-update',
  '--disable-features=IsolateOrigins,site-per-process',
];

// Klassische Evasions, die vor jeder Seite laufen.
const EVASIONS = `
  try {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    window.chrome = window.chrome || { runtime: {} };
    Object.defineProperty(navigator, 'languages', { get: () => ['de-DE','de','en-US','en'] });
    Object.defineProperty(navigator, 'plugins', { get: () => [1,2,3,4,5] });
    const _q = window.navigator.permissions && window.navigator.permissions.query;
    if (_q) {
      window.navigator.permissions.query = (p) =>
        p && p.name === 'notifications'
          ? Promise.resolve({ state: Notification.permission })
          : _q(p);
    }
    // WebGL-Vendor/Renderer plausibel halten
    const _gp = WebGLRenderingContext.prototype.getParameter;
    WebGLRenderingContext.prototype.getParameter = function (p) {
      if (p === 37445) return 'Intel Inc.';
      if (p === 37446) return 'Intel Iris OpenGL Engine';
      return _gp.call(this, p);
    };
  } catch (e) { /* best effort */ }
`;

function resolveHeadless(): boolean {
  if (process.env.HEADLESS === 'false') return false;
  if (process.env.HEADLESS === 'true') return true;
  // Wenn ein (virtuelles) Display verfügbar ist, headful bevorzugen.
  return !process.env.DISPLAY;
}

export async function launchBrowser(): Promise<Browser> {
  return chromium.launch({
    headless: resolveHeadless(),
    args: STEALTH ? STEALTH_ARGS : ['--no-sandbox', '--disable-dev-shm-usage'],
  });
}

export interface ContextOpts {
  viewport?: { width: number; height: number };
}

export async function createContext(browser: Browser, opts: ContextOpts = {}): Promise<BrowserContext> {
  const context = await browser.newContext({
    userAgent: STEALTH ? UA : undefined,
    viewport: opts.viewport ?? { width: 1920, height: 1080 },
    locale: 'de-DE',
    timezoneId: 'Europe/Berlin',
    deviceScaleFactor: 1,
    isMobile: false,
    hasTouch: false,
    extraHTTPHeaders: STEALTH
      ? {
          'Accept-Language': 'de-DE,de;q=0.9,en;q=0.8',
          'Upgrade-Insecure-Requests': '1',
        }
      : undefined,
  });
  if (STEALTH) await context.addInitScript(EVASIONS);
  return context;
}

// --- Domain-Guardrail --------------------------------------------------------
// Erlaubt wird die registrierbare Domain (eTLD+1) der Agent-URL, nicht nur der
// exakte Host: Consent- und Weiterleitungsflüsse laufen regelmäßig über eine
// Geschwister-Subdomain (z.B. www.google.com -> consent.google.com), und die zu
// blocken bricht die Seite. Ein Wechsel auf eine FREMDE Site bleibt gesperrt.
const TWO_PART_TLDS = new Set([
  'co.uk', 'org.uk', 'ac.uk', 'gov.uk', 'co.jp', 'ne.jp', 'or.jp',
  'com.au', 'net.au', 'org.au', 'co.nz', 'com.br', 'com.mx',
  'co.za', 'com.tr', 'co.in', 'com.cn', 'com.pl', 'com.es',
]);

export function registrableDomain(host: string): string {
  const parts = host.split('.');
  if (parts.length <= 2) return host;
  const last2 = parts.slice(-2).join('.');
  return TWO_PART_TLDS.has(last2) ? parts.slice(-3).join('.') : last2;
}

/** Gehört `url` zur selben registrierbaren Domain wie `allowedHost`? */
export function isAllowedUrl(url: string, allowedHost: string): boolean {
  let host: string;
  try { host = new URL(url).hostname; } catch { return false; }
  const base = registrableDomain(allowedHost);
  return host === base || host.endsWith('.' + base);
}
