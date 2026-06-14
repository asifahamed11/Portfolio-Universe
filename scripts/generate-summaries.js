import dotenv from 'dotenv';
import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs, doc, setDoc } from 'firebase/firestore';

// Load environment variables
dotenv.config();

// The custom Kaggle Qwen 2.5 Server URL (localhost since we run Node in Kaggle now)
const OLLAMA_URL = "http://localhost:11434/api/generate";

const firebaseConfig = {
  apiKey: process.env.PUBLIC_FIREBASE_API_KEY,
  authDomain: "portfolio-universe.firebaseapp.com",
  projectId: "portfolio-universe",
  storageBucket: "portfolio-universe.firebasestorage.app",
  messagingSenderId: "893366203418",
  appId: "1:893366203418:web:13b69c585c49a443268da3"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

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
    "available_for_hire": true // true if they mention being available for freelance or hire
  }
}
Do NOT wrap the JSON in markdown code blocks (\`\`\`json). Just return the raw JSON object.

Data:
${JSON.stringify(validData)}
`;

  try {
    const result = await fetch(OLLAMA_URL, {
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
  console.log('Fetching portfolio data from Firestore...');
  const snapshot = await getDocs(collection(db, 'portfolios'));
  const portfolios = snapshot.docs.map(doc => doc.data());

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
        const key = urlToKey(portfolio.url);
        let updateData = {
          summary: "",
          role: "",
          tech_stack: [],
          available_for_hire: false
        };

        if (resultsMap[portfolio.url]) {
          const data = resultsMap[portfolio.url];
          updateData.summary = data.summary || "";
          updateData.role = data.role || "";
          updateData.tech_stack = data.tech_stack || [];
          updateData.available_for_hire = data.available_for_hire || false;
          successCount++;
        }
        
        try {
          await setDoc(doc(db, 'portfolios', key), updateData, { merge: true });
        } catch (e) {
          console.error(`Failed to save summary for ${portfolio.url}: ${e.message}`);
        }
      }
      
      console.log(`Saved batch results to Firestore. Total success: ${successCount}`);
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
