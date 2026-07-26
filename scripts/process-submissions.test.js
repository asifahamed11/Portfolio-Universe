import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';
import { parseServiceAccount } from './process-submissions.js';
import { PRIVATE_REVIEW_MARKER } from './submission-review-state.js';

const execFileAsync = promisify(execFile);
const SCRIPT_FILE = fileURLToPath(new URL('./process-submissions.js', import.meta.url));

describe('submission service-account validation', () => {
  it('distinguishes malformed JSON from valid credentials for the wrong project', () => {
    expect(() => parseServiceAccount('{')).toThrow(/not valid JSON/u);
    expect(() => parseServiceAccount(JSON.stringify({
      project_id: 'other-project',
      client_email: 'admin@example.test',
      private_key: 'secret',
    }))).toThrow(/Credentials must be for portfolio-universe/u);
  });

  it('rejects JSON null without misreporting it as malformed JSON', () => {
    expect(() => parseServiceAccount('null')).toThrow(
      /Credentials must be for portfolio-universe/u,
    );
  });

  it('normalizes escaped private-key newlines after validation', () => {
    expect(parseServiceAccount(JSON.stringify({
      project_id: 'portfolio-universe',
      client_email: 'admin@example.test',
      private_key: 'line one\\nline two',
    })).private_key).toBe('line one\nline two');
  });
});

describe('submission snapshot CLI modes', () => {
  it('withholds private reviews, restores them, and can safely discard the recovery copy', async () => {
    const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'portfolio-review-'));
    const dataDirectory = path.join(temporaryRoot, 'src', 'data');
    const dataFile = path.join(dataDirectory, 'portfolios.json');
    const privateFile = `${dataFile}.review-private`;
    const records = [
      { url: 'https://public.example', name: 'Public' },
      {
        url: 'https://queued.example',
        name: 'Queued',
        is_portfolio: false,
        ai_processed: false,
        [PRIVATE_REVIEW_MARKER]: 'queued-id',
      },
      {
        url: 'https://accepted.example',
        name: 'Accepted',
        is_portfolio: true,
        ai_processed: true,
        [PRIVATE_REVIEW_MARKER]: 'accepted-id',
      },
    ];

    try {
      await fs.mkdir(dataDirectory, { recursive: true });
      await fs.writeFile(dataFile, `${JSON.stringify(records)}\n`, 'utf8');

      await execFileAsync(process.execPath, [SCRIPT_FILE, '--prepare-public'], {
        cwd: temporaryRoot,
      });
      const publicRecords = JSON.parse(await fs.readFile(dataFile, 'utf8'));
      expect(publicRecords.map((record) => record.url)).toEqual([
        'https://public.example',
        'https://accepted.example',
      ]);
      expect(publicRecords.every(
        (record) => !(PRIVATE_REVIEW_MARKER in record),
      )).toBe(true);
      expect(JSON.parse(await fs.readFile(privateFile, 'utf8'))).toHaveLength(3);

      await execFileAsync(process.execPath, [SCRIPT_FILE, '--restore-private'], {
        cwd: temporaryRoot,
      });
      const restored = JSON.parse(await fs.readFile(dataFile, 'utf8'));
      expect(restored).toHaveLength(3);
      expect(restored[1][PRIVATE_REVIEW_MARKER]).toBe('queued-id');

      await execFileAsync(process.execPath, [SCRIPT_FILE, '--prepare-public'], {
        cwd: temporaryRoot,
      });
      await execFileAsync(process.execPath, [SCRIPT_FILE, '--discard-private'], {
        cwd: temporaryRoot,
      });
      await expect(fs.access(privateFile)).rejects.toMatchObject({ code: 'ENOENT' });
    } finally {
      await fs.rm(temporaryRoot, { recursive: true, force: true });
    }
  }, 20_000);
});
