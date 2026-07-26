// Shared utility functions used by the browser and Firestore helpers.

const UNSAFE_URL_CHARACTERS = /[\u0000-\u001f\u007f\s"'<>`\\]/;
const TRACKING_PARAMETER = /^(utm_.*|fbclid|gclid|dclid|mc_cid|mc_eid|ref|ref_src)$/i;

/**
 * Return a stable, safe HTTP(S) URL or null when the value must not be rendered
 * or fetched. The result intentionally omits a root-only trailing slash so the
 * same portfolio does not get separate counters for `example.com` and
 * `example.com/`.
 *
 * @param {unknown} value
 * @returns {string | null}
 */
export const normalizePortfolioUrl = (value) => {
  if (typeof value !== 'string') return null;

  const input = value.trim();
  if (!input || input.length > 2048 || UNSAFE_URL_CHARACTERS.test(input)) return null;

  try {
    const parsed = new URL(input);
    if (!['http:', 'https:'].includes(parsed.protocol)) return null;
    if (!parsed.hostname || parsed.username || parsed.password) return null;

    parsed.hash = '';
    for (const key of [...parsed.searchParams.keys()]) {
      if (TRACKING_PARAMETER.test(key)) parsed.searchParams.delete(key);
    }

    parsed.hostname = parsed.hostname.toLowerCase();
    if ((parsed.protocol === 'https:' && parsed.port === '443') ||
        (parsed.protocol === 'http:' && parsed.port === '80')) {
      parsed.port = '';
    }

    parsed.pathname = parsed.pathname.replace(/\/{2,}/g, '/');
    parsed.searchParams.sort();

    const pathname = parsed.pathname === '/'
      ? ''
      : parsed.pathname.replace(/\/+$/, '');
    return `${parsed.origin}${pathname}${parsed.search}`;
  } catch {
    return null;
  }
};

/**
 * Return a protocol- and www-insensitive identity for deduplication and stable
 * Firestore document IDs.
 *
 * @param {string} url
 * @returns {string}
 */
export const canonicalUrlKey = (url) => {
  const normalized = normalizePortfolioUrl(url);
  if (!normalized) throw new TypeError('A valid HTTP(S) portfolio URL is required.');

  const parsed = new URL(normalized);
  const hostname = parsed.hostname.replace(/^www\./i, '');
  const port = parsed.port ? `:${parsed.port}` : '';
  return `${hostname}${port}${parsed.pathname}${parsed.search}`;
};

/**
 * Create the fixed-length SHA-256 Firestore document ID used by the trusted
 * migration job. This avoids Firestore's 1,500-byte document-ID limit.
 *
 * @param {string} url
 * @returns {Promise<string>}
 */
export const urlToDocumentKey = async (url) => {
  const identity = canonicalUrlKey(url);
  if (!globalThis.crypto?.subtle) {
    throw new Error('This browser does not support secure URL hashing.');
  }

  const digest = await globalThis.crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(identity),
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
};

/**
 * Coerce an untrusted counter to a finite, non-negative integer.
 *
 * @param {unknown} value
 * @returns {number}
 */
export const toSafeCount = (value) => {
  const number = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(number) || number < 0) return 0;
  return Math.min(Number.MAX_SAFE_INTEGER, Math.floor(number));
};

/**
 * Derive a useful visible label when enrichment produced an empty name.
 *
 * @param {unknown} name
 * @param {string} url
 * @returns {string}
 */
export const getPortfolioDisplayName = (name, url) => {
  if (typeof name === 'string') {
    const cleanName = name.trim().replace(/\s+/g, ' ');
    if (cleanName) return cleanName.slice(0, 120);
  }

  try {
    const hostname = new URL(url).hostname.replace(/^www\./i, '');
    return hostname || 'Portfolio';
  } catch {
    return 'Portfolio';
  }
};

/**
 * Validate and normalize a portfolio before it reaches search or DOM creation.
 *
 * @param {unknown} value
 * @param {number} index
 * @returns {null | {
 *   index: number,
 *   name: string,
 *   url: string,
 *   screenshot: string | null,
 *   summary: string,
 *   role: string,
 *   tech_stack: string[],
 *   available_for_hire: boolean,
 *   baseLikes: number,
 *   views: number
 * }}
 */
export const sanitizePortfolio = (value, index = 0) => {
  if (!value || typeof value !== 'object' || value.is_portfolio === false) return null;

  const url = normalizePortfolioUrl(value.url);
  if (!url) return null;

  const screenshot = normalizePortfolioUrl(value.screenshot);
  const summary = typeof value.summary === 'string'
    ? value.summary.trim().replace(/\s+/g, ' ').slice(0, 600)
    : '';
  const role = typeof value.role === 'string'
    ? value.role.trim().replace(/\s+/g, ' ').slice(0, 80)
    : '';
  const techStack = Array.isArray(value.tech_stack)
    ? [...new Set(value.tech_stack
      .filter((item) => typeof item === 'string')
      .map((item) => item.trim().replace(/\s+/g, ' ').slice(0, 40))
      .filter(Boolean))]
      .slice(0, 12)
    : [];

  return {
    index: Number.isSafeInteger(index) && index >= 0 ? index : 0,
    name: getPortfolioDisplayName(value.name, url),
    url,
    screenshot,
    summary,
    role,
    tech_stack: techStack,
    available_for_hire: value.available_for_hire === true,
    baseLikes: toSafeCount(value.baseLikes ?? value.base_likes),
    views: toSafeCount(value.views),
  };
};

/**
 * Normalize and deduplicate a bookmark list while preserving its order.
 *
 * @param {unknown} value
 * @returns {string[]}
 */
export const sanitizeBookmarks = (value) => {
  if (!Array.isArray(value)) return [];

  const seen = new Set();
  const result = [];
  for (const candidate of value) {
    const url = normalizePortfolioUrl(candidate);
    if (url && !seen.has(url)) {
      seen.add(url);
      result.push(url);
      if (result.length === 2000) break;
    }
  }
  return result;
};

/**
 * Encode a canonical URL to a safe Firestore field key.
 *
 * @param {string} url
 * @returns {string}
 */
export const urlToKey = (url) => {
  const canonicalUrl = normalizePortfolioUrl(url);
  if (!canonicalUrl) throw new TypeError('A valid HTTP(S) portfolio URL is required.');

  try {
    return btoa(encodeURIComponent(canonicalUrl))
      .replace(/\//g, '_')
      .replace(/\+/g, '-')
      .replace(/=/g, '');
  } catch {
    let hash = 0;
    for (let i = 0; i < canonicalUrl.length; i++) {
      hash = (Math.imul(31, hash) + canonicalUrl.charCodeAt(i)) | 0;
    }
    return `hash_${hash >>> 0}`;
  }
};
