import fs from 'node:fs/promises';
import path from 'node:path';
import { FieldValue } from 'firebase-admin/firestore';
import {
  portfolioIdentity,
  toSafeHttpsUrl,
} from '../src/lib/portfolio.js';
import { getAdminFirestore } from './firebase-admin.js';

const dataFile = path.resolve(
  process.env.DATA_FILE || 'src/data/portfolios.json',
);
const db = getAdminFirestore();

const portfolios = JSON.parse(await fs.readFile(dataFile, 'utf8'));
if (!Array.isArray(portfolios)) {
  throw new TypeError('Portfolio data must be a JSON array.');
}

const knownIdentities = new Set(
  portfolios
    .map((portfolio) => portfolioIdentity(portfolio?.url))
    .filter(Boolean),
);
const submissions = await db
  .collection('submissions')
  .where('status', '==', 'pending')
  .get();

let imported = 0;
let rejected = 0;
const rejectedSubmissions = [];

for (const submission of submissions.docs) {
  const data = submission.data();
  const url = toSafeHttpsUrl(data.url);
  const name =
    typeof data.name === 'string'
      ? data.name.replace(/\s+/g, ' ').trim().slice(0, 120)
      : '';
  const identity = url && portfolioIdentity(url);

  if (!url || !identity || !name) {
    rejectedSubmissions.push(submission.ref);
    rejected++;
    continue;
  }

  if (!knownIdentities.has(identity)) {
    portfolios.push({
      url,
      name,
      role: '',
      specialization: '',
      summary: '',
      tech_stack: [],
      available_for_hire: false,
      primary_language: '',
      views: 0,
      has_blog: false,
      screenshot: `https://s0.wp.com/mshots/v1/${encodeURIComponent(url)}?w=600`,
      ai_processed: false,
      source: 'user_submission',
    });
    knownIdentities.add(identity);
    imported++;
  }
}

for (let offset = 0; offset < rejectedSubmissions.length; offset += 450) {
  const batch = db.batch();
  for (const reference of rejectedSubmissions.slice(offset, offset + 450)) {
    batch.update(reference, {
      status: 'rejected',
      rejectionReason: 'invalid_submission',
      processedAt: FieldValue.serverTimestamp(),
    });
  }
  await batch.commit();
}
await fs.writeFile(
  dataFile,
  `${JSON.stringify(portfolios, null, 2)}\n`,
  'utf8',
);

console.log(
  `Submission import complete: ${imported} added, ${rejected} rejected, ${submissions.size} pending inspected.`,
);
