import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fetchUserBookmarks } from './dbUtils.js';
import { getDoc } from 'firebase/firestore';

vi.mock('firebase/firestore', () => {
  return {
    doc: vi.fn((db, coll, id) => `ref-${coll}-${id}`),
    getDoc: vi.fn(),
    setDoc: vi.fn(),
    updateDoc: vi.fn(),
    increment: vi.fn(),
    collection: vi.fn(),
    addDoc: vi.fn(),
    serverTimestamp: vi.fn(),
  };
});

vi.mock('./firebase.js', () => ({
  db: {},
}));

describe('fetchUserBookmarks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should return bookmarks if they exist', async () => {
    const mockBookmarks = ['url1', 'url2'];
    getDoc.mockResolvedValueOnce({
      exists: () => true,
      data: () => ({ bookmarks: mockBookmarks }),
    });

    const result = await fetchUserBookmarks('user123');
    expect(result).toEqual(mockBookmarks);
  });

  it('should return empty array if document does not exist', async () => {
    getDoc.mockResolvedValueOnce({
      exists: () => false,
    });

    const result = await fetchUserBookmarks('user123');
    expect(result).toEqual([]);
  });

  it('should return empty array if document exists but has no bookmarks', async () => {
    getDoc.mockResolvedValueOnce({
      exists: () => true,
      data: () => ({}),
    });

    const result = await fetchUserBookmarks('user123');
    expect(result).toEqual([]);
  });

  it('should return empty array and log error on exception', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const mockError = new Error('Database error');
    getDoc.mockRejectedValueOnce(mockError);

    const result = await fetchUserBookmarks('user123');

    expect(result).toEqual([]);
    expect(consoleSpy).toHaveBeenCalledWith("Failed to fetch user bookmarks:", mockError);

    consoleSpy.mockRestore();
  });
});
