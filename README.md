# Checky

Checky überwacht beliebige Websites in regelmäßigen Abständen — Preise, Verfügbarkeiten, Statusseiten — **ohne** Site-spezifische APIs. Der Zugriff läuft immer über einen echten Browser (Playwright/Chromium), pro Lauf mit frischem Kontext.

**Idee:** Ein KI-Agent lernt einen Check **einmal per natürlicher Sprache** an (Recorder) und friert den erfolgreichen Ablauf als **deterministisches Recipe** ein. Der Regelbetrieb spielt dieses Recipe stur ab — ohne KI, ohne Token. Bricht ein Selektor (Seiten-Redesign), repariert die KI ihn **einmalig** (Self-Healing) und legt eine neue Recipe-Version an.

```
Projekt "Flugsuche Japan"
 ├─ Agent  lufthansa.com · "Preis MUC→HND im Mai"     · täglich 07:00
 └─ Agent  flights.google.com · gleiche Route          · 2×/Woche
```

## Stack

Vite · React 19 · TypeScript · Tailwind · TanStack Query · Express · Zod · PostgreSQL 16 · pg-boss (Cron/Queue/Retry) · Playwright (Chromium) · Claude Agent SDK · Docker Compose · Makefile.

Monorepo: `apps/web` · `apps/api` · `apps/worker` · `packages/shared`.

```
        ┌────────┐      ┌────────┐      ┌────────────┐
Browser │  web   │─/api▶│  api   │─────▶│ PostgreSQL │
  :8081 │ (Vite) │      │ :8080  │      │  (+pg-boss)│
        └────────┘      └────────┘      └─────┬──────┘
                                              │ Queue/Cron
                                        ┌─────▼──────┐
                                        │   worker   │  Playwright + Claude Agent SDK
                                        │ (Chromium) │  Recipe-Player · Self-Healing · Recorder
                                        └────────────┘
```

## Voraussetzungen

- Docker + Docker Compose (oder Podman, siehe unten)
- Node.js (nur für lokale Typechecks/Tests außerhalb von Docker)
- Ein **Claude-Abo-Token** für KI-Features (Recorder & Self-Healing):
  ```bash
  claude setup-token        # in einem echten Terminal ausführen; gibt sk-ant-oat01-… aus
  ```

## Quickstart

```bash
make init                 # npm install (lokal)
cp .env.example .env       # DB_URL passt für Docker; Token eintragen:
#   CLAUDE_CODE_OAUTH_TOKEN=sk-ant-oat01-…   (ohne Anführungszeichen/Leerzeichen)

make up                    # Stack starten (db, api, web, worker)
make migrate               # DB-Schema anlegen
make seed                  # Demo-Projekt + Bücher-Agent + Recipe v1

# Dashboard: http://localhost:8081
# API-Health: curl http://localhost:8080/health

make run-once PROFILE="Bücher-Preis-Check"   # einen Lauf sofort ausführen
make e2e                                      # End-to-End-Test gegen den Stack
```

Ohne Token laufen Regelbetrieb-Checks trotzdem (deterministische Recipes); nur Recorder und Self-Healing brauchen den Token.

## Make-Targets

| Target | Zweck |
|---|---|
| `make help` | Hilfe (Default) |
| `make init` | Lokale Abhängigkeiten installieren |
| `make build` | Docker-Images bauen |
| `make up` / `make down` | Stack starten / stoppen |
| `make reset` | Container **und Volumes** löschen, frisch aufbauen |
| `make migrate` | DB-Migrationen ausführen |
| `make seed` | Demo-Daten einspielen |
| `make run-once PROFILE=<id\|name>` | Einen Lauf sofort ausführen |
| `make logs` / `make logs-worker` | Logs folgen |
| `make ps` | Container auflisten |
| `make db-shell` | psql-Shell |
| `make test` | Unit-Tests (Vitest) |
| `make e2e` | End-to-End-Test (Playwright, im worker-Container) |
| `make lint` | TypeScript-Typecheck über alle Pakete |
| `make clean` | Build-Artefakte + node_modules entfernen |

## Endpunkte

- Dashboard: `http://localhost:8081`
- API: `http://localhost:8080` — `/health`, `/metrics`, `/api/*`
- `/metrics`: `checky_runs_total{status}`, `checky_ai_tokens_total`, `checky_queue_depth`

## Einstellungen (Dashboard → Einstellungen)

- **Kill-Switch**: pausiert alle Ausführungen global (manuelle Trigger werden mit 423 abgelehnt).
- **Benachrichtigungen**: generischer Webhook (POST JSON bei Änderung/Fehler) und optional Matrix.
- **Retention**: Screenshots/Läufe älter als N Tage werden täglich (03:00 UTC) aufgeräumt; der letzte Lauf je Agent bleibt.
- **Rate-Limit**: max. Läufe/Tag/Domain (Setting `rate_limit_per_day`, Default 12) — darüber `error='rate_limited'`.

## Troubleshooting

- **Chromium/Shared Memory**: Der worker-Service setzt `shm_size: 1gb`. Bei „Target closed"/Crashes prüfen, dass das gilt.
- **Token fehlt / KI failt**: Recorder/Healing brauchen `CLAUDE_CODE_OAUTH_TOKEN` in `.env` (kein `ANTHROPIC_API_KEY` setzen — der hätte Vorrang). Token ohne führendes Leerzeichen/Quotes.
- **`--dangerously-skip-permissions` Fehler**: Nicht `permissionMode: bypassPermissions` als root verwenden — bewusst weggelassen.
- **Podman statt Docker**: alle Targets mit `make COMPOSE="podman-compose" up` etc.
- **Sauberer Neustart**: `make reset && make up && make migrate && make seed`.

## Playwright-Update-Prozedur

Die Playwright-Version ist an das Docker-Basisimage gekoppelt und **gepinnt**:

1. In `apps/worker/package.json` `playwright`/`@playwright/test` auf die neue Version heben.
2. In `Dockerfile` das worker-Basisimage passend pinnen: `mcr.microsoft.com/playwright:v<VERSION>-jammy`.
3. `npm install` (Lockfile), dann `make build && make e2e`.

Version und Image **immer gemeinsam** anheben, sonst passen Browser und Library nicht zusammen.
