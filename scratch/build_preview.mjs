import fs from 'node:fs';
import path from 'node:path';

const catalogDir = path.resolve('catalog');
const files = fs.readdirSync(catalogDir).filter(f => f.endsWith('.svg')).sort();
let catJson = {};
if (fs.existsSync('catalog/catalog.json')) {
  try { catJson = JSON.parse(fs.readFileSync('catalog/catalog.json', 'utf8')); } catch (e) {}
}

const blocks = files.map(file => {
  const key = file.replace('.svg', '');
  const meta = catJson[key] || {};
  return {
    file,
    key,
    category: meta.category || 'Other',
    width: meta.width || 0,
    height: meta.height || 0
  };
});

const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>AccessibleIMPACT Block Catalog Preview (${blocks.length} Blocks)</title>
  <style>
    body {
      background: #0f172a;
      color: #f8fafc;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      padding: 24px;
      margin: 0;
    }
    .header {
      max-width: 1400px;
      margin: 0 auto 24px auto;
      display: flex;
      flex-wrap: wrap;
      justify-content: space-between;
      align-items: center;
      gap: 16px;
      border-bottom: 1px solid #334155;
      padding-bottom: 16px;
    }
    h1 { margin: 0; font-size: 24px; color: #38bdf8; }
    .controls { display: flex; gap: 12px; align-items: center; flex-wrap: wrap; }
    input[type="search"], select {
      padding: 8px 14px;
      border-radius: 6px;
      border: 1px solid #475569;
      background: #1e293b;
      color: #fff;
      font-size: 14px;
    }
    .count { color: #94a3b8; font-size: 14px; margin-top: 4px; }
    .container {
      max-width: 1400px;
      margin: 0 auto;
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(380px, 1fr));
      gap: 20px;
    }
    .card {
      background: #1e293b;
      padding: 16px;
      border-radius: 10px;
      box-shadow: 0 4px 12px rgba(0,0,0,0.25);
      border: 1px solid #334155;
      display: flex;
      flex-direction: column;
    }
    .card-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 12px;
      gap: 8px;
    }
    h3 {
      margin: 0;
      color: #e2e8f0;
      font-size: 13px;
      font-family: Consolas, Monaco, monospace;
      word-break: break-all;
    }
    .badge {
      background: #0284c7;
      color: #fff;
      font-size: 11px;
      padding: 2px 8px;
      border-radius: 12px;
      font-weight: 600;
      white-space: nowrap;
    }
    .svg-wrap {
      overflow-x: auto;
      padding: 16px;
      background: #090d16;
      border: 1px solid #334155;
      border-radius: 8px;
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 80px;
    }
    .svg-wrap img {
      max-width: 100%;
      height: auto;
      display: block;
    }
  </style>
</head>
<body>
  <div class="header">
    <div>
      <h1>AccessibleIMPACT Block Catalog Preview</h1>
      <div class="count">Showing <span id="shownCount">${blocks.length}</span> of ${blocks.length} blocks</div>
    </div>
    <div class="controls">
      <input type="search" id="searchBox" placeholder="Filter blocks by name...">
      <select id="catSelect">
        <option value="ALL">All Categories</option>
      </select>
    </div>
  </div>
  <div class="container" id="cardsContainer"></div>

  <script>
    const BLOCKS = ${JSON.stringify(blocks)};
    const container = document.getElementById('cardsContainer');
    const catSelect = document.getElementById('catSelect');
    const searchBox = document.getElementById('searchBox');
    const shownCount = document.getElementById('shownCount');

    const categories = Array.from(new Set(BLOCKS.map(b => b.category))).sort();
    categories.forEach(cat => {
      const opt = document.createElement('option');
      opt.value = cat;
      opt.textContent = cat;
      catSelect.appendChild(opt);
    });

    function render(list) {
      container.innerHTML = '';
      shownCount.textContent = list.length;
      list.forEach(b => {
        const card = document.createElement('div');
        card.className = 'card';
        card.innerHTML = \`
          <div class="card-header">
            <h3>\${b.file}</h3>
            <span class="badge">\${b.category}</span>
          </div>
          <div class="svg-wrap">
            <img src="catalog/\${encodeURIComponent(b.file)}" alt="\${b.file}" loading="lazy" />
          </div>
        \`;
        container.appendChild(card);
      });
    }

    function filterCards() {
      const q = searchBox.value.toLowerCase().trim();
      const cat = catSelect.value;
      const filtered = BLOCKS.filter(b => {
        const matchQ = !q || b.key.toLowerCase().includes(q) || b.file.toLowerCase().includes(q);
        const matchCat = cat === 'ALL' || b.category === cat;
        return matchQ && matchCat;
      });
      render(filtered);
    }

    searchBox.addEventListener('input', filterCards);
    catSelect.addEventListener('change', filterCards);

    render(BLOCKS);
  </script>
</body>
</html>`;

fs.writeFileSync('catalog_preview.html', html, 'utf8');
console.log('Successfully generated catalog_preview.html with', blocks.length, 'SVGs (lazy-loaded).');
