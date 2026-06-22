import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_FILE = path.join(__dirname, '../src/data/portfolios.json');

async function recoverFalseNegatives() {
  console.log('Reading portfolios.json...');
  const data = JSON.parse(await fs.readFile(DATA_FILE, 'utf-8'));
  let recoveredCount = 0;

  for (const p of data) {
    if (p.ai_processed && p.is_portfolio === false) {
      // Revert the ai_processed flag so it can be re-analyzed
      // Alternatively, we can force it to true if we are manually verifying
      p.ai_processed = false; 
      recoveredCount++;
    }
  }

  if (recoveredCount > 0) {
    await fs.writeFile(DATA_FILE, JSON.stringify(data, null, 2), 'utf-8');
    console.log(`Successfully queued ${recoveredCount} false negatives for re-processing.`);
  } else {
    console.log('No false negatives found to recover.');
  }
}

recoverFalseNegatives().catch(console.error);
