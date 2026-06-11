import { db } from './firebase.js';
import { doc, getDoc, setDoc, updateDoc, increment } from 'firebase/firestore';

// References
const globalLikesRef = doc(db, 'global_stats', 'likes');

// Helper to encode URLs to safe document keys (Firestore fields cannot contain /, +, ~ etc.)
export const urlToKey = (url) => {
  try {
    return btoa(encodeURIComponent(url)).replace(/\//g, '_').replace(/\+/g, '-').replace(/=/g, '');
  } catch (e) {
    // Fallback simple hash if btoa fails
    let hash = 0;
    for (let i = 0; i < url.length; i++) {
      hash = ((hash << 5) - hash) + url.charCodeAt(i);
      hash |= 0;
    }
    return `hash_${Math.abs(hash)}`;
  }
};

// Fetch global likes map
export const fetchGlobalLikes = async () => {
  try {
    const snap = await getDoc(globalLikesRef);
    if (snap.exists()) {
      return snap.data();
    }
    return {};
  } catch (error) {
    console.error("Failed to fetch global likes:", error);
    return {};
  }
};

// Fetch user's bookmarks
export const fetchUserBookmarks = async (uid) => {
  try {
    const userRef = doc(db, 'users', uid);
    const snap = await getDoc(userRef);
    if (snap.exists() && snap.data().bookmarks) {
      return snap.data().bookmarks;
    }
    return [];
  } catch (error) {
    console.error("Failed to fetch user bookmarks:", error);
    return [];
  }
};

// Toggle a bookmark (Like / Unlike)
// Returns true if liked, false if unliked
export const toggleLikeInFirestore = async (uid, url, isLiking) => {
  try {
    const userRef = doc(db, 'users', uid);
    const key = urlToKey(url);

    // 1. Update User's bookmarks array
    // Since we don't use arrayUnion due to keeping order, we'll fetch and set
    // But since localStorage is source of truth for the client, we can just pass the whole array
    const bookmarks = JSON.parse(localStorage.getItem(`pu_bookmarks_${uid}`) || '[]');
    await setDoc(userRef, { bookmarks }, { merge: true });

    // 2. Increment/Decrement global like count
    // Use increment for atomic operation
    await setDoc(globalLikesRef, {
      [key]: increment(isLiking ? 1 : -1)
    }, { merge: true });

  } catch (error) {
    console.error("Failed to update Firestore:", error);
  }
};
