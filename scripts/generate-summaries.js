import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { GoogleGenerativeAI } from '@google/generative-ai';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_FILE = path.join(__dirname, '../src/data/portfolios.json');

// Initialize Gemini API
const apiKey = process.env.GEMINI_API_KEY;
if (!apiKey) {
  console.error('ERROR: Please set GEMINI_API_KEY in your .env file');
  process.exit(1);
}

const genAI = new GoogleGenerativeAI(apiKey);
// Using gemini-2.5-flash as it has 1M token context, perfect for batching
const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });

const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function fetchWebsiteContent(url) {
  try {
    const response = await fetch(`https://r.jina.ai/${encodeURIComponent(url)}`, {
      headers: { 'Accept': 'text/plain' }
    });
    if (!response.ok) {
      throw new Error(`Jina Reader returned status ${response.status}`);
    }
    const text = await response.text();
    // Trim to 5,000 chars per website to save tokens when batching
    return text.substring(0, 5000);
  } catch (error) {
    console.error(`Failed to fetch content for ${url}:`, error.message);
    return null;
  }
}

async function processBatch(batch) {
  console.log(`\nFetching text content for ${batch.length} websites sequentially (to avoid Jina rate limits)...`);
  
  const websitesData = [];
  for (let i = 0; i < batch.length; i++) {
    const text = await fetchWebsiteContent(batch[i].url);
    websitesData.push({ url: batch[i].url, text: text || "" });
    // Add a 1.5s delay between fetches to respect Jina AI free rate limits
    if (i < batch.length - 1) await delay(1500);
  }
  
  // Filter out empty ones to save tokens
  const validData = websitesData.filter(d => d.text.trim().length > 50);
  
  if (validData.length === 0) {
    console.log("No valid text found in this batch.");
    return {};
  }

  console.log(`Sending 1 single request to Gemini for ${validData.length} websites...`);

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
    "experience_level": "Junior/Mid/Senior/Lead", // Guess based on content, or "Unknown"
    "location": "City, Country", // Or "Unknown"
    "has_blog": true, // true if they have a blog or articles, false otherwise
    "available_for_hire": true, // true if they mention being available for freelance or hire
    "specialization": "Web3/E-commerce/SaaS/3D/Mobile etc.", // Specific niche, or "General"
    "primary_language": "English" // Guess the language the portfolio is written in
  }
}
Do NOT wrap the JSON in markdown code blocks (\`\`\`json). Just return the raw JSON object.

Data:
${JSON.stringify(validData)}
`;

  try {
    const result = await model.generateContent(prompt);
    const response = await result.response;
    let jsonStr = response.text().trim();
    
    // Clean up if the model accidentally wrapped in markdown
    if (jsonStr.startsWith('\`\`\`json')) jsonStr = jsonStr.substring(7);
    if (jsonStr.startsWith('\`\`\`')) jsonStr = jsonStr.substring(3);
    if (jsonStr.endsWith('\`\`\`')) jsonStr = jsonStr.substring(0, jsonStr.length - 3);
    
    return JSON.parse(jsonStr.trim());
  } catch (error) {
    console.error('Gemini API Error during batch generation:', error.message);
    return null;
  }
}

async function main() {
  console.log('Loading portfolio data...');
  let portfolios = [];
  try {
    const data = fs.readFileSync(DATA_FILE, 'utf-8');
    portfolios = JSON.parse(data);
  } catch (err) {
    console.error('Error reading portfolios.json:', err);
    process.exit(1);
  }

  const itemsToProcess = portfolios.filter(p => !p.summary);
  console.log(`Found ${itemsToProcess.length} portfolios that need summaries.`);
  
  if (itemsToProcess.length === 0) {
    console.log("All portfolios already have summaries!");
    return;
  }

  const BATCH_SIZE = 20; // Process 20 at a time to keep Gemini context fast and Jina safe
  let successCount = 0;

  for (let i = 0; i < itemsToProcess.length; i += BATCH_SIZE) {
    const batch = itemsToProcess.slice(i, i + BATCH_SIZE);
    console.log(`\n--- Processing Batch ${Math.floor(i/BATCH_SIZE) + 1} (${batch.length} items) ---`);
    
    const resultsMap = await processBatch(batch);
    
    if (resultsMap) {
      // Apply results to portfolios
      for (const portfolio of batch) {
        if (resultsMap[portfolio.url]) {
          const data = resultsMap[portfolio.url];
          portfolio.summary = data.summary || "Creative professional portfolio showcasing latest projects.";
          portfolio.role = data.role || "Unknown";
          portfolio.tech_stack = data.tech_stack || [];
          portfolio.experience_level = data.experience_level || "Unknown";
          portfolio.location = data.location || "Unknown";
          
          // New advanced filter fields
          portfolio.has_blog = data.has_blog || false;
          portfolio.available_for_hire = data.available_for_hire || false;
          portfolio.specialization = data.specialization || "General";
          portfolio.primary_language = data.primary_language || "Unknown";
          
          successCount++;
        } else {
          // Fallback if model missed it
          portfolio.summary = "Creative professional portfolio showcasing latest projects.";
        }
      }
      
      // Save after each batch
      fs.writeFileSync(DATA_FILE, JSON.stringify(portfolios, null, 2));
      console.log(`Saved batch results. Total success: ${successCount}`);
    } else {
      console.log("Batch failed. Moving to next after delay.");
    }
    
    if (i + BATCH_SIZE < itemsToProcess.length) {
      console.log('Waiting 10 seconds before next batch to respect rate limits...');
      await delay(10000);
    }
  }

  console.log(`\nFinished! Successfully generated summaries for ${successCount} items using batching.`);
}

main();
