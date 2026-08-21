<div align="center">

# 🔎 Checky

**Überwache beliebige Websites — Preise, Verfügbarkeiten, Statusseiten — ganz ohne Site-APIs.**

Ein KI-Agent lernt einen Check **einmal** per natürlicher Sprache an und friert ihn als **deterministisches Recipe** ein. Der Regelbetrieb spielt es stur ab — ohne KI, ohne Token-Kosten. Bricht ein Selektor, repariert die KI ihn **einmalig** und legt eine neue Version an.

`Playwright` · `React 19` · `Express` · `PostgreSQL` · `pg-boss` · `Claude Agent SDK` · `Docker`

</div>

---

## Inhalt

- [Was Checky macht](#was-checky-macht)
- [Kernkonzept: Anlernen → Abspielen → Heilen](#kernkonzept-anlernen--abspielen--heilen)
- [Die Bausteinbibliothek](#die-bausteinbibliothek)
- [Architektur](#architektur)
- [Voraussetzungen](#voraussetzungen)
- [Quickstart](#quickstart)
- [Make-Befehle](#make-befehle)
- [Konfiguration (.env)](#konfiguration-env)
- [Ports & Endpunkte](#ports--endpunkte)
- [Bedienung im Dashboard](#bedienung-im-dashboard)
- [Einen Check anlernen (Recorder)](#einen-check-anlernen-recorder)
- [Anti-Detection](#anti-detection)
- [API-Referenz](#api-referenz)
- [Projekt-Struktur](#projekt-struktur)
- [Eigene Bausteine hinzufügen](#eigene-bausteine-hinzufügen)
- [Einstellungen & Betrieb](#einstellungen--betrieb)
- [Troubleshooting](#troubleshooting)
- [Playwright-Update-Prozedur](#playwright-update-prozedur)
- [Roadmap](#roadmap)

---

## Was Checky macht

Checky beobachtet Websites in regelmäßigen Abständen und speichert strukturierte Ergebnisse (z.B. einen Preis, eine Verfügbarkeit, einen Status). Der Zugriff läuft **immer über einen echten Browser** (Playwright/Chromium), pro Lauf mit frischem Kontext — es braucht **keine** offizielle API der Zielseite.

Organisiert wird alles in einer klaren Hierarchie:

```
Projekt "Flugsuche Beispielreise"   (wählt einen Tracking-Typ + zentrale Parameter)
 ├─ Agent  idealo.de/flug   · "günstigster Preis BER→JFK"   · täglich 07:00
 ├─ Agent  check24.de/flug  · gleiche Route                 · täglich 07:00
 └─ Agent  google.com/flights · gleiche Route               · 2×/Woche
```

Typische Einsätze: **Flugpreise**, **Heizölpreise**, Produkt-/Angebotspreise, Ticket-Verfügbarkeiten, Status-/Wartungsseiten.

## Kernkonzept: Anlernen → Abspielen → Heilen

1. **Anlernen (Recorder, KI).** Du beschreibst das Ziel in natürlicher Sprache. Ein KI-Agent bedient den Browser, bis er das Ergebnis findet, und **destilliert** den erfolgreichen Weg zu einem deterministischen **Recipe** (eine Liste Playwright-Schritte). Du bestätigst — fertig.
2. **Abspielen (Regelbetrieb, ohne KI).** Der Zeitplan (Cron) spielt das Recipe stur ab. Kein KI-Aufruf, keine Token, reproduzierbar und schnell.
3. **Selbstheilen (KI, nur bei Bruch).** Ändert die Zielseite ihr Layout und ein Selektor bricht, repariert die KI ihn **einmalig** anhand eines ARIA-Snapshots und legt eine **neue Recipe-Version** an. Der nächste reguläre Lauf ist wieder KI-frei.

> Ohne Token laufen Regelbetrieb-Checks trotzdem (bestehende Recipes). Nur **Recorder** und **Self-Healing** brauchen den Claude-Token.

## Die Bausteinbibliothek

Checky ist als erweiterbare **Bibliothek aus Bausteinen** aufgebaut — neue Dienste entstehen durch **Kombinieren**, nicht durch Neuschreiben. Drei Ebenen greifen ineinander:

```
Manifest   (Tracking-Typ)      WAS: Parameter-Formular + Ergebnis-Darstellung   manifests/<id>.json
   └─ Blueprint (Quelle)       WO:  site + goal_template + Zeitplan              blueprints/<id>.json
        └─ Recipe (angelernt)  WIE: Playwright-Schritte, pro Agent, teilbar      DB-Tabelle recipes
```

- **Manifest** — ein Tracking-*Typ* wie `flight`, `heizoel`, `generic`. Deklariert das typisierte Parameter-Formular, das Ergebnis-Schema und über `display`, welches Feld die **Kennzahl** ist (Preis), welche **Einheit** gilt und welche Parameter **Wunsch-/Schmerzgrenze** definieren. Rein deklaratives JSON.
- **Blueprint** — eine fertig vorbereitete *Quelle* wie `idealo-flug`, die auf ein Manifest verweist und `site` + `goal_template` mitbringt. Mehrere Blueprints teilen sich ein Manifest.
- **Recipe** — die beim Anlernen aufgezeichneten, **versionierten** Schritte eines konkreten Agenten.

Ein **Projekt** wählt ein Manifest und setzt dessen Parameter **einmal zentral**; seine **Agenten** erben diese und dürfen sie überschreiben. Der Worker merged `{…Projekt, …Agent}` und füllt damit `{{platzhalter}}` in Goal & Recipe.

**Teilen per Bundle.** Bausteine lassen sich als eine JSON-Datei ex-/importieren — Grundlage fürs Sichern, Weitergeben und für ein späteres Community-Repo:

```bash
# Export (Download)
curl "http://localhost:8080/api/library/export?manifests=flight&blueprints=idealo-flug" -o bundle.json
# Import
curl -X POST http://localhost:8080/api/library/import -H 'Content-Type: application/json' -d @bundle.json
```

> Ausführliche Beschreibung: siehe [`ARCHITECTURE.md`](./ARCHITECTURE.md).

## Architektur

```
        ┌────────┐      ┌────────┐      ┌────────────┐
Browser │  web   │─/api▶│  api   │─────▶│ PostgreSQL │
  :8081 │ (Vite) │      │ :8080  │      │  (+pg-boss)│
        └────────┘      └────────┘      └─────┬──────┘
                                              │ Queue / Cron / Retry
                                        ┌─────▼──────┐
                                        │   worker   │  Playwright + Claude Agent SDK
                                        │ (Chromium) │  Recipe-Player · Self-Healing · Recorder
                                        └────────────┘
```

- **web** — Dashboard (Vite/React 19/TypeScript/Tailwind/TanStack Query).
- **api** — REST + Validierung (Express/Zod), reiht Jobs in pg-boss ein.
- **worker** — spielt Recipes im echten Browser ab, lernt an, heilt, benachrichtigt.
- **db** — PostgreSQL 16; pg-boss nutzt dieselbe DB für Queue, Cron und Retry.

**Stack:** Vite · React 19 · TypeScript · Tailwind · TanStack Query · Express · Zod · PostgreSQL 16 · pg-boss · Playwright (Chromium) · Claude Agent SDK · Docker Compose · Makefile.

## Voraussetzungen

- **Docker + Docker Compose** (oder Podman, siehe [Troubleshooting](#troubleshooting)).
- **Node.js ≥ 20** — nur für lokale Typechecks/Tests außerhalb von Docker.
- Ein **Claude-Abo-Token** für die KI-Features (Recorder & Self-Healing):
  ```bash
  claude setup-token        # in einem echten Terminal; gibt sk-ant-oat01-… aus
  ```
  Ohne Token läuft der Regelbetrieb bestehender Recipes weiter — nur Anlernen/Heilen ruht.

## Quickstart

```bash
make init                       # npm install (lokal, für Typechecks/Tests)
cp .env.example .env            # DB_URL passt für Docker; Token eintragen:
#   CLAUDE_CODE_OAUTH_TOKEN=sk-ant-oat01-…   (ohne Anführungszeichen/Leerzeichen)

make up                         # Stack starten (db, api, web, worker)
make migrate                    # DB-Schema anlegen
make seed                       # Demo-Projekt + Bücher-Agent + Recipe v1

# Dashboard:   http://localhost:8081
# API-Health:  curl http://localhost:8080/health

make run-once PROFILE="Bücher-Preis-Check"   # einen Lauf sofort ausführen
make e2e                                       # End-to-End-Test gegen den Stack
```

Optional das Flug-Projekt (17 Quellen) importieren:

```bash
make seed-flights               # importiert checky-agents-seed.json
```

## Make-Befehle

| Befehl | Zweck |
|---|---|
| `make help` | Zeigt alle Targets (Default) |
| `make init` | Lokale Abhängigkeiten installieren (`npm install`) |
| `make build` | Alle Docker-Images neu bauen |
| `make up` / `make down` | Stack starten / stoppen + entfernen |
| `make reset` | Container **und Volumes** löschen, frisch bauen & starten |
| `make migrate` | DB-Migrationen ausführen |
| `make seed` | Demo-Daten einspielen (Bücher-Agent inkl. Recipe) |
| `make seed-flights` | Flug-Projekt aus `checky-agents-seed.json` importieren |
| `make run-once PROFILE=<id\|name>` | Einen Lauf sofort ausführen |
| `make logs` / `make logs-worker` | Container-Logs folgen (alle / nur worker) |
| `make ps` | Laufende Container auflisten |
| `make db-shell` | Interaktive PostgreSQL-Shell (`psql`) |
| `make test` | Unit-Tests |
| `make e2e` | End-to-End-Tests (Playwright, im worker-Container) |
| `make lint` | TypeScript-Typecheck über **alle** Pakete |
| `make clean` | Build-Artefakte + `node_modules` entfernen |

> Podman: allen Targets `COMPOSE="podman-compose"` mitgeben, z.B. `make up COMPOSE="podman-compose"`.

## Konfiguration (.env)

Aus `.env.example` kopieren und anpassen:

| Variable | Bedeutung | Default |
|---|---|---|
| `DB_URL` | PostgreSQL-Verbindung (für Docker vorkonfiguriert) | `postgres://checky:changeme@db:5432/checky` |
| `CLAUDE_CODE_OAUTH_TOKEN` | Claude-Abo-Token für Recorder & Self-Healing | — |

> **Kein `ANTHROPIC_API_KEY` setzen** — er hätte Vorrang und umginge den Abo-Token.

Weitere, in `docker-compose.yml` gesetzte Variablen: `SCREENSHOT_DIR`, `HEADLESS=false` + `STEALTH=true` (Anti-Detection im worker).

## Ports & Endpunkte

| Dienst | URL |
|---|---|
| Dashboard (web) | `http://localhost:8081` |
| API | `http://localhost:8080` — `/health`, `/metrics`, `/api/*` |
| Metriken | `/metrics`: `checky_runs_total{status}`, `checky_ai_tokens_total`, `checky_queue_depth` |

## Bedienung im Dashboard

- **Projekte** anlegen und einen **Tracking-Typ** (Manifest) wählen; Parameter (z.B. Route, Datum, Wunschpreis) einmal zentral setzen — über das **Zahnrad** oben rechts im Projekt.
- **Agenten** je Quelle anlegen. Solange kein Recipe existiert, ist ein Agent klar als **„Nicht angelernt"** markiert (amber Badge + Hinweis) und der grüne **Anlernen**-Button springt ins Auge.
- **Massenaktionen**: „Alle aktivieren / pausieren / ausführen" im Projekt-Kopf.
- **Ergebnisse**: Kennzahl (Preis) groß und farbig — grün bei erreichtem **Wunschpreis**, rot über der **Schmerzgrenze** — plus Verlaufs-Chart mit Ziel-/Grenz-Linien und CSV-/JSON-Export.

## Einen Check anlernen (Recorder)

Zwei Modi:

- **Autonom** — die KI versucht das Ziel selbstständig zu erreichen. Ideal für einfache Seiten (Preis auslesen, Statuswert).
- **Assistiert (turn-based)** — für schwierige Formulare (Datepicker, Consent-Layer, mehrstufige Suchmasken). Du gibst Schritt für Schritt Anweisungen („Klicke Abflughafen", „Wähle 2027-01-01"), die KI führt aus, du beendest die Aufnahme.

In beiden Fällen entsteht am Ende eine **Vorschau**; nach deiner Bestätigung wird sie als **Recipe-Version** gespeichert und der Agent läuft ab dann deterministisch.

## Anti-Detection

Damit Bot-Schutz (z.B. bei Flugportalen) nicht sofort blockt, läuft der Browser **headful unter Xvfb** (virtuelles Display) statt headless, mit realistischem Linux-Chrome-Fingerprint und gängigen Evasions (`navigator.webdriver`, Plugins, `window.chrome`, WebGL). Gesteuert über `HEADLESS=false` und `STEALTH=true` (im worker gesetzt).

## API-Referenz

Basis: `http://localhost:8080`

**Projekte**
- `GET /api/projects` · `POST /api/projects` · `GET /api/projects/:id` · `PATCH /api/projects/:id` · `DELETE /api/projects/:id`

**Agenten**
- `GET /api/projects/:id/agents` · `POST /api/projects/:id/agents`
- `GET /api/agents/:id` · `PATCH /api/agents/:id` · `DELETE /api/agents/:id`
- `GET /api/agents/:id/runs` · `GET /api/agents/:id/results`
- `POST /api/agents/:id/trigger` — Lauf sofort einreihen (423 bei aktivem Kill-Switch)

**Recorder**
- `POST /api/agents/:id/recorder` `{ mode: "auto" | "assisted" }`
- `GET /api/recorder/:sid`
- `POST /api/recorder/:sid/instruct` `{ text }` · `POST /api/recorder/:sid/finish` (assistiert)
- `POST /api/recorder/:sid/abort` · `POST /api/recorder/:sid/confirm` — Vorschau → Recipe-Version

**Läufe**
- `GET /api/runs?project_id=&agent_id=&status=&limit=`
- `GET /api/screenshots/:file.png`

**Bausteinbibliothek**
- `GET /api/manifests` · `GET /api/manifests/:id`
- `GET /api/blueprints[?manifest_id=]` · `GET /api/blueprints/:id`
- `GET /api/library/export?manifests=&blueprints=` · `POST /api/library/import`

**Betrieb**
- `GET /api/settings` · `PUT /api/settings` · `POST /api/admin/cleanup`
- `GET /health` · `GET /metrics`

## Projekt-Struktur

Monorepo (npm workspaces):

```
apps/
  web/     Dashboard (React/Vite)
    src/api/client.ts        einziger HTTP-Zugang zur API
    src/lib/resultDisplay.ts manifest-getriebene Darstellungs-Logik
    src/ui/                  wiederverwendbare Bausteine (PriceHeadline, ConfirmDialog, toast, …)
    src/pages/               Seiten
  api/     REST-API (Express/Zod)
    src/app.ts               Kompositions-Wurzel: Router-Montage + Error-Handler
    src/lib/                  http · boss (pg-boss) · library (manifests/blueprints/bundles)
    src/routes/              projects · agents · runs · recorder · library · settings
    migrations/              DB-Schema (node-pg-migrate)
  worker/  Ausführung (Playwright + Claude Agent SDK)
    src/index.ts             Job-Dispatch (agent-run | recorder | cleanup)
    src/executor.ts          Recipe abspielen (+ Self-Healing)
    src/recorder.ts          Anlernen: auto + assisted
    src/browser.ts           Browser-Start + Anti-Detection
    src/notify.ts            Webhook/Matrix
    src/aiProvider.ts        KI: Selektor heilen + JSON-Extraktion
packages/
  shared/  Zod-Schemas als einzige Quelle der Wahrheit (Typen für api + web)
manifests/   Tracking-Typen  (git-versioniert, live-gemountet)
blueprints/  Quellen         (git-versioniert, live-gemountet)
```

## Eigene Bausteine hinzufügen

| Ziel | Schritt |
|---|---|
| Neuer Tracking-Typ (z.B. Strompreis) | `manifests/strom.json` anlegen — nur JSON, kein Code |
| Neue Quelle für einen Typ | `blueprints/<id>.json` mit `manifest_id` anlegen |
| Neue API-Domäne | `routes/<name>.ts` schreiben + eine Zeile `app.use(...)` in `app.ts` |
| Fremden Baustein übernehmen | Bundle über `POST /api/library/import` |

`manifests/` und `blueprints/` sind live gemountet — Änderungen greifen sofort, ohne Rebuild.

## Einstellungen & Betrieb

- **Kill-Switch** — pausiert alle Ausführungen global; manuelle Trigger werden mit `423` abgelehnt.
- **Benachrichtigungen** — generischer Webhook (POST JSON bei Änderung/Fehler) und optional Matrix.
- **Retention** — Screenshots/Läufe älter als N Tage werden täglich (03:00 UTC) aufgeräumt; der letzte Lauf je Agent bleibt.
- **Rate-Limit** — max. Läufe/Tag/Domain (Setting `rate_limit_per_day`, Default 12); darüber `error='rate_limited'`.

## Troubleshooting

- **Chromium / Shared Memory** — der worker setzt `shm_size: 1gb`. Bei „Target closed"/Crashes prüfen, dass das greift.
- **Token fehlt / KI failt** — Recorder/Healing brauchen `CLAUDE_CODE_OAUTH_TOKEN` in `.env` (kein `ANTHROPIC_API_KEY` setzen). Token ohne führende Leerzeichen/Quotes.
- **`--dangerously-skip-permissions`-Fehler** — nicht `permissionMode: bypassPermissions` als root verwenden (bewusst weggelassen).
- **Podman statt Docker** — alle Targets mit `make COMPOSE="podman-compose" up` usw.
- **Sauberer Neustart** — `make reset && make migrate && make seed`.
- **Ports belegt** — Host-Ports 8080 (api) und 8081 (web) in `docker-compose.yml` anpassbar.

## Playwright-Update-Prozedur

Die Playwright-Version ist an das Docker-Basisimage gekoppelt und **gepinnt**:

1. In `apps/worker/package.json` `playwright`/`@playwright/test` auf die neue Version heben.
2. In `Dockerfile` das worker-Basisimage passend pinnen: `mcr.microsoft.com/playwright:v<VERSION>-jammy`.
3. `npm install` (Lockfile), dann `make build && make e2e`.

Version und Image **immer gemeinsam** anheben, sonst passen Browser und Library nicht zusammen.

## Roadmap

- Frontend-UI für **Blueprint-Auswahl** beim Agent-Anlegen + Bundle-Import/Export-Buttons.
- **Recipes in Bundles** aufnehmen (angelernte Schritte teilen).
- **Agent-Klassifizierung/Tags** (Status- vs. Preis- vs. Verfügbarkeits-Agent).
- Community-Repo für Manifeste, Blueprints und Recipes.
