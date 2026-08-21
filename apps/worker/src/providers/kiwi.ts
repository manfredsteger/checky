// Kiwi.com-Flugpreis-Provider (API-Quelle, kind:api).
// Nutzt den keyless Website-GraphQL (api.skypicker.com/umbrella) — denselben
// Endpoint wie kiwi.com. Liefert den günstigsten Flug, der die Filter erfüllt
// (v.a. max. Zwischenstopps + max. Reisezeit), damit nicht ein 24h-Umsteige-
// Konstrukt einen 12h-Direktflug „unterbietet".

const ENDPOINT = 'https://api.skypicker.com/umbrella/v2/graphql';
const VISITOR = '00000000-0000-0000-0000-000000000000';

const CABIN: Record<string, string> = {
  economy: 'ECONOMY', premium: 'PREMIUM_ECONOMY', business: 'BUSINESS', first: 'FIRST',
};

// Bekannte Städte -> Kiwi-Sammel-IDs (alle Flughäfen). IATA-Codes und bereits
// aufgelöste "City:"/"Station:"-IDs werden direkt durchgereicht.
const CITY_ALIASES: Record<string, string> = {
  tokio: 'City:tokyo_jp', tokyo: 'City:tokyo_jp', osaka: 'City:osaka_jp',
  muenchen: 'Station:airport:MUC', münchen: 'Station:airport:MUC', munich: 'Station:airport:MUC',
  berlin: 'City:berlin_de', frankfurt: 'City:frankfurt_de', hamburg: 'City:hamburg_de',
  london: 'City:london_gb', paris: 'City:paris_fr', wien: 'City:vienna_at',
};

const PLACES_QUERY = `query P($search: PlacesSearchInput, $options: PlacesOptionsInput) {
  places(search: $search, options: $options) {
    ... on PlaceConnection { edges { node { __typename id } } }
  }
}`;

// Beliebigen Ort auflösen: IATA/„City:"/„Station:" direkt; sonst per Kiwi-
// Places-Query (bevorzugt die Stadt = alle Flughäfen). Alias-Liste nur als
// Offline-Fallback, falls die Query mal nicht erreichbar ist.
async function resolveLocation(input: string): Promise<string> {
  const v = (input || '').trim();
  if (!v) throw new Error('Kiwi: leerer Ort');
  if (v.includes(':')) return v;                         // schon eine Kiwi-ID
  if (/^[A-Za-z]{3}$/.test(v)) return `Station:airport:${v.toUpperCase()}`; // IATA

  try {
    const res = await fetch(`${ENDPOINT}?featureName=PlacesQuery`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'kw-skypicker-visitor-uniqid': VISITOR },
      body: JSON.stringify({ query: PLACES_QUERY, variables: { search: { term: v }, options: { locale: 'en' } } }),
    });
    if (res.ok) {
      const json: any = await res.json();
      const nodes: any[] = (json?.data?.places?.edges || []).map((e: any) => e.node).filter((n: any) => n?.id);
      const city = nodes.find(n => n.__typename === 'City');
      const station = nodes.find(n => n.__typename === 'Station');
      const pick = city || station || nodes[0];
      if (pick?.id) return pick.id;
    }
  } catch { /* Fallback unten */ }

  const alias = CITY_ALIASES[v.toLowerCase()];
  if (alias) return alias;
  throw new Error(`Kiwi: Ort "${v}" nicht auflösbar`);
}

const dayRange = (d: string) => ({ start: `${d}T00:00:00`, end: `${d}T23:59:59` });

const RETURN_QUERY = `query SRI($search: SearchReturnInput, $filter: ItinerariesFilterInput, $options: ItinerariesOptionsInput) {
  returnItineraries(search: $search, filter: $filter, options: $options) {
    __typename
    ... on AppError { error: message }
    ... on Itineraries { itineraries { ... on ItineraryReturn {
      price { amount } outbound { ...sec } inbound { ...sec } } } }
  }
}
fragment sec on Sector { duration sectorSegments { segment {
  source { station { code } } destination { station { code } } carrier { name code } } } }`;

const ONEWAY_QUERY = `query SOI($search: SearchOnewayInput, $filter: ItinerariesFilterInput, $options: ItinerariesOptionsInput) {
  onewayItineraries(search: $search, filter: $filter, options: $options) {
    __typename
    ... on AppError { error: message }
    ... on Itineraries { itineraries { ... on ItineraryOneWay {
      price { amount } sector { ...sec } } } }
  }
}
fragment sec on Sector { duration sectorSegments { segment {
  source { station { code } } destination { station { code } } carrier { name code } } } }`;

function sectorInfo(sec: any) {
  const segs = sec.sectorSegments || [];
  const codes = segs.map((s: any) => s.segment.source.station.code);
  const to = segs.length ? segs[segs.length - 1].segment.destination.station.code : '';
  if (to) codes.push(to);
  const carriers = Array.from(new Set(segs.map((s: any) => s.segment.carrier.name)));
  return {
    stops: Math.max(0, segs.length - 1),
    durationH: Math.round(sec.duration / 360) / 10,
    route: codes.join('–'),
    from: codes[0] || '',
    to,
    carriers,
  };
}

export async function fetchKiwi(params: Record<string, any>): Promise<Record<string, any>> {
  const source = await resolveLocation(params.origin);
  const destination = await resolveLocation(params.dest);
  const adults = Number(params.adults) || 1;
  const children = Number(params.children) || 0;
  const infants = Number(params.infants) || 0;
  const pax = Math.max(1, adults + children);
  const maxStops = params.max_stops != null && params.max_stops !== '' ? Number(params.max_stops) : 1;
  const maxDurH = params.max_duration_h != null && params.max_duration_h !== '' ? Number(params.max_duration_h) : null;
  const cabin = CABIN[String(params.cabin || 'economy').toLowerCase()] || 'ECONOMY';
  const isReturn = !!params.inbound;

  const itinerary: any = {
    source: { ids: [source] },
    destination: { ids: [destination] },
    outboundDepartureDate: dayRange(params.outbound),
  };
  if (isReturn) itinerary.inboundDepartureDate = dayRange(params.inbound);

  const variables = {
    search: { itinerary, passengers: { adults, children, infants }, cabinClass: { cabinClass: cabin, applyMixedClasses: false } },
    filter: { maxStopsCount: maxStops },
    options: { sortBy: 'PRICE', currency: 'eur', locale: 'en', partner: 'skypicker', market: 'de' },
  };
  const query = isReturn ? RETURN_QUERY : ONEWAY_QUERY;

  const res = await fetch(`${ENDPOINT}?featureName=${isReturn ? 'SearchReturnItinerariesQuery' : 'SearchOneWayItinerariesQuery'}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'kw-skypicker-visitor-uniqid': VISITOR },
    body: JSON.stringify({ query, variables }),
  });
  if (!res.ok) throw new Error(`Kiwi HTTP ${res.status}`);
  const json: any = await res.json();
  const root = json?.data?.[isReturn ? 'returnItineraries' : 'onewayItineraries'];
  if (!root) throw new Error('Kiwi: unerwartete Antwort');
  if (root.__typename === 'AppError') throw new Error(`Kiwi: ${root.error}`);

  const items: any[] = root.itineraries || [];
  if (!items.length) throw new Error('Kiwi: keine Flüge für diese Kriterien gefunden');

  // Nach Preis aufsteigend (kommt sortiert), ersten nehmen, der die Reisezeit erfüllt.
  const withInfo = items.map((it: any) => {
    const out = sectorInfo(isReturn ? it.outbound : it.sector);
    const inb = isReturn ? sectorInfo(it.inbound) : null;
    return { it, out, inb, total: Number(it.price.amount) };
  }).sort((a, b) => a.total - b.total);

  const pick = withInfo.find(x =>
    maxDurH == null || (x.out.durationH <= maxDurH && (!x.inb || x.inb.durationH <= maxDurH))
  );
  if (!pick) throw new Error(`Kiwi: kein Flug ≤ ${maxDurH}h Reisezeit gefunden`);

  const airlines = Array.from(new Set([...pick.out.carriers, ...(pick.inb?.carriers || [])])).join(', ');
  // Deeplink aus den echten Flughafen-Codes des gewählten Flugs (robuster als
  // der freie dest-Text, der als Städtename keine gültige Kiwi-URL ergäbe).
  const from = pick.out.from || 'MUC';
  const to = pick.out.to || '';
  const bookingUrl = `https://www.kiwi.com/en/search/results/${from}/${to}/${params.outbound}${isReturn ? '/' + params.inbound : ''}`;

  return {
    price: Math.round(pick.total / pax),          // pro Person (Kennzahl fürs Manifest)
    total: pick.total,                            // Gesamtpreis alle Reisenden
    currency: 'EUR',
    airline: airlines,
    stops: pick.out.stops,
    duration_out_h: pick.out.durationH,
    ...(pick.inb ? { duration_in_h: pick.inb.durationH } : {}),
    route: pick.inb ? `${pick.out.route} / ${pick.inb.route}` : pick.out.route,
    booking_url: bookingUrl,
  };
}
