import fs from 'fs';

const data = JSON.parse(fs.readFileSync('src/data/portfolios.json', 'utf8'));
let changed = 0;

data.forEach(p => {
  let cleaned = false;
  if (p.summary === "Creative professional portfolio showcasing latest projects.") {
    delete p.summary;
    cleaned = true;
  }
  if (p.summary === "Unknown role, this portfolio provides insufficient information for a summary.") {
    delete p.summary;
    cleaned = true;
  }
  if (p.role === "Unknown") {
    delete p.role;
    cleaned = true;
  }
  if (Array.isArray(p.tech_stack) && p.tech_stack.length === 0) {
    delete p.tech_stack;
    cleaned = true;
  }
  if (p.experience_level === "Unknown") {
    delete p.experience_level;
    cleaned = true;
  }
  if (p.location === "Unknown") {
    delete p.location;
    cleaned = true;
  }
  if (p.specialization === "General" || p.specialization === "Unknown") {
    delete p.specialization;
    cleaned = true;
  }
  if (p.primary_language === "Unknown") {
    delete p.primary_language;
    cleaned = true;
  }
  
  // also clean boolean flags that are just defaults without real data
  if (cleaned) {
    changed++;
    delete p.has_blog;
    delete p.available_for_hire;
  }
});

console.log(`Cleaned ${changed} entries.`);
fs.writeFileSync('src/data/portfolios.json', JSON.stringify(data, null, 2));
