COMPOSE ?= docker compose

.DEFAULT_GOAL := help

help: ## Zeigt diese Hilfe an
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | sort | awk 'BEGIN {FS = ":.*?## "}; {printf "\033[36m%-15s\033[0m %s\n", $$1, $$2}'

init: ## Installiert lokale Abhängigkeiten
	npm install

build: ## Baut alle Docker-Images neu
	$(COMPOSE) build

up: ## Startet die gesamte Betriebs-Basis im Hintergrund
	$(COMPOSE) up -d

down: ## Stoppt und entfernt alle Container
	$(COMPOSE) down

reset: ## Löscht alle Container, Volumes und baut frisch auf
	$(COMPOSE) down -v --remove-orphans
	$(COMPOSE) build
	$(COMPOSE) up -d

logs: ## Zeigt alle Container-Logs (follow)
	$(COMPOSE) logs -f

logs-worker: ## Zeigt ausschließlich die Worker-Logs (follow)
	$(COMPOSE) logs -f worker

ps: ## Listet alle laufenden Container auf
	$(COMPOSE) ps

migrate: ## Führt die DB-Migrationen aus
	$(COMPOSE) exec api npm run migrate up

seed: ## Füllt die Datenbank mit Initialdaten
	$(COMPOSE) exec api npx tsx src/db/seed.ts

db-shell: ## Öffnet eine interaktive PostgreSQL-Shell
	$(COMPOSE) exec db psql -U checky -d checky

run-once: ## Startet einen manuellen, einmaligen Worker-Durchlauf
	$(COMPOSE) exec -e PROFILE=$(PROFILE) worker npx tsx apps/worker/src/cli.ts

recorder: ## Startet den interaktiven Recorder
	$(COMPOSE) exec worker echo "Playwright MCP Recorder startet..."

test: ## Führt die Unit-Tests aus
	npm test

e2e: ## Führt End-to-End-Tests aus
	npm run test:e2e

lint: ## Führt den Linter über das Projekt aus
	npm run lint

clean: ## Entfernt alle Build-Artefakte und node_modules
	rm -rf node_modules apps/*/node_modules packages/*/node_modules dist
