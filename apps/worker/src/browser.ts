import { chromium, Browser, BrowserContext, Page } from 'playwright';

// Zentraler, tarnender Browser-Start für Executor UND Recorder.
// Stufe 1 der Anti-Detection: Headful (Xvfb), Launch-Args, realistischer
// Fingerprint + Inline-Evasions – ohne Fork-Pakete. (rebrowser-patches = Stufe 2.)

const STEALTH = process.env.STEALTH !== 'false';

// Wir lassen den Browser seinen ECHTEN User-Agent senden. Ein fest verdrahteter
// UA-String veraltet und widerspricht dann allem anderen (Client Hints, JS-
// Features, Chrome-Version) — genau solche Widersprüche sucht ein Bot-Schutz.
// STEALTH_UA bleibt als Notausgang, falls doch mal einer nötig ist.
const UA_OVERRIDE = process.env.STEALTH_UA || undefined;

const STEALTH_ARGS = [
  // Setzt navigator.webdriver auf false — mehr braucht es dafür nicht.
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

// Nur EINE Korrektur, und zwar eine belegte: unter Xvfb rendert Chromium per
// SwiftShader (Software) und verrät das über WEBGL_debug_renderer_info. Echte
// Rechner nennen dort eine GPU. Die Ersatzwerte müssen zur Plattform passen —
// eine macOS-GPU auf „Linux x86_64" wäre ihrerseits ein Widerspruch.
//
// Absichtlich NICHT mehr angefasst (jeweils nachgemessen, nativ schon korrekt):
//   navigator.webdriver  -> false (nicht undefined! undefined ist selbst ein Tell)
//   navigator.plugins    -> 5
//   window.chrome        -> object
//   navigator.languages  -> folgt der locale des Kontexts
const EVASIONS = `
  try {
    const _gp = WebGLRenderingContext.prototype.getParameter;
    const patch = function (p) {
      if (p === 37445) return 'Google Inc. (Intel)';
      if (p === 37446) return 'ANGLE (Intel, Mesa Intel(R) UHD Graphics (CML GT2), OpenGL 4.6 (Core Profile) Mesa 23.2.1)';
      return _gp.call(this, p);
    };
    WebGLRenderingContext.prototype.getParameter = patch;
    if (typeof WebGL2RenderingContext !== 'undefined') {
      WebGL2RenderingContext.prototype.getParameter = patch;
    }
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

// --- Client Hints geradeziehen ---------------------------------------------
// Der UA-String allein reicht heute nicht: Chrome verrät über die User-Agent
// Client Hints zusätzlich Marken und Architektur. Zwei Widersprüche entstehen
// dort ungewollt und sind für einen Bot-Schutz gut sichtbar:
//   1. brands nennt nur „Chromium" — echtes Chrome führt „Google Chrome" mit.
//      Für Linux/ARM gibt es kein Google Chrome, wir MÜSSEN Chromium fahren.
//   2. architecture meldet „arm" (Container auf Apple Silicon), während der
//      UA-String „Linux x86_64" sagt.
// Beides hier angleichen — das entfernt Widersprüche, statt neue zu schaffen.
async function alignClientHints(page: Page, version: string): Promise<void> {
  const major = version.split('.')[0] || '';
  const ua = UA_OVERRIDE
    || `Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${major}.0.0.0 Safari/537.36`;
  try {
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Emulation.setUserAgentOverride', {
      userAgent: ua,
      acceptLanguage: 'de-DE,de;q=0.9,en;q=0.8',
      platform: 'Linux x86_64',
      userAgentMetadata: {
        brands: [
          { brand: 'Not(A:Brand', version: '99' },
          { brand: 'Google Chrome', version: major },
          { brand: 'Chromium', version: major },
        ],
        fullVersion: version,
        platform: 'Linux',
        platformVersion: '6.8.0',
        architecture: 'x86',
        model: '',
        mobile: false,
        bitness: '64',
        wow64: false,
      },
    } as any);
  } catch { /* best effort — lieber ohne als gar kein Browser */ }
}

export interface ContextOpts {
  viewport?: { width: number; height: number };
}

export async function createContext(browser: Browser, opts: ContextOpts = {}): Promise<BrowserContext> {
  const context = await browser.newContext({
    userAgent: UA_OVERRIDE,
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

/**
 * Seite anlegen und die Client Hints angleichen — VOR dem ersten Laden, sonst
 * hat die Seite ihre Werte schon gelesen. Executor und Recorder nutzen das
 * statt context.newPage().
 */
export async function createPage(browser: Browser, context: BrowserContext): Promise<Page> {
  const page = await context.newPage();
  if (STEALTH) await alignClientHints(page, browser.version());
  return page;
}
