"""
Portfolio Universe - AI enrichment pipeline
Stack: httpx + trafilatura (scrape) + Gemini 2.0 Flash / Groq (LLM)
Env:   GEMINI_API_KEY, GROQ_API_KEY, BATCH_SIZE (default 150)
"""

import asyncio
import json
import os
import sys
import time
from pathlib import Path

import httpx
import trafilatura

# ── Config ─────────────────────────────────────────────────────────────────────
BATCH_SIZE  = int(os.getenv("BATCH_SIZE", "150"))
SCRAPE_CONC = 40          # concurrent scrape workers
LLM_RPM     = 12          # conservative combined rate (leaves headroom)
TEXT_LIMIT  = 4_000       # chars sent to LLM
JINA_BASE   = "https://r.jina.ai/"

# Path to portfolios.json — adjust if nested inside Astro src/data/
DATA_FILE = Path(os.getenv("DATA_FILE", "portfolios.json"))

HEADERS = {
    "User-Agent": "Mozilla/5.0 (compatible; PortfolioBot/1.0; +https://github.com/your-repo)"
}

# ── Prompt ─────────────────────────────────────────────────────────────────────
PROMPT = """\
Extract metadata from this developer portfolio page.
Respond ONLY with a valid JSON object. No markdown fences, no explanation.

Required schema:
{
  "name":        string or null,
  "role":        string or null,
  "tech_stack":  array of strings (top 5-8 technologies only),
  "summary":     string (max 50 words, factual, third-person),
  "seo_score":   integer 0-100 (based on clarity, keywords, structure),
  "hire_status": "available" | "unavailable" | "unknown",
  "contact":     string or null (email or URL)
}

Portfolio text:
"""

# ── Scraper ─────────────────────────────────────────────────────────────────────
async def _scrape_direct(url: str, client: httpx.AsyncClient) -> str | None:
    """Direct fetch + trafilatura extraction. Works for ~85% of portfolio sites."""
    try:
        r = await client.get(url, timeout=12, follow_redirects=True)
        r.raise_for_status()
        text = trafilatura.extract(
            r.text,
            include_comments=False,
            include_tables=True,
            no_fallback=False,
            favor_precision=False,
        )
        if text and len(text) >= 80:
            return text[:TEXT_LIMIT]
    except Exception:
        pass
    return None


async def _scrape_jina(url: str, client: httpx.AsyncClient) -> str | None:
    """Jina fallback for JS-heavy CSR sites (no delay needed — used sparingly)."""
    try:
        r = await client.get(JINA_BASE + url, timeout=25)
        if r.is_success and len(r.text) >= 80:
            return r.text[:TEXT_LIMIT]
    except Exception:
        pass
    return None


async def scrape(url: str, client: httpx.AsyncClient) -> str | None:
    text = await _scrape_direct(url, client)
    if text:
        return text
    # Jina fallback — no artificial delay since we use it sparingly
    return await _scrape_jina(url, client)


# ── LLM Providers ─────────────────────────────────────────────────────────────
def _call_gemini(text: str) -> dict | None:
    """Gemini 2.0 Flash — 15 RPM / 1500 RPD free tier, native JSON output."""
    try:
        import google.generativeai as genai
        genai.configure(api_key=os.environ["GEMINI_API_KEY"])
        model = genai.GenerativeModel("gemini-2.0-flash")
        resp = model.generate_content(
            PROMPT + text,
            generation_config=genai.GenerationConfig(
                response_mime_type="application/json",
                max_output_tokens=512,
                temperature=0.1,
            ),
        )
        return json.loads(resp.text)
    except Exception as e:
        print(f"  [gemini-err] {e}")
        return None


def _call_groq(text: str) -> dict | None:
    """Groq llama-3.3-70b — 30 RPM / 14400 RPD free tier, json_object mode."""
    try:
        from groq import Groq
        client = Groq(api_key=os.environ["GROQ_API_KEY"])
        resp = client.chat.completions.create(
            model="llama-3.3-70b-versatile",
            messages=[{"role": "user", "content": PROMPT + text}],
            response_format={"type": "json_object"},
            max_tokens=512,
            temperature=0.1,
        )
        return json.loads(resp.choices[0].message.content)
    except Exception as e:
        print(f"  [groq-err] {e}")
        return None


# Round-robin state
_llm_counter = 0
_llm_lock = asyncio.Lock()


async def call_llm(text: str) -> dict | None:
    """Alternate between Gemini and Groq per request. Fall back if one fails."""
    global _llm_counter
    async with _llm_lock:
        idx = _llm_counter
        _llm_counter += 1

    has_gemini = bool(os.getenv("GEMINI_API_KEY"))
    has_groq   = bool(os.getenv("GROQ_API_KEY"))

    # Both available → round-robin
    if has_gemini and has_groq:
        if idx % 2 == 0:
            result = await asyncio.to_thread(_call_gemini, text)
            return result or await asyncio.to_thread(_call_groq, text)
        else:
            result = await asyncio.to_thread(_call_groq, text)
            return result or await asyncio.to_thread(_call_gemini, text)

    # Single provider
    if has_gemini:
        return await asyncio.to_thread(_call_gemini, text)
    if has_groq:
        return await asyncio.to_thread(_call_groq, text)

    raise RuntimeError("No LLM provider configured. Set GEMINI_API_KEY or GROQ_API_KEY.")


# ── Rate Limiter ───────────────────────────────────────────────────────────────
class RateLimiter:
    def __init__(self, rpm: int):
        self._interval = 60.0 / rpm
        self._last = 0.0
        self._lock = asyncio.Lock()

    async def acquire(self):
        async with self._lock:
            now = time.monotonic()
            wait = self._interval - (now - self._last)
            if wait > 0:
                await asyncio.sleep(wait)
            self._last = time.monotonic()


_rate = RateLimiter(LLM_RPM)


# ── Core worker ───────────────────────────────────────────────────────────────
async def process_one(
    entry: dict,
    client: httpx.AsyncClient,
    sem: asyncio.Semaphore,
) -> dict:
    url = entry["url"]

    async with sem:
        # Phase 1: Scrape
        text = await scrape(url, client)
        if not text:
            entry["ai_status"] = "scrape_failed"
            print(f"  ✗ scrape_failed  {url[:70]}")
            return entry

        # Phase 2: LLM (rate-limited)
        await _rate.acquire()
        meta = await call_llm(text)

        if meta and isinstance(meta, dict):
            entry.update(meta)
            entry["ai_status"] = "done"
            name = entry.get("name") or "?"
            role = entry.get("role") or "?"
            print(f"  ✓ {name:<22} | {role:<30} | {url[:50]}")
        else:
            entry["ai_status"] = "llm_failed"
            print(f"  ✗ llm_failed     {url[:70]}")

        return entry


# ── Main ──────────────────────────────────────────────────────────────────────
async def main():
    if not DATA_FILE.exists():
        print(f"ERROR: {DATA_FILE} not found.", file=sys.stderr)
        sys.exit(1)

    data: list[dict] = json.loads(DATA_FILE.read_text(encoding="utf-8"))

    # Filter: skip already processed
    pending = [e for e in data if e.get("ai_status") not in ("done",)]
    batch   = pending[:BATCH_SIZE]

    total_done = sum(1 for e in data if e.get("ai_status") == "done")
    print(f"Portfolio Universe Pipeline")
    print(f"  Total:   {len(data)}")
    print(f"  Done:    {total_done}")
    print(f"  Pending: {len(pending)}")
    print(f"  Batch:   {len(batch)}")
    print()

    if not batch:
        print("All done! No pending URLs.")
        return

    url_to_idx = {e["url"]: i for i, e in enumerate(data)}
    sem = asyncio.Semaphore(SCRAPE_CONC)

    async with httpx.AsyncClient(headers=HEADERS, timeout=httpx.Timeout(15.0)) as client:
        results = await asyncio.gather(
            *[process_one(e.copy(), client, sem) for e in batch],
            return_exceptions=True,
        )

    # Merge results back into data
    for res in results:
        if isinstance(res, Exception):
            print(f"  [exception] {res}")
            continue
        if isinstance(res, dict):
            idx = url_to_idx.get(res["url"])
            if idx is not None:
                data[idx] = res

    DATA_FILE.write_text(
        json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8"
    )

    done_now = sum(1 for e in data if e.get("ai_status") == "done")
    failed   = sum(1 for e in data if e.get("ai_status") in ("scrape_failed", "llm_failed"))
    print()
    print(f"Batch complete.")
    print(f"  Done:   {done_now}/{len(data)}")
    print(f"  Failed: {failed} (will retry next run)")


if __name__ == "__main__":
    asyncio.run(main())
