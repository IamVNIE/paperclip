# VPS deployment

Docker Compose stack for running Paperclip on a VPS that already has
Docker, Caddy, and network/DNS in place. A `Makefile` drives lifecycle — no
auto-start, no systemd unit.

- App runs in Docker, built from this checkout
- Published to `127.0.0.1:3100` only — host Caddy reverse-proxies to it
- DB is Neon (external); `DATABASE_URL` comes from `.env`

---

## 1. `.env`

```sh
cd /home/ec2-user/paperclip/deploy/vps
cp .env.example .env
```

Fill in the required values:

| Key | How to generate |
|---|---|
| `PAPERCLIP_PUBLIC_URL` | `https://qb-pp-agents.dev.qwikbuild.com` |
| `DATABASE_URL`         | Neon **pooler** connection string, `sslmode=require` |
| `BETTER_AUTH_SECRET`   | `openssl rand -base64 48` |
| `PAPERCLIP_SECRETS_MASTER_KEY` | `openssl rand -base64 32` |
| `PAPERCLIP_DATA_DIR`   | Host directory for `/paperclip` (e.g. `/home/ec2-user/paperclip-data`) |

Compose auto-loads `.env` from this directory. `make up` creates
`PAPERCLIP_DATA_DIR` if it doesn't exist.

---

## 2. Install the Caddyfile

The `Caddyfile` in this directory is the source of truth:

```sh
make caddy-install   # copies to /etc/caddy/Caddyfile, validates, reloads
```

---

## 3. Bring the app up

```sh
make up              # build + start + wait for healthy
make health          # curl https://.../health via Caddy
make health-local    # curl 127.0.0.1:3100/health (bypasses Caddy)
```

---

## 4. Make targets

| Command | What it does |
|---|---|
| `make up`            | Build + start detached + wait for healthcheck |
| `make down`          | Stop + remove app container (volume preserved) |
| `make restart`       | Restart the app in place |
| `make recreate`      | Recreate container without rebuild (picks up `.env` changes) |
| `make stop` / `start`| Pause / resume without removing the container |
| `make logs`          | Tail app logs |
| `make logs-caddy`    | Tail host Caddy logs (journald) |
| `make ps`            | Container state + health |
| `make health`        | Public `/health` via Caddy |
| `make health-local`  | Loopback `/health` directly |
| `make shell`         | Shell into the app container |
| `make db-ping`       | Verify the app can reach Neon |
| `make caddy-install` | Copy `./Caddyfile` → `/etc/caddy/Caddyfile`, validate, reload |
| `make caddy-validate`| Validate local `Caddyfile` without installing |
| `make caddy-reload`  | Reload host Caddy |
| `make caddy-status`  | Host Caddy systemd status |
| `make config`        | Render effective compose config |
| `make update`        | `git pull` + rebuild + restart |
| `make prune`         | Clean stopped containers + dangling images |
| `make nuke-data`     | **Destructive**: `rm -rf` `PAPERCLIP_DATA_DIR` (prompts) |

---

## 5. Updates

```sh
cd /home/ec2-user/paperclip && git fetch && git checkout <tag>
cd deploy/vps && make update
```

If the `Caddyfile` changed, also run `make caddy-install`.

After a reboot: nothing auto-starts. Run `make up`.

---

## 6. Data directory

`PAPERCLIP_DATA_DIR` on the host is bind-mounted to `/paperclip` in the
container. It holds the secrets master key file, agent workspaces, and
uploaded assets. Losing it means losing the ability to decrypt stored agent
API keys — **back it up**.

Because it's a bind mount, `docker compose down -v` does **not** delete it.
Only `make nuke-data` (with confirmation) will.

Back up to S3 on a cron:

```sh
# /etc/cron.daily/paperclip-backup
aws s3 sync "$PAPERCLIP_DATA_DIR" "s3://<bucket>/paperclip-data/$(date +%F)/"
```
