import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fetchUserBookmarks } from './dbUtils.js';
import { doc, getDoc } from 'firebase/firestore';

// Mock dependencies
vi.mock('firebase/firestore', () => {
  return {
    doc: vi.fn(),
    getDoc: vi.fn(),
    setDoc: vi.fn(),
    updateDoc: vi.fn(),
    increment: vi.fn(),
    collection: vi.fn(),
    addDoc: vi.fn(),
    serverTimestamp: vi.fn(),
    getFirestore: vi.fn(),
  };
});

vi.mock('./firebase.js', () => {
  return {
    db: {},
    app: {}
  };
});

describe('fetchUserBookmarks', () => {
  const uid = 'test-uid-123';

  beforeEach(() => {
    vi.clearAllMocks();

    // Mock doc() to just return a dummy reference
    doc.mockReturnValue('dummy-doc-ref');
  });

  it('should return bookmarks when snapshot exists and has bookmarks', async () => {
    const mockBookmarks = ['url1', 'url2'];
    getDoc.mockResolvedValueOnce({
      exists: () => true,
      data: () => ({ bookmarks: mockBookmarks })
    });

    const result = await fetchUserBookmarks(uid);

    expect(doc).toHaveBeenCalledWith(expect.anything(), 'users', uid);
    expect(getDoc).toHaveBeenCalledWith('dummy-doc-ref');
    expect(result).toEqual(mockBookmarks);
  });

  it('should return empty array when snapshot exists but has no bookmarks', async () => {
    getDoc.mockResolvedValueOnce({
      exists: () => true,
      data: () => ({})
    });

    const result = await fetchUserBookmarks(uid);

    expect(result).toEqual([]);
  });

  it('should return empty array when snapshot does not exist', async () => {
    getDoc.mockResolvedValueOnce({
      exists: () => false,
      data: () => ({})
    });

    const result = await fetchUserBookmarks(uid);

    expect(result).toEqual([]);
  });

  it('should return empty array when getDoc throws an error', async () => {
    // Suppress console.error for this test
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    getDoc.mockRejectedValueOnce(new Error('Firebase error'));

    const result = await fetchUserBookmarks(uid);

    expect(result).toEqual([]);
    expect(consoleSpy).toHaveBeenCalledWith("Failed to fetch user bookmarks:", expect.any(Error));

    consoleSpy.mockRestore();
  });
});
