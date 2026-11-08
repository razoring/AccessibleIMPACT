const fs = require('fs');

const tokens = JSON.parse(fs.readFileSync('all_tokens.json', 'utf8'));

const angleCount = tokens.filter(t => t.startsWith('<') && t.endsWith('>')).length;
const squareCount = tokens.filter(t => t.startsWith('[') && t.endsWith(']')).length;
const parenCount = tokens.filter(t => t.startsWith('(') && t.endsWith(')')).length;

const htmlContent = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>AccessibleIMPACT Token Verification Suite</title>
  <style>
    :root {
      --bg: #0b0f19;
      --card-bg: #141c2e;
      --card-border: #222f49;
      --card-hover: #293859;
      --text-main: #f1f5f9;
      --text-muted: #94a3b8;
      --accent: #38bdf8;
      --green: #2ecc71;
      --red: #ef4444;
      --purple: #a855f7;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0; padding: 0;
      background: var(--bg); color: var(--text-main);
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      min-height: 100vh; display: flex; flex-direction: column;
    }
    .sticky-toolbar {
      position: sticky; top: 0; z-index: 9999;
      background: rgba(11, 15, 25, 0.94);
      backdrop-filter: blur(12px);
      -webkit-backdrop-filter: blur(12px);
      border-bottom: 1px solid var(--card-border);
      padding: 12px 24px;
      display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between;
      gap: 16px;
      box-shadow: 0 4px 24px rgba(0, 0, 0, 0.5);
    }
    .brand-section { display: flex; align-items: center; gap: 12px; }
    .brand-title {
      font-size: 18px; font-weight: 700;
      background: linear-gradient(135deg, #38bdf8, #818cf8);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
    }
    .toolbar-actions { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
    .mode-toggle-btn {
      display: inline-flex; align-items: center; gap: 10px;
      background: linear-gradient(135deg, #2563eb, #1d4ed8);
      color: #ffffff; border: 1px solid rgba(255, 255, 255, 0.15);
      border-radius: 9999px; padding: 8px 18px;
      font-size: 14px; font-weight: 600; cursor: pointer;
      box-shadow: 0 4px 14px rgba(37, 99, 235, 0.35);
      transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
      user-select: none;
    }
    .mode-toggle-btn:hover {
      transform: translateY(-1px);
      box-shadow: 0 6px 20px rgba(37, 99, 235, 0.5);
      filter: brightness(1.08);
    }
    .mode-toggle-btn.extension-disabled {
      background: #334155;
      color: #94a3b8;
      box-shadow: none;
      border-color: #475569;
    }
    .status-dot {
      width: 10px; height: 10px; border-radius: 50%;
      background: var(--green);
      box-shadow: 0 0 8px var(--green);
      transition: background 0.2s, box-shadow 0.2s;
    }
    .mode-toggle-btn.extension-disabled .status-dot,
    .floating-fab.fab-disabled .status-dot {
      background: var(--red);
      box-shadow: 0 0 8px var(--red);
    }
    .filter-group {
      display: flex; align-items: center; gap: 4px;
      background: #161f33; border: 1px solid var(--card-border);
      border-radius: 8px; padding: 4px;
    }
    .filter-btn {
      background: transparent; color: var(--text-muted);
      border: none; padding: 6px 12px;
      font-size: 13px; font-weight: 500;
      border-radius: 6px; cursor: pointer;
      transition: all 0.15s ease;
    }
    .filter-btn:hover { color: var(--text-main); }
    .filter-btn.active {
      background: var(--accent); color: #0b0f19;
      font-weight: 600;
    }
    .search-input {
      background: #161f33; border: 1px solid var(--card-border);
      border-radius: 8px; color: #fff;
      padding: 8px 14px; font-size: 13px;
      min-width: 220px; outline: none;
      transition: border-color 0.2s;
    }
    .search-input:focus { border-color: var(--accent); }
    .container {
      max-width: 1440px; margin: 0 auto; padding: 24px;
      flex: 1; width: 100%;
    }
    .summary-bar {
      display: flex; align-items: center; justify-content: space-between;
      margin-bottom: 20px; color: var(--text-muted); font-size: 14px;
    }
    .badge-pill {
      display: inline-block; padding: 3px 8px;
      border-radius: 6px; font-size: 12px; font-weight: 600;
      margin-right: 6px;
    }
    .badge-angle { background: rgba(168, 85, 247, 0.2); color: #c084fc; border: 1px solid rgba(168, 85, 247, 0.4); }
    .badge-square { background: rgba(56, 189, 248, 0.2); color: #38bdf8; border: 1px solid rgba(56, 189, 248, 0.4); }
    .badge-paren { background: rgba(34, 197, 94, 0.2); color: #4ade80; border: 1px solid rgba(34, 197, 94, 0.4); }
    .token-grid {
      display: grid; grid-template-columns: repeat(auto-fill, minmax(360px, 1fr));
      gap: 16px;
    }
    .token-card {
      background: var(--card-bg); border: 1px solid var(--card-border);
      border-radius: 10px; padding: 16px;
      display: flex; flex-direction: column; gap: 12px;
      transition: transform 0.15s ease, border-color 0.15s ease, box-shadow 0.15s ease;
      position: relative;
    }
    .token-card:hover {
      border-color: var(--card-hover);
      box-shadow: 0 4px 16px rgba(0, 0, 0, 0.35);
    }
    .card-meta {
      display: flex; justify-content: space-between; align-items: center;
      font-size: 12px; color: var(--text-muted);
      border-bottom: 1px solid rgba(255, 255, 255, 0.05);
      padding-bottom: 8px;
    }
    .token-index { font-family: monospace; color: #64748b; }
    .token-target-area {
      min-height: 48px; display: flex; align-items: center;
      background: #0d1322; padding: 12px 14px;
      border-radius: 6px; border: 1px solid #1c273e;
      overflow-x: auto; font-size: 15px; line-height: 1.6;
    }
    .raw-preview {
      font-family: Consolas, Monaco, monospace; font-size: 12px;
      color: #64748b; word-break: break-all;
    }
    .floating-fab {
      position: fixed; bottom: 24px; right: 24px; z-index: 10000;
      background: #2563eb; color: #fff;
      border: 2px solid rgba(255, 255, 255, 0.2); border-radius: 50px;
      padding: 12px 22px; font-size: 14px; font-weight: 700;
      box-shadow: 0 6px 20px rgba(0, 0, 0, 0.4); cursor: pointer;
      display: flex; align-items: center; gap: 10px;
      transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
    }
    .floating-fab:hover {
      transform: translateY(-2px);
      box-shadow: 0 8px 24px rgba(37, 99, 235, 0.6);
      filter: brightness(1.1);
    }
    .floating-fab.fab-disabled {
      background: #334155; color: #94a3b8; border-color: #475569;
    }
  </style>
</head>
<body>
  <header class="sticky-toolbar">
    <div class="brand-section">
      <div id="aifx-toggle-slot"></div>
      <div class="brand-title">AccessibleIMPACT Token Verifier</div>
    </div>
    <div class="toolbar-actions">
      <div class="filter-group">
        <button class="filter-btn active" data-filter="all">All (<span id="count-all">${tokens.length}</span>)</button>
        <button class="filter-btn" data-filter="angle">&lt;&gt; (${angleCount})</button>
        <button class="filter-btn" data-filter="square">[] (${squareCount})</button>
        <button class="filter-btn" data-filter="paren">() (${parenCount})</button>
      </div>
      <input type="search" id="search-input" class="search-input" placeholder="Search tokens (e.g. &lt;true&gt;, sprite, velocity)..." autocomplete="off">
      <button id="master-toggle" class="mode-toggle-btn" title="Toggle Rendered Mode vs Extension Disabled">
        <span class="status-dot"></span>
        <span id="toggle-label">Rendered Mode</span>
      </button>
    </div>
  </header>
  <main class="container">
    <div class="summary-bar">
      <div>Showing <strong id="visible-count">0</strong> of <strong id="total-count">${tokens.length}</strong> tokens</div>
      <div>
        <span class="badge-pill badge-angle">&lt;&gt; Angled (${angleCount})</span>
        <span class="badge-pill badge-square">[] Square (${squareCount})</span>
        <span class="badge-pill badge-paren">() Round (${parenCount})</span>
      </div>
    </div>
    <div id="token-grid" class="token-grid"></div>
  </main>
  <button id="floating-toggle-btn" class="floating-fab" title="Switch Rendered / Extension Disabled">
    <span class="status-dot"></span>
    <span id="fab-label">Rendered Mode</span>
  </button>
  <script>
    window.ALL_TOKENS = ${JSON.stringify(tokens)};
  </script>
  <script src="app.js"></script>
  <script src="overlay.js"></script>
</body>
</html>
`;

fs.writeFileSync('index.html', htmlContent);
console.log('index.html successfully created with', tokens.length, 'tokens');

