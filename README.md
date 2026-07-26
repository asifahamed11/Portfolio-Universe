# Portfolio Universe

A searchable directory of developer portfolios, built with Astro and deployed as a static site to GitHub Pages.

**Live site:** [asifahamed11.github.io/Portfolio-Universe](https://asifahamed11.github.io/Portfolio-Universe/)

The checked-in `src/data/portfolios.json` file is the build-time source of truth. Firebase adds authentication, private bookmarks, portfolio view counters, trusted aggregate statistics, and a submission queue.

## Features

- Search and filter the curated portfolio directory.
- Sign in with Google or GitHub to save private bookmarks.
- Submit a portfolio for automated review.
- Display portfolio view counts and trusted aggregate like counts from Firestore.
- Enrich pending records with validated metadata from Gemini or Groq.
- Deploy the static Astro build to GitHub Pages.

## Technology

| Area | Technology |
| --- | --- |
| Site | Astro 7, React 19, Tailwind CSS 4 |
| Authentication and data | Firebase Authentication, Cloud Firestore |
| Trusted data jobs | Firebase Admin SDK |
| AI enrichment | Google Gemini or Groq, Pydantic validation |
| Content extraction | DNS-pinned AIOHTTP, Trafilatura |
| Tests | Astro diagnostics, Vitest, generated-HTML validation |
| Hosting | GitHub Actions and GitHub Pages |
| Runtime | Node.js 22.12 or newer; Python 3.12 for AI jobs |

## Local development

Install Node.js 22.12 or newer, then run:

```bash
git clone https://github.com/asifahamed11/Portfolio-Universe.git
cd Portfolio-Universe
npm ci
```

Create a local `.env` file:

```dotenv
PUBLIC_FIREBASE_API_KEY=your_firebase_web_api_key
```

Start the development server:

```bash
npm run dev
```

Astro serves the project at [http://localhost:4321/Portfolio-Universe/](http://localhost:4321/Portfolio-Universe/).

Useful commands:

```bash
npm test       # Run unit tests
npm run test:python # Run AI retry-state regression tests
npm run test:rules # Run rule tests against an already-running Firestore emulator
npm run check  # Run Astro and TypeScript diagnostics
npm run build  # Build the static site without fetching or publishing data
npm run preview
```

`npm run build` is intentionally deterministic: it reads the checked-in JSON file and does not contact Firestore or modify project data.

Run the security-rule suite with Java 21 installed:

```bash
npx --yes firebase-tools@15.24.0 emulators:exec --only firestore --project demo-portfolio-universe "npm run test:rules"
```

## Data maintenance

The maintenance commands mutate `src/data/portfolios.json` or Firestore. Review the resulting diff before committing it.

| Command | Purpose | Required access |
| --- | --- | --- |
| `npm run update-data` | Fetch the upstream developer-portfolios README, normalize URLs, remove duplicates, and append new candidates | Network |
| `npm run normalize-data` | Repair and deduplicate the checked-in JSON without contacting the network | Local file access |
| `npm run process-submissions` | Validate pending Firestore submissions and queue safe, new URLs in the local data file | `FIREBASE_SERVICE_ACCOUNT_KEY` |
| `npm run process-submissions -- --checkpoint` | Save marked retry/AI state into private submission documents before publication | `FIREBASE_SERVICE_ACCOUNT_KEY` |
| `npm run process-submissions -- --prepare-public` | Create an ignored recovery copy and strip marked queued/rejected reviews from the commit-ready JSON | Local file access |
| `npm run process-submissions -- --restore-private` | Restore the ignored private review copy for finalization; `--discard-private` removes that copy when restoration is no longer needed | Local file access |
| `npm run generate-summaries` | Scrape pending URLs, validate AI metadata, and update successful records atomically | Python dependencies plus `GEMINI_API_KEY` or `GROQ_API_KEY` |
| `npm run migrate-data -- --prune` | Publish validated metadata, transactionally reconcile legacy counters, and explicitly remove stale portfolio documents | `FIREBASE_SERVICE_ACCOUNT_KEY` and `ALLOW_FIRESTORE_PRUNE=1` |
| `npm run process-submissions -- --finalize` | Accept AI-confirmed portfolios and reject AI-confirmed non-portfolios | `FIREBASE_SERVICE_ACCOUNT_KEY` |
| `npm run rebuild-likes` | Rebuild trusted SHA-256-keyed aggregate totals from private user bookmark documents | `FIREBASE_SERVICE_ACCOUNT_KEY` |
| `npm run sync-data` | Intentionally export Firestore portfolios back to the JSON file | `FIREBASE_SERVICE_ACCOUNT_KEY` and `ALLOW_FIRESTORE_EXPORT=1` |
| `npm run deploy-rules` | Validate and publish `firestore.rules` through the Firebase Admin SDK | `FIREBASE_SERVICE_ACCOUNT_KEY` with Rules IAM access |

To run the AI pipeline locally:

```bash
python -m pip install -r scripts/requirements.txt
npm run generate-summaries
```

Optional AI settings:

```dotenv
GEMINI_API_KEY=your_gemini_key
GROQ_API_KEY=your_groq_key
BATCH_SIZE=50
CHECKPOINT_SIZE=5
PIPELINE_TIME_BUDGET_SECONDS=1200
PROVIDER_TIMEOUT_SECONDS=60
MAX_PORTFOLIO_ATTEMPTS=8
DATA_FILE=src/data/portfolios.json
GEMINI_MODEL=gemini-3.6-flash
GROQ_MODEL=openai/gpt-oss-120b
```

At least one AI provider key is required when records are eligible and pending. Provider responses are accepted only after strict schema validation. Scraping rejects credentials and non-HTTP schemes, resolves with a timeout, blocks non-public addresses, pins connections to the approved DNS result, validates every redirect, and caps response size. Failed records receive backoff metadata so they cannot permanently starve newer submissions. After the configured attempt limit, a portfolio-specific URL or content failure is rejected; provider and system outages remain queued for a later retry. A user can resubmit a terminally rejected URL to start a fresh review.

### Firestore export safeguard

`npm run sync-data` can replace the tracked data file, so it refuses to run unless `ALLOW_FIRESTORE_EXPORT=1` is set. It merges trusted Firestore view counters into the richer local records, enforces a minimum record count, and creates `src/data/portfolios.json.bak` before replacing existing data. Override the lower bound only when necessary with `MIN_PORTFOLIO_EXPORT_COUNT`.

Pruning is separately guarded: `--prune` also requires `ALLOW_FIRESTORE_PRUNE=1`, at least 1,000 local records by default, and at least 80% overlap with the existing Firestore collection. An intentional smaller data set can change the count guard with `MIN_FIRESTORE_PRUNE_COUNT`; the overlap guard remains enforced.

## Automation

`.github/workflows/ai-automation.yml` deliberately separates deterministic deployment from network-dependent maintenance:

- Every push to `main` runs unit tests and Astro diagnostics, builds the checked-in data, validates generated HTML, and deploys GitHub Pages. External data providers cannot block that site build.
- Firestore rules are tested against the local emulator before maintenance or deployment. Push releases publish the rules first and deploy the matching site only after that succeeds, preventing a client/rules compatibility split.
- Manual and daily midnight UTC maintenance runs only from `main`. It updates and normalizes data, keeps queued/rejected submission review state in private Firestore fields, runs AI enrichment with bounded timeouts, migrates only publishable portfolios, exports live views, commits a scrubbed public snapshot, and finalizes reviewed submissions. The resulting immutable revision is rebuilt before its rules and matching Pages artifact are deployed.

Repository secrets used by the workflow:

- `PUBLIC_FIREBASE_API_KEY`
- `FIREBASE_SERVICE_ACCOUNT_KEY` as a JSON service-account object
- `GEMINI_API_KEY` and/or `GROQ_API_KEY`

Never commit Admin SDK credentials or AI provider keys. Firebase web configuration is public by design; authorization is enforced by Firestore rules, not by hiding the web API key.

## Firestore security model

| Path | Client reads | Client writes |
| --- | --- | --- |
| `global_stats/likes` | Public | Denied; trusted Admin SDK jobs only |
| Other `global_stats/{document}` paths | Denied | Denied |
| `portfolios/{portfolioKey}` | Public | Signed-in users may increment an existing integer `views` field by exactly one; creates are denied |
| `users/{userId}` | Document owner | Document owner; bookmark data is schema- and size-limited |
| `submissions/{userId}` | Denied | The owner may create one exact-schema pending record, retry rejected/duplicate records, or submit again one day after acceptance |

Admin SDK scripts validate that credentials belong to the `portfolio-universe` project. Signed-in view increments are constrained for integrity, but rules cannot rate-limit an authenticated bot; the counters are ranking signals, not unique-visitor analytics. Global likes are rebuilt by the trusted daily job rather than written by browsers.

## Project layout

```text
Portfolio-Universe/
|-- .github/workflows/ai-automation.yml
|-- scripts/
|   |-- hybrid_pipeline.py
|   |-- deploy-firestore-rules.js
|   |-- migrate-to-firestore.js
|   |-- process-submissions.js
|   |-- rebuild-global-likes.js
|   |-- static-html-check.py
|   |-- sync-firestore-to-json.js
|   `-- update-data.js
|-- src/
|   |-- components/
|   |-- data/portfolios.json
|   |-- lib/
|   |-- pages/
|   |-- scripts/
|   `-- styles/
|-- astro.config.mjs
|-- firestore.rules
`-- package.json
```

## Contributing

Pull requests for fixes and site improvements are welcome. Portfolio entries can also be proposed through the site's authenticated submission form or through the upstream [developer-portfolios repository](https://github.com/emmabostian/developer-portfolios).

## License

MIT License - Asif Ahamed
