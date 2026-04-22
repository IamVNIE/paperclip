# Paperclip VPS deployment — operator Makefile.
#
# Usage:
#   make help          # list targets
#   make up            # build + start
#   make down          # stop + remove containers
#   make logs          # tail app logs
#   make update        # git pull + rebuild + restart
#
# Runs from this directory: /home/ec2-user/paperclip/deploy/vps/
# Reads env from ./.env (copy .env.example).
#
# Caddy is managed outside this Makefile. See paperclip.caddyfile for the
# site-block snippet to drop into /etc/caddy/Caddyfile.d/ manually.

SHELL        := /bin/bash
COMPOSE      := docker compose
COMPOSE_FILE := compose.yml
ENV_FILE     := .env
APP          := paperclip
REPO_ROOT    := $(abspath ../..)
PUBLIC_URL   := $(shell grep -E '^PAPERCLIP_PUBLIC_URL=' $(ENV_FILE) 2>/dev/null | cut -d= -f2-)
DATA_DIR     := $(shell grep -E '^PAPERCLIP_DATA_DIR=' $(ENV_FILE) 2>/dev/null | cut -d= -f2-)

.DEFAULT_GOAL := help

# ---------------------------------------------------------------- housekeeping

.PHONY: help
help: ## Show this help
	@awk 'BEGIN {FS = ":.*##"; printf "\nTargets:\n"} \
	      /^[a-zA-Z_-]+:.*?##/ { printf "  \033[36m%-16s\033[0m %s\n", $$1, $$2 }' $(MAKEFILE_LIST)

.PHONY: check-env
check-env: ## Verify .env exists and has required keys
	@test -f $(ENV_FILE) || { echo "ERROR: $(ENV_FILE) missing. cp .env.example .env"; exit 1; }
	@for k in PAPERCLIP_PUBLIC_URL DATABASE_URL BETTER_AUTH_SECRET PAPERCLIP_SECRETS_MASTER_KEY PAPERCLIP_DATA_DIR; do \
	  grep -qE "^$$k=.+" $(ENV_FILE) || { echo "ERROR: $$k missing or empty in $(ENV_FILE)"; exit 1; }; \
	done

.PHONY: ensure-data-dir
ensure-data-dir: check-env ## Create PAPERCLIP_DATA_DIR if missing
	@test -n "$(DATA_DIR)" || { echo "ERROR: could not read PAPERCLIP_DATA_DIR from $(ENV_FILE)"; exit 1; }
	@mkdir -p "$(DATA_DIR)"
	@echo "data dir: $(DATA_DIR)"

.PHONY: config
config: check-env ## Validate compose config (render effective YAML)
	$(COMPOSE) -f $(COMPOSE_FILE) config

# ---------------------------------------------------------------- lifecycle

.PHONY: build
build: check-env ## Build the app image without starting
	$(COMPOSE) -f $(COMPOSE_FILE) build paperclip

.PHONY: up deploy
up deploy: check-env ensure-data-dir ## Build (if needed) and start the app detached
	$(COMPOSE) -f $(COMPOSE_FILE) up -d --build --remove-orphans
	@echo
	@echo "App is up. Waiting for healthcheck..."
	@$(MAKE) --no-print-directory wait-healthy

.PHONY: down
down: ## Stop and remove the app container (volume preserved)
	$(COMPOSE) -f $(COMPOSE_FILE) down --remove-orphans

.PHONY: restart
restart: ## Restart the app in place (no rebuild)
	$(COMPOSE) -f $(COMPOSE_FILE) restart

.PHONY: stop
stop: ## Stop the app without removing the container
	$(COMPOSE) -f $(COMPOSE_FILE) stop

.PHONY: start
start: ## Start the previously-stopped container
	$(COMPOSE) -f $(COMPOSE_FILE) start

.PHONY: recreate
recreate: check-env ensure-data-dir ## Force recreate container (picks up env changes without rebuild)
	$(COMPOSE) -f $(COMPOSE_FILE) up -d --force-recreate --no-build

# ---------------------------------------------------------------- updates

.PHONY: pull-src
pull-src: ## git pull the repo checkout (no deploy)
	git -C $(REPO_ROOT) pull --ff-only

.PHONY: update
update: pull-src up ## git pull + rebuild + restart

# ---------------------------------------------------------------- observability

.PHONY: ps status
ps status: ## Show container state and health
	$(COMPOSE) -f $(COMPOSE_FILE) ps

.PHONY: logs
logs: ## Tail app logs (Ctrl-C to exit)
	$(COMPOSE) -f $(COMPOSE_FILE) logs -f --tail=200 $(APP)

.PHONY: health
health: ## Curl the public health endpoint (through the reverse proxy)
	@test -n "$(PUBLIC_URL)" || { echo "ERROR: PAPERCLIP_PUBLIC_URL not set in $(ENV_FILE)"; exit 1; }
	@echo "GET $(PUBLIC_URL)/health"
	@curl -fsS "$(PUBLIC_URL)/health" | (jq . 2>/dev/null || cat)

.PHONY: health-local
health-local: ## Curl the app directly on loopback
	@curl -fsS http://127.0.0.1:3100/health | (jq . 2>/dev/null || cat)

.PHONY: wait-healthy
wait-healthy: ## Block until app container reports healthy (2 min timeout)
	@cid=$$($(COMPOSE) -f $(COMPOSE_FILE) ps -q $(APP)); \
	 test -n "$$cid" || { echo "ERROR: $(APP) container not running"; exit 1; }; \
	 for i in $$(seq 1 60); do \
	   s=$$(docker inspect -f '{{.State.Health.Status}}' $$cid 2>/dev/null); \
	   case "$$s" in \
	     healthy)   echo "  healthy"; exit 0;; \
	     unhealthy) echo "  unhealthy — check 'make logs'"; exit 1;; \
	     *)         printf "."; sleep 2;; \
	   esac; \
	 done; \
	 echo " timed out after 120s"; exit 1

# ---------------------------------------------------------------- debugging

.PHONY: shell
shell: ## Interactive shell in the app container
	$(COMPOSE) -f $(COMPOSE_FILE) exec $(APP) bash || \
	$(COMPOSE) -f $(COMPOSE_FILE) exec $(APP) sh

.PHONY: db-ping
db-ping: ## Verify the app can reach Neon
	$(COMPOSE) -f $(COMPOSE_FILE) exec $(APP) node -e "\
	  const p = require('postgres'); \
	  const sql = p(process.env.DATABASE_URL, { ssl: 'require', max: 1 }); \
	  sql\`select 1 as ok\`.then(r => { console.log('db:', r[0]); return sql.end(); }) \
	    .catch(e => { console.error('db error:', e.message); process.exit(1); });"

# ---------------------------------------------------------------- danger zone

.PHONY: prune
prune: ## Remove stopped containers and dangling images (keeps volumes)
	docker container prune -f
	docker image prune -f

.PHONY: nuke-data
nuke-data: check-env ## DESTRUCTIVE: delete the PAPERCLIP_DATA_DIR bind mount contents
	@test -n "$(DATA_DIR)" || { echo "ERROR: PAPERCLIP_DATA_DIR not set"; exit 1; }
	@echo "About to recursively delete: $(DATA_DIR)"
	@echo "This removes the secrets master key — stored agent API keys become unrecoverable."
	@read -p "Type 'yes' to confirm: " c; \
	 [ "$$c" = "yes" ] || { echo "aborted"; exit 1; }
	$(COMPOSE) -f $(COMPOSE_FILE) down --remove-orphans
	rm -rf "$(DATA_DIR)"
