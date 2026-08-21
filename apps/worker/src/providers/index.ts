import { fetchKiwi } from './kiwi.js';
import { fetchEsyoil } from './esyoil.js';
import { fetchHeizoel24 } from './heizoel24.js';

// Registry der API-Provider (kind:api). Neuer Provider = eine Zeile hier +
// eine Adapter-Datei. Jeder Adapter bekommt die gemergten Agent-Parameter und
// liefert das Ergebnis-Objekt, das wie ein Recipe-Ergebnis gespeichert wird.
export type ProviderFn = (params: Record<string, any>) => Promise<Record<string, any>>;

const registry: Record<string, ProviderFn> = {
  kiwi: fetchKiwi,
  esyoil: fetchEsyoil,
  heizoel24: fetchHeizoel24,
};

export const PROVIDERS = Object.keys(registry);

export async function fetchProvider(name: string, params: Record<string, any>): Promise<Record<string, any>> {
  const fn = registry[name];
  if (!fn) throw new Error(`Unbekannter Provider: "${name}" (verfügbar: ${PROVIDERS.join(', ')})`);
  return fn(params);
}
