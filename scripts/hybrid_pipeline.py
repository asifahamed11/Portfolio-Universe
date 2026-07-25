"""Safely scrape and enrich pending developer portfolios.

Untrusted browsing happens in a job with read-only repository permissions.
Every initial URL, redirect, and browser request is restricted to public HTTPS
destinations. Failures are persisted with bounded retries so one bad site
cannot starve the rest of the queue.
"""

from __future__ import annotations

import asyncio
import ipaddress
import json
import os
import random
import socket
import sys
import time
from datetime import UTC, datetime, timedelta
from pathlib import Path
from urllib.parse import urljoin, urlsplit

import httpx
import trafilatura
from dotenv import load_dotenv
from google import genai
from google.genai import types
from groq import AsyncGroq
from playwright.async_api import BrowserContext, Route, async_playwright
from pydantic import BaseModel, Field

load_dotenv(Path(__file__).parent.parent / ".env")

BATCH_SIZE = int(os.getenv("BATCH_SIZE", "50"))
DATA_FILE = Path(os.getenv("DATA_FILE", "src/data/portfolios.json"))
GEMINI_MODEL = os.getenv("GEMINI_MODEL", "gemini-2.5-flash")
MAX_LLM_RETRIES = int(os.getenv("MAX_LLM_RETRIES", "2"))
MAX_ENTRY_ATTEMPTS = int(os.getenv("MAX_ENTRY_ATTEMPTS", "3"))
MIN_SUCCESS_RATE = float(os.getenv("MIN_SUCCESS_RATE", "0.20"))
SCRAPE_CONCURRENCY = int(os.getenv("SCRAPE_CONCURRENCY", "5"))
MAX_RESPONSE_BYTES = int(os.getenv("MAX_RESPONSE_BYTES", str(2 * 1024 * 1024)))
MAX_REDIRECTS = 5
REQUEST_TIMEOUT_SECONDS = 20

GEMINI_KEYS = [key for key in [os.getenv("GEMINI_API_KEY")] if key]
GROQ_KEY = os.getenv("GROQ_API_KEY")

# Use the official provider endpoints. Do not route credentials through proxies.
gemini_clients = [genai.Client(api_key=key) for key in GEMINI_KEYS]
groq_client = AsyncGroq(api_key=GROQ_KEY) if GROQ_KEY else None
rpm_limit = max(15, (len(gemini_clients) * 15) + (30 if groq_client else 0))


class PortfolioMetadata(BaseModel):
    is_portfolio: bool
    name: str = Field(default="", max_length=120)
    location: str = Field(default="", max_length=120)
    summary: str = Field(default="", max_length=600)
    role: str = Field(default="", max_length=80)
    tech_stack: list[str] = Field(default_factory=list, max_length=8)
    projects: list[str] = Field(default_factory=list, max_length=5)
    social_links: list[str] = Field(default_factory=list, max_length=10)
    seo_evaluation: str = Field(default="", max_length=40)
    portfolio_score: int = Field(default=0, ge=0, le=10)
    available_for_hire: bool = False


GROQ_PROMPT_INSTRUCTION = """
Extract metadata from this developer portfolio. Output only valid JSON:
{
  "is_portfolio": boolean,
  "name": string,
  "location": string,
  "summary": string,
  "role": string,
  "tech_stack": string[],
  "projects": string[],
  "social_links": string[],
  "seo_evaluation": "Good" | "Average" | "Needs Improvement",
  "portfolio_score": integer,
  "available_for_hire": boolean
}
Portfolio text:
"""


class RateLimiter:
    def __init__(self, rpm: int) -> None:
        self._interval = 60.0 / rpm
        self._last = 0.0
        self._lock = asyncio.Lock()

    async def acquire(self) -> None:
        async with self._lock:
            now = time.monotonic()
            wait = self._interval - (now - self._last)
            if wait > 0:
                await asyncio.sleep(wait)
            self._last = time.monotonic()


rate_limiter = RateLimiter(rpm_limit)


def utc_now() -> datetime:
    return datetime.now(UTC)


def safe_error(error: Exception) -> str:
    return " ".join(str(error).split())[:300] or error.__class__.__name__


def public_https_parts(url: str):
    try:
        parsed = urlsplit(url)
        port = parsed.port
    except (TypeError, ValueError):
        return None

    if (
        parsed.scheme.lower() != "https"
        or not parsed.hostname
        or parsed.username
        or parsed.password
        or port not in (None, 443)
    ):
        return None
    return parsed


async def resolves_to_public_ip(hostname: str) -> bool:
    try:
        loop = asyncio.get_running_loop()
        addresses = await loop.run_in_executor(
            None,
            lambda: socket.getaddrinfo(
                hostname,
                443,
                type=socket.SOCK_STREAM,
            ),
        )
    except (OSError, socket.gaierror):
        return False

    if not addresses:
        return False

    for address in addresses:
        try:
            ip = ipaddress.ip_address(address[4][0])
        except ValueError:
            return False
        if not ip.is_global:
            return False
    return True


async def is_safe_public_url(url: str) -> bool:
    parsed = public_https_parts(url)
    return bool(parsed and await resolves_to_public_ip(parsed.hostname))


async def fetch_public_html(url: str) -> str:
    headers = {
        "Accept": "text/html,application/xhtml+xml",
        "User-Agent": "PortfolioUniverseBot/1.0 (+https://asifahamed11.github.io/Portfolio-Universe/)",
    }
    timeout = httpx.Timeout(REQUEST_TIMEOUT_SECONDS)

    async with httpx.AsyncClient(
        follow_redirects=False,
        timeout=timeout,
        headers=headers,
    ) as client:
        current_url = url
        for _ in range(MAX_REDIRECTS + 1):
            if not await is_safe_public_url(current_url):
                raise ValueError("URL does not resolve to a public HTTPS address")

            async with client.stream("GET", current_url) as response:
                if response.is_redirect:
                    location = response.headers.get("location")
                    if not location:
                        raise ValueError("redirect response did not include a location")
                    current_url = urljoin(current_url, location)
                    continue

                response.raise_for_status()
                content_type = response.headers.get("content-type", "").lower()
                if not (
                    content_type.startswith("text/html")
                    or content_type.startswith("application/xhtml+xml")
                    or content_type.startswith("text/plain")
                ):
                    raise ValueError(f"unsupported content type: {content_type}")

                chunks: list[bytes] = []
                size = 0
                async for chunk in response.aiter_bytes():
                    size += len(chunk)
                    if size > MAX_RESPONSE_BYTES:
                        raise ValueError("response exceeded the configured size limit")
                    chunks.append(chunk)

                return b"".join(chunks).decode(
                    response.encoding or "utf-8",
                    errors="replace",
                )

    raise ValueError("redirect limit exceeded")


async def scrape_tier1(url: str) -> str:
    html = await fetch_public_html(url)
    text = trafilatura.extract(html) or ""
    if len(text) < 200:
        raise ValueError("static extraction returned too little text")
    return text


async def route_public_requests(route: Route) -> None:
    request_url = route.request.url
    scheme = urlsplit(request_url).scheme.lower()
    if scheme in {"about", "blob", "data"}:
        await route.continue_()
        return
    if await is_safe_public_url(request_url):
        await route.continue_()
    else:
        await route.abort("blockedbyclient")


async def scrape_tier2(url: str, browser_context: BrowserContext) -> str:
    page = await browser_context.new_page()
    try:
        response = await page.goto(
            url,
            wait_until="domcontentloaded",
            timeout=REQUEST_TIMEOUT_SECONDS * 1000,
        )
        if response and response.status >= 400:
            raise ValueError(f"browser received HTTP {response.status}")
        await page.wait_for_timeout(1_000)
        text = trafilatura.extract(await page.content()) or ""
        if len(text) < 100:
            raise ValueError("browser extraction returned too little text")
        return text
    finally:
        await page.close()


async def scrape(url: str, browser_context: BrowserContext) -> tuple[str, str]:
    if not await is_safe_public_url(url):
        raise ValueError("portfolio URL is not a public HTTPS destination")

    try:
        return await scrape_tier1(url), "httpx"
    except Exception as tier1_error:
        try:
            return await scrape_tier2(url, browser_context), "playwright"
        except Exception as tier2_error:
            raise ValueError(
                f"static: {safe_error(tier1_error)}; browser: {safe_error(tier2_error)}"
            ) from tier2_error


async def call_gemini(client, text: str) -> PortfolioMetadata:
    response = await client.aio.models.generate_content(
        model=GEMINI_MODEL,
        contents=f"Extract metadata from this developer portfolio:\n\n{text}",
        config=types.GenerateContentConfig(
            response_mime_type="application/json",
            response_schema=PortfolioMetadata,
            temperature=0.1,
        ),
    )
    return PortfolioMetadata.model_validate_json(response.text)


async def call_groq(text: str) -> PortfolioMetadata:
    if not groq_client:
        raise RuntimeError("Groq client is unavailable")
    response = await groq_client.chat.completions.create(
        model=os.getenv("GROQ_MODEL", "llama-3.3-70b-versatile"),
        messages=[{"role": "user", "content": GROQ_PROMPT_INSTRUCTION + text}],
        response_format={"type": "json_object"},
        temperature=0.1,
    )
    return PortfolioMetadata.model_validate_json(
        response.choices[0].message.content
    )


async def enrich(text: str) -> tuple[PortfolioMetadata, str]:
    providers = [("gemini", client) for client in gemini_clients]
    if groq_client:
        providers.append(("groq", groq_client))

    last_error: Exception | None = None
    for attempt in range(MAX_LLM_RETRIES):
        random.shuffle(providers)
        for provider, client in providers:
            await rate_limiter.acquire()
            try:
                if provider == "gemini":
                    return await call_gemini(client, text), GEMINI_MODEL
                return await call_groq(text), os.getenv(
                    "GROQ_MODEL",
                    "llama-3.3-70b-versatile",
                )
            except Exception as error:
                last_error = error

        if attempt < MAX_LLM_RETRIES - 1:
            await asyncio.sleep(5 * (attempt + 1))

    raise RuntimeError(
        f"all configured LLM providers failed: {safe_error(last_error or RuntimeError('unknown error'))}"
    )


def mark_failure(entry: dict, stage: str, error: Exception) -> None:
    attempts = int(entry.get("ai_attempt_count") or 0) + 1
    attempted_at = utc_now()
    entry["ai_processed"] = False
    entry["ai_attempt_count"] = attempts
    entry["ai_last_attempt_at"] = attempted_at.isoformat()
    entry["ai_last_error"] = {
        "stage": stage,
        "message": safe_error(error),
    }

    if attempts >= MAX_ENTRY_ATTEMPTS:
        entry["ai_state"] = "dead_letter"
        entry.pop("ai_next_retry_at", None)
    else:
        entry["ai_state"] = "retry"
        retry_delay = timedelta(hours=6 * (2 ** (attempts - 1)))
        entry["ai_next_retry_at"] = (attempted_at + retry_delay).isoformat()


def clear_failure(entry: dict) -> None:
    entry["ai_state"] = "processed"
    entry["ai_attempt_count"] = 0
    entry.pop("ai_last_attempt_at", None)
    entry.pop("ai_last_error", None)
    entry.pop("ai_next_retry_at", None)


async def process_portfolio(
    entry: dict,
    browser_context: BrowserContext,
) -> bool:
    url = entry.get("url")
    if not isinstance(url, str):
        mark_failure(entry, "validation", ValueError("missing URL"))
        return False

    try:
        text, scraper = await scrape(url, browser_context)
    except Exception as error:
        mark_failure(entry, "scrape", error)
        print(f"[scrape-failed] {url}: {safe_error(error)}")
        return False

    try:
        metadata, model = await enrich(text[:8_000])
    except Exception as error:
        mark_failure(entry, "llm", error)
        print(f"[llm-failed] {url}: {safe_error(error)}")
        return False

    data = metadata.model_dump()
    entry["is_portfolio"] = data["is_portfolio"]
    entry["name"] = data["name"] or entry.get("name", "")
    entry["location"] = data["location"]
    entry["summary"] = data["summary"]
    entry["role"] = data["role"]
    entry["tech_stack"] = data["tech_stack"]
    entry["projects"] = data["projects"]
    entry["social_links"] = data["social_links"]
    entry["seo_evaluation"] = data["seo_evaluation"]
    entry["portfolio_score"] = data["portfolio_score"]
    entry["available_for_hire"] = data["available_for_hire"]
    entry["ai_processed"] = True
    clear_failure(entry)
    print(f"[processed] {scraper} | {model} | {entry['name']} | {url}")
    return True


def retry_is_due(entry: dict, now: datetime) -> bool:
    retry_at = entry.get("ai_next_retry_at")
    if not retry_at:
        return True
    try:
        parsed = datetime.fromisoformat(retry_at)
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=UTC)
        return parsed <= now
    except (TypeError, ValueError):
        return True


async def main() -> None:
    try:
        portfolios = json.loads(DATA_FILE.read_text(encoding="utf-8"))
    except Exception as error:
        print(f"ERROR reading {DATA_FILE}: {safe_error(error)}", file=sys.stderr)
        sys.exit(1)

    if not isinstance(portfolios, list):
        print("ERROR: portfolio data must be a JSON array.", file=sys.stderr)
        sys.exit(1)

    now = utc_now()
    pending = [
        entry
        for entry in portfolios
        if isinstance(entry, dict)
        and not entry.get("ai_processed")
        and entry.get("ai_state") != "dead_letter"
        and retry_is_due(entry, now)
    ]
    pending.sort(
        key=lambda entry: (
            int(entry.get("ai_attempt_count") or 0),
            entry.get("ai_last_attempt_at") or "",
        )
    )
    batch = pending[:BATCH_SIZE]

    if not batch:
        print("No eligible pending portfolios to process.")
        return

    if not gemini_clients and not groq_client:
        print(
            "ERROR: Set GEMINI_API_KEY or GROQ_API_KEY before running enrichment.",
            file=sys.stderr,
        )
        sys.exit(1)

    print(
        f"Processing {len(batch)} portfolios "
        f"(RPM={rpm_limit}, concurrency={SCRAPE_CONCURRENCY})."
    )

    async with async_playwright() as playwright:
        browser = await playwright.chromium.launch(headless=True)
        context = await browser.new_context(
            accept_downloads=False,
            service_workers="block",
        )
        await context.route("**/*", route_public_requests)
        semaphore = asyncio.Semaphore(SCRAPE_CONCURRENCY)

        async def bounded_process(entry: dict) -> bool:
            async with semaphore:
                return await process_portfolio(entry, context)

        results = await asyncio.gather(
            *(bounded_process(entry) for entry in batch)
        )
        await context.close()
        await browser.close()

    temporary_file = DATA_FILE.with_suffix(f"{DATA_FILE.suffix}.tmp")
    temporary_file.write_text(
        json.dumps(portfolios, indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )
    temporary_file.replace(DATA_FILE)

    successes = sum(results)
    attempted = len(results)
    success_rate = successes / attempted if attempted else 1.0
    print(
        f"Enrichment complete: {successes}/{attempted} succeeded "
        f"({success_rate:.1%})."
    )
    if attempted and success_rate < MIN_SUCCESS_RATE:
        print(
            f"ERROR: success rate is below the {MIN_SUCCESS_RATE:.0%} threshold.",
            file=sys.stderr,
        )
        sys.exit(2)


if __name__ == "__main__":
    asyncio.run(main())
