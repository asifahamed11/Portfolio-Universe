import fs from 'node:fs/promises';
import path from 'node:path';
import type { APIRoute } from 'astro';
import { sanitizePortfolio } from '../lib/utils.js';

export const prerender = true;

export const GET: APIRoute = async () => {
  const dataPath = path.join(process.cwd(), 'src', 'data', 'portfolios.json');
  const rawData = await fs.readFile(dataPath, 'utf8');
  const parsedData: unknown = JSON.parse(rawData);

  if (!Array.isArray(parsedData)) {
    throw new TypeError('Portfolio data must be a JSON array.');
  }

  const portfolios = parsedData
    .map((portfolio, index) => sanitizePortfolio(portfolio, index))
    .filter((portfolio): portfolio is NonNullable<typeof portfolio> => portfolio !== null)
    .map(({ index: _index, ...portfolio }) => portfolio);

  return new Response(JSON.stringify(portfolios), {
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'public, max-age=0, must-revalidate',
      'X-Content-Type-Options': 'nosniff',
    },
  });
};
