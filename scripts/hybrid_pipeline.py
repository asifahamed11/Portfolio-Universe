"""
Hybrid Pipeline (Python) - Multi-Key Round Robin
Tier 1: HTTPX + Trafilatura (Fast, Static)
Tier 2: Playwright + Trafilatura (Accurate, SPAs)
LLM: Gemini 2.5 Flash (3 keys) + Groq Llama 3 (1 key)
"""

import asyncio
import json
import os
import sys
import time
from pathlib import Path
import httpx
from dotenv import load_dotenv

# Load environment variables from .env file at the root of the project
load_dotenv(Path(__file__).parent.parent / ".env")

import trafilatura
from playwright.async_api import async_playwright
from google import genai
from google.genai import types
from pydantic import BaseModel, Field
from groq import AsyncGroq

# --- Config ---
BATCH_SIZE = int(os.getenv("BATCH_SIZE", "50"))
DATA_FILE = Path(os.getenv("DATA_FILE", "src/data/portfolios.json"))
RPM_LIMIT = 30 # Safe combined limit
MAX_RETRIES = 3

# Keys
GEMINI_KEYS = [
    os.getenv("GEMINI_API_KEY")
]
GEMINI_KEYS = [k for k in GEMINI_KEYS if k] # Filter out None

GROQ_KEY = os.getenv("GROQ_API_KEY")

if not GEMINI_KEYS and not GROQ_KEY:
    print("ERROR: No API keys provided. Please set GEMINI_API_KEY or GROQ_API_KEY.", file=sys.stderr)
    sys.exit(1)

# Calculate RPM limit
RPM_LIMIT = (len(GEMINI_KEYS) * 15) + (30 if GROQ_KEY else 0)
if RPM_LIMIT == 0: RPM_LIMIT = 15

# Initialize Clients
# Note: Using NaraRouter endpoint for the provided key
gemini_clients = [genai.Client(api_key=key, http_options={'base_url': 'https://router.bynara.id'}) for key in GEMINI_KEYS]
groq_client = AsyncGroq(api_key=GROQ_KEY) if GROQ_KEY else None

# Round-robin state
_llm_counter = 0
_llm_lock = asyncio.Lock()

# Global Quota Exhaustion Tracker
_consecutive_failures = 0
_exhausted_threshold = 10
_global_exhausted = False

# --- Schema ---
class PortfolioMetadata(BaseModel):
    is_portfolio: bool = Field(description="True if personal portfolio, False otherwise")
    name: str = Field(description="Full name, empty if none")
    location: str = Field(description="City, Country or Remote")
    summary: str = Field(description="30-50 words summary in third person")
    role: str = Field(description="Frontend Developer | Backend Developer | Full Stack Developer | Mobile Developer | ML/AI Engineer | Data Scientist | DevOps/Cloud Engineer | UI/UX Designer | Game Developer | Other")
    tech_stack: list[str] = Field(description="Max 8 top technologies")
    projects: list[str] = Field(description="Max 5 projects")
    social_links: list[str] = Field(description="Full https URLs")
    seo_evaluation: str = Field(description="'Good', 'Average', or 'Needs Improvement'")
    portfolio_score: int = Field(description="Integer 1-10")
    available_for_hire: bool = Field(description="True if explicit hire me signal")

# Groq prompt needs explicit schema instructions since it doesn't support strict OpenAPI schema yet
GROQ_PROMPT_INSTRUCTION = """
Extract metadata from this developer portfolio. You MUST output ONLY valid JSON matching this exact structure:
{
    "is_portfolio": boolean (true if personal portfolio, false otherwise),
    "name": string (Full name, empty if none),
    "location": string (City, Country or Remote),
    "summary": string (30-50 words summary in third person),
    "role": string (One of: Frontend Developer, Backend Developer, Full Stack Developer, Mobile Developer, ML/AI Engineer, Data Scientist, DevOps/Cloud Engineer, UI/UX Designer, Game Developer, Other),
    "tech_stack": array of strings (Max 8 top technologies),
    "projects": array of strings (Max 5 projects),
    "social_links": array of strings (Full https URLs),
    "seo_evaluation": string ('Good', 'Average', or 'Needs Improvement'),
    "portfolio_score": integer (1-10),
    "available_for_hire": boolean (true if explicit hire me signal)
}
Portfolio Text:
"""

# --- Rate Limiter ---
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

_rate_limiter = RateLimiter(RPM_LIMIT)

# --- Scraping ---
async def scrape_tier1(url: str) -> str | None:
    try:
        async with httpx.AsyncClient(follow_redirects=True) as client:
            resp = await client.get(url, timeout=15)
            if resp.status_code == 200:
                text = trafilatura.extract(resp.text)
                if text and len(text) > 200:
                    return text
    except Exception:
        pass
    return None

async def scrape_tier2(url: str, browser_context) -> str | None:
    try:
        page = await browser_context.new_page()
        await page.goto(url, wait_until="networkidle", timeout=30000)
        html = await page.content()
        await page.close()
        text = trafilatura.extract(html)
        if text:
            return text
    except Exception:
        pass
    return None

async def call_gemini(client, text):
    prompt = f"Extract metadata from this developer portfolio:\n\n{text}"
    response = await client.aio.models.generate_content(
        model='gemini-2.0-flash', # Using 2.0-flash as it usually has 15 RPM
        contents=prompt,
        config=types.GenerateContentConfig(
            response_mime_type="application/json",
            response_schema=PortfolioMetadata,
            temperature=0.1
        ),
    )
    return json.loads(response.text)

async def call_groq(text):
    response = await groq_client.chat.completions.create(
        model="llama-3.3-70b-versatile",
        messages=[{"role": "user", "content": GROQ_PROMPT_INSTRUCTION + text}],
        response_format={"type": "json_object"},
        temperature=0.1,
    )
    return json.loads(response.choices[0].message.content)

async def process_portfolio(entry: dict, browser_context) -> dict:
    global _llm_counter
    url = entry["url"]
    
    # 1. Scrape
    text = await scrape_tier1(url)
    used_tier = "Tier 1 (HTTPX)"
    if not text:
        text = await scrape_tier2(url, browser_context)
        used_tier = "Tier 2 (Playwright)"
        
    if not text:
        print(f"  [X] Scrape Failed: {url}")
        return entry

    text = text[:8000] # Cap context

    # 2. LLM Processing (Robust Retry Across Clients)
    import random
    global _consecutive_failures, _global_exhausted
    
    if _global_exhausted:
        return entry # Skip immediately if quota is fully exhausted
        
    clients_to_try = [("gemini", c, i) for i, c in enumerate(gemini_clients)]
    if groq_client:
        clients_to_try.append(("groq", groq_client, 0))

    random.shuffle(clients_to_try) # Randomize to distribute load

    for attempt in range(MAX_RETRIES):
        await _rate_limiter.acquire()
        
        for provider, client, idx in clients_to_try:
            try:
                if provider == "gemini":
                    data = await call_gemini(client, text)
                    llm_used = f"Gemini (Key {idx + 1})"
                else:
                    data = await call_groq(text)
                    llm_used = "Groq"

                # Apply schema defaults
                entry["is_portfolio"] = data.get("is_portfolio", False)
                entry["name"] = data.get("name", "")
                entry["location"] = data.get("location", "")
                entry["summary"] = data.get("summary", "")
                entry["role"] = data.get("role", "")
                entry["tech_stack"] = data.get("tech_stack", [])
                entry["projects"] = data.get("projects", [])
                entry["social_links"] = data.get("social_links", [])
                entry["seo_evaluation"] = data.get("seo_evaluation", "")
                entry["portfolio_score"] = data.get("portfolio_score", 0)
                entry["available_for_hire"] = data.get("available_for_hire", False)

                entry["ai_processed"] = True
                
                async with _llm_lock:
                    _consecutive_failures = 0 # Reset counter on success
                    
                print(f"  [V] {used_tier} | {llm_used} | {data.get('name', '?')} | {url}")
                return entry
                
            except Exception as e:
                err_str = str(e)
                if "429" in err_str or "401" in err_str or "RESOURCE_EXHAUSTED" in err_str:
                    # Skip to the next key quietly
                    continue
                else:
                    # Other unknown error, print it but still try next key
                    continue
                    
        # If we exhausted all keys in this attempt, wait 10 seconds before next attempt
        if attempt < MAX_RETRIES - 1:
            await asyncio.sleep(10)

    async with _llm_lock:
        _consecutive_failures += 1
        if _consecutive_failures >= _exhausted_threshold and not _global_exhausted:
            _global_exhausted = True
            print("\n🚨 GLOBAL QUOTA EXHAUSTED! Skipping the rest of the batch to save time.\n")

    if not _global_exhausted:
        print(f"  [X] LLM Error on {url}: All keys exhausted or invalid.")
        
    return entry

async def main():
    # Load Data
    try:
        with open(DATA_FILE, "r", encoding="utf-8") as f:
            portfolios = json.load(f)
    except Exception as e:
        print(f"ERROR reading {DATA_FILE}: {e}")
        sys.exit(1)

    pending = [p for p in portfolios if not p.get("ai_processed")]
    batch = pending[:BATCH_SIZE]

    if not batch:
        print("No pending portfolios to process.")
        return

    print(f"Starting Multi-Key Hybrid Pipeline on {len(batch)} portfolios... (RPM Limit: {RPM_LIMIT})")
    
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        context = await browser.new_context()
        
        # We need a semaphore to avoid launching too many concurrent Playwright tabs or hitting network socket limits.
        sem = asyncio.Semaphore(5) # 5 concurrent tasks
        
        async def sem_process(entry):
            async with sem:
                return await process_portfolio(entry, context)
        
        tasks = [sem_process(entry) for entry in batch]
        await asyncio.gather(*tasks)
        
        await browser.close()
        
    # Save Data
    with open(DATA_FILE, "w", encoding="utf-8") as f:
        json.dump(portfolios, f, indent=2, ensure_ascii=False)
        
    print(f"Batch completed and saved to {DATA_FILE}")

if __name__ == "__main__":
    asyncio.run(main())
