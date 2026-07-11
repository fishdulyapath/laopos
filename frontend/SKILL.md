---
name: bizsuit-frontend
description: Use when building or modifying BizSuit-style Vue 3 + PrimeVue ERP frontends that connect to MarketPlaceWebServiceExpress or a compatible /service/v1 backend.
---

# BizSuit Frontend Skill

Use this skill when creating, extending, or porting a BizSuit-style ERP frontend.
The goal is a PC-first business application with dense, clear workflows, PrimeVue controls, Docker deployment, and minimal coupling to shared backend services.

## Scope

- Frontend stack: Vue 3, Vite, PrimeVue, Pinia, Axios.
- Primary API base path: `/service/v1`.
- Shared service: `MarketPlaceWebServiceExpress`.
- UI target: desktop PC first, with responsive fallbacks.
- Deployment: Docker and nginx serving the built Vite app.

## Working Rules

- Do not store credentials, passwords, production connection strings, or `.env` secrets in repo files.
- Keep backend changes additive when the backend is shared by multiple projects.
- Do not change behavior of existing shared endpoints unless the change is proven not to affect other projects.
- Prefer adding new endpoints over changing old endpoint contracts.
- For current sales parity work, treat `POST /saveTrans` as frozen contract.
- Implement and extend sales persistence on `POST /saveTransAndPro`.
- Use existing service modules under `src/services` instead of calling Axios directly in views, unless a local pattern already does so.
- Use `rg` for search and keep edits scoped.
- Use `apply_patch` for manual file edits.
- Before finalizing frontend changes, run:

```bash
npm run build
```

## Frontend Architecture

- `src/views` owns page-level workflows.
- `src/components` owns reusable UI and focused workflow sections.
- `src/services` owns API calls and response normalization.
- `src/stores` owns app/session state such as auth and selected POS.
- `src/utils` owns pure helpers such as formatting, discount math, image URLs, permissions, and session storage.
- Keep business calculations in reusable helpers when they are shared by multiple pages.
- Keep page-local draft state in the page when the workflow is one document screen.

## UI Principles

- Build the actual work screen first, not a landing page.
- For ERP screens, prefer dense but readable panels over marketing-style hero layouts.
- Use PrimeVue controls consistently:
  - `Select` for option sets.
  - `InputNumber` for numeric values.
  - `InputText` for short text/search/barcode fields.
  - `Textarea` for remarks.
  - `Dialog` for focused selection/confirmation.
  - `Message` for validation and status feedback.
- Use `minmax(0, 1fr)`, `min-width: 0`, and ellipsis to prevent horizontal overflow.
- Prefer PrimeFlex utility/grid classes for layout, spacing, and responsive columns before adding scoped CSS; use custom CSS only when PrimeFlex does not cover the needed behavior cleanly.
- PC screens may scroll vertically, but should not expand sideways beyond the viewport.
- Table-like ERP entry screens should keep summary/action panels visible on desktop when practical.

## Auth And POS

- BizSuit login is employee-only.
- Preserve selected POS behavior through the POS store.
- Read branch, warehouse, shelf, and default document context from the selected POS when available.
- Permission checks should use `src/utils/permissions.js` and the auth store.

## Sales Document Rules

- Sale screen code is `SI`.
- Document format must come from `erp_doc_format` through backend APIs such as `getSaleDocFormatList`.
- Do not derive sale `doc_no` or `doc_format_code` from POS text when the user selected a document format.
- The selected `doc_format_code` controls generated document number and print forms.
- `SellView` should save through `saveTransAndPro` for detailed sale flow.
- Keep quick-sale and existing shared consumers that still use `saveTrans` unchanged unless explicitly requested.
- Sale save should pass `doc_format_code`, `form_code`, POS context, customer, salesperson, VAT settings, bill discount, payment totals, and line items explicitly.
- For current backend parity, include and preserve these header fields in payload and DB round-trip when available:
  - `doc_group`, `side_code`, `department_code`, `allocate_code`, `project_code`, `job_code`
  - `contactor`, `doc_ref`, `doc_ref_date`, `sale_group`, `cashier_code`
- Product price depends on customer, sale type, VAT type/rate, item unit, and quantity.
- Refresh product prices after any price-affecting field changes:
  - customer
  - sale type
  - VAT type
  - VAT rate
  - line quantity
- Service items use `item_type = 1` and must not be blocked by stock-balance rules.

## One-Page ERP Entry Pattern

For ERP document screens such as sales or purchase entry:

- Keep document header, customer/supplier, item lines, totals, and payment in one workflow.
- Store the active draft in local page state unless multi-device cart collaboration is explicitly required.
- Avoid using cart/basket tables for normal ERP entry screens.
- Search and barcode add should append directly to the document draft.
- Recalculate totals locally after every line, discount, tax, or payment change.
- Block save while price refresh or required validation is incomplete.
- After save, show the generated document number and offer print-form selection.

## Images And Ngrok

- Product images should use helpers from `src/utils/imageUrls.js`.
- Image URLs for ngrok should include `ngrok-skip-browser-warning=1`.
- Add cache-busting when stale image behavior is likely.

## Docker

- Keep frontend runtime Docker images static and small.
- Build with Vite, serve `dist` through nginx.
- Route `/service` to the backend service when using a full-stack compose setup.
- Keep environment examples free of real secrets.

## Verification Checklist

- `npm run build` passes.
- Focused sales regressions pass:
  - `npm run test:demo-sale`
  - `npm run test:set-product`
  - `npm run test:phase1-payment`
  - `npm run test:sale-credit`
  - `npm run test:sell-detail`
  - `npm run test:sale-all` (single-command suite runner)
- The changed screen renders in browser.
- No horizontal overflow on desktop viewport.
- Core workflow can be exercised with demo data.
- Shared backend endpoint behavior is unchanged unless explicitly approved.
- No credentials or generated local secrets were added to git.
