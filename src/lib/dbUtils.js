import { db } from './firebase.js';
import {
  doc,
  getDoc,
  increment,
  runTransaction,
  serverTimestamp,
  setDoc,
  updateDoc,
} from 'firebase/firestore';
import {
  normalizePortfolioUrl,
  sanitizeBookmarks,
  toSafeCount,
  urlToDocumentKey,
  urlToKey,
} from './utils.js';

// Re-export for consumers
export { urlToKey };

// References
const globalLikesRef = doc(db, 'global_stats', 'likes');

// Fetch global likes map
export const fetchGlobalLikes = async () => {
  try {
    const snap = await getDoc(globalLikesRef);
    if (snap.exists()) {
      return Object.fromEntries(
        Object.entries(snap.data())
          .filter(([key, value]) =>
            typeof key === 'string' &&
            key.length > 0 &&
            Number.isFinite(Number(value)) &&
            Number(value) >= 0
          )
          .map(([key, value]) => [key, toSafeCount(value)])
      );
    }
    return {};
  } catch (error) {
    console.error("Failed to fetch global likes:", error);
    throw error;
  }
};

// Fetch user's bookmarks
export const fetchUserBookmarks = async (uid) => {
  if (typeof uid !== 'string' || !uid) {
    throw new TypeError('A user id is required.');
  }

  try {
    const userRef = doc(db, 'users', uid);
    const snap = await getDoc(userRef);
    if (!snap.exists()) return [];

    const data = snap.data();
    if (data.bookmarks === undefined) return [];
    if (!Array.isArray(data.bookmarks)) {
      throw new TypeError('The stored bookmark list is invalid.');
    }

    return sanitizeBookmarks(data.bookmarks);
  } catch (error) {
    console.error("Failed to fetch user bookmarks:", error);
    throw error;
  }
};

/**
 * Persist the desired bookmark state transactionally.
 *
 * Shared aggregate likes are intentionally read-only in the browser. Updating a
 * global counter securely requires trusted backend code; allowing a client to
 * write arbitrary dynamic fields made the previous aggregate exploitable.
 *
 * @param {string} uid
 * @param {string} rawUrl
 * @param {boolean} shouldLike
 * @returns {Promise<{isLiked: boolean, bookmarks: string[]}>}
 */
export const toggleLikeInFirestore = async (uid, rawUrl, shouldLike) => {
  if (typeof uid !== 'string' || !uid) {
    throw new TypeError('A user id is required.');
  }
  const url = normalizePortfolioUrl(rawUrl);
  if (!url) throw new TypeError('A valid portfolio URL is required.');

  try {
    const userRef = doc(db, 'users', uid);
    return await runTransaction(db, async (transaction) => {
      const snapshot = await transaction.get(userRef);
      const bookmarks = snapshot.exists()
        ? sanitizeBookmarks(snapshot.data().bookmarks)
        : [];
      const currentlyLiked = bookmarks.includes(url);

      if (currentlyLiked === shouldLike) {
        return { isLiked: currentlyLiked, bookmarks };
      }

      const nextBookmarks = shouldLike
        ? [...bookmarks, url]
        : bookmarks.filter((bookmark) => bookmark !== url);

      transaction.set(userRef, { bookmarks: nextBookmarks }, { merge: true });
      return { isLiked: shouldLike, bookmarks: nextBookmarks };
    });
  } catch (error) {
    console.error("Failed to update Firestore:", error);
    throw error;
  }
};

// Increment the view count for a specific portfolio
export const incrementPortfolioView = async (url) => {
  const normalizedUrl = normalizePortfolioUrl(url);
  if (!normalizedUrl) throw new TypeError('A valid portfolio URL is required.');

  try {
    const parsed = new URL(normalizedUrl);
    const variants = new Set([normalizedUrl]);
    const addVariant = (protocol, hostname, trailingSlash) => {
      const variant = new URL(normalizedUrl);
      variant.protocol = protocol;
      variant.hostname = hostname;
      if (trailingSlash && !variant.pathname.endsWith('/')) variant.pathname += '/';
      let serialized = variant.toString();
      if (!trailingSlash && variant.pathname === '/') {
        serialized = serialized.replace(`${variant.origin}/`, variant.origin);
      }
      variants.add(serialized);
    };
    const hostnames = new Set([
      parsed.hostname,
      parsed.hostname.startsWith('www.')
        ? parsed.hostname.slice(4)
        : `www.${parsed.hostname}`,
    ]);
    for (const protocol of ['https:', 'http:']) {
      for (const hostname of hostnames) {
        addVariant(protocol, hostname, false);
        addVariant(protocol, hostname, true);
      }
    }

    const legacyKeys = [...variants].map((variant) =>
      btoa(encodeURIComponent(variant))
        .replace(/\//g, '_')
        .replace(/\+/g, '-')
        .replace(/=/g, '')
    );
    const candidateKeys = [await urlToDocumentKey(normalizedUrl), ...legacyKeys];

    for (const key of [...new Set(candidateKeys)]) {
      const portfolioRef = doc(db, 'portfolios', key);
      const snapshot = await getDoc(portfolioRef);
      if (!snapshot.exists()) continue;
      await updateDoc(portfolioRef, { views: increment(1) });
      return;
    }
    throw new Error('The portfolio counter has not been initialized.');
  } catch (error) {
    console.error("Failed to increment views:", error);
    throw error;
  }
};

// Submit a new portfolio for review
export const submitPortfolio = async (uid, name, url) => {
  if (typeof uid !== 'string' || !uid) throw new TypeError('A user id is required.');
  const normalizedName = typeof name === 'string' ? name.trim().replace(/\s+/g, ' ').slice(0, 100) : '';
  const normalizedUrl = normalizePortfolioUrl(url);
  if (!normalizedName) throw new TypeError('A portfolio name is required.');
  if (!normalizedUrl) throw new TypeError('A valid portfolio URL is required.');

  try {
    const submissionRef = doc(db, 'submissions', uid);
    await setDoc(submissionRef, {
      uid,
      name: normalizedName,
      url: normalizedUrl,
      status: 'pending',
      createdAt: serverTimestamp()
    });
    return true;
  } catch (error) {
    console.error("Failed to submit portfolio:", error);
    throw error;
  }
};
