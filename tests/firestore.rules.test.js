import fs from 'node:fs/promises';
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
} from '@firebase/rules-unit-testing';
import {
  doc,
  getDoc,
  serverTimestamp,
  setDoc,
  updateDoc,
} from 'firebase/firestore';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';

let testEnvironment;

beforeAll(async () => {
  testEnvironment = await initializeTestEnvironment({
    projectId: 'portfolio-universe-rules-test',
    firestore: {
      host: '127.0.0.1',
      port: 8080,
      rules: await fs.readFile('firestore.rules', 'utf8'),
    },
  });
});

beforeEach(async () => {
  await testEnvironment.clearFirestore();
});

afterAll(async () => {
  await testEnvironment.cleanup();
});

describe('portfolio and aggregate rules', () => {
  it('allows public reads but denies every client write', async () => {
    await testEnvironment.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), 'portfolios', 'portfolio-1'), {
        name: 'Example',
        url: 'https://example.com/',
        views: 2,
      });
      await setDoc(doc(context.firestore(), 'global_stats', 'likes'), {
        example: 1,
      });
    });

    const anonymous = testEnvironment.unauthenticatedContext().firestore();
    const authenticated = testEnvironment
      .authenticatedContext('user-1')
      .firestore();

    await assertSucceeds(
      getDoc(doc(anonymous, 'portfolios', 'portfolio-1')),
    );
    await assertFails(
      setDoc(doc(anonymous, 'portfolios', 'attacker'), { views: 1 }),
    );
    await assertFails(
      updateDoc(doc(authenticated, 'portfolios', 'portfolio-1'), {
        views: 3,
      }),
    );
    await assertFails(
      setDoc(doc(authenticated, 'global_stats', 'likes'), {
        example: 999,
      }),
    );
  });
});
describe('user bookmark rules', () => {
  it('allows only the owner and only the bounded bookmark schema', async () => {
    const owner = testEnvironment.authenticatedContext('owner').firestore();
    const stranger = testEnvironment
      .authenticatedContext('stranger')
      .firestore();
    const reference = doc(owner, 'users', 'owner');

    await assertSucceeds(
      setDoc(reference, {
        bookmarks: ['https://example.com/'],
        updatedAt: serverTimestamp(),
      }),
    );
    await assertSucceeds(getDoc(reference));
    await assertFails(getDoc(doc(stranger, 'users', 'owner')));
    await assertFails(
      setDoc(doc(stranger, 'users', 'owner'), {
        bookmarks: [],
        updatedAt: serverTimestamp(),
      }),
    );
    await assertFails(
      setDoc(reference, {
        bookmarks: [],
        admin: true,
        updatedAt: serverTimestamp(),
      }),
    );
    await assertFails(
      setDoc(reference, {
        bookmarks: Array.from(
          { length: 501 },
          (_, index) => `https://example.com/${index}`,
        ),
        updatedAt: serverTimestamp(),
      }),
    );
  });
});

describe('submission rules', () => {
  it('accepts a strict authenticated submission and denies unsafe variants', async () => {
    const owner = testEnvironment.authenticatedContext('owner').firestore();
    const anonymous = testEnvironment.unauthenticatedContext().firestore();
    const validSubmission = {
      uid: 'owner',
      name: 'Example Developer',
      url: 'https://example.com/',
      status: 'pending',
      createdAt: serverTimestamp(),
    };

    await assertSucceeds(
      setDoc(doc(owner, 'submissions', 'valid'), validSubmission),
    );
    await assertFails(
      getDoc(doc(owner, 'submissions', 'valid')),
    );
    await assertFails(
      setDoc(doc(anonymous, 'submissions', 'anonymous'), validSubmission),
    );
    await assertFails(
      setDoc(doc(owner, 'submissions', 'http'), {
        ...validSubmission,
        url: 'http://example.com/',
      }),
    );
    await assertFails(
      setDoc(doc(owner, 'submissions', 'wrong-owner'), {
        ...validSubmission,
        uid: 'stranger',
      }),
    );
    await assertFails(
      setDoc(doc(owner, 'submissions', 'extra-field'), {
        ...validSubmission,
        role: 'admin',
      }),
    );
  });
});
