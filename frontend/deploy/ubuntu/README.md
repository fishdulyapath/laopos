# NextStep POS Ubuntu Deployment

This deploys the full stack on one Ubuntu server using Docker Hub images:

- `laoposservice`: `minorsoft/laoposservice:latest` on the internal Docker network.
- `laoposweb`: `minorsoft/laoposweb:latest` served at `/laopos/`.
- `nginx`: public nginx proxy exposing `/laopos/`, `/service/`, `/healthz`, and `/api-health`.

Keep real database credentials on the server only.

## Server Prerequisites

Ubuntu 22.04 or newer is recommended.

```bash
sudo bash frontend/deploy/ubuntu/install-docker.sh
sudo usermod -aG docker "$USER"
```

Log out and back in after adding the user to the `docker` group.

## Directory Layout

Only the deploy files are required on the Ubuntu server when you use prebuilt images. A simple layout is:

```text
/opt/laopos/
  backend/
  frontend/
```

Example:

```bash
sudo mkdir -p /opt/laopos
sudo chown -R "$USER":"$USER" /opt/laopos
cd /opt
git clone <laopos-repo-url> laopos
```

If you copy files instead of using git, keep the `frontend/deploy/ubuntu/` folder structure.

## Environment File

```bash
cd /opt/laopos/frontend
cp deploy/ubuntu/env.production.example .env.production
nano .env.production
chmod 600 .env.production
```

Important values:

- `LAOPOS_STACK_PORT=8081` keeps the app behind an existing host nginx or firewall rule.
- Use `LAOPOS_STACK_PORT=80` only when Docker should bind directly to public HTTP.
- `DB_HOST` must be reachable from inside the Docker container. If PostgreSQL runs on the same Ubuntu host, use `host.docker.internal`, already wired through Docker host gateway in the compose file.
- `LAOPOS_SERVICE_IMAGE` defaults to `minorsoft/laoposservice:latest`.
- `LAOPOS_WEB_IMAGE` defaults to `minorsoft/laoposweb:latest`.

## Deploy Or Update

```bash
cd /opt/laopos/frontend
bash deploy/ubuntu/deploy.sh
```

The script validates required env values, pulls both images, starts the stack, and prints container status.

## Build And Push Images

Run this from the cloned repository:

```text
laopos/
  backend/
  frontend/
```

Login to Docker Hub first:

```bash
docker login
```

Build and push the default `latest` images for Ubuntu:

```bash
cd /opt/laopos/frontend
bash deploy/ubuntu/build-and-push-images.sh
```

Build and push a version tag:

```bash
IMAGE_TAG=2026.05.13 bash deploy/ubuntu/build-and-push-images.sh
```

Also update `latest` while pushing a version tag:

```bash
IMAGE_TAG=2026.05.13 PUSH_LATEST=1 bash deploy/ubuntu/build-and-push-images.sh
```
docker exec -u root laoposservice chown -R node:node /app/uploads/customer-display
Defaults:

- API image: `minorsoft/laoposservice`
- App image: `minorsoft/laoposweb`
- Platform: `linux/amd64`
- App path: `/laopos/`
- API base: `/service/v1`

Override when needed:

```bash
PLATFORMS=linux/amd64,linux/arm64 \
VITE_BASE_PATH=/laopos/ \
VITE_API_BASE_URL=/service/v1 \
bash deploy/ubuntu/build-and-push-images.sh 2026.05.13
```

## Smoke Test

```bash
cd /opt/laopos/frontend
bash deploy/ubuntu/smoke.sh
```

Expected checks:

- proxy health
- backend health through proxy
- NextStep POS app shell
- `/service/v1/getPOSList`
- optional employee login if `SMOKE_EMPLOYEE_USER` and `SMOKE_EMPLOYEE_PASSWORD` are set

## Enable Auto Start

Edit `deploy/ubuntu/laopos-stack.service` if your deploy path is not `/opt/laopos/frontend`, then:

```bash
sudo cp deploy/ubuntu/laopos-stack.service /etc/systemd/system/laopos-stack.service
sudo systemctl daemon-reload
sudo systemctl enable laopos-stack
sudo systemctl start laopos-stack
```

## Useful Operations

```bash
docker compose --env-file .env.production -f deploy/ubuntu/docker-compose.images.yml ps
docker compose --env-file .env.production -f deploy/ubuntu/docker-compose.images.yml logs -f
docker compose --env-file .env.production -f deploy/ubuntu/docker-compose.images.yml pull
docker compose --env-file .env.production -f deploy/ubuntu/docker-compose.images.yml down
```

## Public URLs

With the default port:

- App: `http://SERVER_IP:8081/laopos/`
- API health: `http://SERVER_IP:8081/api-health`
- API base: `http://SERVER_IP:8081/service/v1`

For HTTPS, terminate TLS in a host reverse proxy or load balancer and forward to `127.0.0.1:8081`.
