import fs from 'node:fs/promises';
import path from 'node:path';
import {
  normalizePortfolioCollection,
  portfolioIdentity,
  toSafeHttpsUrl,
} from '../src/lib/portfolio.js';

const dataFile = path.resolve(
  process.env.DATA_FILE || 'src/data/portfolios.json',
);

const fail = (message) => {
  console.error(`Portfolio validation failed: ${message}`);
  process.exitCode = 1;
};

try {
  const source = JSON.parse(await fs.readFile(dataFile, 'utf8'));
  if (!Array.isArray(source)) {
    fail('the root value must be an array.');
  } else {
    const identities = new Set();
    let duplicateCount = 0;
    let excludedHttpCount = 0;
    let excludedFalsePositiveCount = 0;
    let unsafeHttpsCount = 0;

    source.forEach((record, index) => {
      if (!record || typeof record !== 'object') {
        fail(`entry ${index} is not an object.`);
        return;
      }

      if (record.is_portfolio === false) {
        excludedFalsePositiveCount++;
        return;
      }

      const safeUrl = toSafeHttpsUrl(record.url);
      if (!safeUrl) {
        if (
          typeof record.url === 'string' &&
          record.url.trim().toLowerCase().startsWith('http:')
        ) {
          excludedHttpCount++;
        } else {
          unsafeHttpsCount++;
          fail(`entry ${index} contains an unsafe URL.`);
        }
        return;
      }

      const identity = portfolioIdentity(safeUrl);
      if (identities.has(identity)) duplicateCount++;
      identities.add(identity);
    });

    const displayable = normalizePortfolioCollection(source);
    if (displayable.length === 0) {
      fail('no displayable HTTPS portfolios remain after validation.');
    }

    if (duplicateCount > 0) {
      console.warn(
        `Portfolio validation: ${duplicateCount} normalized duplicate(s) will be excluded.`,
      );
    }
    if (excludedHttpCount > 0) {
      console.warn(
        `Portfolio validation: ${excludedHttpCount} non-HTTPS record(s) will be excluded.`,
      );
    }

    console.log(
      `Portfolio validation passed: ${displayable.length} displayable, ${excludedFalsePositiveCount} false positive(s), ${unsafeHttpsCount} unsafe HTTPS record(s).`,
    );
  }
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
}
