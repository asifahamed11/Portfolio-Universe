import fs from 'node:fs';
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
  Timestamp,
  updateDoc,
} from 'firebase/firestore';
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  it,
} from 'vitest';

const PROJECT_ID = 'demo-portfolio-universe';
const EMULATOR_HOST = '127.0.0.1';
const EMULATOR_PORT = 8080;
const PORTFOLIO_PATH = 'portfolios/example';

let testEnvironment;

function submission(uid, overrides = {}) {
  return {
    uid,
    name: 'Example Portfolio',
    url: 'https://example.com',
    status: 'pending',
    createdAt: serverTimestamp(),
    ...overrides,
  };
}

async function seed(path, value) {
  await testEnvironment.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), path), value);
  });
}

beforeAll(async () => {
  testEnvironment = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: {
      host: EMULATOR_HOST,
      port: EMULATOR_PORT,
      rules: fs.readFileSync('firestore.rules', 'utf8'),
    },
  });
});

beforeEach(async () => {
  await testEnvironment.clearFirestore();
});

afterAll(async () => {
  if (testEnvironment) {
    await testEnvironment.cleanup();
  }
});

describe('global statistics', () => {
  it('allows public reads of likes only and denies every client write', async () => {
    await seed('global_stats/likes', { total: 7 });
    await seed('global_stats/private', { internalValue: 9 });
    const guestDb = testEnvironment.unauthenticatedContext().firestore();
    const signedInDb = testEnvironment.authenticatedContext('alice').firestore();

    await assertSucceeds(getDoc(doc(guestDb, 'global_stats/likes')));
    await assertFails(getDoc(doc(guestDb, 'global_stats/private')));
    await assertFails(setDoc(doc(signedInDb, 'global_stats/likes'), { total: 8 }));
  });
});

describe('portfolio counters', () => {
  beforeEach(async () => {
    await seed(PORTFOLIO_PATH, {
      name: 'Example',
      url: 'https://example.com',
      views: 4,
    });
  });

  it('allows public reads but requires authentication to update', async () => {
    const guestDb = testEnvironment.unauthenticatedContext().firestore();

    await assertSucceeds(getDoc(doc(guestDb, PORTFOLIO_PATH)));
    await assertFails(updateDoc(doc(guestDb, PORTFOLIO_PATH), { views: 5 }));
  });

  it('allows exactly one signed-in increment and rejects counter jumps', async () => {
    const signedInDb = testEnvironment.authenticatedContext('alice').firestore();
    const portfolioRef = doc(signedInDb, PORTFOLIO_PATH);

    await assertSucceeds(updateDoc(portfolioRef, { views: 5 }));
    await assertFails(updateDoc(portfolioRef, { views: 7 }));
  });

  it('rejects metadata edits and client-created portfolios', async () => {
    const signedInDb = testEnvironment.authenticatedContext('alice').firestore();

    await assertFails(updateDoc(doc(signedInDb, PORTFOLIO_PATH), {
      name: 'Tampered',
      views: 5,
    }));
    await assertFails(setDoc(doc(signedInDb, 'portfolios/new'), {
      name: 'New',
      url: 'https://new.example',
      views: 1,
    }));
    await assertFails(setDoc(doc(signedInDb, 'portfolios/minimal'), {
      views: 1,
    }));
  });
});

describe('private bookmarks', () => {
  it('allows exact-schema owner access and denies cross-user access', async () => {
    const aliceDb = testEnvironment.authenticatedContext('alice').firestore();
    const bobDb = testEnvironment.authenticatedContext('bob').firestore();
    const aliceRef = doc(aliceDb, 'users/alice');

    await assertSucceeds(setDoc(aliceRef, { bookmarks: ['example'] }));
    await assertSucceeds(getDoc(aliceRef));
    await assertFails(getDoc(doc(bobDb, 'users/alice')));
    await assertFails(updateDoc(doc(bobDb, 'users/alice'), { bookmarks: [] }));
  });

  it('rejects unexpected fields and oversized bookmark lists', async () => {
    const aliceDb = testEnvironment.authenticatedContext('alice').firestore();

    await assertFails(setDoc(doc(aliceDb, 'users/alice'), {
      bookmarks: [],
      admin: true,
    }));
    await assertFails(setDoc(doc(aliceDb, 'users/alice'), {
      bookmarks: Array.from({ length: 2001 }, (_, index) => String(index)),
    }));
  });

  it('cannot preserve unexpected fields from a malformed existing document', async () => {
    const aliceDb = testEnvironment.authenticatedContext('alice').firestore();
    await seed('users/alice', {
      bookmarks: ['example'],
      admin: true,
    });

    await assertFails(updateDoc(doc(aliceDb, 'users/alice'), {
      bookmarks: [],
    }));
  });
});

describe('submission queue', () => {
  it('allows an owner to create an exact pending submission', async () => {
    const aliceDb = testEnvironment.authenticatedContext('alice').firestore();
    const submissionRef = doc(aliceDb, 'submissions/alice');

    await assertSucceeds(setDoc(submissionRef, submission('alice')));
    await assertFails(getDoc(submissionRef));
  });

  it('rejects anonymous, cross-user, and extra-field submissions', async () => {
    const guestDb = testEnvironment.unauthenticatedContext().firestore();
    const aliceDb = testEnvironment.authenticatedContext('alice').firestore();

    await assertFails(setDoc(
      doc(guestDb, 'submissions/alice'),
      submission('alice'),
    ));
    await assertFails(setDoc(
      doc(aliceDb, 'submissions/bob'),
      submission('bob'),
    ));
    await assertFails(setDoc(
      doc(aliceDb, 'submissions/alice'),
      submission('alice', { role: 'admin' }),
    ));
  });

  it('allows rejected retries and blocks queued resubmissions', async () => {
    const aliceDb = testEnvironment.authenticatedContext('alice').firestore();
    const submissionRef = doc(aliceDb, 'submissions/alice');

    await seed('submissions/alice', {
      uid: 'alice',
      name: 'Old portfolio',
      url: 'https://old.example',
      status: 'rejected',
      createdAt: new Date(0),
    });
    await assertSucceeds(setDoc(submissionRef, submission('alice')));

    await seed('submissions/alice', {
      uid: 'alice',
      name: 'Queued portfolio',
      url: 'https://queued.example',
      status: 'queued',
      createdAt: new Date(0),
    });
    await assertFails(setDoc(submissionRef, submission('alice')));
  });

  it('enforces the one-day cooldown after an accepted submission', async () => {
    const aliceDb = testEnvironment.authenticatedContext('alice').firestore();
    const submissionRef = doc(aliceDb, 'submissions/alice');
    const hour = 60 * 60 * 1000;

    await seed('submissions/alice', {
      uid: 'alice',
      status: 'accepted',
      processedAt: Timestamp.fromMillis(Date.now() - (23 * hour)),
    });
    await assertFails(setDoc(submissionRef, submission('alice')));

    await seed('submissions/alice', {
      uid: 'alice',
      status: 'accepted',
      processedAt: Timestamp.fromMillis(Date.now() - (25 * hour)),
    });
    await assertSucceeds(setDoc(submissionRef, submission('alice')));
  });
});
