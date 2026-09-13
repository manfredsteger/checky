import { fetchKiwi } from './kiwi.js';
import { fetchEsyoil } from './esyoil.js';
import { fetchHeizoel24 } from './heizoel24.js';
import { fetchAniworld } from './aniworld.js';
import { fetchTopstreamfilm } from './topstreamfilm.js';
import { fetchLovetorrent } from './lovetorrent.js';

// Registry der API-Provider (kind:api). Neuer Provider = eine Zeile hier +
// eine Adapter-Datei. Jeder Adapter bekommt die gemergten Agent-Parameter und
// liefert das Ergebnis-Objekt, das wie ein Recipe-Ergebnis gespeichert wird.
//
// Zusätzlich reicht der Worker einen Kontext durch: die globalen Einstellungen
// (für Quellen-Zugänge wie hinterlegte Cookies). Provider, die ihn nicht
// brauchen, ignorieren das zweite Argument einfach.
export interface ProviderContext {
  sources: { lovetorrent_cookie?: string; lovetorrent_user_agent?: string };
}
export type ProviderFn = (params: Record<string, any>, ctx: ProviderContext) => Promise<Record<string, any>>;

const registry: Record<string, ProviderFn> = {
  kiwi: fetchKiwi,
  esyoil: fetchEsyoil,
  heizoel24: fetchHeizoel24,
  aniworld: fetchAniworld,
  topstreamfilm: fetchTopstreamfilm,
  lovetorrent: fetchLovetorrent,
};

export const PROVIDERS = Object.keys(registry);

export async function fetchProvider(name: string, params: Record<string, any>, ctx: ProviderContext = { sources: {} }): Promise<Record<string, any>> {
  const fn = registry[name];
  if (!fn) throw new Error(`Unbekannter Provider: "${name}" (verfügbar: ${PROVIDERS.join(', ')})`);
  return fn(params, ctx);
}
