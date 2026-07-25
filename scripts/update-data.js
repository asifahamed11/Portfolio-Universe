import fs from 'fs/promises';
import path from 'path';
import {
  portfolioIdentity,
  toSafeHttpsUrl,
} from '../src/lib/portfolio.js';

const README_URL = 'https://raw.githubusercontent.com/emmabostian/developer-portfolios/master/README.md';
const DATA_FILE = path.join(process.cwd(), 'src', 'data', 'portfolios.json');

async function fetchReadme() {
  const response = await fetch(README_URL);
  if (!response.ok) {
    throw new Error(`Failed to fetch README.md: ${response.statusText}`);
  }
  return await response.text();
}

function parseMarkdownList(markdown) {
  const lines = markdown.split('\n');
  const portfolios = [];
  const linkRegex = /^\s*-\s+\[([^\]]+)\]\((https?:\/\/[^)]+)\)/;

  for (const line of lines) {
    const match = line.match(linkRegex);
    if (match) {
      const nameRaw = match[1].trim();
      const url = match[2].trim();
      const name = nameRaw.replace(/[*_~`]/g, '');
      portfolios.push({ name, url });
    }
  }
  return portfolios;
}

async function run() {
  try {
    console.log('Fetching README.md...');
    const markdown = await fetchReadme();
    
    console.log('Parsing markdown...');
    const extractedData = parseMarkdownList(markdown);
    
    const cleanedData = Array.from(
      new Map(
        extractedData
          .map((item) => ({ ...item, url: toSafeHttpsUrl(item.url) }))
          .filter((item) => item.url)
          .map(item => [portfolioIdentity(item.url), {
            name: item.name,
            url: item.url,
            screenshot: `https://s0.wp.com/mshots/v1/${encodeURIComponent(item.url)}?w=600`
          }])
      ).values()
    );

    // Read existing portfolios.json
    let existingPortfolios = [];
    try {
      const fileData = await fs.readFile(DATA_FILE, 'utf-8');
      existingPortfolios = JSON.parse(fileData);
    } catch (e) {
      console.log('No existing portfolios.json found, creating new one.');
    }

    // Reject unsafe/non-HTTPS legacy entries and collapse normalized duplicates.
    const existingMap = new Map();
    let rejectedCount = 0;
    for (const portfolio of existingPortfolios) {
      const safeUrl = toSafeHttpsUrl(portfolio.url);
      const identity = safeUrl && portfolioIdentity(safeUrl);
      if (!safeUrl || !identity || existingMap.has(identity)) {
        rejectedCount++;
        continue;
      }
      existingMap.set(identity, { ...portfolio, url: safeUrl });
    }
    existingPortfolios = [...existingMap.values()];

    let newCount = 0;

    // Merge new portfolios
    for (const item of cleanedData) {
      const identity = portfolioIdentity(item.url);
      if (identity && !existingMap.has(identity)) {
        // Add completely new portfolio
        const portfolio = {
          url: item.url,
          name: item.name,
          role: "",
          specialization: "",
          summary: "",
          tech_stack: [],
          available_for_hire: false,
          primary_language: "",
          views: 0,
          has_blog: false,
          screenshot: item.screenshot
        };
        existingPortfolios.push(portfolio);
        existingMap.set(identity, portfolio);
        newCount++;
      }
    }

    // Save back to JSON
    await fs.writeFile(DATA_FILE, JSON.stringify(existingPortfolios, null, 2), 'utf-8');
    
    console.log(
      `\nSuccessfully synced data. Added ${newCount}, rejected ${rejectedCount} unsafe/duplicate legacy entries, total ${existingPortfolios.length}.`,
    );
    process.exit(0);
  } catch (error) {
    console.error('Error during data update:', error);
    process.exit(1);
  }
}

run();
