import { db } from './firebase.js';
import {
  addDoc,
  collection,
  doc,
  getDoc,
  runTransaction,
  serverTimestamp,
} from 'firebase/firestore';
import { toSafeHttpsUrl } from './portfolio.js';
import { urlToKey } from './utils.js';

// Re-export for consumers
export { urlToKey };

// Fetch user's bookmarks
export const fetchUserBookmarks = async (uid) => {
  try {
    const userRef = doc(db, 'users', uid);
    const snap = await getDoc(userRef);
    const bookmarks = snap.exists() ? snap.data().bookmarks : [];
    if (Array.isArray(bookmarks)) {
      return [...new Set(bookmarks.map(toSafeHttpsUrl).filter(Boolean))].slice(0, 500);
    }
    return [];
  } catch (error) {
    console.error("Failed to fetch user bookmarks:", error);
    return [];
  }
};

/**
 * Persist a bookmark with a transaction so simultaneous tabs/devices cannot
 * overwrite one another. Global counters are intentionally not client-writable.
 */
export const toggleBookmarkInFirestore = async (uid, url, isSaving) => {
  const safeUrl = toSafeHttpsUrl(url);
  if (!uid || !safeUrl) {
    throw new TypeError('A signed-in user and a valid HTTPS portfolio URL are required.');
  }

  const userRef = doc(db, 'users', uid);

  return runTransaction(db, async (transaction) => {
    const snapshot = await transaction.get(userRef);
    const existing = snapshot.exists() && Array.isArray(snapshot.data().bookmarks)
      ? snapshot.data().bookmarks.map(toSafeHttpsUrl).filter(Boolean)
      : [];
    const bookmarks = [...new Set(existing)];
    const currentIndex = bookmarks.indexOf(safeUrl);

    if (isSaving && currentIndex === -1) {
      bookmarks.push(safeUrl);
    } else if (!isSaving && currentIndex !== -1) {
      bookmarks.splice(currentIndex, 1);
    }

    const nextBookmarks = bookmarks.slice(0, 500);
    transaction.set(
      userRef,
      {
        bookmarks: nextBookmarks,
        updatedAt: serverTimestamp(),
      },
      { merge: true },
    );

    return nextBookmarks;
  });
};

// Submit a new portfolio for review
export const submitPortfolio = async (uid, name, url) => {
  const cleanName = typeof name === 'string'
    ? name.replace(/\s+/g, ' ').trim().slice(0, 120)
    : '';
  const safeUrl = toSafeHttpsUrl(url);

  if (!uid || !cleanName || !safeUrl) {
    throw new TypeError('Name and a valid HTTPS portfolio URL are required.');
  }

  try {
    const submissionsRef = collection(db, 'submissions');
    await addDoc(submissionsRef, {
      uid,
      name: cleanName,
      url: safeUrl,
      status: 'pending',
      createdAt: serverTimestamp()
    });
    return true;
  } catch (error) {
    console.error("Failed to submit portfolio:", error);
    throw error;
  }
};
