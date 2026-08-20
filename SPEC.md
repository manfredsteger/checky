A.1 Konzept

Checky überwacht beliebige Websites in regelmäßigen Abständen — Flugsuchen, Konzertkarten-Verfügbarkeit, Statusseiten, Preise, was auch immer. Keine Site-spezifischen APIs, keine Accounts bei Drittanbietern. Der Zugriff läuft immer über einen echten Browser (Playwright/Chromium), pro Lauf mit frischem Kontext (keine Cookies, kein Cache, kein Storage).

Hierarchie:

Projekt                     „Flugsuche 2027 Mai Japan"
 ├─ Agent 1                 lufthansa.com · „Preis MUC→HND hin/rück im Mai"
 │   └─ Zeitplan            täglich 07:00 + 19:00 (±10 min Jitter)
 ├─ Agent 2                 flights.google.com · gleiche Route
 │   └─ Zeitplan            2× wöchentlich
 └─ Agent 3                 skyscanner.de · Preisalarm-Vergleich
     └─ Zeitplan            monatlich am 1.

Projekt                     „Konzert XY 2027"
 └─ Agent 1                 eventim.de · „Sind Tickets verfügbar? (ja/nein + Preis)"
     └─ Zeitplan            alle 6 Stunden

Jeder Agent ist unabhängig: eigene Zielseite, eigenes Ziel („was soll gecheckt werden"), eigene Parameter, eigener Zeitplan, eigenes Ergebnis-Schema.

Lebenszyklus eines Agenten:

Anlernen (Recorder): Der Nutzer beschreibt in natürlicher Sprache, was der Agent tun soll. Ein Claude-Agent (Agent SDK) steuert den Browser über Playwright MCP (Accessibility-Tree, keine Screenshot-Koordinaten), der Nutzer schaut per Live-View zu. Der erfolgreiche Pfad wird als Recipe (deterministische Playwright-Schritte) eingefroren.
Regelbetrieb: Der Scheduler spielt das Recipe stur ab — null KI, null Token, reproduzierbar.
Selbstheilung: Bricht ein Selektor (Seiten-Redesign), repariert Claude einmalig den Selektor (Accessibility-Snapshot rein, neuer Locator raus), Recipe bekommt eine neue Version. Klappt das nicht: Run failed, Alert, Mensch übernimmt.
Ergebnis: Strukturiertes JSON (pro Agent definiertes Schema) + Screenshot als Beleg. Delta-Erkennung gegen den letzten Lauf → optional Benachrichtigung nur bei Änderung.
A.2 Stack (nicht verhandelbar)

Vite · React 19 · TypeScript strict · Tailwind v3 · TanStack Query v5 · Express.js · Zod · PostgreSQL 16 · pg-boss (Cron/Queue/Retry, kein Redis) · Playwright (Chromium) · Claude Agent SDK (Auth ausschließlich CLAUDE_CODE_OAUTH_TOKEN aus dem Claude-Abo, kein API-Key) · Playwright MCP für den Recorder · Vitest · Docker Compose · Makefile als einzige Bedienoberfläche.

Monorepo: apps/web · apps/api · apps/worker · packages/shared (Zod-Schemas, Typen).

A.3 Datenmodell
sql
projects   (id, name, description, created_at)
agents     (id, project_id→projects, name, site, goal_text, params jsonb,
            schedule_cron, jitter_min, enabled, notify jsonb,
            result_schema jsonb,          -- Zod/JSON-Schema des Ergebnisses
            created_at)
recipes    (id, agent_id→agents, version, steps jsonb, healed_from,
            created_at, UNIQUE(agent_id, version))
runs       (id, agent_id, recipe_id, status,   -- queued|running|succeeded|failed|healed
            started_at, finished_at, error, steps_log jsonb,
            ai_tokens int default 0,
            screenshot_before, screenshot_after)
results    (id, run_id, agent_id, data jsonb, data_hash, changed bool,
            created_at)
A.4 Recipe-Format (deterministischer Regelbetrieb)
json
{
  "steps": [
    { "action": "goto", "url": "https://…" },
    { "action": "click", "selector": "getByRole('button', { name: /Ablehnen/ })", "optional": true, "note": "Consent: immer ABLEHNEN" },
    { "action": "fill", "selector": "getByLabel('Von')", "value": "{{origin}}" },
    { "action": "click", "selector": "getByRole('button', { name: 'Suchen' })" },
    { "action": "waitFor", "selector": "[data-testid='results']" },
    { "action": "extract", "mode": "dom_map", "fallback": "ai_json" }
  ]
}

Locator-Priorität: getByLabel > getByRole > getByPlaceholder > data-testid > CSS. Kein XPath. {{…}}-Platzhalter kommen aus agents.params.

A.5 Guardrails (Code, nicht nur Prompt)
Domain-Allowlist pro Agent; page.route() blockt alles andere (Recorder: Playwright-MCP --allowed-origins).
Hartes Verbot: Passwortfelder (type=password), Zahlungsfelder (autocomplete=cc-*), Logins, Downloads, CAPTCHA-Umgehung → sofortiger Abbruch.
Denylist-Buttons: „Buchen/Kaufen/Bezahlen/Anmelden/Bestellen".
Budgets: max. Laufzeit 120 s, max. Aktionen/Run, max. Runs/Tag pro Domain, Token-Log pro Run.
Frischer browser.newContext() pro Run, finally close().
Kill-Switch im Dashboard (pausiert Scheduler global).
Niedrige Frequenz + Jitter — respektvoller Umgang mit fremden Seiten; bei Bot-Block: Agent pausieren, nicht eskalieren.
A.6 Dashboard-Seiten
Projekte: Liste, anlegen/umbenennen/archivieren.
Projekt-Detail: Agenten-Karten (Status-Badge letzter Run, nächster Lauf, Toggle, „Jetzt ausführen", „Neu anlernen").
Agent anlegen: Name, Site, Ziel in Freitext, Parameter, Zeitplan-Builder (Presets täglich/alle X h/wöchentlich/monatlich → intern Cron), Notify-Optionen → führt in den Recorder.
Recorder: Live-Screenshot-View (2-s-Polling), Aktions-Log, Bestätigungsdialog vor Submits, „Als Recipe speichern".
Runs: Filterbare Tabelle, Step-Timeline, Screenshots, Fehler, Token-Verbrauch.
Ergebnisse: Historie pro Agent, Delta-Markierung, Verlaufs-Chart (z. B. Preis über Zeit), CSV/JSON-Export.
Einstellungen: Notify-Ziele (Matrix/Webhook), Kill-Switch, Retention.

Zusätzliche bindende Regeln in SPEC.md:
- Jede API-Route validiert Input mit Zod aus packages/shared; keine any-Types.
- Jedes Feature muss nach `make up` ohne weitere Handgriffe funktionieren.
- Pro Auftrag genau EIN Feature; keine ungefragten Extras.
- KI-Aufrufe im Code NUR über das AIProvider-Interface.
- KEINE echten Tokens, Keys oder Secrets im Code, der DB oder im Frontend.
- Die .env.example ist eine reine Vorlage mit Platzhaltern (z. B. changeme).
- Der Code liest Secrets ausschließlich über process.env. Wenn eine Env-Var fehlt, startet der Code mit einer klaren Fehlermeldung oder deaktiviert das Feature sauber. Die App darf niemals deswegen abstürzen oder einen Default-Key erfinden.
