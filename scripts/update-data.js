import fs from 'fs/promises';
import path from 'path';

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

function isValidUrl(string) {
  try {
    new URL(string);
    return true;
  } catch (err) {
    return false;
  }
}

async function run() {
  try {
    console.log('Fetching README.md...');
    const markdown = await fetchReadme();
    
    console.log('Parsing markdown...');
    const extractedData = parseMarkdownList(markdown);
    
    const cleanedData = extractedData
      .filter(item => isValidUrl(item.url))
      .map(item => ({
        name: item.name,
        url: item.url,
        screenshot: `https://s0.wp.com/mshots/v1/${encodeURIComponent(item.url)}?w=600`
      }));

    // Read existing portfolios.json
    let existingPortfolios = [];
    try {
      const fileData = await fs.readFile(DATA_FILE, 'utf-8');
      existingPortfolios = JSON.parse(fileData);
    } catch (e) {
      console.log('No existing portfolios.json found, creating new one.');
    }

    // Create a map of existing URLs for fast lookup
    const existingMap = new Map();
    existingPortfolios.forEach(p => existingMap.set(p.url, p));

    let newCount = 0;

    // Merge new portfolios
    for (const item of cleanedData) {
      if (!existingMap.has(item.url)) {
        // Add completely new portfolio
        existingPortfolios.push({
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
        });
        newCount++;
      }
    }

    // Save back to JSON
    await fs.writeFile(DATA_FILE, JSON.stringify(existingPortfolios, null, 2), 'utf-8');
    
    console.log(`\nSuccessfully synced data. Found ${newCount} new portfolios. Total is now ${existingPortfolios.length}.`);
    process.exit(0);
  } catch (error) {
    console.error('Error during data update:', error);
    process.exit(1);
  }
}

run();
