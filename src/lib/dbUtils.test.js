import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { getDoc, doc } from 'firebase/firestore';
import { fetchGlobalLikes } from './dbUtils';

// Mock firebase modules
vi.mock('./firebase.js', () => ({
  db: {}
}));

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
  };
});

describe('fetchGlobalLikes', () => {
  const originalConsoleError = console.error;

  beforeEach(() => {
    vi.clearAllMocks();
    console.error = vi.fn(); // Suppress console.error during tests
  });

  afterEach(() => {
    console.error = originalConsoleError;
  });

  it('should return global likes map if document exists', async () => {
    const mockData = { 'portfolio-1': 10, 'portfolio-2': 5 };

    // Setup mock implementations
    getDoc.mockResolvedValueOnce({
      exists: () => true,
      data: () => mockData
    });

    const result = await fetchGlobalLikes();

    expect(getDoc).toHaveBeenCalledTimes(1);
    expect(result).toEqual(mockData);
  });

  it('should return empty object if document does not exist', async () => {
    // Setup mock implementations
    getDoc.mockResolvedValueOnce({
      exists: () => false,
      data: () => undefined
    });

    const result = await fetchGlobalLikes();

    expect(getDoc).toHaveBeenCalledTimes(1);
    expect(result).toEqual({});
  });

  it('should return empty object and log error if fetch fails', async () => {
    // Setup mock to throw an error
    const testError = new Error('Network error');
    getDoc.mockRejectedValueOnce(testError);

    const result = await fetchGlobalLikes();

    expect(getDoc).toHaveBeenCalledTimes(1);
    expect(console.error).toHaveBeenCalledWith("Failed to fetch global likes:", testError);
    expect(result).toEqual({});
  });
});
