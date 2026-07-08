import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { incrementPortfolioView } from './dbUtils.js';

// Mock dependencies
vi.mock('./firebase.js', () => ({
  db: {} // Mock db object
}));

vi.mock('firebase/firestore', () => ({
  doc: vi.fn(),
  setDoc: vi.fn(),
  increment: vi.fn(),
  // We need to mock these as well since they are imported in dbUtils.js
  getDoc: vi.fn(),
  updateDoc: vi.fn(),
  collection: vi.fn(),
  addDoc: vi.fn(),
  serverTimestamp: vi.fn()
}));

vi.mock('./utils.js', () => ({
  urlToKey: vi.fn()
}));

// Import mocked functions to assert on them
import { doc, setDoc, increment } from 'firebase/firestore';
import { urlToKey } from './utils.js';
import { db } from './firebase.js';

describe('dbUtils - incrementPortfolioView', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Silence console.error for clean test output
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should increment view count for a valid url', async () => {
    const url = 'https://example.com/portfolio';
    const mockedKey = 'example-com-portfolio';
    const mockedDocRef = { id: mockedKey };
    const mockedIncrementValue = { _type: 'increment', value: 1 };

    urlToKey.mockReturnValue(mockedKey);
    doc.mockReturnValue(mockedDocRef);
    increment.mockReturnValue(mockedIncrementValue);
    setDoc.mockResolvedValue(undefined);

    await incrementPortfolioView(url);

    expect(urlToKey).toHaveBeenCalledWith(url);
    expect(doc).toHaveBeenCalledWith(db, 'portfolios', mockedKey);
    expect(increment).toHaveBeenCalledWith(1);
    expect(setDoc).toHaveBeenCalledWith(
      mockedDocRef,
      { views: mockedIncrementValue },
      { merge: true }
    );
  });

  it('should handle errors gracefully', async () => {
    const url = 'https://error.com';
    const error = new Error('Firestore failure');

    urlToKey.mockImplementation(() => {
      throw error;
    });

    await incrementPortfolioView(url);

    expect(console.error).toHaveBeenCalledWith('Failed to increment views:', error);
    // setDoc should not be called if urlToKey throws
    expect(setDoc).not.toHaveBeenCalled();
  });

  it('should handle setDoc errors gracefully', async () => {
    const url = 'https://example.com/fail';
    const mockedKey = 'example-com-fail';
    const error = new Error('Network error');

    urlToKey.mockReturnValue(mockedKey);
    doc.mockReturnValue({ id: mockedKey });
    increment.mockReturnValue({ _type: 'increment', value: 1 });
    setDoc.mockRejectedValue(error);

    await incrementPortfolioView(url);

    expect(console.error).toHaveBeenCalledWith('Failed to increment views:', error);
    expect(setDoc).toHaveBeenCalled();
  });
});
