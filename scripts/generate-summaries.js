import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_FILE = path.join(__dirname, '../src/data/portfolios.json');

// The custom Kaggle Qwen 2.5 Server URL (localhost since we run Node in Kaggle now)
const OLLAMA_URL = "http://localhost:11434/api/generate";

const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function fetchWebsiteContent(url) {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000); // 10 second timeout
    
    const response = await fetch(`https://r.jina.ai/${url}`, {
      headers: { 'Accept': 'text/plain' },
      signal: controller.signal
    });
    
    clearTimeout(timeoutId);
    
    if (!response.ok) {
      throw new Error(`Jina Reader returned status ${response.status}`);
    }
    const text = await response.text();
    return text.substring(0, 5000);
  } catch (error) {
    console.error(`Failed to fetch content for ${url}:`, error.message);
    return null;
  }
}

const urlToKey = (url) => {
  try {
    return btoa(encodeURIComponent(url)).replace(/\//g, '_').replace(/\+/g, '-').replace(/=/g, '');
  } catch (e) {
    let hash = 0;
    for (let i = 0; i < url.length; i++) {
      hash = Math.imul(31, hash) + url.charCodeAt(i) | 0;
    }
    return `hash_${hash >>> 0}`;
  }
};

async function processBatch(batch) {
  console.log(`\nFetching text content for ${batch.length} websites sequentially (to avoid Jina rate limits)...`);
  
  const websitesData = [];
  for (let i = 0; i < batch.length; i++) {
    const text = await fetchWebsiteContent(batch[i].url);
    websitesData.push({ url: batch[i].url, text: text || "" });
    if (i < batch.length - 1) await delay(1500);
  }
  
  const validData = websitesData.filter(d => d.text.trim().length > 50);
  
  if (validData.length === 0) {
    console.log("No valid text found in this batch.");
    return {};
  }

  console.log(`Sending 1 single request to Qwen 2.5 for ${validData.length} websites...`);

  const prompt = `You are a data-extraction engine for a developer-portfolio aggregator.
Input: JSON array of {url, content} objects — content is scraped text/HTML per site.
For EACH entry, extract fields per schema below. Return ONE raw JSON object.

OUTPUT RULES — follow exactly:
- Keys = exact "url" strings from input, same order, one entry per url. No url skipped, none added.
- Raw JSON only. No markdown fences, no preamble, no closing remarks. Response starts with { and ends with }.
- Every field present on every entry. Never null, never omit a key.
- Never invent facts not present in content.
- If site content is non-English, write summary/role/projects in English; keep proper nouns (name, location, tech names) as-is.

SCHEMA (per url):
{
  "is_portfolio": boolean,
  "name": string,
  "location": string,
  "summary": string,
  "role": string,
  "tech_stack": string[],
  "projects": string[],
  "social_links": string[],
  "seo_evaluation": "Good" | "Average" | "Needs Improvement",
  "portfolio_score": integer 1-10,
  "available_for_hire": boolean
}

FIELD RULES:
- is_portfolio: true ONLY for an individual's personal portfolio, resume, or dev/design showcase. false for: company sites, blogs, SaaS landing pages, docs, generic tools, agency/team pages listing multiple people, or unedited template boilerplate. If false -> output empty values for strings, empty arrays, etc.
- name: full name as displayed. "" if none.
- location: "City, Country" if both known. "Remote" only if explicitly stated. else "".
- summary: 30-50 words, third person. Cover domain + years of experience, core stack, one standout strength/achievement.
- role: pick exactly ONE — Frontend Developer | Backend Developer | Full Stack Developer | Mobile Developer | ML/AI Engineer | Data Scientist | DevOps/Cloud Engineer | UI/UX Designer | Game Developer | Other.
- tech_stack: canonical names only. Dedupe. Order by prominence in content. Max 8.
- projects: max 5, most significant/recent first. Each: "<what it does> — <key tech>", <=20 words, no marketing language.
- social_links: full https:// URLs (add scheme if missing). Dedupe.
- seo_evaluation: "Good" = descriptive title incl. name+role. "Average" = title present but generic. "Needs Improvement" = default/template title.
- portfolio_score (1-10 integer): content completeness/clarity only. 1-3 = empty. 4-6 = basic. 7-8 = solid. 9-10 = exceptional.
- available_for_hire: true ONLY on explicit signal — "available for hire/freelance", "open to opportunities", a hire-me CTA.

Data:
${JSON.stringify(validData)}`;

  try {
      const result = await fetch('http://127.0.0.1:11434/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: "qwen2.5:7b",
          prompt: prompt,
          stream: false
        })
      });

    if (!result.ok) {
      throw new Error(`Ollama API error! status: ${result.status}`);
    }

    const response = await result.json();
    let jsonStr = response.response.trim();
    
    if (jsonStr.startsWith('```json')) jsonStr = jsonStr.substring(7);
    if (jsonStr.startsWith('```')) jsonStr = jsonStr.substring(3);
    if (jsonStr.endsWith('```')) jsonStr = jsonStr.substring(0, jsonStr.length - 3);
    
    return JSON.parse(jsonStr.trim());
  } catch (error) {
    console.error('Qwen 2.5 API Error during batch generation:', error.message);
    return null;
  }
}

async function main() {
  console.log('Loading portfolios from local JSON file...');
  
  if (!fs.existsSync(DATA_FILE)) {
    console.error(`ERROR: Data file not found at ${DATA_FILE}`);
    process.exit(1);
  }
  
  const fileData = fs.readFileSync(DATA_FILE, 'utf-8');
  const portfolios = JSON.parse(fileData);

  // Filter out portfolios that already have a summary so we can resume if stopped
  let itemsToProcess = portfolios.filter(p => !p.summary || p.summary.trim() === ""); 
  console.log(`Found ${itemsToProcess.length} portfolios to process.`);
  
  if (itemsToProcess.length === 0) {
    console.log("No portfolios found!");
    process.exit(0);
  }


  const BATCH_SIZE = 1; // Process one by one sequentially to prevent Ollama Out of Memory crashes
  let successCount = 0;

  for (let i = 0; i < itemsToProcess.length; i += BATCH_SIZE) {
    const batch = itemsToProcess.slice(i, i + BATCH_SIZE);
    console.log(`\n--- Processing Batch ${Math.floor(i/BATCH_SIZE) + 1} (${batch.length} items) ---`);
    
    const resultsMap = await processBatch(batch);
    
    if (resultsMap) {
      for (const portfolio of batch) {
        // Find the index of this portfolio in the main array
        const index = portfolios.findIndex(p => p.url === portfolio.url);
        if (index === -1) continue;

        if (resultsMap[portfolio.url]) {
          const data = resultsMap[portfolio.url];
          portfolios[index].name = data.name || portfolios[index].name || "";
          portfolios[index].location = data.location || "";
          portfolios[index].summary = data.summary || "";
          portfolios[index].role = data.role || "";
          portfolios[index].tech_stack = Array.isArray(data.tech_stack) ? data.tech_stack.slice(0, 8) : [];
          portfolios[index].projects = Array.isArray(data.projects) ? data.projects : [];
          portfolios[index].social_links = Array.isArray(data.social_links) ? data.social_links : [];
          portfolios[index].seo_evaluation = data.seo_evaluation || "";
          portfolios[index].portfolio_score = data.portfolio_score || 0;
          portfolios[index].available_for_hire = !!data.available_for_hire;
          portfolios[index].is_portfolio = data.is_portfolio !== false;
          portfolios[index].ai_processed = true;
          successCount++;
          
          console.log(`\n[✓] Extracted data for: ${portfolio.url}`);
          console.log(`    Name: ${portfolios[index].name}`);
          console.log(`    Role: ${portfolios[index].role}`);
          console.log(`    Location: ${portfolios[index].location}`);
          console.log(`    Tech Stack: ${portfolios[index].tech_stack.join(', ')}`);
          console.log(`    Score: ${portfolios[index].portfolio_score}/10 | SEO: ${portfolios[index].seo_evaluation}`);
          console.log(`    Summary: ${portfolios[index].summary}`);
        }
      }
      
      // Save the updated array back to portfolios.json after every batch
      try {
        fs.writeFileSync(DATA_FILE, JSON.stringify(portfolios, null, 2), 'utf-8');
        console.log(`Saved batch results to ${DATA_FILE}. Total success: ${successCount}`);
      } catch (e) {
        console.error(`Failed to save to JSON file: ${e.message}`);
      }
    } else {
      console.log("Batch failed. Moving to next after delay.");
    }
    
    if (i + BATCH_SIZE < itemsToProcess.length) {
      console.log('Waiting 10 seconds before next batch to respect rate limits...');
      await delay(10000);
    }
  }

  console.log(`\nFinished! Successfully generated and saved summaries for ${successCount} items.`);
  process.exit(0);
}

main();
