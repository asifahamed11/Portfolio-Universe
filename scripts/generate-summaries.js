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
      hash = ((hash << 5) - hash) + url.charCodeAt(i);
      hash |= 0;
    }
    return `hash_${Math.abs(hash)}`;
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

  const prompt = `
You are an expert at extracting specific professional information.
I will give you a JSON array containing website contents for multiple portfolios.
For EACH portfolio, extract the following information.

CRITICAL RULES FOR SUMMARY:
1. STRICT FORMAT MUST BE: "[Role] at [Company], [brief highlight]."
2. Keep it exactly between 10-15 words. Just output the text.
3. NEVER use the person's name or prefixes like "Currently works as".

Return your answer strictly as a RAW JSON Object where the keys are the "url" strings provided, and the values are objects containing the extracted data:
{
  "https://example.com": {
    "summary": "10-15 word summary",
    "role": "General role category (e.g. Frontend Developer, Backend Developer, Full Stack, UI/UX Designer, Data Scientist, etc.)",
    "tech_stack": ["React", "Node.js", "Python"], // Array of up to 5 main technologies
    "available_for_hire": true, // true if they mention being available for freelance or hire
    "is_portfolio": true // Set to true ONLY if the website is clearly a personal portfolio, resume, or developer showcase. Set to false if it's a company website, blog post, generic tool, generic product landing page, or anything else.
  }
}
Do NOT wrap the JSON in markdown code blocks (\`\`\`json). Just return the raw JSON object.

Data:
${JSON.stringify(validData)}
`;

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


  const BATCH_SIZE = 1; // Process one by one sequentially as requested
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
          portfolios[index].summary = data.summary || "";
          portfolios[index].role = data.role || "";
          portfolios[index].tech_stack = Array.isArray(data.tech_stack) ? data.tech_stack.slice(0, 5) : [];
          portfolios[index].available_for_hire = !!data.available_for_hire;
          portfolios[index].is_portfolio = data.is_portfolio !== false;
          portfolios[index].ai_processed = true;
          successCount++;
          console.log(`[✓] Updated: ${portfolio.url}`);
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
