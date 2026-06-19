# Portfolio Universe

A curated aggregator of 1,700+ developer portfolios — AI-enriched, Firebase-backed, deployed to GitHub Pages.

**Live:** https://asifahamed11.github.io/Portfolio-Universe/

---

## What it does

- Auto-syncs portfolios daily from [emmabostian/developer-portfolios](https://github.com/emmabostian/developer-portfolios)
- Enriches each entry with AI-generated metadata: role, tech stack, summary, SEO score, hire status
- Tracks views per portfolio via Firestore; supports bookmarks and global likes
- Deploys automatically on every push via GitHub Actions

---

## Stack

| Layer | Technology |
|---|---|
| Framework | Astro 6 |
| UI | React 19, Tailwind CSS 4 |
| Database | Firebase Firestore |
| AI Model | Qwen 2.5 7B via Ollama (Kaggle T4 GPU) |
| Scraping | Jina Reader API |
| Deployment | GitHub Actions → GitHub Pages |
| Runtime | Node.js >= 22.12.0 |

---

## Project structure

```
Portfolio-Universe/
├── .github/workflows/ai-automation.yml   # CI/CD pipeline
├── src/data/portfolios.json              # Build-time data source
├── scripts/
│   ├── update-data.js                    # Fetch upstream list, merge new entries
│   ├── migrate-to-firestore.js           # Push JSON → Firestore
│   ├── sync-firestore-to-json.js         # Pull Firestore → JSON (runs before build)
│   ├── generate-summaries.js             # AI enrichment via Ollama
│   └── clean-dummies.js                  # Remove low-confidence AI outputs
├── kaggle_model_run.py                   # Kaggle notebook: Ollama setup + pipeline runner
└── firestore.rules
```

---

## Local development

```bash
git clone https://github.com/asifahamed11/Portfolio-Universe.git
cd Portfolio-Universe
npm install
```

Create `.env`:

```env
PUBLIC_FIREBASE_API_KEY=your_key_here
```

```bash
npm run dev        # localhost:4321
npm run build      # sync Firestore → JSON, then build
npm run preview    # preview production build
```

---

## AI pipeline

Runs on Kaggle (free T4 GPU) via `kaggle_model_run.py`:

1. Install Ollama, pull `qwen2.5:7b`
2. Clone repo, run `node scripts/generate-summaries.js`
3. For each unprocessed URL: scrape via Jina Reader, send to Qwen 2.5, extract structured JSON
4. Save back to `portfolios.json`, push to Firestore

Extracted per portfolio: `name`, `role`, `location`, `summary`, `tech_stack`, `projects`, `social_links`, `seo_evaluation`, `portfolio_score`, `available_for_hire`, `is_portfolio`.

---

## CI/CD

Runs on push to `main`, manual trigger, and daily at midnight UTC.

```
Fetch upstream README
→ Merge new portfolios into portfolios.json
→ Sync to Firestore
→ Commit updated JSON
→ Build Astro (pulls Firestore data first)
→ Deploy to GitHub Pages
```

---

## Firestore rules

| Collection | Read | Write |
|---|---|---|
| `global_stats` | Public | Authenticated users |
| `portfolios` | Public | `views` field only (upsert allowed) |
| `users/{userId}` | Owner | Owner |
| `submissions` | Denied | Authenticated, own UID |

---

## Contributing

Submit new portfolios to the upstream [emmabostian/developer-portfolios](https://github.com/emmabostian/developer-portfolios) repo — they sync here automatically within 24 hours.

Pull requests for site features are welcome.

---

MIT License — Asif Ahamed
