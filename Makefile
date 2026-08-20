# CaféVision — Comandos de operación
# ----------------------------------------------------
.DEFAULT_GOAL := help
SHELL := /bin/bash

COMPOSE := docker compose
BACKEND := cafevision-backend
DB      := cafevision-postgres

.PHONY: help
help:               ## Lista comandos disponibles
	@awk 'BEGIN {FS = ":.*##"} /^[a-zA-Z_-]+:.*##/ {printf "  \033[36m%-18s\033[0m %s\n", $$1, $$2}' $(MAKEFILE_LIST)

.PHONY: keys
keys:               ## Genera par RS256 para JWT
	@chmod +x ./scripts/generate-keys.sh
	@./scripts/generate-keys.sh

.PHONY: dev
dev: keys           ## Levanta toda la infraestructura en modo desarrollo
	$(COMPOSE) up -d

.PHONY: dev-build
dev-build: keys     ## Reconstruye imágenes y levanta
	$(COMPOSE) up -d --build

.PHONY: down
down:               ## Detiene todos los servicios
	$(COMPOSE) down

.PHONY: clean
clean:              ## Detiene servicios y borra volúmenes (DESTRUCTIVO)
	$(COMPOSE) down -v

.PHONY: logs
logs:               ## Sigue los logs de todos los servicios
	$(COMPOSE) logs -f --tail=100

.PHONY: logs-backend
logs-backend:       ## Logs solo del backend
	$(COMPOSE) logs -f --tail=200 backend

.PHONY: migrate
migrate:            ## Ejecuta migraciones SQL manualmente (backend lo hace al iniciar)
	$(COMPOSE) exec backend npm run migrate

.PHONY: migrate-down
migrate-down:       ## Rollback de la última migración
	$(COMPOSE) exec backend npm run migrate:down

.PHONY: shell-db
shell-db:           ## Shell psql contra postgres
	$(COMPOSE) exec postgres psql -U cafevision -d cafevision

.PHONY: shell-backend
shell-backend:      ## Shell bash dentro del backend
	$(COMPOSE) exec backend sh

.PHONY: pull-mistral
pull-mistral:       ## Descarga el modelo Mistral en Ollama
	$(COMPOSE) exec ollama ollama pull mistral:7b-instruct

.PHONY: ps
ps:                 ## Estado de los contenedores
	$(COMPOSE) ps

.PHONY: build-android
build-android:      ## Build APK Android via Capacitor (frontend)
	cd Cereza/FrontEnd && npm run build && npx cap sync android && cd android && ./gradlew assembleRelease

.PHONY: prod
prod:               ## Levanta en modo producción (requiere docker-compose.prod.yml)
	$(COMPOSE) -f docker-compose.yml -f docker-compose.prod.yml up -d --build
