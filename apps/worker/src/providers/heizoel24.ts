// Heizöl-Preis-Provider (API-Quelle, kind:api) über heizoel24.de.
// PLZ- UND mengengenau: nutzt den keyless Matrix-Endpoint, den der
// Heizölrechner der Website aufruft. Preis in € / 100 L; "Stations" = Anzahl
// Abladestellen (1 = eine Lieferstelle, der Standard/angezeigte Preis).

const ENDPOINT = 'https://www.heizoel24.de/api/site/1/prices/matrix';

export async function fetchHeizoel24(params: Record<string, any>): Promise<Record<string, any>> {
  const plz = String(params.plz || '').trim();
  if (!/^\d{5}$/.test(plz)) throw new Error('heizoel24: gültige 5-stellige PLZ nötig (Parameter plz)');
  const menge = Number(params.menge) > 0 ? Math.round(Number(params.menge)) : 3000;
  const stations = Number(params.stations) > 0 ? Number(params.stations) : 1; // Abladestellen

  const url = `${ENDPOINT}?zipCode=${encodeURIComponent(plz)}&amounts=${menge}`;
  const res = await fetch(url, { headers: { 'accept': 'application/json' } });
  if (!res.ok) throw new Error(`heizoel24 HTTP ${res.status}`);
  const json: any = await res.json();

  // Antwort: [[{Price, Amount, Stations}, ...]] — Eintrag mit passender
  // Abladestellen-Zahl wählen (Standard 1).
  const rows: any[] = Array.isArray(json?.[0]) ? json[0] : [];
  const pick = rows.find(r => r?.Stations === stations && r?.Price != null)
            ?? rows.find(r => r?.Price != null);
  if (!pick) throw new Error(`heizoel24: kein Preis für PLZ ${plz} / ${menge} L (evtl. kein Liefergebiet)`);

  const per100 = Number(pick.Price);
  const total = Math.round(per100 * menge / 100 * 100) / 100;

  return {
    price_per_100l: per100,
    total,
    unit: '€/100L',
    supplier: `heizoel24 (PLZ ${plz}, ${stations} Abladestelle${stations > 1 ? 'n' : ''})`,
    plz,
    menge,
  };
}
