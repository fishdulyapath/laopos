# BizSuit Agent Rules

Before searching, analyzing, editing, debugging, or planning changes in this repository, read and apply:

- `SKILL.md`

This repository is intended to be portable to another machine. Agents should be able to understand the project rules from this file plus `SKILL.md` without relying on local-only notes.

## Project Summary

- BizSuit is a Vue 3 + Vite + PrimeVue ERP frontend.
- API base path is `/service/v1`.
- The backend is the shared `MarketPlaceWebServiceExpress` service.
- UI is PC-first and should avoid horizontal overflow.
- Deployment uses Docker/nginx.

## Hard Rules

- Do not commit `.env` secrets, production credentials, employee passwords, DB passwords, or local runtime config.
- Do not change existing shared backend endpoint behavior in ways that can affect other projects.
- Prefer frontend-only changes when possible.
- If backend support is required, prefer additive endpoints over changing existing endpoint contracts.
- Keep changes scoped to the requested workflow.
- Use PrimeVue controls and existing app patterns.
- For layout and spacing, always use PrimeFlex utility/grid classes first (`grid`, `formgrid`, `col-*`, spacing utilities, flex utilities). Add scoped/custom CSS only when PrimeFlex cannot express the required behavior cleanly.

## Sales Screen Rules

- The sales screen is an ERP document entry screen, not a cart/basket helper.
- Do not reintroduce the basket/cart workflow for normal sale entry.
- Sale document data should be entered in one page: header, customer, salesperson, item lines, totals, bill discount, and payment.
- Product prices must refresh after changes to customer, sale type, VAT type, VAT rate, and line quantity.
- Service items (`item_type = 1`) must not be blocked by stock-balance rules.
- Sale document format for screen `SI` must come from backend document-format data.

## Verification

Before finalizing frontend work, run:

```bash
source "$HOME/.nvm/nvm.sh"
nvm use node
npm run build
```

For UI changes, verify the relevant screen in a browser when practical.

## Git

- Keep repo portable and clean.
- Do not commit generated secrets or local-only files.
- If asked to push, commit only the relevant files and push to the current branch.
