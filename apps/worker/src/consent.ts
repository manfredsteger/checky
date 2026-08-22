import { Page } from 'playwright';

// --- Consent-Banner wegräumen ------------------------------------------------
// Cookie-Layer sind der häufigste Grund, warum ein Anlern-Lauf scheitert: sie
// überdecken die Seite, und die großen Frameworks (usercentrics) rendern in ein
// GESCHLOSSENES Shadow-DOM — dort kommen weder ARIA-Snapshot noch Klick hin.
// Darum zuerst die offizielle JS-API des jeweiligen CMP aufrufen, dann das
// Overlay entfernen und erst als letzte Stufe nach einem Button suchen.

const ACCEPT_NAMES = [
  /^Alle akzeptieren$/i, /^Akzeptieren$/i, /^Alle zulassen$/i, /^Zustimmen$/i,
  /^Ich stimme zu$/i, /^Einverstanden$/i, /^Verstanden$/i, /^OK$/i,
  /^Accept all$/i, /^Accept$/i, /^Agree$/i, /^Got it$/i,
];

const CMP_SELECTORS = [
  '#usercentrics-cmp-ui', '#usercentrics-root', '[id^="usercentrics"]',
  '#onetrust-consent-sdk', '#onetrust-banner-sdk',
  '#didomi-host', '#didomi-popup',
  '#CybotCookiebotDialog', '#CybotCookiebotDialogBodyUnderlay',
  '[id*="sp_message_container"]', '.qc-cmp2-container',
  '.cmpbox', '#cmpwrapper',
  // Check24: eigener Layer, der sonst jeden Klick abfängt.
  '.c24-cookie-consent-wrapper', '.c24-strict-blocking-layer',
];

/**
 * Räumt Consent-/Cookie-Layer weg. Best effort — wirft nie.
 * @returns kurzer Hinweis, was passiert ist (für den Mitschnitt).
 */
export async function dismissConsent(page: Page): Promise<string> {
  const notes: string[] = [];

  // Stufe 1: offizielle CMP-APIs (erreichen auch geschlossenes Shadow-DOM).
  try {
    const viaApi = await page.evaluate((sels) => {
      const done: string[] = [];
      const w = window as any;
      try { if (w.UC_UI?.acceptAllConsents) { w.UC_UI.acceptAllConsents(); w.UC_UI.closeCMP?.(); done.push('usercentrics'); } } catch { /* ignore */ }
      try { if (w.OneTrust?.AllowAll) { w.OneTrust.AllowAll(); done.push('onetrust'); } } catch { /* ignore */ }
      try { if (w.Didomi?.setUserAgreeToAll) { w.Didomi.setUserAgreeToAll(); done.push('didomi'); } } catch { /* ignore */ }
      try { if (w.Cookiebot?.submitCustomConsent) { w.Cookiebot.submitCustomConsent(true, true, true); done.push('cookiebot'); } } catch { /* ignore */ }
      try { if (w.__tcfapi) { w.__tcfapi('displayConsentUi', 2, () => {}); } } catch { /* ignore */ }
      // Check24 kocht sein eigenes Süppchen: „fam" = alle akzeptieren. Die
      // Buttons sind <a onclick=…>, deshalb greift die Button-Suche unten nicht.
      try { if (w.Check24?.cookieBanner?.c24consent?.giveConsent) { w.Check24.cookieBanner.c24consent.giveConsent('fam'); done.push('check24'); } } catch { /* ignore */ }
      // Stufe 2: Overlay-Reste entfernen, damit nichts mehr den Klick abfängt.
      for (const s of sels) {
        document.querySelectorAll(s).forEach(el => { try { el.remove(); done.push('removed:' + s); } catch { /* ignore */ } });
      }
      // Scroll-Sperre lösen, die viele CMPs auf <body> setzen.
      try { document.documentElement.style.overflow = ''; document.body.style.overflow = ''; } catch { /* ignore */ }
      return done;
    }, CMP_SELECTORS);
    if (viaApi.length) notes.push(...viaApi.slice(0, 4));
  } catch { /* Seite evtl. mitten in Navigation */ }

  // Stufe 3: sichtbares Zustimmen-Element klicken. Auch Links, denn manche
  // Banner (Check24) bauen ihre Schalter als <a onclick=…> statt <button>.
  if (!notes.length) {
    outer:
    for (const name of ACCEPT_NAMES) {
      for (const role of ['button', 'link'] as const) {
        try {
          const el = page.getByRole(role, { name }).first();
          if (await el.isVisible({ timeout: 300 })) {
            await el.click({ timeout: 2500 });
            notes.push(`klick:${role}:${name.source}`);
            break outer;
          }
        } catch { /* nächster Kandidat */ }
      }
    }
  }
  if (!notes.length) {
    for (const frame of page.frames()) {
      if (frame === page.mainFrame()) continue;
      try {
        const btn = frame.getByRole('button', { name: ACCEPT_NAMES[0] }).first();
        if (await btn.isVisible({ timeout: 300 })) { await btn.click({ timeout: 2500 }); notes.push('klick:iframe'); break; }
      } catch { /* ignore */ }
    }
  }

  if (notes.length) await page.waitForTimeout(800);
  return notes.length ? notes.join(', ') : 'kein Consent-Layer gefunden';
}
