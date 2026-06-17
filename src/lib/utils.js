// Shared utility functions used across both client and script code

/**
 * Encode a URL to a safe Firestore document key.
 * Firestore fields cannot contain /, +, ~ etc.
 * @param {string} url
 * @returns {string}
 */
export const urlToKey = (url) => {
  try {
    return btoa(encodeURIComponent(url)).replace(/\//g, '_').replace(/\+/g, '-').replace(/=/g, '');
  } catch (e) {
    // Fallback simple hash if btoa fails
    let hash = 0;
    for (let i = 0; i < url.length; i++) {
      hash = Math.imul(31, hash) + url.charCodeAt(i) | 0;
    }
    return `hash_${hash >>> 0}`;
  }
};
