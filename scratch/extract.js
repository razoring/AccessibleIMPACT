const fs = require('fs');
let text = fs.readFileSync('C:/Users/conta/.gemini/antigravity/brain/169b7b90-afec-471e-85ee-0716a35a714d/.system_generated/steps/921/output.txt', 'utf8');
const start = text.indexOf('{"count":360');
const end = text.indexOf('### Ran Playwright code');
const jsonStr = text.slice(start, end).trim();
const out = JSON.parse(jsonStr);
fs.writeFileSync('scratch/makecode_catalog.json', JSON.stringify(out.catalog, null, 2));
console.log('Saved catalog with', Object.keys(out.catalog).length, 'blocks');

