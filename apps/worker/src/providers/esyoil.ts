// Heizöl-Preis-Provider (API-Quelle, kind:api) über esyoil.
// Nutzt den keyless Chart-Daten-Endpoint (derselbe, den die esyoil-Preisseite
// lädt): nationaler Tagespreis in € / 100 L. Der letzte Datenpunkt ist heute.
// Hinweis: Das ist der Bundesdurchschnitt — PLZ/Region fließt (noch) nicht ein;
// die Menge wird für den Gesamtpreis hochgerechnet.

const ENDPOINT = 'https://www.esyoil.com/api/oil/chart-data/jahresuebersicht/12?withTrend=true';

export async function fetchEsyoil(params: Record<string, any>): Promise<Record<string, any>> {
  const res = await fetch(ENDPOINT, { headers: { 'accept': 'application/json' } });
  if (!res.ok) throw new Error(`esyoil HTTP ${res.status}`);
  const json: any = await res.json();
  const data: any[] = json?.data || [];
  if (!data.length) throw new Error('esyoil: keine Preisdaten');

  const latest = data[data.length - 1];
  const per100 = Number(latest.value);
  if (!isFinite(per100)) throw new Error('esyoil: ungültiger Preiswert');

  const menge = Number(params.menge) > 0 ? Number(params.menge) : null;
  const total = menge != null ? Math.round(per100 * menge / 100 * 100) / 100 : null;

  return {
    price_per_100l: per100,
    ...(total != null ? { total } : {}),
    unit: '€/100L',
    supplier: 'esyoil (Bundesdurchschnitt)',
    date: String(latest.date || '').slice(0, 10),
    ...(params.plz ? { plz: String(params.plz) } : {}),
  };
}
