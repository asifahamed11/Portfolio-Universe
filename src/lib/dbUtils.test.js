import { describe, it, expect, vi, beforeEach } from 'vitest';
import { submitPortfolio } from './dbUtils.js';
import { collection, addDoc, serverTimestamp, doc } from 'firebase/firestore';

// Mock dependencies
vi.mock('./firebase.js', () => ({
  db: {}
}));

vi.mock('firebase/firestore', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    collection: vi.fn(),
    addDoc: vi.fn(),
    serverTimestamp: vi.fn(() => 'mocked-timestamp'),
    doc: vi.fn()
  };
});

describe('submitPortfolio', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should successfully submit a new portfolio', async () => {
    // Arrange
    const mockUid = 'user123';
    const mockName = 'Test Portfolio';
    const mockUrl = 'https://example.com';

    collection.mockReturnValue('mock-collection-ref');
    addDoc.mockResolvedValue({ id: 'new-doc-id' });

    // Act
    const result = await submitPortfolio(mockUid, mockName, mockUrl);

    // Assert
    expect(result).toBe(true);
    expect(collection).toHaveBeenCalledWith({}, 'submissions');
    expect(serverTimestamp).toHaveBeenCalled();
    expect(addDoc).toHaveBeenCalledWith('mock-collection-ref', {
      uid: mockUid,
      name: mockName,
      url: mockUrl,
      status: 'pending',
      createdAt: 'mocked-timestamp'
    });
  });

  it('should throw an error if submission fails', async () => {
    // Arrange
    const mockUid = 'user123';
    const mockName = 'Test Portfolio';
    const mockUrl = 'https://example.com';
    const mockError = new Error('Firestore error');

    collection.mockReturnValue('mock-collection-ref');
    addDoc.mockRejectedValue(mockError);

    // Console spy to prevent noise in test output
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    // Act & Assert
    await expect(submitPortfolio(mockUid, mockName, mockUrl)).rejects.toThrow('Firestore error');

    expect(consoleSpy).toHaveBeenCalledWith('Failed to submit portfolio:', mockError);

    consoleSpy.mockRestore();
  });
});
