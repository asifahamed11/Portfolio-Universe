# Portfolio Universe

A curated, searchable directory of developer portfolios built with Astro, React, Firebase Authentication, and Firestore. The site is deployed to GitHub Pages.

## Features

- Search and filter validated developer portfolios.
- Show AI-generated roles, summaries, technology tags, and availability.
- Save private per-user bookmarks with Google or GitHub authentication.
- Accept authenticated portfolio submissions for the automated review queue.
- Refresh and enrich portfolio data in an isolated, least-privilege workflow.

Only validated public HTTPS URLs are rendered or scraped. Records marked as false positives, normalized duplicates, and legacy HTTP links are excluded from the site.

## Local development

Requirements:

- Node.js 22.12 or newer
- Java 21 or newer for Firestore emulator rule tests
- Python 3.12 and Playwright only when running AI enrichment

```bash
npm ci
npm run dev
```

The regular build is deterministic and uses the committed JSON file:

```bash
npm test
npm run check
npm run build
```

`npm run build` does not download or overwrite portfolio data.

## Data and AI pipeline

`src/data/portfolios.json` is the source of truth.

The scheduled `Portfolio data refresh` workflow:

1. Imports upstream entries and pending authenticated submissions.
2. Validates and deduplicates their URLs.
3. Passes the JSON artifact to a read-only scraping job.
4. Scrapes only public HTTPS destinations, including redirect and browser-request checks.
5. Uses Gemini 2.5 Flash through Google's official endpoint, with Groq as an optional fallback.
6. Records bounded retry/dead-letter state instead of repeatedly starving the queue.
7. Commits the validated JSON from a separate write-only job.
8. Reconciles Firestore from the exact committed JSON in a separate trusted job.

The scraping job never receives repository-write, Pages, OIDC, or Firebase service-account privileges.

Required Actions secrets:

- `FIREBASE_SERVICE_ACCOUNT_KEY`
- `GEMINI_API_KEY` or `GROQ_API_KEY`

Local enrichment:

```bash
python -m pip install -r scripts/requirements.txt
python -m playwright install chromium
GEMINI_API_KEY=... npm run ai:enrich
```

## Firebase security model

| Collection | Client reads | Client writes |
|---|---:|---:|
| `portfolios` | Public | Denied |
| `global_stats` | Public | Denied |
| `users/{uid}` | Owner only | Owner bookmarks only |
| `submissions` | Denied | Authenticated, validated creates only |

Portfolio and aggregate mutations require trusted server/admin code. The web client no longer writes global like or view counters; displayed view counts are read-only data snapshots.

## Useful scripts

| Command | Purpose |
|---|---|
| `npm run validate:data` | Validate the portfolio JSON trust boundary |
| `npm run update:data` | Merge the upstream developer-portfolios list |
| `npm run import:submissions` | Merge pending Firestore submissions |
| `npm run ai:enrich` | Run the Python scraping/enrichment batch |
| `npm run sync:firestore` | Reconcile Firestore from committed JSON |

Admin scripts use Application Default Credentials, `FIREBASE_SERVICE_ACCOUNT_KEY`, or a gitignored local Firebase service-account file.

## Deployment

- `CI` runs tests, Astro checks, the deterministic build, and a production dependency audit.
- `Deploy GitHub Pages` deploys only the exact commit that triggered the workflow.
- `Deploy Firestore rules` publishes tested rules only when rule configuration reaches `main` (or when manually dispatched).
- `Portfolio data refresh` is schedule/manual only, so its generated commit cannot recursively start another enrichment run.

## License

MIT. See [LICENSE](LICENSE).
