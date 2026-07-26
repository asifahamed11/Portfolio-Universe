import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  fetchGlobalLikes,
  fetchUserBookmarks,
  incrementPortfolioView,
  submitPortfolio,
  toggleLikeInFirestore,
} from './dbUtils.js';
import {
  doc,
  getDoc,
  runTransaction,
  serverTimestamp,
  setDoc,
  updateDoc,
} from 'firebase/firestore';

// Mock dependencies
vi.mock('./firebase.js', () => ({
  db: {}
}));

vi.mock('firebase/firestore', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    serverTimestamp: vi.fn(() => 'mocked-timestamp'),
    doc: vi.fn(),
    getDoc: vi.fn(),
    increment: vi.fn((value) => ({ increment: value })),
    runTransaction: vi.fn(),
    setDoc: vi.fn(),
    updateDoc: vi.fn(),
  };
});

describe('view persistence', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    doc.mockImplementation((_database, ...segments) => segments.join('/'));
  });

  it('increments the initialized SHA-256 document instead of creating one', async () => {
    getDoc.mockResolvedValue({ exists: () => true });
    updateDoc.mockResolvedValue(undefined);

    await incrementPortfolioView('https://www.example.com/');

    expect(getDoc).toHaveBeenCalledWith(
      'portfolios/73d986e009065f182c10bcb6a45db3d6eda9498f8930654af2653f8a938cd801'
    );
    expect(updateDoc).toHaveBeenCalledWith(
      'portfolios/73d986e009065f182c10bcb6a45db3d6eda9498f8930654af2653f8a938cd801',
      { views: { increment: 1 } }
    );
  });
});

describe('submitPortfolio', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    doc.mockImplementation((_database, ...segments) => segments.join('/'));
    serverTimestamp.mockReturnValue('mocked-timestamp');
  });

  it('should successfully submit a new portfolio', async () => {
    // Arrange
    const mockUid = 'user123';
    const mockName = 'Test Portfolio';
    const mockUrl = 'https://example.com';

    // Act
    const result = await submitPortfolio(mockUid, mockName, mockUrl);

    // Assert
    expect(result).toBe(true);
    expect(serverTimestamp).toHaveBeenCalled();
    expect(setDoc).toHaveBeenCalledWith('submissions/user123', {
      uid: mockUid,
      name: mockName,
      url: mockUrl,
      status: 'pending',
      createdAt: 'mocked-timestamp'
    });
  });

  it('normalizes submission values and rejects unsafe URLs before writing', async () => {
    await submitPortfolio(
      'user123',
      '  Example   Developer  ',
      'https://EXAMPLE.com/?utm_source=test'
    );

    expect(setDoc).toHaveBeenCalledWith('submissions/user123', {
      uid: 'user123',
      name: 'Example Developer',
      url: 'https://example.com',
      status: 'pending',
      createdAt: 'mocked-timestamp',
    });

    await expect(
      submitPortfolio('user123', 'Bad URL', 'https://example.com/" onclick="alert(1)')
    ).rejects.toThrow('A valid portfolio URL is required.');
  });

  it('should throw an error if submission fails', async () => {
    // Arrange
    const mockUid = 'user123';
    const mockName = 'Test Portfolio';
    const mockUrl = 'https://example.com';
    const mockError = new Error('Firestore error');

    setDoc.mockRejectedValue(mockError);

    // Console spy to prevent noise in test output
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    // Act & Assert
    await expect(submitPortfolio(mockUid, mockName, mockUrl)).rejects.toThrow('Firestore error');

    expect(consoleSpy).toHaveBeenCalledWith('Failed to submit portfolio:', mockError);

    consoleSpy.mockRestore();
  });
});

describe('bookmark persistence', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    doc.mockImplementation((_database, ...segments) => segments.join('/'));
  });

  it('updates the current server bookmark list inside a transaction', async () => {
    const transaction = {
      get: vi.fn().mockResolvedValue({
        exists: () => true,
        data: () => ({ bookmarks: ['https://one.example/'] }),
      }),
      set: vi.fn(),
    };
    runTransaction.mockImplementation(async (_database, callback) => callback(transaction));

    const result = await toggleLikeInFirestore(
      'user123',
      'https://two.example/',
      true
    );

    expect(transaction.set).toHaveBeenCalledWith(
      'users/user123',
      { bookmarks: ['https://one.example', 'https://two.example'] },
      { merge: true }
    );
    expect(result).toEqual({
      isLiked: true,
      bookmarks: ['https://one.example', 'https://two.example'],
    });
  });

  it('propagates bookmark read failures instead of replacing cache with empty data', async () => {
    const error = new Error('offline');
    getDoc.mockRejectedValue(error);
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    await expect(fetchUserBookmarks('user123')).rejects.toBe(error);
    expect(consoleSpy).toHaveBeenCalledWith('Failed to fetch user bookmarks:', error);

    consoleSpy.mockRestore();
  });
});

describe('global like reads', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('drops unsafe counters returned by Firestore', async () => {
    getDoc.mockResolvedValue({
      exists: () => true,
      data: () => ({
        safe: 8.9,
        numericString: '4',
        negative: -1,
        markup: '<img src=x>',
      }),
    });

    await expect(fetchGlobalLikes()).resolves.toEqual({
      safe: 8,
      numericString: 4,
    });
  });
});
