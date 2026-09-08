# docs/enrichment — Public Lead Enrichment Agent

Reference implementation for the public-business-contact enrichment pipeline.
**Nothing here is on a runtime path.** Files mirror their destination paths so
each one can be moved with a single `mv` once you've reviewed it.

Start with `IMPLEMENTATION_PLAN.md`.

## Destination map

| Here | Destination |
|---|---|
| `migration/00000000000020_enrichment_runs.sql` | `supabase/migrations/` |
| `scraper/src/lib/ssrf.ts` | `scraper/src/lib/` |
| `scraper/src/lib/browser.ts` | `scraper/src/lib/` |
| `scraper/src/handlers/enrich.ts` | `scraper/src/handlers/` |
| `scraper/server.patch.ts` | apply by hand to `scraper/src/server.ts` |
| `scraper/Dockerfile` | replaces `scraper/Dockerfile` |
| `scraper/railway.json` | `scraper/` |
| `lib/enrichment/*.ts` | `lib/enrichment/` |
| `inngest/functions/enrich-prospect.ts` | `inngest/functions/` |
| `app/api/prospects/[id]/enrich/route.ts` | `app/api/prospects/[id]/enrich/` |
| `tests/enrichment-validator.test.ts` | `tests/` |

Also required, not included as files (one-line edits):
- register `enrichProspectFunction` in `app/api/inngest/route.ts`
- extend `lib/dpdp.ts:eraseContact` to clear `public_contacts` / `phone_e164` / `phone_source`
- resolve the `PYTHON_BACKEND_URL` rewrite question — see Phase 0

## Verified

- `node --test --experimental-strip-types tests/enrichment-validator.test.ts` → 18/18 pass
- `tsc --noEmit` against the repo's real tsconfig + real `lib/` modules → clean
- `tsc --noEmit` against `scraper/tsconfig.json` → clean
- migration parsed with libpg_query → 18 valid statements

## New dependencies

```bash
npm install openai@^7.10.0 libphonenumber-js@^1.13.12
cd scraper && npm install   # generates the missing package-lock.json
```

Note: `validator.ts` imports `libphonenumber-js/max`, not the bare package.
The default build ships "min" metadata where `getType()` returns `undefined`
for every number.
