const MSHOTS_HOSTS = new Set(['s0.wp.com', 's.wordpress.com']);
const DEFAULT_MSHOTS_RETRY_DELAYS_MS = Object.freeze([4_000, 8_000, 12_000]);
const DEFAULT_RETRY_JITTER_MS = 1_200;
const DEFAULT_MSHOTS_ATTEMPT_TIMEOUT_MS = 15_000;
const DEFAULT_SECONDARY_ATTEMPT_TIMEOUT_MS = 20_000;
const activeRecoveries = new WeakMap();

const parseAbsoluteUrl = (value) => {
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    return new URL(value);
  } catch {
    return null;
  }
};

const getImageSource = (image) =>
  image.currentSrc || image.getAttribute?.('src') || image.src || '';

const setRecoveryState = (image, state) => {
  if (image.dataset) image.dataset.previewRecoveryState = state;
};

const stableHash = (value) => {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = ((hash << 5) - hash + value.charCodeAt(index)) | 0;
  }
  return Math.abs(hash);
};

export const parseMshotsRequest = (value) => {
  const parsed = parseAbsoluteUrl(value);
  if (
    !parsed
    || !MSHOTS_HOSTS.has(parsed.hostname.toLowerCase())
    || !parsed.pathname.startsWith('/mshots/v1/')
  ) {
    return null;
  }

  const requestedWidth = Number.parseInt(parsed.searchParams.get('w') || '', 10);
  return {
    url: parsed,
    isDefault: /^\/mshots\/v1\/default\/?$/i.test(parsed.pathname),
    expectedWidth: Number.isInteger(requestedWidth) && requestedWidth > 0
      ? requestedWidth
      : null,
  };
};

export const isMicrolinkScreenshotUrl = (value) => {
  const parsed = parseAbsoluteUrl(value);
  return Boolean(parsed && parsed.hostname.toLowerCase() === 'api.microlink.io');
};

export const createMicrolinkScreenshotUrl = (portfolioUrl) =>
  `https://api.microlink.io/?url=${encodeURIComponent(portfolioUrl)}&screenshot=true&meta=false&embed=screenshot.url`;

export const createMshotsScreenshotUrl = (portfolioUrl, width = 600) => {
  const requestedWidth = Number.isFinite(width)
    ? Math.max(1, Math.trunc(width))
    : 600;
  return `https://s0.wp.com/mshots/v1/${encodeURIComponent(portfolioUrl)}?w=${requestedWidth}`;
};

export const addMshotsRetryToken = (value, attempt, timestamp = Date.now()) => {
  const request = parseMshotsRequest(value);
  if (!request) return value;
  request.url.searchParams.set('_pu_retry', `${timestamp}-${attempt}`);
  return request.url.toString();
};

export const getAlternateMshotsUrl = (value) => {
  const request = parseMshotsRequest(value);
  if (!request) return value;
  request.url.hostname = request.url.hostname.toLowerCase() === 's0.wp.com'
    ? 's.wordpress.com'
    : 's0.wp.com';
  return request.url.toString();
};

export const isPendingMshotsImage = (image, source = getImageSource(image)) => {
  const request = parseMshotsRequest(source);
  if (!request) return false;
  if (request.isDefault) return true;

  const naturalWidth = Number(image?.naturalWidth) || 0;
  const naturalHeight = Number(image?.naturalHeight) || 0;
  // The mShots generation placeholder is a 400x300 GIF.
  return (
    naturalWidth === 400
    && naturalHeight === 300
    && request.expectedWidth !== 400
  );
};

export const createPreviewAttemptGate = ({
  concurrency = 2,
  maxQueued = 8,
  maxTotal = 16,
} = {}) => {
  const concurrencyLimit = Number.isFinite(concurrency)
    ? Math.max(1, Math.trunc(concurrency))
    : 1;
  const queueLimit = Number.isFinite(maxQueued)
    ? Math.max(0, Math.trunc(maxQueued))
    : 0;
  const totalLimit = Number.isFinite(maxTotal)
    ? Math.max(0, Math.trunc(maxTotal))
    : Number.POSITIVE_INFINITY;
  const queue = [];
  let activeCount = 0;
  let startedCount = 0;

  const rejectRemainingQueue = () => {
    if (startedCount < totalLimit) return;
    while (queue.length > 0) {
      const entry = queue.shift();
      if (!entry || entry.cancelled) continue;
      entry.cancelled = true;
      entry.reject();
    }
  };

  const startNext = () => {
    while (
      activeCount < concurrencyLimit
      && startedCount < totalLimit
      && queue.length > 0
    ) {
      const entry = queue.shift();
      if (!entry || entry.cancelled) continue;
      startEntry(entry);
    }
    rejectRemainingQueue();
  };

  const startEntry = (entry) => {
    if (entry.cancelled) return;
    entry.started = true;
    activeCount += 1;
    startedCount += 1;
    let released = false;

    entry.release = () => {
      if (released) return;
      released = true;
      activeCount = Math.max(0, activeCount - 1);
      startNext();
    };

    try {
      entry.start(entry.release);
    } catch {
      entry.release();
      entry.reject();
    }
  };

  return (start, reject = () => {}) => {
    if (typeof start !== 'function') return () => {};

    const entry = {
      start,
      reject: typeof reject === 'function' ? reject : () => {},
      started: false,
      cancelled: false,
      release: null,
    };

    if (startedCount >= totalLimit) {
      entry.cancelled = true;
      entry.reject();
      return () => {};
    }

    if (activeCount < concurrencyLimit) {
      startEntry(entry);
    } else if (queue.length < queueLimit) {
      queue.push(entry);
    } else {
      entry.cancelled = true;
      entry.reject();
    }

    return () => {
      if (entry.cancelled) return;
      entry.cancelled = true;
      if (entry.started) {
        entry.release?.();
        return;
      }
      const queuedIndex = queue.indexOf(entry);
      if (queuedIndex >= 0) queue.splice(queuedIndex, 1);
    };
  };
};

const runImmediately = (start) => {
  let released = false;
  const release = () => {
    released = true;
  };
  start(release);
  return () => {
    if (!released) release();
  };
};

const observeWhenNearViewport = (image, onVisible) => {
  if (typeof onVisible !== 'function') return () => {};

  const Observer = globalThis.IntersectionObserver;
  if (typeof Observer === 'function') {
    try {
      const observer = new Observer((entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        observer.disconnect();
        onVisible();
      }, { rootMargin: '300px 0px' });
      observer.observe(image);
      return () => observer.disconnect();
    } catch {
      // Fall through to the geometry check in non-standard DOM environments.
    }
  }

  const rectangle = image.getBoundingClientRect?.();
  const viewportHeight = Number(globalThis.innerHeight) || 0;
  if (
    rectangle
    && viewportHeight > 0
    && rectangle.top <= viewportHeight + 300
    && rectangle.bottom >= -300
  ) {
    onVisible();
  } else if (image.loading !== 'lazy') {
    onVisible();
  }
  return () => {};
};

export const installPreviewRecovery = (image, {
  portfolioUrl = '',
  fallbackSrc = '',
  retryDelays = DEFAULT_MSHOTS_RETRY_DELAYS_MS,
  retryJitterMs = DEFAULT_RETRY_JITTER_MS,
  mshotsAttemptTimeoutMs = DEFAULT_MSHOTS_ATTEMPT_TIMEOUT_MS,
  secondaryAttemptTimeoutMs = DEFAULT_SECONDARY_ATTEMPT_TIMEOUT_MS,
  requestMshotsRetryAttempt = runImmediately,
  requestSecondaryAttempt = runImmediately,
  schedule = setTimeout,
  cancelSchedule = clearTimeout,
  now = Date.now,
  defer = queueMicrotask,
  observeVisibility = observeWhenNearViewport,
} = {}) => {
  if (
    !image
    || typeof image.addEventListener !== 'function'
    || typeof image.removeEventListener !== 'function'
    || typeof fallbackSrc !== 'string'
    || !fallbackSrc
  ) {
    return () => {};
  }

  const existing = activeRecoveries.get(image);
  if (existing) return existing.dispose;

  const primarySource = image.getAttribute?.('src') || image.src || '';
  const normalizedDelays = Array.isArray(retryDelays)
    ? retryDelays
      .map((delay) => Number(delay))
      .filter((delay) => Number.isFinite(delay) && delay >= 0)
    : [];
  const jitterLimit = Number.isFinite(retryJitterMs)
    ? Math.max(0, Math.trunc(retryJitterMs))
    : 0;
  const retryJitter = jitterLimit > 0
    ? stableHash(portfolioUrl || primarySource) % (jitterLimit + 1)
    : 0;

  let provider = parseMshotsRequest(primarySource)
    ? 'mshots'
    : isMicrolinkScreenshotUrl(primarySource)
      ? 'microlink'
      : 'primary';
  let mshotsRetrySource = primarySource;
  let retryIndex = 0;
  let retryTimer = null;
  let attemptWatchdogTimer = null;
  let disposed = false;
  let alternateErrorAttempted = false;
  let cancelMshotsRetryAttempt = null;
  let cancelSecondaryAttempt = null;
  let stopVisibilityObservation = null;

  const clearRetryTimer = () => {
    if (retryTimer === null) return;
    cancelSchedule(retryTimer);
    retryTimer = null;
  };

  const clearAttemptWatchdog = () => {
    if (attemptWatchdogTimer === null) return;
    cancelSchedule(attemptWatchdogTimer);
    attemptWatchdogTimer = null;
  };

  const clearVisibilityObservation = () => {
    if (!stopVisibilityObservation) return;
    const stopObserving = stopVisibilityObservation;
    stopVisibilityObservation = null;
    stopObserving();
  };

  const startAttemptWatchdog = (expectedProvider, timeoutMs) => {
    clearAttemptWatchdog();
    const timeout = Number(timeoutMs);
    if (!Number.isFinite(timeout) || timeout <= 0) return;

    attemptWatchdogTimer = schedule(() => {
      attemptWatchdogTimer = null;
      if (disposed || provider !== expectedProvider) return;
      handleError();
    }, timeout);
  };

  const clearMshotsRetryAttempt = () => {
    if (!cancelMshotsRetryAttempt) return;
    const cancelAttempt = cancelMshotsRetryAttempt;
    cancelMshotsRetryAttempt = null;
    cancelAttempt();
  };

  const clearSecondaryAttempt = () => {
    if (!cancelSecondaryAttempt) return;
    const cancelAttempt = cancelSecondaryAttempt;
    cancelSecondaryAttempt = null;
    cancelAttempt();
  };

  const removeListeners = () => {
    image.removeEventListener('load', handleLoad);
    image.removeEventListener('error', handleError);
  };

  const finish = (state) => {
    if (disposed) return;
    clearRetryTimer();
    clearAttemptWatchdog();
    clearVisibilityObservation();
    clearMshotsRetryAttempt();
    clearSecondaryAttempt();
    setRecoveryState(image, state);
    removeListeners();
    activeRecoveries.delete(image);
    disposed = true;
  };

  const setSource = (source, nextProvider) => {
    if (disposed || typeof source !== 'string' || !source) return;
    clearRetryTimer();
    clearAttemptWatchdog();
    clearVisibilityObservation();
    provider = nextProvider;
    image.hidden = false;
    image.src = source;
  };

  const useLocalFallback = () => {
    if (disposed || provider === 'fallback') {
      finish('fallback-error');
      return;
    }
    clearMshotsRetryAttempt();
    clearSecondaryAttempt();
    clearAttemptWatchdog();
    if (image.dataset) image.dataset.fallbackAttempted = 'true';
    setRecoveryState(image, 'fallback');
    setSource(fallbackSrc, 'fallback');
  };

  const useSecondaryProvider = () => {
    if (
      disposed
      || !portfolioUrl
      || isMicrolinkScreenshotUrl(primarySource)
    ) {
      useLocalFallback();
      return;
    }
    if (provider === 'secondary-waiting' || provider === 'microlink') return;

    clearMshotsRetryAttempt();
    provider = 'secondary-waiting';
    setRecoveryState(image, 'secondary-waiting');

    const cancelAttempt = requestSecondaryAttempt(
      (release) => {
        if (disposed) {
          release();
          return;
        }
        setRecoveryState(image, 'secondary');
        setSource(createMicrolinkScreenshotUrl(portfolioUrl), 'microlink');
        startAttemptWatchdog('microlink', secondaryAttemptTimeoutMs);
      },
      () => {
        if (!disposed) useLocalFallback();
      },
    );

    if (!disposed && (provider === 'secondary-waiting' || provider === 'microlink')) {
      cancelSecondaryAttempt = cancelAttempt;
    } else {
      cancelAttempt();
    }
  };

  const queueMshotsSource = (source) => {
    if (disposed) return;
    setRecoveryState(image, 'retry-queued');

    const cancelAttempt = requestMshotsRetryAttempt(
      (release) => {
        if (disposed) {
          release();
          return;
        }
        setRecoveryState(image, 'retrying');
        setSource(source, 'mshots');
        startAttemptWatchdog('mshots', mshotsAttemptTimeoutMs);
      },
      () => {
        if (!disposed) useSecondaryProvider();
      },
    );

    if (!disposed && provider === 'mshots') {
      cancelMshotsRetryAttempt = cancelAttempt;
    } else {
      cancelAttempt();
    }
  };

  const scheduleMshotsRetry = () => {
    if (disposed || retryTimer !== null) return;
    if (retryIndex >= normalizedDelays.length) {
      useSecondaryProvider();
      return;
    }

    const attempt = retryIndex + 1;
    const baseDelay = normalizedDelays[retryIndex];
    retryIndex += 1;
    setRecoveryState(image, 'waiting');

    retryTimer = schedule(() => {
      retryTimer = null;
      if (disposed) return;
      const retrySource = addMshotsRetryToken(mshotsRetrySource, attempt, now());
      queueMshotsSource(retrySource);
    }, baseDelay + retryJitter);
  };

  function handleLoad() {
    if (disposed) return;
    clearAttemptWatchdog();
    clearVisibilityObservation();

    if (provider === 'mshots') {
      clearMshotsRetryAttempt();
      if (isPendingMshotsImage(image)) {
        scheduleMshotsRetry();
        return;
      }
      finish('ready');
      return;
    }

    finish(provider === 'fallback' ? 'fallback' : 'ready');
  }

  function handleError() {
    if (disposed) return;
    clearRetryTimer();
    clearAttemptWatchdog();
    clearVisibilityObservation();
    clearMshotsRetryAttempt();

    if (provider === 'fallback') {
      finish('fallback-error');
      return;
    }

    if (provider === 'microlink') {
      useLocalFallback();
      return;
    }

    if (provider === 'mshots' && !alternateErrorAttempted) {
      alternateErrorAttempted = true;
      mshotsRetrySource = getAlternateMshotsUrl(mshotsRetrySource);
      const alternateSource = addMshotsRetryToken(
        mshotsRetrySource,
        'edge',
        now(),
      );
      queueMshotsSource(alternateSource);
      return;
    }

    useSecondaryProvider();
  }

  const dispose = () => {
    if (disposed) return;
    clearRetryTimer();
    clearAttemptWatchdog();
    clearVisibilityObservation();
    clearMshotsRetryAttempt();
    clearSecondaryAttempt();
    removeListeners();
    activeRecoveries.delete(image);
    disposed = true;
  };

  activeRecoveries.set(image, { dispose });
  if (image.dataset) image.dataset.previewRecoveryReady = 'true';
  image.addEventListener('load', handleLoad);
  image.addEventListener('error', handleError);

  stopVisibilityObservation = observeVisibility(image, () => {
    if (disposed || image.complete) return;
    const timeout = provider === 'microlink'
      ? secondaryAttemptTimeoutMs
      : mshotsAttemptTimeoutMs;
    startAttemptWatchdog(provider, timeout);
  });

  if (image.complete) {
    defer(() => {
      if (disposed) return;
      if (Number(image.naturalWidth) > 0) handleLoad();
      else handleError();
    });
  }

  return dispose;
};
