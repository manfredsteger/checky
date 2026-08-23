COMPOSE ?= docker compose

# Registry-/Publish-Parameter (überschreibbar: make publish IMAGE_PREFIX=user/checky TAG=1.0)
IMAGE_PREFIX ?= checky
TAG          ?= latest
# Ziel für db-dump/db-restore (Default: Zeitstempel-Datei unter backups/)
FILE ?= backups/checky-$(shell date +%Y%m%d-%H%M%S).sql

.DEFAULT_GOAL := help

.PHONY: help init setup complete up down start stop restart prod dev ps status \
        build rebuild deploy deploy-web publish \
        migrate db-push seed seed-flights db-shell shell-db db-dump db-restore wait-db disk \
        reset reset-hard nuke prune clean \
        logs logs-api logs-worker run-once recorder test e2e lint

help: ## Zeigt diese Hilfe (nach Gruppen)
	@awk 'BEGIN {FS = ":.*##"; printf "\n\033[1mChecky\033[0m — Make-Befehle\n"} \
		/^##@/ { printf "\n\033[1m%s\033[0m\n", substr($$0, 5); next } \
		/^[a-zA-Z0-9_.-]+:.*?##/ { printf "  \033[36m%-16s\033[0m %s\n", $$1, $$2 }' \
		$(MAKEFILE_LIST)
	@echo

##@ Setup & Lifecycle
init: ## Lokale Abhängigkeiten installieren (npm install)
	npm install

setup: ## Erststart: .env anlegen, installieren, bauen, starten, migrieren, seeden
	@[ -f .env ] || { cp .env.example .env; echo "→ .env aus .env.example erstellt — CLAUDE_CODE_OAUTH_TOKEN eintragen!"; }
	$(MAKE) init
	$(COMPOSE) build
	$(COMPOSE) up -d
	$(MAKE) wait-db
	$(MAKE) migrate
	$(MAKE) seed
	@echo "✓ Bereit — Dashboard: http://localhost:8081"

complete: ## Nach Updates: bauen, starten, migrieren, seeden (DB bleibt erhalten)
	$(COMPOSE) build
	$(COMPOSE) up -d
	$(MAKE) wait-db
	$(MAKE) migrate
	$(MAKE) seed

up: ## Stack im Hintergrund starten (db, api, web, worker)
	$(COMPOSE) up -d

down: ## Container stoppen & entfernen (Volumes/DB bleiben)
	$(COMPOSE) down

start: ## Gestoppte Container wieder starten
	$(COMPOSE) start

stop: ## Container stoppen (nicht entfernen)
	$(COMPOSE) stop

restart: ## Container neu erzeugen (DB & Images bleiben) — „normaler" Neustart
	$(COMPOSE) down
	$(COMPOSE) up -d

prod: up ## Produktions-Stack starten (Alias für up)

dev: ## Frontend lokal mit Hot-Reload (proxyt /api auf den laufenden Stack)
	API_PROXY_TARGET=http://localhost:8080 npm run dev:web

ps: ## Laufende Container auflisten
	$(COMPOSE) ps

status: ## Container-Status + Health + Docker-Disk-Verbrauch
	@$(COMPOSE) ps
	@echo
	@docker system df

##@ Build & Deploy
build: ## Alle Docker-Images neu bauen
	$(COMPOSE) build

rebuild: ## Alle Images neu bauen & starten (DB bleibt erhalten)
	$(COMPOSE) build
	$(COMPOSE) up -d

deploy: rebuild ## Alias für rebuild (Code-Stand ausrollen, DB bleibt)

deploy-web: ## Nur den Web-Container neu bauen & starten (Frontend-Änderungen)
	$(COMPOSE) build web
	$(COMPOSE) up -d web

publish: ## api/web/worker-Images bauen & pushen (IMAGE_PREFIX=user/checky TAG=1.0)
	@for svc in api web worker; do \
		img="$(IMAGE_PREFIX)-$$svc:$(TAG)"; \
		echo "→ build $$img"; docker build --target $$svc -t $$img . || exit 1; \
		echo "→ push  $$img"; docker push $$img || exit 1; \
	done

##@ Datenbank
migrate: ## DB-Migrationen ausführen (Schema anlegen/aktualisieren)
	$(COMPOSE) exec -w /app/apps/api api npm run migrate up

db-push: migrate ## Alias für migrate (DB-Schema anwenden)

seed: ## Demo-Daten einspielen (Bücher-Agent inkl. Recipe)
	$(COMPOSE) exec -w /app/apps/api api npx tsx src/db/seed.ts

seed-flights: ## Flug-Projekt aus checky-agents-seed.json importieren
	$(COMPOSE) exec -w /app/apps/api api npx tsx src/db/seed-flights.ts

db-shell: ## Interaktive PostgreSQL-Shell (psql)
	$(COMPOSE) exec db psql -U checky -d checky

shell-db: db-shell ## Alias für db-shell

db-dump: ## DB nach FILE=… sichern (Default: backups/checky-<zeit>.sql)
	@mkdir -p backups
	$(COMPOSE) exec -T db pg_dump -U checky -d checky > "$(FILE)"
	@echo "✓ Dump: $(FILE)"

db-restore: ## Dump FILE=… zurückspielen (überschreibt Daten!)
	@[ -n "$(FILE)" ] && [ -f "$(FILE)" ] || { echo "FILE=<pfad.sql> angeben (existierende Datei)"; exit 1; }
	$(COMPOSE) exec -T db psql -U checky -d checky < "$(FILE)"
	@echo "✓ Restore aus $(FILE)"

wait-db: ## Warten, bis PostgreSQL Verbindungen annimmt
	@echo "Warte auf PostgreSQL…"
	@until $(COMPOSE) exec -T db pg_isready -U checky -d checky >/dev/null 2>&1; do sleep 1; done
	@echo "PostgreSQL bereit."

##@ Reset & Wartung
reset: ## Frischer Neustart mit Rebuild — DB BLEIBT erhalten (down→build→up→migrate)
	$(COMPOSE) down --remove-orphans
	$(COMPOSE) build
	$(COMPOSE) up -d
	$(MAKE) wait-db
	$(MAKE) migrate

reset-hard: ## KOMPLETT-Reset: LÖSCHT die DB (Volume), baut & seedet neu — mit Rückfrage
	@if [ "$(FORCE)" != "1" ]; then \
		printf "\033[1;31m⚠  Dies LÖSCHT die Datenbank (Volume db_data) unwiderruflich.\033[0m\n   Wirklich fortfahren? [y/N] "; \
		read ans; case "$$ans" in [yY]) ;; *) echo "   Abgebrochen."; exit 1;; esac; \
	fi
	$(COMPOSE) down -v --remove-orphans
	$(COMPOSE) build
	$(COMPOSE) up -d
	$(MAKE) wait-db
	$(MAKE) migrate
	$(MAKE) seed
	@echo "✓ Komplett zurückgesetzt & neu geseedet."

nuke: reset-hard ## Alias für reset-hard (komplettes Zurücksetzen inkl. DB)

prune: ## Docker-Disk sicher freigeben (Build-Cache + ungenutzte Images) — NIE Volumes
	@echo "Vorher:"; docker system df | head -5
	docker builder prune -af
	docker image prune -af
	@echo "Nachher:"; docker system df | head -5
	@echo "✓ Freigegeben. Volumes unangetastet — DB ist sicher."

disk: ## Belegung der Docker-Disk zeigen — läuft sie voll, stirbt Postgres
	@docker run --rm -v checky-main_db_data:/v alpine sh -c "df -h /v | tail -2" 2>/dev/null || true
	@docker system df
	@echo "Bei >85% Belegung: 'make prune' ausführen. Postgres kann sonst nicht"
	@echo "einmal mehr seine Lock-Datei schreiben und startet in einer Schleife neu."

clean: ## Lokale Build-Artefakte + node_modules entfernen
	rm -rf node_modules apps/*/node_modules packages/*/node_modules dist apps/*/dist

##@ Betrieb & Qualität
logs: ## Alle Container-Logs folgen
	$(COMPOSE) logs -f

logs-api: ## Nur API-Logs folgen
	$(COMPOSE) logs -f api

logs-worker: ## Nur Worker-Logs folgen
	$(COMPOSE) logs -f worker

run-once: ## Einen Lauf sofort ausführen (PROFILE=<id|name>)
	$(COMPOSE) exec -e PROFILE=$(PROFILE) worker npx tsx apps/worker/src/cli.ts

recorder: ## Interaktiven Recorder anstoßen
	$(COMPOSE) exec worker echo "Playwright MCP Recorder startet..."

test: ## Unit-Tests
	npm test

e2e: ## End-to-End-Tests (Playwright, im worker-Container)
	$(COMPOSE) exec -T worker npx playwright test --config apps/worker/e2e/playwright.config.ts

lint: ## TypeScript-Typecheck über alle Pakete
	npm run lint
