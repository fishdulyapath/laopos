# BizSuit Ubuntu Deployment

This deploys the full stack on one Ubuntu server using Docker Hub images:

- `bizsuit-api`: `minorsoft/bizsuit-api:latest` on the internal Docker network.
- `bizsuit-app`: `minorsoft/bizsuit-app:latest` served at `/bizsuit/`.
- `nginx`: public nginx proxy exposing `/bizsuit/`, `/service/`, `/healthz`, and `/api-health`.

Keep real database credentials on the server only.

## Server Prerequisites

Ubuntu 22.04 or newer is recommended.

```bash
sudo bash BizSuit/deploy/ubuntu/install-docker.sh
sudo usermod -aG docker "$USER"
```

Log out and back in after adding the user to the `docker` group.

## Directory Layout

Only the deploy files are required on the Ubuntu server when you use prebuilt images. A simple layout is:

```text
/opt/bizs/
  BizSuit/
```

Example:

```bash
sudo mkdir -p /opt/bizs
sudo chown -R "$USER":"$USER" /opt/bizs
cd /opt/bizs
git clone <bizsuit-repo-url> BizSuit
```

If you copy files instead of using git, keep the `BizSuit/deploy/ubuntu/` folder structure.

## Environment File

```bash
cd /opt/bizs/BizSuit
cp deploy/ubuntu/env.production.example .env.production
nano .env.production
chmod 600 .env.production
```

Important values:

- `BIZSUIT_STACK_PORT=8081` keeps the app behind an existing host nginx or firewall rule.
- Use `BIZSUIT_STACK_PORT=80` only when Docker should bind directly to public HTTP.
- `DB_HOST` must be reachable from inside the Docker container. If PostgreSQL runs on the same Ubuntu host, use `host.docker.internal`, already wired through Docker host gateway in the compose file.
- `BIZSUIT_API_IMAGE` defaults to `minorsoft/bizsuit-api:latest`.
- `BIZSUIT_APP_IMAGE` defaults to `minorsoft/bizsuit-app:latest`.

## Deploy Or Update

```bash
cd /opt/bizs/BizSuit
bash deploy/ubuntu/deploy.sh
```

The script validates required env values, pulls both images, starts the stack, and prints container status.

## Build And Push Images

Run this from a machine that has both folders side by side:

```text
bizs/
  BizSuit/
  MarketPlaceWebServiceExpress/
```

Login to Docker Hub first:

```bash
docker login
```

Build and push the default `latest` images for Ubuntu:

```bash
cd BizSuit
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
docker exec -u root bizsuit-api chown -R node:node /app/uploads/customer-display
Defaults:

- API image: `minorsoft/bizsuit-api`
- App image: `minorsoft/bizsuit-app`
- Platform: `linux/amd64`
- App path: `/bizsuit/`
- API base: `/service/v1`

Override when needed:

```bash
PLATFORMS=linux/amd64,linux/arm64 \
VITE_BASE_PATH=/bizsuit/ \
VITE_API_BASE_URL=/service/v1 \
bash deploy/ubuntu/build-and-push-images.sh 2026.05.13
```

## Smoke Test

```bash
cd /opt/bizs/BizSuit
bash deploy/ubuntu/smoke.sh
```

Expected checks:

- proxy health
- backend health through proxy
- BizSuit app shell
- `/service/v1/getPOSList`
- optional employee login if `SMOKE_EMPLOYEE_USER` and `SMOKE_EMPLOYEE_PASSWORD` are set

## Enable Auto Start

Edit `deploy/ubuntu/bizsuit-stack.service` if your deploy path is not `/opt/bizs/BizSuit`, then:

```bash
sudo cp deploy/ubuntu/bizsuit-stack.service /etc/systemd/system/bizsuit-stack.service
sudo systemctl daemon-reload
sudo systemctl enable bizsuit-stack
sudo systemctl start bizsuit-stack
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

- App: `http://SERVER_IP:8081/bizsuit/`
- API health: `http://SERVER_IP:8081/api-health`
- API base: `http://SERVER_IP:8081/service/v1`

For HTTPS, terminate TLS in a host reverse proxy or load balancer and forward to `127.0.0.1:8081`.
