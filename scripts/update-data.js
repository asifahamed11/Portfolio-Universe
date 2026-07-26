import fs from 'fs/promises';
import path from 'path';
import { pathToFileURL } from 'url';

const README_URL = 'https://raw.githubusercontent.com/emmabostian/developer-portfolios/master/README.md';
const DATA_FILE = path.join(process.cwd(), 'src', 'data', 'portfolios.json');
const MAX_README_BYTES = 5 * 1024 * 1024;
const MIN_UPSTREAM_PORTFOLIOS = 1000;
const FETCH_ATTEMPTS = 3;
const TRACKING_PARAMETERS = new Set([
  'fbclid',
  'gclid',
  'dclid',
  'mc_cid',
  'mc_eid',
  'ref',
  'ref_src',
]);

export function normalizePortfolioUrl(value) {
  if (typeof value !== 'string') return null;

  const candidate = value.trim();
  if (
    candidate.length < 8
    || candidate.length > 2048
    || /[\u0000-\u001f\u007f\s"'<>`\\]/u.test(candidate)
  ) {
    return null;
  }

  try {
    const parsed = new URL(candidate);
    if (!['http:', 'https:'].includes(parsed.protocol)) return null;
    if (!parsed.hostname || parsed.username || parsed.password) return null;

    parsed.hostname = parsed.hostname.toLowerCase();
    parsed.hash = '';
    if (
      (parsed.protocol === 'https:' && parsed.port === '443')
      || (parsed.protocol === 'http:' && parsed.port === '80')
    ) {
      parsed.port = '';
    }

    parsed.pathname = parsed.pathname.replace(/\/{2,}/g, '/');
    const pathname = parsed.pathname === '/'
      ? ''
      : parsed.pathname.replace(/\/+$/g, '');

    for (const key of [...parsed.searchParams.keys()]) {
      if (key.toLowerCase().startsWith('utm_') || TRACKING_PARAMETERS.has(key.toLowerCase())) {
        parsed.searchParams.delete(key);
      }
    }
    parsed.searchParams.sort();

    return `${parsed.origin}${pathname}${parsed.search}`;
  } catch {
    return null;
  }
}

export function repairPortfolioUrlCandidate(value) {
  if (typeof value !== 'string') return null;
  const candidate = value.trim();
  if (normalizePortfolioUrl(candidate)) return candidate;

  const withoutTrailingQuote = candidate.endsWith('"')
    && !candidate.slice(0, -1).includes('"')
    ? candidate.slice(0, -1)
    : null;
  return withoutTrailingQuote && normalizePortfolioUrl(withoutTrailingQuote)
    ? withoutTrailingQuote
    : null;
}

export function canonicalUrlKey(value) {
  const normalized = normalizePortfolioUrl(value);
  if (!normalized) return null;

  const parsed = new URL(normalized);
  const hostname = parsed.hostname.replace(/^www\./i, '');
  const port = parsed.port ? `:${parsed.port}` : '';
  return `${hostname}${port}${parsed.pathname}${parsed.search}`;
}

export function sanitizeName(value, fallbackUrl = '') {
  const cleaned = typeof value === 'string'
    ? value.replace(/[*_~`]/g, '').replace(/[\u0000-\u001f\u007f]/gu, '').trim()
    : '';

  if (cleaned) return cleaned.slice(0, 100);

  try {
    return new URL(fallbackUrl).hostname.replace(/^www\./i, '').slice(0, 100);
  } catch {
    return 'Unknown portfolio';
  }
}

export function isHostnameFallbackName(name, url) {
  const cleanedName = typeof name === 'string' ? name.trim() : '';
  if (!cleanedName) return true;

  const normalizedUrl = normalizePortfolioUrl(url);
  if (!normalizedUrl) return false;

  const hostname = new URL(normalizedUrl).hostname.replace(/^www\./i, '').slice(0, 100);
  return cleanedName.toLowerCase() === hostname.toLowerCase();
}

export function mergeUpstreamPortfolioName(existingName, upstreamName, url) {
  if (!isHostnameFallbackName(existingName, url)) return existingName;

  const normalizedUpstreamName = sanitizeName(upstreamName, url);
  return isHostnameFallbackName(normalizedUpstreamName, url)
    ? existingName
    : normalizedUpstreamName;
}

export function parseMarkdownList(markdown) {
  if (typeof markdown !== 'string') return [];

  const portfolios = [];
  const linkPrefix = /^\s*-\s+\[([^\]]+)\]\((https?:\/\/)/iu;

  for (const line of markdown.split(/\r?\n/u)) {
    const match = line.match(linkPrefix);
    if (!match) continue;

    const urlStart = match[0].length - match[2].length;
    let nestedParentheses = 0;
    let urlEnd = -1;
    for (let index = urlStart; index < line.length; index++) {
      const character = line[index];
      if (/\s/u.test(character)) {
        urlEnd = -1;
        break;
      }
      if (character === '(') {
        nestedParentheses += 1;
      } else if (character === ')') {
        if (nestedParentheses === 0) {
          urlEnd = index;
          break;
        }
        nestedParentheses -= 1;
      }
    }
    if (urlEnd < 0) continue;

    const candidate = repairPortfolioUrlCandidate(line.slice(urlStart, urlEnd));
    const url = normalizePortfolioUrl(candidate);
    if (!url) continue;

    portfolios.push({
      name: sanitizeName(match[1], url),
      url,
    });
  }

  return portfolios;
}

function isMeaningful(value) {
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === 'string') return value.trim().length > 0;
  return value !== null && value !== undefined;
}

function recordRichness(record) {
  return Object.values(record).reduce((score, value) => score + (isMeaningful(value) ? 1 : 0), 0);
}

function recordQuality(record) {
  let score = recordRichness(record);
  if (record.ai_processed === true) score += 10_000;
  if (record.is_portfolio === true) score += 1_000;

  const url = normalizePortfolioUrl(record.url);
  if (url) {
    const parsed = new URL(url);
    if (parsed.protocol === 'https:') score += 100;
    if (!parsed.hostname.startsWith('www.')) score += 10;
  }
  return score;
}

function mergeRecords(first, second) {
  const primary = recordQuality(second) > recordQuality(first) ? second : first;
  const secondary = primary === first ? second : first;
  const merged = { ...primary };

  for (const [key, value] of Object.entries(secondary)) {
    if (Array.isArray(merged[key]) || Array.isArray(value)) {
      const combined = [
        ...(Array.isArray(merged[key]) ? merged[key] : []),
        ...(Array.isArray(value) ? value : []),
      ];
      merged[key] = [...new Set(combined.filter(isMeaningful))];
    } else if (!isMeaningful(merged[key]) && isMeaningful(value)) {
      merged[key] = value;
    }
  }

  const viewValues = [first.views, second.views]
    .filter((value) => Number.isSafeInteger(value) && value >= 0);
  if (viewValues.length > 0) merged.views = Math.max(...viewValues);

  return merged;
}

export function normalizeAndDedupe(records) {
  if (!Array.isArray(records)) {
    throw new TypeError('Portfolio data must be a JSON array.');
  }

  const byUrl = new Map();
  let rejected = 0;
  let duplicates = 0;

  for (const rawRecord of records) {
    if (!rawRecord || typeof rawRecord !== 'object' || Array.isArray(rawRecord)) {
      rejected++;
      continue;
    }

    const url = normalizePortfolioUrl(repairPortfolioUrlCandidate(rawRecord.url));
    const key = canonicalUrlKey(url);
    if (!url || !key) {
      rejected++;
      continue;
    }

    const normalizedRecord = {
      ...rawRecord,
      name: sanitizeName(rawRecord.name, url),
      url,
    };

    if (typeof normalizedRecord.screenshot === 'string') {
      const screenshot = normalizePortfolioUrl(normalizedRecord.screenshot);
      if (screenshot) {
        normalizedRecord.screenshot = screenshot;
      } else {
        delete normalizedRecord.screenshot;
      }
    }

    if (byUrl.has(key)) {
      duplicates++;
      byUrl.set(key, mergeRecords(byUrl.get(key), normalizedRecord));
    } else {
      byUrl.set(key, normalizedRecord);
    }
  }

  return {
    records: [...byUrl.values()],
    rejected,
    duplicates,
  };
}

export async function writeJsonAtomic(filePath, value) {
  const directory = path.dirname(filePath);
  const temporaryPath = path.join(
    directory,
    `.${path.basename(filePath)}.${process.pid}.${Date.now()}.tmp`,
  );

  await fs.mkdir(directory, { recursive: true });
  try {
    await fs.writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
    await fs.rename(temporaryPath, filePath);
  } catch (error) {
    await fs.rm(temporaryPath, { force: true }).catch(() => {});
    throw error;
  }
}

async function readBoundedText(response) {
  const contentLength = Number(response.headers.get('content-length') || 0);
  if (contentLength > MAX_README_BYTES) {
    throw new Error(`Upstream README exceeds ${MAX_README_BYTES} bytes.`);
  }

  if (!response.body) throw new Error('Upstream README response had no body.');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let totalBytes = 0;
  let markdown = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    totalBytes += value.byteLength;
    if (totalBytes > MAX_README_BYTES) {
      await reader.cancel();
      throw new Error(`Upstream README exceeds ${MAX_README_BYTES} bytes.`);
    }
    markdown += decoder.decode(value, { stream: true });
  }

  return markdown + decoder.decode();
}

async function fetchReadme() {
  let lastError;
  for (let attempt = 1; attempt <= FETCH_ATTEMPTS; attempt++) {
    try {
      const response = await fetch(README_URL, {
        headers: { accept: 'text/markdown,text/plain;q=0.9' },
        signal: AbortSignal.timeout(20_000),
      });
      if (!response.ok) {
        throw new Error(`Failed to fetch README.md: HTTP ${response.status}`);
      }

      const contentType = response.headers.get('content-type')?.toLowerCase() || '';
      if (
        contentType
        && !contentType.includes('text/plain')
        && !contentType.includes('text/markdown')
        && !contentType.includes('application/octet-stream')
      ) {
        throw new Error(`Unexpected upstream content type: ${contentType}`);
      }

      return await readBoundedText(response);
    } catch (error) {
      lastError = error;
      if (attempt < FETCH_ATTEMPTS) {
        const delay = attempt * 1_500;
        console.warn(
          `Upstream fetch attempt ${attempt}/${FETCH_ATTEMPTS} failed; retrying in ${delay}ms.`,
        );
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }
  throw lastError;
}

async function readExistingPortfolios() {
  try {
    const fileData = await fs.readFile(DATA_FILE, 'utf8');
    const parsed = JSON.parse(fileData);
    if (!Array.isArray(parsed)) {
      throw new TypeError(`${DATA_FILE} must contain a JSON array.`);
    }
    return parsed;
  } catch (error) {
    if (error?.code === 'ENOENT') {
      console.warn('No existing portfolios.json found; creating a new data file.');
      return [];
    }
    throw new Error(`Could not safely read ${DATA_FILE}: ${error.message}`, { cause: error });
  }
}

export async function run() {
  console.log('Fetching upstream portfolio list...');
  const markdown = await fetchReadme();
  const extracted = parseMarkdownList(markdown);
  if (extracted.length < MIN_UPSTREAM_PORTFOLIOS) {
    throw new Error(
      `Upstream parsing returned only ${extracted.length} portfolios; `
      + `at least ${MIN_UPSTREAM_PORTFOLIOS} are required.`,
    );
  }
  const upstream = normalizeAndDedupe(extracted);

  const existing = normalizeAndDedupe(await readExistingPortfolios());
  const existingByUrl = new Map(
    existing.records.map((portfolio) => [canonicalUrlKey(portfolio.url), portfolio]),
  );

  let newCount = 0;
  let repairedNameCount = 0;
  for (const item of upstream.records) {
    const key = canonicalUrlKey(item.url);
    const existingRecord = existingByUrl.get(key);
    if (existingRecord) {
      const mergedName = mergeUpstreamPortfolioName(
        existingRecord.name,
        item.name,
        existingRecord.url,
      );
      if (mergedName !== existingRecord.name) {
        existingRecord.name = mergedName;
        repairedNameCount++;
      }
      continue;
    }

    const record = {
      url: item.url,
      name: item.name,
      role: '',
      specialization: '',
      summary: '',
      tech_stack: [],
      projects: [],
      social_links: [],
      available_for_hire: false,
      primary_language: '',
      views: 0,
      has_blog: false,
      is_portfolio: false,
      ai_processed: false,
      screenshot: `https://s0.wp.com/mshots/v1/${encodeURIComponent(item.url)}?w=600`,
    };
    existing.records.push(record);
    existingByUrl.set(key, record);
    newCount++;
  }

  await writeJsonAtomic(DATA_FILE, existing.records);

  console.log(
    `Synced ${newCount} new portfolios and repaired ${repairedNameCount} fallback names `
    + `(${existing.duplicates} duplicate and `
    + `${existing.rejected} invalid existing records removed). Total: ${existing.records.length}.`,
  );
}

export async function normalizeLocalData() {
  const normalized = normalizeAndDedupe(await readExistingPortfolios());
  if (normalized.records.length === 0) {
    throw new Error('Refusing to replace portfolios.json with an empty data set.');
  }

  await writeJsonAtomic(DATA_FILE, normalized.records);
  console.log(
    `Normalized ${normalized.records.length} local portfolios `
    + `(${normalized.duplicates} duplicate and ${normalized.rejected} invalid records removed).`,
  );
}

const isDirectExecution = process.argv[1]
  && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (isDirectExecution) {
  const command = process.argv.includes('--normalize-only') ? normalizeLocalData : run;
  command().catch((error) => {
    console.error('Data update failed:', error);
    process.exitCode = 1;
  });
}
