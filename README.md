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
- [Der schnellste Weg: Deep-Link statt Anlernen](#der-schnellste-weg-deep-link-statt-anlernen)
- [API-Quellen (`kind: api`) — ganz ohne Browser](#api-quellen-kind-api--ganz-ohne-browser)
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

Typische Einsätze: **Flugpreise**, **Heizölpreise**, **Produktpreise** (Amazon & Co.), Ticket-Verfügbarkeiten, Status-/Wartungsseiten, **Neuigkeiten-Feeds** (neue Folgen/Titel auf einer Katalogseite, gefiltert z.B. nach Sprache).

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

- **Manifest** — ein Tracking-*Typ* wie `flight`, `heizoel`, `produkt` (Online-Preise), `neuigkeiten` (Listen neuer Einträge statt eines Preises) oder `generic`. Deklariert das typisierte Parameter-Formular, das Ergebnis-Schema und über `display`, welches Feld die **Kennzahl** ist (Preis/Treffer-Anzahl), welche **Einheit** gilt und welche Parameter **Wunsch-/Schmerzgrenze** definieren. Rein deklaratives JSON.
- **Blueprint** — eine fertig vorbereitete *Quelle* wie `idealo-flug`, die auf ein Manifest verweist und `site` + `goal_template` mitbringt. Mehrere Blueprints teilen sich ein Manifest. Ein Blueprint liefert seine Daten auf einem von zwei Wegen (`kind`): **`browser`** (Recipe/Playwright, angelernt oder Deep-Link) oder **`api`** (fester Adapter in `apps/worker/src/providers/`, kein Browser nötig) — siehe [API-Quellen](#api-quellen-kind-api--ganz-ohne-browser).
- **Recipe** — die beim Anlernen aufgezeichneten, **versionierten** Schritte eines konkreten Agenten (nur bei `kind: browser`).

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

Erststart in einem Befehl (legt `.env` an, installiert, baut, startet, migriert, seedet):

```bash
make setup
# → danach in .env den CLAUDE_CODE_OAUTH_TOKEN eintragen und `make restart`
```

Oder Schritt für Schritt:

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

Nach Code-Änderungen ausrollen (die Images backen den Quellstand ein, kein Live-Mount):

```bash
make deploy-web    # nur Frontend neu bauen & starten (DB bleibt)
make rebuild       # alle Images neu bauen & starten (DB bleibt)  — Alias: make deploy
make complete      # rebuild + migrate + seed (nach größeren Updates)
```

Optional das Flug-Projekt (17 Quellen) importieren:

```bash
make seed-flights               # importiert checky-agents-seed.json
```

## Make-Befehle

`make help` zeigt alle Targets gruppiert an (Default-Ziel). Überblick:

**Setup & Lifecycle**

| Befehl | Zweck |
|---|---|
| `make setup` | Erststart komplett: `.env` anlegen · install · build · up · migrate · seed |
| `make complete` | Nach Updates: build · up · migrate · seed (**DB bleibt**) |
| `make init` | Lokale Abhängigkeiten installieren (`npm install`) |
| `make up` / `make down` | Stack starten / stoppen + entfernen (Volumes bleiben) |
| `make start` / `make stop` | Container nur stoppen/starten (nicht entfernen) |
| `make restart` | Container neu erzeugen — „normaler" Neustart (DB & Images bleiben) |
| `make prod` | Produktions-Stack starten (Alias für `up`) |
| `make dev` | Frontend lokal mit Hot-Reload (proxyt `/api` auf den laufenden Stack) |
| `make ps` / `make status` | Container auflisten / Status + Health + Docker-Disk |

**Build & Deploy**

| Befehl | Zweck |
|---|---|
| `make build` | Alle Docker-Images neu bauen |
| `make rebuild` / `make deploy` | Images neu bauen **& starten** (DB bleibt) |
| `make deploy-web` | Nur den Web-Container neu bauen & starten (Frontend-Änderungen) |
| `make publish IMAGE_PREFIX=user/checky TAG=1.0` | api/web/worker-Images bauen & in eine Registry pushen |

**Datenbank**

| Befehl | Zweck |
|---|---|
| `make migrate` (`make db-push`) | DB-Migrationen ausführen |
| `make seed` / `make seed-flights` | Demo-Daten / Flug-Projekt einspielen |
| `make db-shell` (`make shell-db`) | Interaktive PostgreSQL-Shell (`psql`) |
| `make db-dump [FILE=…]` | DB nach `backups/checky-<zeit>.sql` sichern |
| `make db-restore FILE=…` | Dump zurückspielen (überschreibt Daten) |
| `make wait-db` | Warten, bis PostgreSQL bereit ist |

**Reset & Wartung**

| Befehl | Zweck |
|---|---|
| `make reset` | Frischer Neustart mit Rebuild — **DB bleibt erhalten** (down → build → up → migrate) |
| `make reset-hard` (`make nuke`) | **KOMPLETT-Reset: löscht die DB** (Volume), baut & seedet neu — mit Sicherheitsabfrage (`FORCE=1` überspringt sie) |
| `make prune` | Docker-Disk sicher freigeben (Build-Cache + dangling Images) — **rührt nie Volumes an** |
| `make clean` | Lokale Build-Artefakte + `node_modules` entfernen |

**Betrieb & Qualität**

| Befehl | Zweck |
|---|---|
| `make logs` / `make logs-api` / `make logs-worker` | Container-Logs folgen |
| `make run-once PROFILE=<id\|name>` | Einen Lauf sofort ausführen |
| `make test` / `make e2e` / `make lint` | Unit-Tests / E2E (Playwright) / Typecheck über alle Pakete |

> **Reset-Leiter:** `restart` (Container neu, alles bleibt) → `reset` (Rebuild, **DB bleibt**) → `reset-hard`/`nuke` (**DB weg**, neu geseedet). Der destruktive Schritt fragt nach; nur `reset-hard` löscht Daten.
>
> **Disk-Full vermeiden:** wiederholte Builds füllen den Docker-Build-Cache — nach Build-Runden `make prune` (gibt Cache + dangling Images frei, lässt Volumes/DB unangetastet). Niemals `docker … prune --volumes` von Hand — das löscht die DB.
>
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
- **Live-Anzeige**: Läuft gerade etwas, zeigen Agenten-Karte, Projekt-Kachel und Sidebar das sofort — Fortschrittsbalken (bestimmt, sobald aus früheren Läufen eine Erwartungsdauer bekannt ist), Laufzeit und Restschätzung. Sehr kurze Läufe (API-Quellen sind teils in Millisekunden fertig) quittieren stattdessen für ~12 s mit „Aktualisiert vor Xs". Hängt ein Lauf ungewöhnlich lange, wird er amber. Die Kacheln laden ihr Ergebnis danach von selbst nach — kein Neuladen nötig.
- **Ergebnisse**: Kennzahl (Preis) groß und farbig — grün bei erreichtem **Wunschpreis**, rot über der **Schmerzgrenze** — plus Verlaufs-Chart mit Ziel-/Grenz-Linien und CSV-/JSON-Export.
- **Plausibilitäts-Badge „prüfen"**: Kann eine Quelle einen behaupteten Direktflug/Filter nicht wirklich belegen (z.B. keine Stopp-Angabe), bleibt der Preis neutral statt grün — ein unbelegter Wert soll nicht wie ein bestätigter Erfolg aussehen.
- **Projekt-Übersicht** (Kopfzeile-Umschalter „Übersicht"): vergleicht die Kennzahl **über alle Agenten eines Projekts** — Mehrlinien-Chart oder sortierbare Tabelle (Ø/Min/Max/Trend), automatisch passend zur Anzahl der Quellen.
- **Messreihen**: Änderst du zentrale Parameter (Route, Sprachfilter, …), zählt das als neue Messreihe — ältere Werte werden nicht stillschweigend weiterverglichen, sondern als „nicht vergleichbar" gekennzeichnet und lassen sich optional einblenden.

## Der schnellste Weg: Deep-Link statt Anlernen

Bei vielen Vergleichsportalen steht die **komplette Suche in der URL**. Dann braucht es gar kein
Anlernen: der Blueprint bringt ein fertiges Recipe mit, und der Agent liefert ab dem ersten Klick
echte Daten. Solche Vorlagen tragen im Blueprint-Picker das Abzeichen **„Sofort"**.

```
https://www.kayak.de/flights/BER-JFK/2027-01-01/2027-01-15/2adults?sort=price_a&fs=stops=~1;legdur=-1200
              └── Route ──┘ └── Hinflug ─┘└── Rückflug ─┘└─ Reisende ─┘  └── max. 1 Stopp, ≤20 h ──┘
```

Das Recipe dazu ist immer dasselbe Muster — Seite öffnen, Consent wegräumen, auf die Ergebnisliste
warten, günstigsten Preis aus **allen** Treffern ziehen:

```jsonc
{ "action": "goto",    "url": "https://…/{{origin_code}}-{{dest_code}}/{{outbound}}{{inbound_seg}}/{{pax_path}}?…" },
{ "action": "consent", "optional": true },
{ "action": "waitFor", "selector": "[class*=\"price-text\"]", "ms": 90000 },
{ "action": "extract", "mode": "dom_map", "map": {
    "price": { "selector": "[class*=\"price-text\"]", "reduce": "min_number" }   // Minimum über alle Preise
}}
```

**Abgeleitete Parameter** (`apps/worker/src/params.ts`) halten die URLs lesbar: aus `adults`/`children`
wird `pax_path`, aus `max_stops`/`max_duration_h` wird `flight_filter`, aus `inbound` wird
`inbound_seg` (leer = Nur-Hinflug). `origin_code`/`dest_code` sind die IATA-Codes für URL-Quellen —
API-Quellen wie Kiwi verstehen auch „Tokio", eine URL nicht.

> **Warum die Dauergrenze wichtig ist:** ohne `max_duration_h` gewinnt bei fernen Reisedaten
> regelmäßig ein 30-Stunden-Umsteigekonstrukt den Preisvergleich. Mit `max_stops=1` und
> `max_duration_h=20` liefert Kayak für BER→JFK 620 € statt eines unbrauchbaren 480-€-Tarifs
> mit 19 h Aufenthalt in Reykjavík.

### Wenn die Suche nicht in der URL steht

Manche Quellen halten ihre Ergebnisse hinter einem **Sitzungs-Token** (idealo:
`/ergebnis/znLi1`) — ein Deep-Link ist dort grundsätzlich unmöglich. Dann bedient
das Recipe die Suchmaske. Zwei Bausteine machen das haltbar:

| Aktion | Wozu |
|---|---|
| `click_until` | Klickt (z.B. „nächster Monat"), **bis** ein Zielelement da ist. Eine feste Klickzahl wäre zeitabhängig: der Abstand von heute bis zum Reisedatum schrumpft täglich, und das Recipe würde still danebengreifen. |
| `click` mit `repeat` | Zähler-Widgets (Reisende +/−), die bei jedem Aufruf beim selben Startwert stehen — die Klickzahl ist damit deterministisch. `repeat: 0` klickt gar nicht. |
| `divide_by` | Quellen, die nur den Gesamtpreis nennen, auf „pro Person" umrechnen (`"divide_by": "{{pax_total}}"`). |

> **Falle bei Kalendern:** `react-dates` (Lufthansa) rendert Nachbarmonate **unsichtbar mit**. Ein
> `click_until` auf blosse Existenz hört deshalb zu früh auf und der Klick läuft danach in einen
> Timeout. Immer `:visible` anhängen: `td[aria-label*="{{outbound_de}}"]:visible`.

Für Datumsformate gibt es fertige abgeleitete Parameter: `{{outbound}}` (ISO),
`{{outbound_compact}}` (`20270510`), `{{outbound_ts}}` (Unix-Sekunden) und `{{outbound_de}}`
(`1. Januar 2027`) — jeweils auch als `inbound_*`.

```jsonc
{ "action": "click_until", "selector": "[aria-label=\"vor\"]",
  "until": "[data-qa=\"day-button-{{outbound}}\"]", "max": 30 },
{ "action": "click", "selector": "[data-qa=\"day-button-{{outbound}}\"]" }
```

> **Consent-Banner werden meist nachgeschoben.** Ein Versuch direkt nach dem Laden
> greift ins Leere — und der Layer legt sich danach über die Seite und verschluckt
> jeden Klick. `dismissConsent` fasst deshalb einmal nach.

## API-Quellen (`kind: api`) — ganz ohne Browser

Manche Quellen brauchen gar kein Playwright: liefert eine Seite ihre Daten über eine
schlüssellose JSON-Schnittstelle aus, holt ein fester **Provider** (`apps/worker/src/providers/<id>.ts`)
das Ergebnis direkt per `fetch()` — schneller, robuster gegen Layout-Änderungen und ganz ohne
Bot-Schutz-Sorgen. Ein Blueprint mit `"kind": "api", "provider": "<id>"` aktiviert das; der Agent
bekommt in der Oberfläche das Abzeichen **„API · `<id>`"** und braucht kein Anlernen.

| Provider | Quelle | Liefert |
|---|---|---|
| `kiwi` | `api.skypicker.com` (Kiwi.com, keyless) | Flugpreis, Airline, Stopps, Dauer — inkl. Direktflug-Filter |
| `esyoil` | esyoil.com | Bundesweiter Heizölpreis €/100L |
| `heizoel24` | heizoel24.de | Heizölpreis €/100L für eine konkrete PLZ + Liefermenge |
| `aniworld` | aniworld.to/neue-episoden | Neue Episoden/Serien, gefiltert nach Sprache, inkl. Genre je Serie |

Eigenen Provider ergänzen: `apps/worker/src/providers/<id>.ts` mit einer `fetch<Id>(params)`-Funktion
schreiben, in `providers/index.ts` registrieren, dazu einen Blueprint mit `kind: "api"` anlegen.

## Einen Check anlernen (Recorder)

Nur nötig, wenn die Quelle weder Deep-Link noch bedienbare Suchmaske hat.

Zwei Modi:

- **Autonom** — die KI versucht das Ziel selbstständig zu erreichen. Ideal für einfache Seiten (Preis auslesen, Statuswert).
- **Assistiert (turn-based)** — für schwierige Formulare (Datepicker, Consent-Layer, mehrstufige Suchmasken). Du gibst Schritt für Schritt Anweisungen („Klicke Abflughafen", „Wähle 2027-01-01"), die KI führt aus, du beendest die Aufnahme.

In beiden Fällen entsteht am Ende eine **Vorschau**; nach deiner Bestätigung wird sie als **Recipe-Version** gespeichert und der Agent läuft ab dann deterministisch.

Der Anlern-Agent bekommt automatisch die zusammengeführten Projekt- und Agent-Parameter (mit
aufgelösten `{{Platzhalter}}` im Ziel), räumt nach jeder Navigation Consent-Layer weg und kann
`wait`, `press` und `dismiss_consent` nutzen. Findet er **kein** Ergebnisfeld, endet die Session als
**`failed` mit Begründung** — nicht als leere Bestätigungs-Vorschau. Ein Recipe, das nichts ausliest,
ist schlimmer als gar keins.

## Anti-Detection

Damit Bot-Schutz (z.B. bei Flugportalen) nicht sofort blockt, läuft der Browser **headful unter Xvfb** (virtuelles Display) statt headless, mit realistischem Linux-Chrome-Fingerprint und gängigen Evasions (`navigator.webdriver`, Plugins, `window.chrome`, WebGL). Gesteuert über `HEADLESS=false` und `STEALTH=true` (im worker gesetzt).

**Domain-Guardrail.** Ein Agent darf die Seite nicht verlassen — begrenzt wird aber auf die
*registrierbare* Domain (eTLD+1) und nur für **Dokument-Navigationen**. Subressourcen (CDN, Fonts,
XHR der Ergebnis-API) laufen durch: sie zu blocken lässt die Seite leer bleiben und ist selbst ein
Bot-Merkmal. Geschwister-Subdomains sind erlaubt, weil Consent-Flüsse dorthin umleiten
(`www.google.com` → `consent.google.com`); ein Wechsel auf eine fremde Site bleibt gesperrt.

**Was nicht geht.** Skyscanner (PerimeterX) zeigt statt Ergebnissen ein Captcha; ohne Residential-Proxy
ist das nicht lösbar. Solche Quellen gehören deaktiviert und markiert, nicht täglich rot laufen gelassen.

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
- `GET /api/activity` — Live-Zustand fürs Dashboard: `runs` (queued/running), `recent` (in den letzten 20 s beendet), `eta` (erwartete Laufdauer je Agent aus den letzten 5 erfolgreichen Läufen, in Sekunden) und `server_time` (für den Uhr-Abgleich im Browser)
- `GET /api/screenshots/:file.png`

**Bausteinbibliothek**
- `GET /api/manifests` · `GET /api/manifests/:id`
- `GET /api/blueprints[?manifest_id=]` · `GET /api/blueprints/:id`
- `GET /api/library/export?manifests=&blueprints=` · `POST /api/library/import`
- `GET /api/places?q=` — Flughafen-/Städtesuche (Kiwi-Places, keyless) fürs Routen-Eingabefeld im Dashboard

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
    src/providers/           API-Quellen ohne Browser (kiwi, esyoil, heizoel24, aniworld, …)
packages/
  shared/  Zod-Schemas als einzige Quelle der Wahrheit (Typen für api + web)
manifests/   Tracking-Typen  (git-versioniert, live-gemountet)
blueprints/  Quellen         (git-versioniert, live-gemountet)
```

## Eigene Bausteine hinzufügen

| Ziel | Schritt |
|---|---|
| Neuer Tracking-Typ (z.B. Strompreis) | `manifests/strom.json` anlegen — nur JSON, kein Code |
| Neue Quelle für einen Typ (Browser/Recipe) | `blueprints/<id>.json` mit `manifest_id` anlegen |
| Neue Quelle ohne Browser (`kind: api`) | `apps/worker/src/providers/<id>.ts` + Registrierung in `providers/index.ts` + Blueprint mit `kind:"api"` |
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
- **Sauberer Neustart (Daten behalten)** — `make reset` (baut neu & migriert, DB bleibt).
- **Kompletter Reset (Daten weg)** — `make reset-hard` (löscht die DB, baut & seedet neu; fragt vorher nach).
- **Docker-Disk voll** — `make prune` (gibt Build-Cache + dangling Images frei; Volumes/DB bleiben unangetastet).
- **Ports belegt** — Host-Ports 8080 (api) und 8081 (web) in `docker-compose.yml` anpassbar.

## Playwright-Update-Prozedur

Die Playwright-Version ist an das Docker-Basisimage gekoppelt und **gepinnt**:

1. In `apps/worker/package.json` `playwright`/`@playwright/test` auf die neue Version heben.
2. In `Dockerfile` das worker-Basisimage passend pinnen: `mcr.microsoft.com/playwright:v<VERSION>-jammy`.
3. `npm install` (Lockfile), dann `make build && make e2e`.

Version und Image **immer gemeinsam** anheben, sonst passen Browser und Library nicht zusammen.

## Roadmap

- **Recipes in Bundles** aufnehmen (angelernte Schritte teilen — Export/Import kennt aktuell nur Manifeste/Blueprints).
- Community-Repo für Manifeste, Blueprints und Recipes.
- Weitere API-Quellen ohne Browser, wo verfügbar (schneller & robuster als Recipes).
