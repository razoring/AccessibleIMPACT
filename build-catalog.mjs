// build-catalog.mjs — P3 Catalog Builder
// Reads blocks.txt vocabulary + tree.txt taxonomy + instructions/ corpus evidence
// Produces catalog.json mapping normalized payload tokens -> { blockType, category, confidence }
// Design rules: only blocks.txt tokens; no runtime dependency on data-id; toolbox-default only.

import fs from 'fs';
import path from 'path';

const ROOT = '.';

function norm(s) {
  return s.toLowerCase()
    .replace(/\[|\]/g, ' ')
    .replace(/\[\s*\]\s*|\(\s*\)\s*|\s+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

// Read blocks vocabulary (only bracket tokens from blocks.txt; bubbles untouched)
const blocksRaw = fs.readFileSync('blocks.txt', 'utf8');
const blockLines = blocksRaw.split(/\r?\n/).filter(l => l.trim().startsWith('['));
const vocabulary = new Set();
for (const line of blockLines) {
  const m = line.match(/\[([^\]]+)\]/);
  if (m) vocabulary.add(norm(m[1]));
}

// Read tree taxonomy: extract block type names (not data-id) and category paths
const treeRaw = fs.readFileSync('tree.txt', 'utf8');
const lines = treeRaw.split(/\r?\n/);

// Build taxonomy lookup: blockType -> category (from tree indentation)
const taxonomy = {}; // blockType -> { category, subcategory }
let currentCategory = null;
let currentSub = null;

for (const raw of lines) {
  const line = raw.replace(/^[ │├└─]+/, ''); // strip tree drawing chars roughly
  if (!line.trim()) continue;
  // Category line: ends with no data-id parenthesis, is capitalized phrase
  if (/^[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*$/.test(line.trim()) && !line.includes('data-id')) {
    currentCategory = line.trim();
    currentSub = null;
  } else if (/├─/.test(raw) || /└─/.test(raw)) {
    // Try to extract type name before (data-id)
    const m = raw.match(/([a-zA-Z_][a-zA-Z0-9_]*)\s+\(data-id/);
    if (m) {
      const btype = m[1];
      taxonomy[btype] = { category: currentCategory || 'Unknown', subcategory: currentSub || null };
    }
  }
}

// Derive mapping programmatically from taxonomy + token normalization (no manual table).
// Strategy: tokenize vocabulary; for each, find taxonomy block types whose names
// contain matching keywords; pick best by overlapping word count.
function deriveMatch(token, taxonomy) {
  const tokWords = token.split(/\s+/).filter(Boolean);
  let best = null, bestScore = 0;
  for (const [btype, info] of Object.entries(taxonomy)) {
    const bWords = btype.toLowerCase().replace(/_/g, ' ').split(/\s+/).filter(w => w.length > 1);
    let score = 0;
    for (const w of tokWords) {
      const w2 = w.replace(/[^a-z]/g, '');
      if (!w2 || w2.length < 2) continue;
      for (const bw of bWords) {
        const bw2 = bw.replace(/[^a-z]/g, '');
        if (w2 === bw2 || w2.includes(bw2) || bw2.includes(w2)) score += 1;
        else if (w2.substring(0, 3) === bw2.substring(0, 3)) score += 0.3;
      }
    }
    if (info.category) {
      const catWords = info.category.toLowerCase().split(/\s+/);
      for (const w of tokWords) {
        const w2 = w.replace(/[^a-z]/g, '');
        for (const cw of catWords) {
          const cw2 = cw.replace(/[^a-z]/g, '');
          if (w2 === cw2 || w2.includes(cw2)) score += 0.5;
        }
      }
    }
    if (score > bestScore) { bestScore = score; best = btype; }
  }
  return bestScore >= 2 ? best : null;
}

const catalog = {};
// Build catalog for vocabulary entries; leave unmatched as null blockType (preserved as original brackets)
for (const token of vocabulary) {
  const key = token;
  const mapped = deriveMatch(key, taxonomy);
  const taxonomyInfo = mapped ? taxonomy[mapped] || { category: 'Unknown', subcategory: null } : { category: 'Unknown', subcategory: null };
  catalog[key] = {
    tokenRaw: key,
    blockType: mapped || null,
    category: taxonomyInfo.category,
    subcategory: taxonomyInfo.subcategory,
    confidence: mapped ? (taxonomyInfo.category !== 'Unknown' ? 'high' : 'medium') : 'none',
    source: 'blocks.txt',
    matchedBy: mapped ? 'taxonomy-normalization' : null,
    // Design rule: never embed data-id; only used for verification if needed
    dataIdRef: null,
    note: mapped ? 'inline-SVG toolbox-default clone' : 'unmatched: preserve original [token] text, do not render wrong block'
  };
}

fs.mkdirSync('catalog', { recursive: true });
fs.writeFileSync('catalog/catalog.json', JSON.stringify(catalog, null, 2));

// Also write a lightweight lookup for renderer.js
const lookup = {};
for (const [token, info] of Object.entries(catalog)) {
  if (info.blockType) {
    lookup[token] = info.blockType;
  }
}
fs.writeFileSync('catalog/token-to-type.json', JSON.stringify(lookup, null, 2));

console.log('P3 catalog built: ' + Object.keys(catalog).length + ' tokens; matched=' + Object.values(catalog).filter(c => c.blockType).length + '; output=./catalog/');
