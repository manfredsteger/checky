import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../lib/http.js';

export const placesRouter = Router();

// --- Flughafen-/Städtesuche --------------------------------------------------
// Damit niemand raten muss, wie ein Ort im Code heißt. „Osaka" ist als STADT
// OSA (alle Flughäfen), der große Flughafen heißt KIX, daneben gibt es ITM —
// das weiß man nicht, das muss die Oberfläche anbieten.
//
// Quelle ist derselbe keyless Endpoint, den der Kiwi-Adapter ohnehin nutzt.

const ENDPOINT = 'https://api.skypicker.com/umbrella/v2/graphql';
const VISITOR = '00000000-0000-0000-0000-000000000000';

const QUERY = `query P($search: PlacesSearchInput, $options: PlacesOptionsInput) {
  places(search: $search, options: $options) {
    ... on PlaceConnection { edges { node {
      __typename id name
      ... on Station { code type city { name country { name } } }
      ... on City { code country { name } }
    } } }
  }
}`;

export interface Place {
  code: string;
  name: string;
  kind: 'city' | 'airport';
  country: string;
  /** fertige Beschriftung für die Auswahlliste */
  label: string;
}

const cache = new Map<string, { at: number; places: Place[] }>();
const TTL_MS = 60 * 60 * 1000;

placesRouter.get('/api/places', asyncHandler(async (req, res) => {
  const q = z.string().min(2).max(60).safeParse(String(req.query.q ?? '').trim());
  if (!q.success) return res.json([]);
  const term = q.data;

  const hit = cache.get(term.toLowerCase());
  if (hit && Date.now() - hit.at < TTL_MS) return res.json(hit.places);

  let places: Place[] = [];
  try {
    const r = await fetch(`${ENDPOINT}?featureName=PlacesQuery`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'kw-skypicker-visitor-uniqid': VISITOR },
      body: JSON.stringify({ query: QUERY, variables: { search: { term }, options: { locale: 'de' } } }),
      signal: AbortSignal.timeout(8000),
    });
    if (r.ok) {
      const json: any = await r.json();
      const nodes: any[] = (json?.data?.places?.edges || []).map((e: any) => e.node).filter(Boolean);
      places = nodes
        .filter(n => (n.__typename === 'City' || (n.__typename === 'Station' && n.type === 'AIRPORT')) && n.code)
        .map(n => {
          const kind: Place['kind'] = n.__typename === 'City' ? 'city' : 'airport';
          const country = n.country?.name || n.city?.country?.name || '';
          return {
            code: String(n.code).toUpperCase(),
            name: n.name,
            kind,
            country,
            label: kind === 'city'
              ? `${n.name} — alle Flughäfen (${n.code})${country ? ', ' + country : ''}`
              : `${n.name} (${n.code})${country ? ', ' + country : ''}`,
          };
        })
        // Städte zuerst: „alle Flughäfen einer Stadt" ist beim Preisvergleich
        // fast immer die bessere Wahl als ein einzelner Flughafen.
        .sort((a, b) => (a.kind === b.kind ? 0 : a.kind === 'city' ? -1 : 1))
        .slice(0, 10);
    }
  } catch (e) {
    console.error('[API] Ortssuche fehlgeschlagen:', e);
  }

  cache.set(term.toLowerCase(), { at: Date.now(), places });
  res.json(places);
}));
