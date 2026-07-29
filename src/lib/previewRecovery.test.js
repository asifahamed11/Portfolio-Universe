import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  addMshotsRetryToken,
  createMicrolinkScreenshotUrl,
  createMshotsScreenshotUrl,
  createPreviewAttemptGate,
  getAlternateMshotsUrl,
  installPreviewRecovery,
  isPendingMshotsImage,
  parseMshotsRequest,
} from './previewRecovery.js';

const MSHOTS_URL =
  'https://s0.wp.com/mshots/v1/https%3A%2F%2Fexample.com?w=600';
const PORTFOLIO_URL = 'https://example.com';
const FALLBACK_URL = '/Portfolio-Universe/portfolio-placeholder.svg';

const createImmediateRequester = (onStart = () => {}) => (start) => {
  onStart();
  let released = false;
  const release = () => {
    released = true;
  };
  start(release);
  return () => {
    if (!released) release();
  };
};

class FakeImage {
  constructor(src, {
    complete = false,
    naturalWidth = 0,
    naturalHeight = 0,
  } = {}) {
    this._src = src;
    this.complete = complete;
    this.naturalWidth = naturalWidth;
    this.naturalHeight = naturalHeight;
    this.hidden = false;
    this.loading = 'lazy';
    this.dataset = {};
    this.history = [src];
    this.listeners = new Map();
  }

  get src() {
    return this._src;
  }

  set src(value) {
    this._src = String(value);
    this.complete = false;
    this.naturalWidth = 0;
    this.naturalHeight = 0;
    this.history.push(this._src);
  }

  get currentSrc() {
    return this._src;
  }

  getAttribute(name) {
    return name === 'src' ? this._src : null;
  }

  addEventListener(type, listener) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type).add(listener);
  }

  removeEventListener(type, listener) {
    this.listeners.get(type)?.delete(listener);
  }

  emit(type, {
    naturalWidth = this.naturalWidth,
    naturalHeight = this.naturalHeight,
  } = {}) {
    this.complete = true;
    this.naturalWidth = type === 'load' ? naturalWidth : 0;
    this.naturalHeight = type === 'load' ? naturalHeight : 0;
    for (const listener of [...(this.listeners.get(type) || [])]) {
      listener.call(this);
    }
  }
}

afterEach(() => {
  vi.useRealTimers();
});

describe('mShots preview helpers', () => {
  it('parses the requested width and preserves the target while cache-busting', () => {
    expect(createMshotsScreenshotUrl(PORTFOLIO_URL))
      .toBe(MSHOTS_URL);
    expect(parseMshotsRequest(MSHOTS_URL)).toMatchObject({
      expectedWidth: 600,
      isDefault: false,
    });

    const retried = new URL(addMshotsRetryToken(MSHOTS_URL, 2, 1234));
    expect(retried.searchParams.get('w')).toBe('600');
    expect(retried.searchParams.get('_pu_retry')).toBe('1234-2');
    expect(decodeURIComponent(retried.pathname)).toContain('https://example.com');
  });

  it('recognizes the 400x300 generation placeholder but accepts a real 600px capture', () => {
    const image = new FakeImage(MSHOTS_URL);
    image.naturalWidth = 400;
    image.naturalHeight = 300;
    expect(isPendingMshotsImage(image)).toBe(true);

    image.naturalWidth = 600;
    image.naturalHeight = 450;
    expect(isPendingMshotsImage(image)).toBe(false);
  });

  it('recognizes the explicit default URL without rejecting other legitimate dimensions', () => {
    const defaultImage = new FakeImage('https://s0.wp.com/mshots/v1/default');
    defaultImage.naturalWidth = 1;
    defaultImage.naturalHeight = 1;
    expect(isPendingMshotsImage(defaultImage)).toBe(true);

    const differentlySizedCapture = new FakeImage(MSHOTS_URL);
    differentlySizedCapture.naturalWidth = 500;
    differentlySizedCapture.naturalHeight = 375;
    expect(isPendingMshotsImage(differentlySizedCapture)).toBe(false);
  });

  it('switches between the two mShots edge hosts', () => {
    expect(new URL(getAlternateMshotsUrl(MSHOTS_URL)).hostname)
      .toBe('s.wordpress.com');
    expect(new URL(getAlternateMshotsUrl(getAlternateMshotsUrl(MSHOTS_URL))).hostname)
      .toBe('s0.wp.com');
  });

  it('queues shared attempts and lets later work start after a slot is released', () => {
    const requestAttempt = createPreviewAttemptGate({
      concurrency: 1,
      maxQueued: 2,
      maxTotal: 3,
    });
    const starts = [];
    const rejects = [];
    let releaseFirst;
    let releaseSecond;

    requestAttempt((release) => {
      starts.push('first');
      releaseFirst = release;
    });
    requestAttempt((release) => {
      starts.push('second');
      releaseSecond = release;
    });
    requestAttempt(() => starts.push('third'), () => rejects.push('third'));

    expect(starts).toEqual(['first']);
    releaseFirst();
    expect(starts).toEqual(['first', 'second']);
    releaseSecond();
    expect(starts).toEqual(['first', 'second', 'third']);
    expect(rejects).toEqual([]);
  });
});

describe('portfolio preview recovery', () => {
  it('retries a pending mShots image and stops after a real capture loads', async () => {
    vi.useFakeTimers();
    const image = new FakeImage(MSHOTS_URL);
    const secondaryStarted = vi.fn();

    installPreviewRecovery(image, {
      portfolioUrl: PORTFOLIO_URL,
      fallbackSrc: FALLBACK_URL,
      retryDelays: [100, 200],
      retryJitterMs: 0,
      requestSecondaryAttempt: createImmediateRequester(secondaryStarted),
      now: () => 99,
    });

    image.emit('load', { naturalWidth: 400, naturalHeight: 300 });
    expect(image.dataset.previewRecoveryState).toBe('waiting');

    await vi.advanceTimersByTimeAsync(100);
    expect(image.src).toContain('_pu_retry=99-1');
    expect(image.dataset.previewRecoveryState).toBe('retrying');

    image.emit('load', { naturalWidth: 600, naturalHeight: 450 });
    expect(image.dataset.previewRecoveryState).toBe('ready');
    expect(secondaryStarted).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('uses Microlink only after bounded pending retries are exhausted', async () => {
    vi.useFakeTimers();
    const image = new FakeImage(MSHOTS_URL);
    const secondaryStarted = vi.fn();

    installPreviewRecovery(image, {
      portfolioUrl: PORTFOLIO_URL,
      fallbackSrc: FALLBACK_URL,
      retryDelays: [100, 200],
      retryJitterMs: 0,
      requestSecondaryAttempt: createImmediateRequester(secondaryStarted),
      now: () => 77,
    });

    image.emit('load', { naturalWidth: 400, naturalHeight: 300 });
    await vi.advanceTimersByTimeAsync(100);
    image.emit('load', { naturalWidth: 400, naturalHeight: 300 });
    await vi.advanceTimersByTimeAsync(200);
    image.emit('load', { naturalWidth: 400, naturalHeight: 300 });

    expect(secondaryStarted).toHaveBeenCalledTimes(1);
    expect(image.src).toBe(createMicrolinkScreenshotUrl(PORTFOLIO_URL));
    expect(image.dataset.previewRecoveryState).toBe('secondary');

    image.emit('load', { naturalWidth: 1200, naturalHeight: 750 });
    expect(image.dataset.previewRecoveryState).toBe('ready');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('tries the alternate mShots host, Microlink, then the local placeholder on hard errors', () => {
    const image = new FakeImage(MSHOTS_URL);
    const secondaryStarted = vi.fn();

    installPreviewRecovery(image, {
      portfolioUrl: PORTFOLIO_URL,
      fallbackSrc: FALLBACK_URL,
      retryJitterMs: 0,
      requestSecondaryAttempt: createImmediateRequester(secondaryStarted),
      now: () => 55,
    });

    image.emit('error');
    expect(new URL(image.src).hostname).toBe('s.wordpress.com');
    expect(image.src).toContain('_pu_retry=55-edge');

    image.emit('error');
    expect(image.src).toBe(createMicrolinkScreenshotUrl(PORTFOLIO_URL));
    expect(secondaryStarted).toHaveBeenCalledTimes(1);

    image.emit('error');
    expect(image.src).toBe(FALLBACK_URL);
    expect(image.dataset.fallbackAttempted).toBe('true');

    const sourceCount = image.history.length;
    image.emit('error');
    expect(image.history).toHaveLength(sourceCount);
    expect(image.dataset.previewRecoveryState).toBe('fallback-error');
  });

  it('uses the local placeholder when the Microlink budget is unavailable', () => {
    const image = new FakeImage(MSHOTS_URL);

    installPreviewRecovery(image, {
      portfolioUrl: PORTFOLIO_URL,
      fallbackSrc: FALLBACK_URL,
      retryDelays: [],
      requestSecondaryAttempt: (_start, reject) => {
        reject();
        return () => {};
      },
    });

    image.emit('load', { naturalWidth: 400, naturalHeight: 300 });
    expect(image.src).toBe(FALLBACK_URL);
    expect(image.dataset.previewRecoveryState).toBe('fallback');
  });

  it('does not retry Microlink when it was already the primary provider', () => {
    const microlinkUrl = createMicrolinkScreenshotUrl(PORTFOLIO_URL);
    const image = new FakeImage(microlinkUrl);
    const requestSecondaryAttempt = vi.fn();

    installPreviewRecovery(image, {
      portfolioUrl: PORTFOLIO_URL,
      fallbackSrc: FALLBACK_URL,
      requestSecondaryAttempt,
    });

    image.emit('error');
    expect(image.src).toBe(FALLBACK_URL);
    expect(requestSecondaryAttempt).not.toHaveBeenCalled();
  });

  it('recovers a broken custom screenshot through Microlink before using the placeholder', () => {
    const image = new FakeImage('https://cdn.example.com/preview.jpg');
    const secondaryStarted = vi.fn();

    installPreviewRecovery(image, {
      portfolioUrl: PORTFOLIO_URL,
      fallbackSrc: FALLBACK_URL,
      requestSecondaryAttempt: createImmediateRequester(secondaryStarted),
    });

    image.emit('error');
    expect(image.src).toBe(createMicrolinkScreenshotUrl(PORTFOLIO_URL));
    expect(secondaryStarted).toHaveBeenCalledTimes(1);

    image.emit('error');
    expect(image.src).toBe(FALLBACK_URL);
  });

  it('cancels pending work when disposed', async () => {
    vi.useFakeTimers();
    const image = new FakeImage(MSHOTS_URL);
    const dispose = installPreviewRecovery(image, {
      portfolioUrl: PORTFOLIO_URL,
      fallbackSrc: FALLBACK_URL,
      retryDelays: [100],
      retryJitterMs: 0,
    });

    image.emit('load', { naturalWidth: 400, naturalHeight: 300 });
    expect(vi.getTimerCount()).toBe(1);
    const sourceCount = image.history.length;

    dispose();
    await vi.runAllTimersAsync();
    image.emit('error');
    expect(image.history).toHaveLength(sourceCount);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('releases a stalled Microlink slot so the next queued card can recover', async () => {
    vi.useFakeTimers();
    const requestSecondaryAttempt = createPreviewAttemptGate({
      concurrency: 1,
      maxQueued: 1,
      maxTotal: 2,
    });
    const firstImage = new FakeImage('https://cdn.example.com/first.jpg');
    const secondImage = new FakeImage('https://cdn.example.com/second.jpg');
    const options = {
      portfolioUrl: PORTFOLIO_URL,
      fallbackSrc: FALLBACK_URL,
      secondaryAttemptTimeoutMs: 100,
      requestSecondaryAttempt,
    };

    installPreviewRecovery(firstImage, options);
    installPreviewRecovery(secondImage, options);
    firstImage.emit('error');
    secondImage.emit('error');

    expect(firstImage.src).toBe(createMicrolinkScreenshotUrl(PORTFOLIO_URL));
    expect(secondImage.dataset.previewRecoveryState).toBe('secondary-waiting');

    await vi.advanceTimersByTimeAsync(100);
    expect(firstImage.src).toBe(FALLBACK_URL);
    expect(secondImage.src).toBe(createMicrolinkScreenshotUrl(PORTFOLIO_URL));

    secondImage.emit('load', { naturalWidth: 1200, naturalHeight: 750 });
    expect(secondImage.dataset.previewRecoveryState).toBe('ready');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('moves a stalled mShots retry to the alternate edge host', async () => {
    vi.useFakeTimers();
    const image = new FakeImage(MSHOTS_URL);
    const requestMshotsRetryAttempt = createPreviewAttemptGate({
      concurrency: 1,
      maxQueued: 1,
      maxTotal: Number.POSITIVE_INFINITY,
    });

    installPreviewRecovery(image, {
      portfolioUrl: PORTFOLIO_URL,
      fallbackSrc: FALLBACK_URL,
      retryDelays: [0],
      retryJitterMs: 0,
      mshotsAttemptTimeoutMs: 100,
      requestMshotsRetryAttempt,
      now: () => 88,
    });

    image.emit('load', { naturalWidth: 400, naturalHeight: 300 });
    await vi.advanceTimersByTimeAsync(0);
    expect(new URL(image.src).hostname).toBe('s0.wp.com');

    await vi.advanceTimersByTimeAsync(100);
    expect(new URL(image.src).hostname).toBe('s.wordpress.com');
    expect(image.dataset.previewRecoveryState).toBe('retrying');
  });

  it('arms the primary watchdog only after a lazy card nears the viewport', async () => {
    vi.useFakeTimers();
    const image = new FakeImage(MSHOTS_URL);
    const stopObserving = vi.fn();
    let revealImage = () => {};

    installPreviewRecovery(image, {
      portfolioUrl: PORTFOLIO_URL,
      fallbackSrc: FALLBACK_URL,
      mshotsAttemptTimeoutMs: 100,
      observeVisibility: (_image, onVisible) => {
        revealImage = onVisible;
        return stopObserving;
      },
      now: () => 66,
    });

    expect(vi.getTimerCount()).toBe(0);
    revealImage();
    expect(vi.getTimerCount()).toBe(1);

    await vi.advanceTimersByTimeAsync(100);
    expect(new URL(image.src).hostname).toBe('s.wordpress.com');
    expect(stopObserving).toHaveBeenCalledTimes(1);

    image.emit('load', { naturalWidth: 600, naturalHeight: 450 });
    expect(image.dataset.previewRecoveryState).toBe('ready');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('handles already-complete images and duplicate installation once', () => {
    vi.useFakeTimers();
    const image = new FakeImage(MSHOTS_URL, {
      complete: true,
      naturalWidth: 400,
      naturalHeight: 300,
    });
    const options = {
      portfolioUrl: PORTFOLIO_URL,
      fallbackSrc: FALLBACK_URL,
      retryDelays: [100],
      retryJitterMs: 0,
      defer: (callback) => callback(),
    };

    const firstDispose = installPreviewRecovery(image, options);
    const secondDispose = installPreviewRecovery(image, options);

    expect(secondDispose).toBe(firstDispose);
    expect(image.dataset.previewRecoveryState).toBe('waiting');
    expect(vi.getTimerCount()).toBe(1);
  });
});
