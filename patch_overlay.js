const fs = require('fs');

let code = fs.readFileSync('overlay.js', 'utf8').replace(/\r\n/g, '\n');

// 1. loadCatalog
const targetLoad = "      if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.getURL) {\n        const [catRes, mapRes] = await Promise.all([\n          fetch(chrome.runtime.getURL('catalog/catalog.json')),\n          fetch(chrome.runtime.getURL('catalog/token_map.json'))\n        ]);";
const replaceLoad = "      if (true) {\n        const catUrl = (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.getURL) ? chrome.runtime.getURL('catalog/catalog.json') : './catalog/catalog.json';\n        const mapUrl = (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.getURL) ? chrome.runtime.getURL('catalog/token_map.json') : './catalog/token_map.json';\n        const [catRes, mapRes] = await Promise.all([\n          fetch(catUrl),\n          fetch(mapUrl)\n        ]);";

// 2. fetchAndRenderResolvedToken
const targetFetch = "const url = chrome.runtime.getURL('catalog/' + entry.file);";
const replaceFetch = "const url = (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.getURL) ? chrome.runtime.getURL('catalog/' + entry.file) : ('./catalog/' + entry.file);";

// 3. Category gating bypass for testbed
const targetGate = "    const activeCategories = getActiveCategories(stepText, overallText);\n\n    for (const rule of tokenRules) {\n      if (rule.category && !activeCategories.has(rule.category)) continue;";
const replaceGate = "    const isTestBed = (typeof window !== 'undefined' && (window.ALL_TOKENS || document.querySelector('[data-instruction], .token-target-area')));\n    const activeCategories = isTestBed ? null : getActiveCategories(stepText, overallText);\n\n    for (const rule of tokenRules) {\n      if (activeCategories && rule.category && !activeCategories.has(rule.category)) continue;";

// 4. Area matchers
const targetArea1 = "return !!el.closest('app-step-information content, [data-instruction], article, .lesson-content');";
const replaceArea1 = "return !!el.closest('app-step-information content, [data-instruction], article, .lesson-content, .token-target-area');";

const targetArea2 = "const areas = document.querySelectorAll('app-step-information content, [data-instruction], article, .lesson-content');";
const replaceArea2 = "const areas = document.querySelectorAll('app-step-information content, [data-instruction], article, .lesson-content, .token-target-area');";

// 5. Toggle button container
const targetCta = "const cta = document.querySelector('.header-cta');";
const replaceCta = "const cta = document.querySelector('.header-cta') || document.querySelector('#aifx-toggle-slot');";

// 6. Direct catalog lookup fallback in resolveTokenWithNLP
const targetEndOfNLP = "    return null;\n  }\n\n  async function fetchAndRenderResolvedToken";
const replaceEndOfNLP = "    // Fallback: direct matching against catalog keys or fields\n    if (catalogMap) {\n      if (catalogMap[cleanFlat]) {\n        return { rule: { id: 'catalog_' + cleanFlat, category: catalogMap[cleanFlat].category || 'common' }, template: cleanFlat, params: {} };\n      }\n      for (const [cKey, cVal] of Object.entries(catalogMap)) {\n        if (cVal.fields && cVal.fields.length) {\n          const fText = cVal.fields.map(f => f.text).filter(Boolean).join(' ').trim().toLowerCase();\n          if (fText === cleanFlat.toLowerCase()) {\n            return { rule: { id: 'catalog_' + cKey, category: cVal.category || 'common' }, template: cKey, params: {} };\n          }\n        }\n      }\n    }\n\n    return null;\n  }\n\n  async function fetchAndRenderResolvedToken";

console.log('Matches check:', {
  load: code.includes(targetLoad),
  fetch: code.includes(targetFetch),
  gate: code.includes(targetGate),
  area1: code.includes(targetArea1),
  area2: code.includes(targetArea2),
  cta: code.includes(targetCta),
  endNLP: code.includes(targetEndOfNLP)
});

code = code
  .replace(targetLoad, replaceLoad)
  .replace(targetFetch, replaceFetch)
  .replace(targetGate, replaceGate)
  .replace(targetArea1, replaceArea1)
  .replace(targetArea2, replaceArea2)
  .replace(targetCta, replaceCta)
  .replace(targetEndOfNLP, replaceEndOfNLP);

fs.writeFileSync('overlay.js', code);
console.log('overlay.js patched successfully!');

