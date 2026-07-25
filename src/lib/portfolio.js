const UNSAFE_URL_CHARACTERS = /[\u0000-\u0020"'<>\\]/;
const MAX_VIEWS = 1_000_000_000;

const cleanText = (value, maxLength) => {
  if (typeof value !== 'string') return '';
  return value.replace(/\s+/g, ' ').trim().slice(0, maxLength);
};

/**
 * Return a canonical HTTPS URL or null when the value is unsafe.
 * Credentials, non-standard ports, whitespace, quotes, and markup characters
 * are rejected before the value reaches an href/src or a network client.
 */
export const toSafeHttpsUrl = (value) => {
  if (typeof value !== 'string') return null;

  const raw = value.trim();
  if (!raw || raw !== value || UNSAFE_URL_CHARACTERS.test(raw)) return null;

  try {
    const parsed = new URL(raw);
    if (
      parsed.protocol !== 'https:' ||
      !parsed.hostname ||
      parsed.username ||
      parsed.password ||
      (parsed.port && parsed.port !== '443')
    ) {
      return null;
    }

    return parsed.href;
  } catch {
    return null;
  }
};

export const portfolioIdentity = (value) => {
  const safeUrl = toSafeHttpsUrl(value);
  if (!safeUrl) return null;

  const parsed = new URL(safeUrl);
  parsed.hash = '';
  parsed.hostname = parsed.hostname.toLowerCase();
  parsed.pathname = parsed.pathname.replace(/\/+$/, '') || '/';
  return parsed.href.toLowerCase();
};

export const normalizePortfolio = (value) => {
  if (!value || typeof value !== 'object' || value.is_portfolio === false) {
    return null;
  }

  if (
    value.source === 'user_submission' &&
    (value.ai_processed !== true || value.is_portfolio !== true)
  ) {
    return null;
  }

  const url = toSafeHttpsUrl(value.url);
  if (!url) return null;

  const parsedUrl = new URL(url);
  const name =
    cleanText(value.name, 120) ||
    parsedUrl.hostname.replace(/^www\./, '');
  const screenshot = toSafeHttpsUrl(value.screenshot);
  const summary = cleanText(value.summary, 600);
  const role = cleanText(value.role, 80);
  const techStack = Array.isArray(value.tech_stack)
    ? value.tech_stack
        .map((technology) => cleanText(technology, 50))
        .filter(Boolean)
        .slice(0, 8)
    : [];
  const numericViews = Number(value.views);
  const views = Number.isFinite(numericViews)
    ? Math.min(MAX_VIEWS, Math.max(0, Math.trunc(numericViews)))
    : 0;

  return {
    name,
    url,
    screenshot,
    summary,
    role,
    tech_stack: techStack,
    available_for_hire: value.available_for_hire === true,
    views,
  };
};

export const normalizePortfolioCollection = (values) => {
  if (!Array.isArray(values)) return [];

  const unique = new Map();
  for (const value of values) {
    const portfolio = normalizePortfolio(value);
    if (!portfolio) continue;

    const identity = portfolioIdentity(portfolio.url);
    if (identity && !unique.has(identity)) {
      unique.set(identity, portfolio);
    }
  }

  return [...unique.values()];
};
