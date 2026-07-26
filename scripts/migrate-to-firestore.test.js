import { describe, expect, it } from 'vitest';
import {
  countPublishablePruneCoverage,
  decodeLegacyUrlKey,
  legacyDocumentKeysForAliases,
  reconcileLikeCounterMap,
  reconcileViewCounters,
  sumSafeCounters,
  urlToKey,
} from './migrate-to-firestore.js';

describe('legacy Firestore counter reconciliation', () => {
  it('adds distinct canonical and legacy partitions before deleting aliases', () => {
    expect(reconcileViewCounters(4, 10, [5, 2])).toBe(17);
  });

  it('keeps a richer local total without double-counting an exported partition', () => {
    expect(reconcileViewCounters(20, 10, [5])).toBe(20);
  });

  it('ignores invalid counters and preserves monotonic local data', () => {
    expect(reconcileViewCounters(8, -4, [Number.NaN, 3.5, 2])).toBe(8);
  });

  it('clamps additions before JavaScript integer precision is lost', () => {
    expect(sumSafeCounters([Number.MAX_SAFE_INTEGER - 1, 10])).toBe(
      Number.MAX_SAFE_INTEGER,
    );
  });
});

describe('legacy URL-key discovery', () => {
  const legacyKey = (url) =>
    Buffer.from(encodeURIComponent(url), 'latin1').toString('base64url');

  it('retains an exact tracking-query alias as well as normalized variants', () => {
    const rawUrl = 'https://example.com/?utm_source=archive';
    const keys = legacyDocumentKeysForAliases([rawUrl]);

    expect(keys).toContain(legacyKey(rawUrl));
    expect(keys).toContain(legacyKey('https://example.com'));
  });

  it('retains the exact historical fragment alias', () => {
    const rawUrl = 'https://example.com/work#projects';

    expect(legacyDocumentKeysForAliases([rawUrl])).toContain(legacyKey(rawUrl));
  });

  it('decodes exact historical aliases from legacy Firestore keys', () => {
    const tracked = 'https://example.com/?utm_source=archive';
    const fragmented = 'https://example.com/work#projects';
    const quoted = 'https://akshayabraham.vercel.app?utm_source=archive"';

    expect(decodeLegacyUrlKey(legacyKey(tracked))).toBe(tracked);
    expect(decodeLegacyUrlKey(legacyKey(fragmented))).toBe(fragmented);
    expect(decodeLegacyUrlKey(legacyKey(quoted))).toBe(
      'https://akshayabraham.vercel.app?utm_source=archive',
    );
    expect(decodeLegacyUrlKey('not-a-legacy-url-key')).toBeNull();
  });
});

describe('prune overlap coverage', () => {
  it('does not let unpublished canonical or legacy rows mask remote divergence', () => {
    const published = { url: 'https://published.example', is_portfolio: true };
    const hiddenCanonical = { url: 'https://hidden.example', is_portfolio: false };
    const hiddenLegacy = { url: 'https://legacy-hidden.example', is_portfolio: false };
    const [hiddenLegacyId] = legacyDocumentKeysForAliases([hiddenLegacy.url]);

    const coverage = countPublishablePruneCoverage(
      [
        { id: urlToKey(published.url), url: published.url },
        { id: urlToKey(hiddenCanonical.url), url: hiddenCanonical.url },
        { id: hiddenLegacyId, url: hiddenLegacy.url },
        { id: 'remote-only', url: 'https://remote-only.example' },
      ],
      [published, hiddenCanonical, hiddenLegacy],
    );

    expect(coverage).toBe(1);
  });
});

describe('aggregate like reconciliation', () => {
  it('preserves unrelated counters without prune and removes consumed aliases', () => {
    const result = reconcileLikeCounterMap(
      { canonical: 4, legacy: 3, remoteOnly: 9 },
      [{ targetKey: 'canonical', sourceKeys: ['canonical', 'legacy'] }],
    );

    expect(result).toEqual({ canonical: 7, remoteOnly: 9 });
  });

  it('is idempotent and drops unrelated counters only during an explicit prune', () => {
    const plan = [{ targetKey: 'canonical', sourceKeys: ['canonical', 'legacy'] }];
    const first = reconcileLikeCounterMap(
      { canonical: 4, legacy: 3, remoteOnly: 9 },
      plan,
    );

    expect(reconcileLikeCounterMap(first, plan)).toEqual(first);
    expect(reconcileLikeCounterMap(
      { canonical: 4, legacy: 3, remoteOnly: 9 },
      plan,
      { pruneStale: true },
    )).toEqual({ canonical: 7 });
  });
});
