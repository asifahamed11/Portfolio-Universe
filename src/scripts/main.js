import Lenis from 'lenis';
import { auth } from '../lib/firebase.js';
import { onAuthStateChanged, signOut } from 'firebase/auth';
import {
  fetchGlobalLikes,
  fetchUserBookmarks,
  incrementPortfolioView as incrementPortfolioViewInFirestore,
  toggleLikeInFirestore,
} from '../lib/dbUtils.js';
import {
  normalizePortfolioUrl,
  sanitizeBookmarks,
  sanitizePortfolio,
  toSafeCount,
  urlToDocumentKey,
  urlToKey,
} from '../lib/utils.js';
import {
  createMshotsScreenshotUrl,
  createPreviewAttemptGate,
  installPreviewRecovery,
} from '../lib/previewRecovery.js';

const FALLBACK_SCREENSHOT = `${import.meta.env.BASE_URL}portfolio-placeholder.svg`;
const PORTFOLIO_DATA_TIMEOUT_MS = 30_000;
const PORTFOLIO_DATA_RETRY_DELAYS_MS = [1_000, 3_000];
const PORTFOLIO_DATA_BACKGROUND_RETRY_MS = 30_000;
const DEFAULT_AVATAR =
  'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" fill="%239CA3AF" viewBox="0 0 24 24"><path d="M12 2a5 5 0 1 0 5 5 5 5 0 0 0-5-5zm0 8a3 3 0 1 1 3-3 3 3 0 0 1-3 3zm9 11v-1a7 7 0 0 0-7-7h-4a7 7 0 0 0-7 7v1h2v-1a5 5 0 0 1 5-5h4a5 5 0 0 1 5 5v1z"/></svg>';
const memoryStorage = new Map();

const storageGet = (key) => {
  try {
    const value = localStorage.getItem(key);
    if (value !== null) memoryStorage.set(key, value);
    return value ?? memoryStorage.get(key) ?? null;
  } catch {
    return memoryStorage.get(key) ?? null;
  }
};

const storageSet = (key, value) => {
  memoryStorage.set(key, value);
  try {
    localStorage.setItem(key, value);
  } catch {
    // Keep the session usable with the in-memory fallback.
  }
};

const storageRemove = (key) => {
  memoryStorage.delete(key);
  try {
    localStorage.removeItem(key);
  } catch {
    // The in-memory value has still been cleared.
  }
};

const parseJSON = (value, fallback) => {
  if (typeof value !== 'string' || !value) return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
};

const getStoredUser = () => {
  const user = parseJSON(storageGet('pu_user'), null);
  return user && typeof user.uid === 'string' && user.uid ? user : null;
};

const getBookmarkStorageKey = (uid) => `pu_bookmarks_${uid}`;

const readStoredBookmarks = (uid) =>
  sanitizeBookmarks(parseJSON(storageGet(getBookmarkStorageKey(uid)), []));

const writeStoredBookmarks = (uid, bookmarks) => {
  const normalized = sanitizeBookmarks(bookmarks);
  storageSet(getBookmarkStorageKey(uid), JSON.stringify(normalized));
  return normalized;
};

const createToastIcon = (kind) => {
  const wrapper = document.createElement('div');
  wrapper.className =
    'shrink-0 bg-white/5 p-1.5 rounded-full border border-white/10 shadow-inner';
  wrapper.innerHTML = kind === 'heart'
    ? '<svg aria-hidden="true" xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="#f43f5e" stroke="#f43f5e" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"/></svg>'
    : kind === 'error'
      ? '<svg aria-hidden="true" xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fb7185" stroke-width="3" stroke-linecap="round"><path d="m6 6 12 12M18 6 6 18"/></svg>'
      : '<svg aria-hidden="true" xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#34d399" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>';
  return wrapper;
};

window.showToast = (message, icon = 'check') => {
  const container = document.getElementById('toast-container');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className =
    'flex items-center gap-3 px-4 py-3 rounded-2xl bg-white/[0.08] backdrop-blur-xl border border-white/20 text-white shadow-[0_8px_30px_rgba(0,0,0,0.4)] transform translate-y-10 opacity-0 transition-all duration-500 ease-out pointer-events-auto';
  toast.setAttribute('role', icon === 'error' ? 'alert' : 'status');

  const text = document.createElement('p');
  text.className = 'text-sm font-semibold tracking-wide drop-shadow-md pr-2';
  text.textContent = String(message);

  toast.append(createToastIcon(icon), text);
  container.appendChild(toast);

  requestAnimationFrame(() => {
    toast.classList.remove('translate-y-10', 'opacity-0');
    toast.classList.add('translate-y-0', 'opacity-100');
  });

  setTimeout(() => {
    toast.classList.remove('translate-y-0', 'opacity-100');
    toast.classList.add('translate-y-10', 'opacity-0');
    setTimeout(() => toast.remove(), 500);
  }, 3000);
};

const initializeApp = () => {
  const gridContainer = document.getElementById('portfolioGrid');
  if (!gridContainer) return;

  const cardTemplate = document.getElementById('portfolioCardTemplate');
  const loadMoreContainer = document.getElementById('loadMoreContainer');
  const emptyState = document.getElementById('emptyState');
  const resultStatus = document.getElementById('resultStatus');
  const searchInputDesk = document.getElementById('searchInputDesk');
  const searchInputMob = document.getElementById('searchInputMob');
  const searchShells = Array.from(document.querySelectorAll('[data-search-shell]'));
  const searchClearButtons = Array.from(document.querySelectorAll('[data-search-clear]'));
  const filterContainer = document.getElementById('filterContainer');
  const filterButtons = Array.from(document.querySelectorAll('.filter-btn'));
  const clearFiltersButton = document.getElementById('clearFiltersBtn');
  const activeIndicator = document.getElementById('activeIndicator');
  const topNavBar = document.getElementById('topNavBar');
  const scrollToTopButton = document.getElementById('scrollToTopBtn');
  const loginButton = document.getElementById('loginBtn');
  const userProfile = document.getElementById('userProfile');
  const userAvatar = document.getElementById('userAvatar');
  const userName = document.getElementById('userName');
  const logoutButton = document.getElementById('logoutBtn');
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

  const ITEMS_PER_PAGE = 20;
  const INITIAL_VISIBLE_COUNT = 40;
  const itemElements = new Map();
  const pendingBookmarkUrls = new Set();
  const optimisticLikeDeltas = new Map();
  let allPortfolios = [];
  let filteredItems = [];
  let currentFilter = 'all';
  let searchQuery = '';
  let visibleCount = INITIAL_VISIBLE_COUNT;
  let cachedGlobalLikes = {};
  let searchTimer = 0;
  let authGeneration = 0;
  let bookmarkMutationVersion = 0;
  let portfolioDataLoaded = false;
  let portfolioLoadPromise = null;
  let portfolioRetryTimer = 0;
  let portfolioRetryRound = 0;
  let portfolioFailureNotified = false;
  const requestMshotsRetryAttempt = createPreviewAttemptGate({
    concurrency: 4,
    maxQueued: 48,
    maxTotal: Number.POSITIVE_INFINITY,
  });
  const requestSecondaryPreviewAttempt = createPreviewAttemptGate({
    concurrency: 2,
    maxQueued: 8,
    maxTotal: 16,
  });

  const initialWrappers = Array.from(
    gridContainer.querySelectorAll(':scope > .portfolio-wrapper')
  );

  const installImageFallback = (image, portfolioUrl) => {
    if (
      !(image instanceof HTMLImageElement)
      || image.dataset.previewRecoveryReady === 'true'
    ) {
      return;
    }

    installPreviewRecovery(image, {
      portfolioUrl,
      fallbackSrc: FALLBACK_SCREENSHOT,
      requestMshotsRetryAttempt,
      requestSecondaryAttempt: requestSecondaryPreviewAttempt,
    });
  };

  for (const wrapper of initialWrappers) {
    const url = normalizePortfolioUrl(wrapper.dataset.url);
    if (!url || itemElements.has(url)) {
      wrapper.remove();
      continue;
    }
    wrapper.dataset.url = url;
    installImageFallback(wrapper.querySelector('.portfolio-image'), url);
    itemElements.set(url, wrapper);
  }

  const extractInitialPortfolios = () =>
    Array.from(itemElements.values())
      .map((wrapper, index) => sanitizePortfolio({
        name: wrapper.querySelector('.portfolio-name')?.textContent || wrapper.dataset.name,
        url: wrapper.dataset.url,
        screenshot: wrapper.querySelector('.portfolio-image')?.getAttribute('src'),
        summary: wrapper.querySelector('.mobile-summary')?.textContent || '',
        role: wrapper.querySelector('.role-text')?.textContent || wrapper.dataset.role,
        tech_stack: (wrapper.dataset.tech || '').split(',').filter(Boolean),
        available_for_hire: wrapper.dataset.hire === 'true',
        baseLikes: wrapper.querySelector('.like-count')?.textContent,
        views: wrapper.querySelector('.view-count')?.textContent,
      }, index))
      .filter(Boolean);

  allPortfolios = extractInitialPortfolios();
  filteredItems = [...allPortfolios];

  const sanitizePortfolioList = (records) => {
    const portfoliosByUrl = new Map();

    for (let index = 0; index < records.length; index += 1) {
      const portfolio = sanitizePortfolio(records[index], index);
      if (!portfolio) continue;

      const existing = portfoliosByUrl.get(portfolio.url);
      if (!existing) {
        portfoliosByUrl.set(portfolio.url, portfolio);
        continue;
      }

      existing.summary ||= portfolio.summary;
      existing.role ||= portfolio.role;
      existing.screenshot ||= portfolio.screenshot;
      existing.available_for_hire ||= portfolio.available_for_hire;
      existing.views = Math.max(existing.views, portfolio.views);
      existing.tech_stack = [...new Set([...existing.tech_stack, ...portfolio.tech_stack])].slice(0, 12);
    }

    return Array.from(portfoliosByUrl.values());
  };

  const setElementText = (root, selector, value) => {
    const element = root.querySelector(selector);
    if (element) element.textContent = String(value);
  };

  const createPortfolioElement = (portfolio) => {
    if (!(cardTemplate instanceof HTMLTemplateElement)) return null;
    const wrapper = cardTemplate.content.firstElementChild?.cloneNode(true);
    if (!(wrapper instanceof HTMLElement)) return null;

    wrapper.dataset.index = String(portfolio.index);
    wrapper.dataset.name = portfolio.name.toLowerCase();
    wrapper.dataset.url = portfolio.url;
    wrapper.dataset.role = portfolio.role.toLowerCase();
    wrapper.dataset.tech = portfolio.tech_stack.join(',').toLowerCase();
    wrapper.dataset.hire = portfolio.available_for_hire ? 'true' : 'false';

    const link = wrapper.querySelector('.portfolio-link');
    if (link instanceof HTMLAnchorElement) {
      link.href = portfolio.url;
      link.setAttribute('aria-label', `Open ${portfolio.name}'s portfolio`);
    }

    const image = wrapper.querySelector('.portfolio-image');
    if (image instanceof HTMLImageElement) {
      image.src = portfolio.screenshot
        || createMshotsScreenshotUrl(portfolio.url);
      image.alt = `Screenshot of ${portfolio.name}'s portfolio`;
      installImageFallback(image, portfolio.url);
    }

    setElementText(wrapper, '.portfolio-name', portfolio.name);
    setElementText(wrapper, '.view-count', portfolio.views);
    const viewsContainer = wrapper.querySelector('.view-count')?.parentElement;
    if (viewsContainer) viewsContainer.title = `${portfolio.views} views`;

    const hireBadge = wrapper.querySelector('.hire-badge-container');
    if (hireBadge instanceof HTMLElement) hireBadge.hidden = !portfolio.available_for_hire;

    const roleBadge = wrapper.querySelector('.role-badge');
    if (roleBadge instanceof HTMLElement) roleBadge.hidden = !portfolio.role;
    setElementText(wrapper, '.role-text', portfolio.role);

    const mobileSummary = wrapper.querySelector('.mobile-summary');
    if (mobileSummary instanceof HTMLElement) {
      mobileSummary.hidden = !portfolio.summary;
      mobileSummary.textContent = portfolio.summary;
    }

    const tooltip = wrapper.querySelector('.card-tooltip');
    if (tooltip instanceof HTMLElement) tooltip.hidden = !portfolio.summary;
    setElementText(wrapper, '.tooltip-summary', portfolio.summary);

    const techStack = wrapper.querySelector('.tech-stack');
    const techPills = Array.from(wrapper.querySelectorAll('.tech-pill'));
    if (techStack instanceof HTMLElement) techStack.hidden = portfolio.tech_stack.length === 0;
    for (let index = 0; index < techPills.length; index += 1) {
      const pill = techPills[index];
      const tech = portfolio.tech_stack[index];
      pill.textContent = tech || '';
      pill.hidden = !tech;
    }
    const overflow = wrapper.querySelector('.tech-overflow');
    if (overflow instanceof HTMLElement) {
      const overflowCount = Math.max(0, portfolio.tech_stack.length - 3);
      overflow.hidden = overflowCount === 0;
      overflow.textContent = `+${overflowCount}`;
    }

    const bookmarkButton = wrapper.querySelector('.bookmark-btn');
    if (bookmarkButton instanceof HTMLButtonElement) {
      bookmarkButton.dataset.url = portfolio.url;
      bookmarkButton.setAttribute('aria-label', `Save ${portfolio.name}'s portfolio to My Likes`);
      bookmarkButton.setAttribute('aria-pressed', 'false');
    }
    setElementText(wrapper, '.like-count', portfolio.baseLikes);

    return wrapper;
  };

  const likeKeyPromises = new Map();
  const getLikeKey = (url) => {
    const normalized = normalizePortfolioUrl(url);
    if (!normalized) return Promise.reject(new TypeError('Invalid portfolio URL.'));
    if (!likeKeyPromises.has(normalized)) {
      likeKeyPromises.set(normalized, urlToDocumentKey(normalized));
    }
    return likeKeyPromises.get(normalized);
  };

  const getLegacyLikeKeys = (url) => {
    const normalized = normalizePortfolioUrl(url);
    if (!normalized) return [];
    const parsed = new URL(normalized);
    const variants = new Set([normalized]);
    const hostnames = new Set([
      parsed.hostname,
      parsed.hostname.startsWith('www.')
        ? parsed.hostname.slice(4)
        : `www.${parsed.hostname}`,
    ]);
    for (const protocol of ['https:', 'http:']) {
      for (const hostname of hostnames) {
        const variant = new URL(normalized);
        variant.protocol = protocol;
        variant.hostname = hostname;
        variants.add(variant.toString());
        if (variant.pathname === '/') {
          variants.add(variant.toString().replace(`${variant.origin}/`, variant.origin));
        }
      }
    }
    return [...variants].map((variant) =>
      btoa(encodeURIComponent(variant))
        .replace(/\//g, '_')
        .replace(/\+/g, '-')
        .replace(/=/g, '')
    );
  };

  const readGlobalLikeCount = (likes, url, hashedKey) => {
    if (likes[hashedKey] !== undefined) return toSafeCount(likes[hashedKey]);
    return [...new Set(getLegacyLikeKeys(url))].reduce(
      (total, key) => total + toSafeCount(likes[key]),
      0,
    );
  };

  const applyLikesToPortfolios = async (portfolios, likes = null) => {
    const keyedPortfolios = await Promise.all(portfolios.map(async (portfolio) => {
      try {
        return [portfolio, await getLikeKey(portfolio.url)];
      } catch {
        return [portfolio, null];
      }
    }));
    const source = likes ?? cachedGlobalLikes;
    for (const [portfolio, key] of keyedPortfolios) {
      const persistedCount = key
        ? readGlobalLikeCount(source, portfolio.url, key)
        : 0;
      portfolio.baseLikes = Math.max(
        0,
        persistedCount + (optimisticLikeDeltas.get(portfolio.url) || 0),
      );
    }
  };

  const applyGlobalLikesToButtons = async (root = gridContainer) => {
    const buttons = root instanceof Element
      ? root.querySelectorAll('.bookmark-btn')
      : [];

    for (const button of buttons) {
      const url = normalizePortfolioUrl(button.dataset.url);
      const countElement = button.querySelector('.like-count');
      if (!url || !countElement) continue;

      try {
        const count = Math.max(
          0,
          readGlobalLikeCount(
            cachedGlobalLikes,
            url,
            await getLikeKey(url),
          ) + (optimisticLikeDeltas.get(url) || 0),
        );
        countElement.textContent = String(count);
      } catch {
        countElement.textContent = '0';
      }
      updateBookmarkButtonLabel(button);
    }
  };

  const updateBookmarkButtonLabel = (button, isLiked = null) => {
    if (!(button instanceof HTMLButtonElement)) return;
    const liked = typeof isLiked === 'boolean'
      ? isLiked
      : button.getAttribute('aria-pressed') === 'true';
    const name = button.closest('.portfolio-wrapper')
      ?.querySelector('.portfolio-name')?.textContent?.trim() || 'this portfolio';
    const count = toSafeCount(button.querySelector('.like-count')?.textContent);
    const action = liked
      ? `Remove ${name} from My Likes`
      : `Save ${name} to My Likes`;
    button.setAttribute(
      'aria-label',
      `${action}. ${count} ${count === 1 ? 'like' : 'likes'}.`,
    );
  };

  const setBookmarkButtonState = (button, isLiked, pending = false) => {
    if (!(button instanceof HTMLButtonElement)) return;
    const icon = button.querySelector('.heart-icon');
    button.setAttribute('aria-pressed', String(isLiked));
    button.setAttribute('aria-busy', String(pending));
    button.classList.toggle('border-red-500/30', isLiked);
    button.classList.toggle('bg-red-500/10', isLiked);
    button.classList.toggle('text-red-400', isLiked);
    button.toggleAttribute('disabled', pending);
    if (icon) {
      icon.setAttribute('fill', isLiked ? 'currentColor' : 'none');
      icon.classList.toggle('text-red-500', isLiked);
    }
    updateBookmarkButtonLabel(button, isLiked);
  };

  const updateBookmarkButtons = (root = gridContainer) => {
    const user = getStoredUser();
    const bookmarks = user ? readStoredBookmarks(user.uid) : [];
    const buttons = root instanceof Element
      ? root.querySelectorAll('.bookmark-btn')
      : [];

    for (const button of buttons) {
      const url = normalizePortfolioUrl(button.dataset.url);
      const isLiked = Boolean(url && bookmarks.includes(url));
      setBookmarkButtonState(
        button,
        isLiked,
        Boolean(url && pendingBookmarkUrls.has(url)),
      );
    }
  };

  const updateBookmarkButtonsForUrl = (url, isLiked, pending = false) => {
    for (const button of gridContainer.querySelectorAll('.bookmark-btn')) {
      if (normalizePortfolioUrl(button.dataset.url) !== url) continue;
      setBookmarkButtonState(button, isLiked, pending);
    }
  };

  const adjustOptimisticLikeCount = (url, amount) => {
    const nextDelta = (optimisticLikeDeltas.get(url) || 0) + amount;
    if (nextDelta === 0) optimisticLikeDeltas.delete(url);
    else optimisticLikeDeltas.set(url, nextDelta);

    for (const portfolio of allPortfolios) {
      if (portfolio.url === url) {
        portfolio.baseLikes = Math.max(0, toSafeCount(portfolio.baseLikes) + amount);
      }
    }
    for (const button of gridContainer.querySelectorAll('.bookmark-btn')) {
      if (normalizePortfolioUrl(button.dataset.url) !== url) continue;
      const countElement = button.querySelector('.like-count');
      if (countElement) {
        countElement.textContent = String(
          Math.max(0, toSafeCount(countElement.textContent) + amount),
        );
      }
      updateBookmarkButtonLabel(button);
    }
  };

  const updateResultStatus = () => {
    if (!resultStatus) return;
    const qualifier = searchQuery || currentFilter !== 'all' ? ' matching your filters' : '';
    resultStatus.textContent =
      `${filteredItems.length} portfolio${filteredItems.length === 1 ? '' : 's'}${qualifier}.`;
  };

  const renderGrid = () => {
    const itemsToShow = filteredItems.slice(0, visibleCount);
    const fragment = document.createDocumentFragment();

    for (const portfolio of itemsToShow) {
      let wrapper = itemElements.get(portfolio.url);
      if (!wrapper) {
        wrapper = createPortfolioElement(portfolio);
        if (!wrapper) continue;
        itemElements.set(portfolio.url, wrapper);
      }
      fragment.appendChild(wrapper);
    }

    gridContainer.replaceChildren(fragment);
    updateBookmarkButtons();
    void applyGlobalLikesToButtons();
    updateResultStatus();
    gridContainer.setAttribute('aria-busy', 'false');

    const hasResults = filteredItems.length > 0;
    emptyState?.classList.toggle('hidden', hasResults);
    if (loadMoreContainer) {
      loadMoreContainer.style.display =
        hasResults && visibleCount < filteredItems.length ? 'flex' : 'none';
    }
  };

  const applyFilters = ({ resetPage = false } = {}) => {
    if (resetPage) visibleCount = INITIAL_VISIBLE_COUNT;

    const user = getStoredUser();
    const bookmarks = user ? readStoredBookmarks(user.uid) : [];
    const query = searchQuery;

    filteredItems = allPortfolios.filter((portfolio) => {
      const name = portfolio.name.toLowerCase();
      const role = portfolio.role.toLowerCase();
      const tech = portfolio.tech_stack.join(',').toLowerCase();
      const normalizedRole = role.replace(/[\s-]/g, '');
      const matchesSearch =
        !query || name.includes(query) || role.includes(query) || tech.includes(query);

      let matchesFilter = true;
      if (currentFilter === 'hire') {
        matchesFilter = portfolio.available_for_hire;
      } else if (currentFilter === 'likes') {
        matchesFilter = bookmarks.includes(portfolio.url);
      } else if (currentFilter === 'designer') {
        matchesFilter =
          role.includes('design') || role.includes('ui') || role.includes('creative');
      } else if (currentFilter === 'fullstack') {
        matchesFilter = normalizedRole.includes('fullstack');
      } else if (currentFilter === 'frontend') {
        matchesFilter = normalizedRole.includes('frontend');
      } else if (currentFilter === 'backend') {
        matchesFilter = normalizedRole.includes('backend');
      }

      return matchesSearch && matchesFilter;
    });

    filteredItems.sort((a, b) => {
      if (currentFilter === 'most_viewed') {
        return b.views - a.views || a.index - b.index;
      }
      return b.baseLikes - a.baseLikes || a.index - b.index;
    });

    renderGrid();
  };

  let indicatorMeasureFrame = 0;
  let pendingIndicatorButton = null;

  const measureIndicator = (button) => {
    if (
      !activeIndicator
      || !filterContainer
      || !(button instanceof HTMLElement)
    ) return;

    const containerRect = filterContainer.getBoundingClientRect();
    const buttonRect = button.getBoundingClientRect();
    const x = buttonRect.left - containerRect.left + filterContainer.scrollLeft;
    const y = buttonRect.top - containerRect.top + filterContainer.scrollTop;

    activeIndicator.style.height = `${buttonRect.height}px`;
    activeIndicator.style.width = `${buttonRect.width}px`;
    activeIndicator.style.transform = `translate3d(${x}px, ${y}px, 0)`;
    if (!activeIndicator.classList.contains('is-ready')) {
      requestAnimationFrame(() => activeIndicator.classList.add('is-ready'));
    }
  };

  const moveIndicator = (button) => {
    if (!(button instanceof HTMLElement)) return;
    pendingIndicatorButton = button;
    if (indicatorMeasureFrame) return;
    indicatorMeasureFrame = requestAnimationFrame(() => {
      indicatorMeasureFrame = 0;
      const target = pendingIndicatorButton;
      pendingIndicatorButton = null;
      measureIndicator(target);
    });
  };

  const updateFilterRailCue = () => {
    if (!filterContainer) return;
    const rail = filterContainer.parentElement;
    if (!rail) return;
    const hasOverflow = filterContainer.scrollWidth > filterContainer.clientWidth + 1;
    const atEnd =
      !hasOverflow
      || filterContainer.scrollLeft + filterContainer.clientWidth
        >= filterContainer.scrollWidth - 4;
    rail.classList.toggle('filter-rail-has-overflow', hasOverflow);
    rail.classList.toggle('filter-rail-at-end', atEnd);
  };

  const selectFilterButton = (selectedButton) => {
    for (const button of filterButtons) {
      const selected = button === selectedButton;
      button.classList.toggle('active', selected);
      button.setAttribute('aria-pressed', String(selected));
      if (!['hire', 'likes'].includes(button.dataset.filter || '')) {
        button.classList.toggle('text-gray-400', !selected);
      }
    }
    moveIndicator(selectedButton);
    if (
      filterContainer
      && filterContainer.scrollWidth > filterContainer.clientWidth
    ) {
      requestAnimationFrame(() => {
        const containerRect = filterContainer.getBoundingClientRect();
        const buttonRect = selectedButton.getBoundingClientRect();
        let nextScrollLeft = filterContainer.scrollLeft;
        if (buttonRect.left < containerRect.left) {
          nextScrollLeft -= containerRect.left - buttonRect.left;
        } else if (buttonRect.right > containerRect.right) {
          nextScrollLeft += buttonRect.right - containerRect.right;
        }
        filterContainer.scrollTo({
          left: nextScrollLeft,
          behavior: reducedMotion.matches ? 'auto' : 'smooth',
        });
      });
    }
  };

  const animateHeart = (url, isLiked) => {
    for (const button of gridContainer.querySelectorAll('.bookmark-btn')) {
      if (normalizePortfolioUrl(button.dataset.url) !== url) continue;
      const icon = button.querySelector('.heart-icon');
      if (!icon) continue;
      for (const animation of icon.getAnimations?.() || []) animation.cancel();
      icon.classList.remove('heart-animated', 'heart-unlike-animated');
      requestAnimationFrame(() => {
        icon.classList.add(isLiked ? 'heart-animated' : 'heart-unlike-animated');
      });
      if (isLiked) window.triggerSpark?.(button);
    }
  };

  const refreshBookmarksFromServer = async (uid, generation = authGeneration) => {
    const versionAtStart = bookmarkMutationVersion;
    try {
      const bookmarks = await fetchUserBookmarks(uid);
      const sameUser = getStoredUser()?.uid === uid;
      if (
        generation === authGeneration
        && sameUser
        && versionAtStart === bookmarkMutationVersion
      ) {
        writeStoredBookmarks(uid, bookmarks);
        updateBookmarkButtons();
        if (currentFilter === 'likes') applyFilters();
      }
    } catch (error) {
      console.warn('Using cached bookmarks because the server read failed.', error);
    }
  };

  const toggleBookmark = async (sourceButton, rawUrl) => {
    const user = getStoredUser();
    if (!user) {
      window.openLoginModal?.();
      return;
    }

    const url = normalizePortfolioUrl(rawUrl);
    if (!url || pendingBookmarkUrls.has(url)) return;

    const before = readStoredBookmarks(user.uid);
    const shouldLike = !before.includes(url);
    const optimistic = shouldLike
      ? [...before, url]
      : before.filter((bookmark) => bookmark !== url);
    let nextFocusUrl = null;
    const restoreFilterFocus =
      currentFilter === 'likes'
      && !shouldLike
      && document.activeElement === sourceButton;
    if (restoreFilterFocus) {
      const visibleButtons = Array.from(
        gridContainer.querySelectorAll('.bookmark-btn'),
      ).filter((button) => button instanceof HTMLButtonElement);
      const currentIndex = visibleButtons.indexOf(sourceButton);
      const orderedCandidates = [
        ...visibleButtons.slice(currentIndex + 1),
        ...visibleButtons.slice(0, Math.max(0, currentIndex)),
      ];
      const candidate = orderedCandidates.find((button) => {
        const candidateUrl = normalizePortfolioUrl(button.dataset.url);
        return candidateUrl && optimistic.includes(candidateUrl);
      });
      nextFocusUrl = candidate
        ? normalizePortfolioUrl(candidate.dataset.url)
        : null;
    }

    bookmarkMutationVersion += 1;
    writeStoredBookmarks(user.uid, optimistic);
    pendingBookmarkUrls.add(url);
    adjustOptimisticLikeCount(url, shouldLike ? 1 : -1);
    updateBookmarkButtonsForUrl(url, shouldLike, true);
    animateHeart(url, shouldLike);
    window.playPopSound?.(shouldLike ? 1 : 0.8);
    if (shouldLike && navigator.vibrate) navigator.vibrate(28);
    if (currentFilter === 'likes') {
      applyFilters();
      if (restoreFilterFocus) {
        requestAnimationFrame(() => {
          const nextButton = Array.from(
            gridContainer.querySelectorAll('.bookmark-btn'),
          ).find((button) =>
            normalizePortfolioUrl(button.dataset.url) === nextFocusUrl
          );
          if (nextButton instanceof HTMLButtonElement) nextButton.focus();
          else filterButtons.find((button) => button.dataset.filter === 'likes')?.focus();
        });
      }
    }

    try {
      await toggleLikeInFirestore(user.uid, url, shouldLike);
      window.showToast?.(
        shouldLike ? 'Saved to My Likes!' : 'Removed from My Likes.',
        shouldLike ? 'heart' : 'check'
      );
    } catch (error) {
      console.error('Bookmark update failed:', error);
      const current = readStoredBookmarks(user.uid);
      const rolledBack = shouldLike
        ? current.filter((bookmark) => bookmark !== url)
        : [...new Set([...current, url])];
      bookmarkMutationVersion += 1;
      writeStoredBookmarks(user.uid, rolledBack);
      adjustOptimisticLikeCount(url, shouldLike ? -1 : 1);
      window.showToast?.('Could not save that change. Please try again.', 'error');
      if (currentFilter === 'likes') applyFilters();
    } finally {
      pendingBookmarkUrls.delete(url);
      const isLiked = readStoredBookmarks(user.uid).includes(url);
      updateBookmarkButtonsForUrl(url, isLiked, false);
      if (pendingBookmarkUrls.size === 0) {
        void refreshBookmarksFromServer(user.uid);
      }
    }
  };

  const recordPortfolioView = async (rawUrl) => {
    if (!auth.currentUser) return;
    const url = normalizePortfolioUrl(rawUrl);
    if (!url) return;

    let key;
    try {
      key = `pu_viewed_${urlToKey(url)}`;
      if (sessionStorage.getItem(key)) return;
      sessionStorage.setItem(key, 'pending');
    } catch {
      key = null;
    }

    try {
      await incrementPortfolioViewInFirestore(url);
      if (key) sessionStorage.setItem(key, '1');
    } catch (error) {
      if (key) sessionStorage.removeItem(key);
      console.warn('View counter update failed:', error);
    }
  };

  window.incrementPortfolioView = (url) => {
    void recordPortfolioView(url);
  };

  gridContainer.addEventListener('click', (event) => {
    const target = event.target instanceof Element ? event.target : null;
    const bookmarkButton = target?.closest('.bookmark-btn');
    if (bookmarkButton instanceof HTMLButtonElement) {
      event.preventDefault();
      event.stopPropagation();
      void toggleBookmark(bookmarkButton, bookmarkButton.dataset.url);
      return;
    }

    const link = target?.closest('.portfolio-link');
    if (link instanceof HTMLAnchorElement) {
      void recordPortfolioView(link.href);
    }
  });

  if (!reducedMotion.matches) {
    gridContainer.addEventListener('pointermove', (event) => {
      const target = event.target instanceof Element ? event.target : null;
      const card = target?.closest('.border-glow-card[data-glow="dynamic"]');
      if (!(card instanceof HTMLElement)) return;

      const rect = card.getBoundingClientRect();
      const halfWidth = rect.width / 2;
      const halfHeight = rect.height / 2;
      const x = event.clientX - rect.left;
      const y = event.clientY - rect.top;
      const dx = x - halfWidth;
      const dy = y - halfHeight;
      const kx = dx === 0 ? Infinity : halfWidth / Math.abs(dx);
      const ky = dy === 0 ? Infinity : halfHeight / Math.abs(dy);
      const edge = Math.min(Math.max(1 / Math.min(kx, ky), 0), 1);
      let angle = dx === 0 && dy === 0 ? 0 : Math.atan2(dy, dx) * (180 / Math.PI) + 90;
      if (angle < 0) angle += 360;
      card.style.setProperty('--edge-proximity', (edge * 100).toFixed(3));
      card.style.setProperty('--cursor-angle', `${angle.toFixed(3)}deg`);
    }, { passive: true });
  }

  const syncSearchUi = (value, { searching = false } = {}) => {
    const normalizedValue = typeof value === 'string' ? value : '';
    const hasValue = normalizedValue.length > 0;
    for (const input of [searchInputDesk, searchInputMob]) {
      if (input instanceof HTMLInputElement && input.value !== normalizedValue) {
        input.value = normalizedValue;
      }
    }
    for (const shell of searchShells) {
      if (!(shell instanceof HTMLElement)) continue;
      shell.dataset.hasValue = String(hasValue);
      shell.dataset.searching = String(searching);
    }
    for (const button of searchClearButtons) {
      if (!(button instanceof HTMLButtonElement)) continue;
      button.hidden = !hasValue;
      button.disabled = !hasValue;
      button.tabIndex = hasValue ? 0 : -1;
      button.setAttribute('aria-hidden', String(!hasValue));
    }
  };

  const commitSearch = (value) => {
    searchQuery = value.toLowerCase().trim();
    syncSearchUi(value, { searching: false });
    applyFilters({ resetPage: true });
  };

  const clearSearch = ({ focusInput = null, apply = true } = {}) => {
    window.clearTimeout(searchTimer);
    searchTimer = 0;
    searchQuery = '';
    syncSearchUi('', { searching: false });
    if (apply) applyFilters({ resetPage: true });
    if (focusInput instanceof HTMLInputElement) focusInput.focus();
  };

  const handleSearch = (event) => {
    const input = event.currentTarget;
    if (!(input instanceof HTMLInputElement)) return;

    syncSearchUi(input.value, { searching: true });
    window.clearTimeout(searchTimer);
    searchTimer = window.setTimeout(() => {
      searchTimer = 0;
      commitSearch(input.value);
    }, 125);
  };

  searchInputDesk?.addEventListener('input', handleSearch);
  searchInputMob?.addEventListener('input', handleSearch);

  for (const button of searchClearButtons) {
    button.addEventListener('click', () => {
      const input = button.closest('[data-search-shell]')?.querySelector('input[type="search"]');
      clearSearch({
        focusInput: input instanceof HTMLInputElement ? input : null,
      });
    });
  }

  for (const input of [searchInputDesk, searchInputMob]) {
    if (!(input instanceof HTMLInputElement)) continue;
    input.addEventListener('keydown', event => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      if (input.value) clearSearch({ focusInput: input });
      else input.blur();
    });
  }

  document.addEventListener('keydown', event => {
    if (
      event.key !== '/'
      || event.defaultPrevented
      || event.metaKey
      || event.ctrlKey
      || event.altKey
      || document.querySelector('[role="dialog"][aria-hidden="false"]')
    ) return;
    const target = event.target;
    if (
      target instanceof HTMLInputElement
      || target instanceof HTMLTextAreaElement
      || (target instanceof HTMLElement && target.isContentEditable)
    ) return;
    const visibleInput = [searchInputDesk, searchInputMob].find(
      input => input instanceof HTMLInputElement && input.offsetParent !== null,
    );
    if (!(visibleInput instanceof HTMLInputElement)) return;
    event.preventDefault();
    visibleInput.focus();
    visibleInput.select();
  });

  syncSearchUi('');

  for (const button of filterButtons) {
    button.addEventListener('click', () => {
      const nextFilter = button.dataset.filter || 'all';
      if (nextFilter === 'likes' && !getStoredUser()) {
        window.openLoginModal?.();
        return;
      }

      currentFilter = nextFilter;
      selectFilterButton(button);
      applyFilters({ resetPage: true });
    });
  }

  clearFiltersButton?.addEventListener('click', () => {
    clearSearch({ apply: false });
    const allButton = filterButtons.find((button) => button.dataset.filter === 'all');
    if (allButton instanceof HTMLButtonElement) allButton.click();
  });

  const loadNextPage = () => {
    if (visibleCount >= filteredItems.length) return;
    visibleCount = Math.min(filteredItems.length, visibleCount + ITEMS_PER_PAGE);
    renderGrid();
  };

  loadMoreContainer?.addEventListener('click', loadNextPage);
  if ('IntersectionObserver' in window && loadMoreContainer) {
    const loadMoreObserver = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) loadNextPage();
    }, { rootMargin: '250px' });
    loadMoreObserver.observe(loadMoreContainer);
  }

  const initializeScroll = () => {
    let lenis = null;
    let lastScrollTop = window.scrollY;

    const updateNavbar = (scrollTop, direction) => {
      if (!topNavBar) return;
      topNavBar.style.top = direction > 0 && scrollTop > 50 ? '-100px' : '12px';
    };

    if (!reducedMotion.matches) {
      try {
        lenis = new Lenis({
          autoRaf: true,
          duration: 1.2,
          easing: (time) => Math.min(1, 1.001 - Math.pow(2, -10 * time)),
        });
        lenis.on('scroll', ({ direction, scroll }) => updateNavbar(scroll, direction));
      } catch (error) {
        console.warn('Smooth scrolling is unavailable; using native scrolling.', error);
      }
    }

    if (!lenis) {
      window.addEventListener('scroll', () => {
        const nextScrollTop = window.scrollY;
        updateNavbar(nextScrollTop, nextScrollTop > lastScrollTop ? 1 : -1);
        lastScrollTop = Math.max(0, nextScrollTop);
      }, { passive: true });
    }

    scrollToTopButton?.addEventListener('click', () => {
      if (lenis) lenis.scrollTo(0);
      else window.scrollTo({ top: 0, behavior: reducedMotion.matches ? 'auto' : 'smooth' });
    });
  };

  initializeScroll();

  const updateAuthUI = (user) => {
    const activeElement = document.activeElement;
    const focusLogoutAfterUpdate = Boolean(user && activeElement === loginButton);
    const focusLoginAfterUpdate = Boolean(
      !user
      && activeElement instanceof Node
      && userProfile?.contains(activeElement),
    );

    if (user) {
      loginButton?.classList.add('hidden');
      userProfile?.classList.remove('hidden');
      userProfile?.classList.add('flex');
      if (userAvatar instanceof HTMLImageElement) {
        userAvatar.hidden = false;
        userAvatar.src = user.photoURL || DEFAULT_AVATAR;
        userAvatar.alt = `${user.displayName || 'User'}'s avatar`;
      }
      if (userName) userName.textContent = user.displayName || 'User';
    } else {
      loginButton?.classList.remove('hidden');
      userProfile?.classList.add('hidden');
      userProfile?.classList.remove('flex');
      if (userAvatar instanceof HTMLImageElement) {
        userAvatar.removeAttribute('src');
        userAvatar.alt = 'User avatar';
      }
      if (userName) userName.textContent = '';
    }

    if (focusLogoutAfterUpdate || focusLoginAfterUpdate) {
      requestAnimationFrame(() => {
        const target = focusLogoutAfterUpdate ? logoutButton : loginButton;
        if (target instanceof HTMLElement && target.offsetParent !== null) target.focus();
      });
    }
  };

  userAvatar?.addEventListener('error', () => {
    if (!(userAvatar instanceof HTMLImageElement)) return;
    if (userAvatar.getAttribute('src') === DEFAULT_AVATAR) {
      userAvatar.hidden = true;
      return;
    }
    userAvatar.src = DEFAULT_AVATAR;
  });

  onAuthStateChanged(auth, (user) => {
    const generation = ++authGeneration;
    updateAuthUI(user);

    if (user) {
      storageSet('pu_user', JSON.stringify({
        name: user.displayName || 'User',
        avatar: user.photoURL || null,
        uid: user.uid,
      }));
      updateBookmarkButtons();
      if (currentFilter === 'likes') applyFilters();
      void refreshBookmarksFromServer(user.uid, generation);
    } else {
      storageRemove('pu_user');
      updateBookmarkButtons();
      if (currentFilter === 'likes') {
        currentFilter = 'all';
        const allButton = filterButtons.find((button) => button.dataset.filter === 'all');
        if (allButton) selectFilterButton(allButton);
        applyFilters({ resetPage: true });
      }
    }

    window.dispatchEvent(new Event('auth-changed'));
  });

  logoutButton?.addEventListener('click', async (event) => {
    event.stopPropagation();
    try {
      await signOut(auth);
    } catch (error) {
      console.error('Logout failed:', error);
      window.showToast?.('Could not log out. Please try again.', 'error');
    }
  });

  window.addEventListener('storage', (event) => {
    const user = getStoredUser();
    if (!user || event.key !== getBookmarkStorageKey(user.uid)) return;
    updateBookmarkButtons();
    if (currentFilter === 'likes') applyFilters();
  });

  const loadGlobalLikes = async () => {
    try {
      const likes = await fetchGlobalLikes();
      cachedGlobalLikes = likes;
      await applyLikesToPortfolios(allPortfolios, likes);
      await applyGlobalLikesToButtons();
      applyFilters();
    } catch (error) {
      console.warn('Global like totals are unavailable; keeping the current counters.', error);
    }
  };

  const fetchPortfolioRecords = async () => {
    const controller = new AbortController();
    const timeoutId = window.setTimeout(
      () => controller.abort(),
      PORTFOLIO_DATA_TIMEOUT_MS,
    );
    try {
      const response = await fetch(`${import.meta.env.BASE_URL}portfolios.json`, {
        credentials: 'same-origin',
        headers: { Accept: 'application/json' },
        signal: controller.signal,
      });
      if (!response.ok) {
        throw new Error(`Portfolio data request failed with HTTP ${response.status}.`);
      }
      const contentType = response.headers.get('content-type') || '';
      if (!contentType.toLowerCase().includes('application/json')) {
        throw new TypeError('Portfolio data response was not JSON.');
      }
      const records = await response.json();
      if (!Array.isArray(records)) throw new TypeError('Portfolio data must be an array.');
      return records;
    } finally {
      window.clearTimeout(timeoutId);
    }
  };

  const schedulePortfolioRetry = () => {
    if (portfolioDataLoaded || portfolioRetryTimer) return;
    const delay = Math.min(
      5 * 60_000,
      PORTFOLIO_DATA_BACKGROUND_RETRY_MS * (2 ** Math.min(portfolioRetryRound, 4)),
    );
    portfolioRetryTimer = window.setTimeout(() => {
      portfolioRetryTimer = 0;
      portfolioRetryRound += 1;
      void loadPortfolioData({ notifyOnFailure: false });
    }, delay);
  };

  const loadPortfolioData = async ({ notifyOnFailure = true } = {}) => {
    if (portfolioDataLoaded) return true;
    if (portfolioLoadPromise) return portfolioLoadPromise;

    portfolioLoadPromise = (async () => {
      let lastError = new Error('Portfolio data could not be loaded.');

      for (let attempt = 0; attempt <= PORTFOLIO_DATA_RETRY_DELAYS_MS.length; attempt += 1) {
        if (attempt > 0) {
          await new Promise((resolve) => {
            window.setTimeout(resolve, PORTFOLIO_DATA_RETRY_DELAYS_MS[attempt - 1]);
          });
        }

        try {
          const records = await fetchPortfolioRecords();
          const sanitized = sanitizePortfolioList(records);
          if (sanitized.length === 0) throw new TypeError('No valid portfolios were found.');

          await applyLikesToPortfolios(sanitized);
          allPortfolios = sanitized;
          portfolioDataLoaded = true;
          portfolioRetryRound = 0;
          if (portfolioRetryTimer) {
            window.clearTimeout(portfolioRetryTimer);
            portfolioRetryTimer = 0;
          }
          applyFilters({ resetPage: true });
          if (portfolioFailureNotified) {
            window.showToast?.('All portfolios are available again.');
          }
          portfolioFailureNotified = false;
          return true;
        } catch (error) {
          lastError = error instanceof Error ? error : new Error(String(error));
          if (!navigator.onLine) break;
        }
      }

      console.error('Portfolio data failed to load:', lastError);
      if (!portfolioFailureNotified) {
        allPortfolios = extractInitialPortfolios();
        applyFilters({ resetPage: true });
        if (notifyOnFailure) {
          window.showToast?.(
            'Some portfolios could not be loaded. Showing the available cards while reconnecting.',
            'error',
          );
        }
        portfolioFailureNotified = true;
      }
      schedulePortfolioRetry();
      return false;
    })();

    try {
      return await portfolioLoadPromise;
    } finally {
      portfolioLoadPromise = null;
    }
  };

  filterContainer?.addEventListener('scroll', updateFilterRailCue, { passive: true });

  window.addEventListener('resize', () => {
    const selected = filterButtons.find((button) => button.getAttribute('aria-pressed') === 'true');
    if (selected) moveIndicator(selected);
    updateFilterRailCue();
  }, { passive: true });

  window.visualViewport?.addEventListener('resize', () => {
    const selected = filterButtons.find((button) => button.getAttribute('aria-pressed') === 'true');
    if (selected) moveIndicator(selected);
    updateFilterRailCue();
  }, { passive: true });

  if (filterContainer && 'ResizeObserver' in window) {
    const filterResizeObserver = new ResizeObserver(() => {
      const selected = filterButtons.find(
        button => button.getAttribute('aria-pressed') === 'true',
      );
      if (selected) moveIndicator(selected);
      updateFilterRailCue();
    });
    filterResizeObserver.observe(filterContainer);
    for (const button of filterButtons) filterResizeObserver.observe(button);
  }

  document.fonts?.ready.then(() => {
    const selected = filterButtons.find(button => button.getAttribute('aria-pressed') === 'true');
    if (selected) moveIndicator(selected);
    updateFilterRailCue();
  });

  window.addEventListener('online', () => {
    if (portfolioDataLoaded) return;
    if (portfolioRetryTimer) {
      window.clearTimeout(portfolioRetryTimer);
      portfolioRetryTimer = 0;
    }
    void loadPortfolioData({ notifyOnFailure: false });
  });

  const selectedFilter = filterButtons.find((button) => button.classList.contains('active'));
  if (selectedFilter) {
    selectedFilter.setAttribute('aria-pressed', 'true');
    moveIndicator(selectedFilter);
  }
  updateFilterRailCue();

  updateBookmarkButtons();
  void applyGlobalLikesToButtons();
  void loadPortfolioData();
  void loadGlobalLikes();
};

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initializeApp, { once: true });
} else {
  initializeApp();
}
