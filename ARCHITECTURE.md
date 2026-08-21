# Checky – Architektur & Bausteinbibliothek

Leitprinzip: **modular, kein Monolith.** Jede Ebene ist eine wiederverwendbare
Bibliothek, die man erweitern, teilen und ineinandergreifen lassen kann. Neue
Dienste (Flug, Heizöl, …) entstehen durch **Kombinieren vorhandener Bausteine**,
nicht durch Neuschreiben.

## Die drei Bibliotheks-Ebenen

```
Manifest   (Tracking-Typ)     WAS getrackt wird: Parameter-Formular + Ergebnis-Darstellung
   │                          manifests/<id>.json
   └─ Blueprint (Quelle)      WO getrackt wird: site + goal_template + Zeitplan, gehört zu 1 Manifest
        │                     blueprints/<id>.json
        └─ Recipe (angelernt) WIE ausgelesen wird: Playwright-Schritte, pro Agent, teilbar
                              DB-Tabelle recipes (+ Bundle-Export)
```

- **Manifest** – z.B. `flight`, `heizoel`, `generic`. Definiert `params` (typisiertes
  Formular), `result_schema`, `display` (welches Feld ist die Kennzahl, Einheit,
  Wunsch-/Schmerzgrenze-Param) und ein `goal_template`. Rein deklarativ, git-versioniert.
- **Blueprint** – eine fertig vorbereitete Quelle (z.B. `idealo-flug`), die auf ein
  Manifest verweist und `site` + `goal_template` mitbringt. Aus einem Blueprint wird
  per Klick ein Agent instanziiert. Mehrere Blueprints teilen sich ein Manifest.
- **Recipe** – die beim „Anlernen" (Recorder) aufgezeichneten, versionierten Schritte
  eines Agenten. Reproduzierbar, self-healing, exportierbar.

Ein **Projekt** wählt ein Manifest und setzt dessen Parameter einmal zentral
(`projects.params`); seine **Agenten** erben diese und können sie überschreiben
(`agents.params`). Der Worker merged `{...projectParams, ...agentParams}` und füllt
damit `{{platzhalter}}` in Goal/Recipe.

## Teilen: Bundles (Import/Export)

Ein **Bundle** (`checky-bundle`, JSON) bündelt beliebige Bausteine in einer Datei:

```
GET  /api/library/export?manifests=flight&blueprints=idealo-flug   → Download
POST /api/library/import   { kind:"checky-bundle", version:1, manifests, blueprints }
```

Damit lassen sich Bausteine sichern, zwischen Instanzen weitergeben und aus einem
künftigen Community-Repo einspielen. `id` wird streng validiert (kein Path-Traversal).
`manifests/` und `blueprints/` sind Live-Mounts → Import ist sofort wirksam, persistent.

## Code-Struktur (Module statt Monolith)

### apps/api
```
src/app.ts            Kompositions-Wurzel: express + Router-Montage + Error-Handler
src/lib/http.ts       asyncHandler + geteilte Param/Query-Schemas
src/lib/boss.ts       zentrale pg-boss-Instanz + enqueue()
src/lib/library.ts    Loader manifests/ + blueprints/, exportBundle/importBundle
src/routes/
  projects.ts  agents.ts  runs.ts  recorder.ts  library.ts  settings.ts
```
Jede Route-Datei exportiert einen `Router`. Neue Domäne = neue Datei + eine Zeile
`app.use(...)`.

### apps/worker
```
src/index.ts     Job-Dispatch (agent-run | recorder | cleanup)
src/executor.ts  Recipe abspielen (+ Self-Healing über aiProvider)
src/recorder.ts  Anlernen: auto + assisted
src/browser.ts   Playwright-Start + Anti-Detection (Stealth/Xvfb)
src/notify.ts    Webhook/Matrix
src/aiProvider.ts  KI: Selektor heilen + JSON-Extraktion (Claude Agent SDK)
```

### apps/web
```
src/api/client.ts        einziger HTTP-Zugang zur API
src/lib/resultDisplay.ts manifest-getriebene Darstellungs-Logik (framework-frei)
src/ui/                  wiederverwendbare Bausteine (PriceHeadline, ConfirmDialog, toast, …)
src/pages/               Seiten
```

### packages/shared
Zod-Schemas als **einzige Quelle der Wahrheit** für Typen (Project, Agent, Manifest,
Blueprint, Recipe, Run, Result, Bundle). API und Web importieren dieselben Typen.

## So fügt man Neues hinzu

| Ziel | Schritt |
|------|---------|
| Neuer Tracking-Typ (z.B. Strompreis) | `manifests/strom.json` anlegen – nur JSON, kein Code |
| Neue Quelle für einen Typ | `blueprints/<id>.json` mit `manifest_id` anlegen |
| Neue API-Domäne | `routes/<name>.ts` + `app.use()` |
| Community-Baustein übernehmen | Bundle über `POST /api/library/import` |

## Offene Ausbaustufen

- Frontend-UI für Blueprint-Auswahl beim Agent-Anlegen + Bundle-Import/Export-Buttons.
- Recipes in Bundles aufnehmen (angelernte Schritte teilen).
- Agent-Klassifizierung/Tags (Status- vs. Preis- vs. Verfügbarkeits-Agent).
