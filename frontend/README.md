# BizSuit

BizSuit is a new Vue 3 + Vite + PrimeVue frontend copied from `smlstaff-ubon` and pointed at the shared `MarketPlaceWebServiceExpress` API.


cd BizSuit && npm run dist:mac

## Agent Handoff

- `AGENTS.md` contains the rules an agent should read immediately after cloning/opening this repo.
- `SKILL.md` contains the portable BizSuit frontend skill for reusing these patterns in other projects.
- Keep both files updated when architecture, sales workflow, backend-safety rules, or deployment assumptions change.

## Local Development

```bash
source "$HOME/.nvm/nvm.sh"


nvm use node
npm ci
npm run dev
```

Default local API behavior:

- `VITE_API_BASE_URL=/service/v1`
- Vite proxies `/service` to `VITE_DEV_PROXY_TARGET`, default `http://localhost:47300`.
- Do not put production credentials in this repository.

## Electron Desktop

Development desktop shell:

```bash
source "$HOME/.nvm/nvm.sh"
nvm use 20.20.0
npm run electron:dev
```

Production-style desktop shell:

```bash
source "$HOME/.nvm/nvm.sh"
nvm use 20.20.0
npm run electron:build
npm run electron:preview
npm run dist:win
npm.cmd run dist:win
```

Electron has a runtime API fallback of `http://45.122.49.250:8092/service/v1`. Windows clients can override it with a config file when the Ubuntu backend changes.

For Windows clients that connect to an Ubuntu API server, place this file next to the installed `.exe` or in Electron user data as `bizsuit-desktop.config.json`:

```json
{
  "apiBaseUrl": "http://45.122.49.250:8092/service/v1",
  "devices": {
    "printerName": "EPSON LQ-310 ESC/P2",
    "rawPrinterName": "EPSON LQ-310 ESC/P2",
    "printSilently": true,
    "dllDir": "C:\\\\smlsoft",
    "cashDrawer": {
      "mode": "usbcr",
      "dllDir": "C:\\\\smlsoft",
      "drawerId": 1
    }
  }
}
```

You can also launch Electron with `BIZSUIT_API_BASE_URL=http://45.122.49.250:8092/service/v1`.

`cashDrawer.mode` supports `usbcr`, `friusb`, `serial`, `printer`, and `command`. Posiflex USB cash drawers commonly use `usbcr.dll`; put the DLL beside the `.exe` or set `dllDir` to the folder that contains it.

## Docker

```bash
docker compose build
docker compose up -d
```

The container serves the app at `/bizsuit/` by default. The deployment reverse proxy should route `/service/*` to `MarketPlaceWebServiceExpress`.
Docker build args use `BIZSUIT_VITE_API_BASE_URL`, `BIZSUIT_VITE_BASE_PATH`, and `BIZSUIT_VITE_TIGER_MOCK` so local Vite `.env` values cannot accidentally change the production asset base.

## Full-Stack Docker

`docker-compose.fullstack.yml` runs three containers:

- `marketplace-api`: `MarketPlaceWebServiceExpress`
- `bizsuit-web`: the built BizSuit frontend
- `bizsuit-proxy`: a reverse proxy that exposes `/bizsuit/`, `/service/`, `/healthz`, and `/api-health`

Keep database credentials outside git. Use exported shell variables or a local env file based on `.env.fullstack.example`.

```bash
export DB_HOST=...
export DB_PORT=...
export DB_USER=...
export DB_PASSWORD=...
export DB_NAME=...
export DB_IMAGES_NAME=...

npm run stack:up
npm run smoke:fullstack
npm run stack:down
```

The full-stack proxy defaults to `http://127.0.0.1:8091/bizsuit/`. Set `BIZSUIT_STACK_PORT` to change the host port. Set `SMOKE_EMPLOYEE_USER` and `SMOKE_EMPLOYEE_PASSWORD` only when you want `smoke:fullstack` to verify employee login through the proxy.

`smoke:fullstack` verifies proxy health, backend health, app shell, static asset cache headers, compiled `/service/v1` API base, POS/options/doc-format APIs, optional product image delivery, and optional sale print preview. Set `SMOKE_CREATE_SALE=1` only on a demo or disposable database when you also want the smoke run to create a sale document through the proxy.

## Phase Plan

Current status:

- Phase 1 is complete.
- Phase 2 has its first implementation: selecting an active basket now opens a PC-style sale document editor with customer, sale type, VAT, salesman, product search/barcode, line table, tax summary, bill-level discount, and the existing payment/save flow.
- Phase 3 has started: barcode entry now supports direct Enter-to-add, quantity prefixes such as `3*barcode`, automatic refocus for scanner use, price retry, and validation guards before payment.
- Phase 4 has started: shared BizSuit page/header/panel/table/empty-state styles are applied to dashboard, sales history, inventory, product management, sold-out, and permission management.
- Verification pass fixed scanner/unit logic, repeated-scan stock checks, basket-scoped done state, line remark save, local sale date, and mobile table overflow.
- Phase 5 has started: demo sale regression and Docker smoke scripts are available, key UI selectors have stable `data-testid` hooks, and service-item stock validation is covered through the shared backend.
- Phase 6 has started: full-stack Docker compose is available with a shared reverse proxy and smoke checks for app shell, static asset cache headers, backend health, API proxy, optional product image/print preview, optional employee login, and opt-in sale-create regression.

### Phase 1 - Project Foundation

- Create isolated `BizSuit` frontend from `smlstaff-ubon`.
- Rename package, browser title, session storage keys, Docker path, and nginx path.
- Add shared app/navigation config so future screens do not duplicate menu definitions.
- Keep API usage compatible with `MarketPlaceWebServiceExpress` and avoid backend changes.

### Phase 2 - PC Sales Editor

- Redesign the sale screen to follow the UX pattern of `สร้าง PU`.
- Keep basket/POS/customer behavior from `smlstaff-ubon`, but present the working area as a PC-first document editor.
- Use one dense document screen for header, customer, product search/barcode, line table, totals, tax detail, and action footer.
- Keep the existing bill-level discount calculation from `CartPriceCheckStep.vue` and expose it directly in the editor summary.
- Preserve save/payment/print behavior and only add backend endpoints if existing endpoints cannot support the new UI safely.

### Phase 3 - Sales Polish And Workflow

- Improve keyboard flow for barcode-heavy PC use.
- Add better empty, loading, and error states.
- Verify price refresh, zero-price confirmation, service-item rules, VAT, line discounts, and bill discounts.
- Compare saved payloads with current `smlstaff-ubon` behavior before production use.

### Phase 4 - Other BizSuit Screens

- Refresh dashboard, sales history, inventory, sold-out, product management, permission management, and receipt views with the same design language.
- Keep route permissions and shared API contracts stable.

### Phase 5 - Deployment Hardening

- Add production reverse-proxy notes for `/bizsuit/` and `/service/`.
- Validate Docker image build, static asset caching, health check, and environment-specific API base URL.
- Add smoke tests for login, POS selection, sale create, sale print preview, and product image loading.

### Phase 6 - Full-Stack Release Candidate

- Provide a reproducible local deployment stack for BizSuit and `MarketPlaceWebServiceExpress`.
- Route both frontend and API through one nginx reverse proxy.
- Keep all DB credentials and employee test credentials in runtime environment variables only.
- Add a smoke test that verifies proxy health, backend health, BizSuit shell, API access, and optional employee-only login.

Current smoke commands:

```bash
npm run test:demo-sale
npm run test:sale-total-mismatch
npm run test:sale-all
npm run smoke:docker
npm run smoke:fullstack
SMOKE_CREATE_SALE=1 npm run smoke:fullstack
```

Sale regression scripts expect `BASE_URL` to point at a running `MarketPlaceWebServiceExpress` service. Keep database credentials in the backend process environment only, not in repo files.
The scripts create sale documents, so run them only against a demo or disposable database.
`smoke:fullstack` starts the full compose stack and removes it when the run completes unless `KEEP_DOCKER_SMOKE=1` is set.
