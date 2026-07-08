import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { urlToKey } from './utils.js';

describe('urlToKey', () => {
  test('should generate a base64 encoded key for a valid URL', () => {
    const url = 'https://example.com/path?query=1';
    const result = urlToKey(url);
    assert.strictEqual(typeof result, 'string');
    assert.ok(!result.includes('/'));
    assert.ok(!result.includes('+'));
    assert.ok(!result.includes('='));
  });

  test('should fallback to hash mechanism when encodeURIComponent fails (e.g., lone surrogate)', () => {
    // A lone surrogate will cause encodeURIComponent to throw a URIError,
    // triggering the fallback hash logic.
    const invalidUrl = '\uD800';
    const result = urlToKey(invalidUrl);

    // Calculate the expected hash for '\uD800' (charCodeAt(0) === 55296)
    // hash = Math.imul(31, 0) + 55296 | 0 = 55296
    assert.strictEqual(result, 'hash_55296');
  });

  test('should fallback to hash mechanism when an object with throwing toString is passed', () => {
    const throwingObj = {
      toString: () => {
        throw new Error('Intentional error');
      },
      length: 3,
      charCodeAt: (i) => 'abc'.charCodeAt(i)
    };

    const result = urlToKey(throwingObj);
    // expected hash for 'abc':
    // h0 = 0
    // h1 = 31 * 0 + 97 = 97
    // h2 = 31 * 97 + 98 = 3105
    // h3 = 31 * 3105 + 99 = 96354
    assert.strictEqual(result, 'hash_96354');
  });
});
