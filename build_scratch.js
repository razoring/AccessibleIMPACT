const fs = require("fs");
const path = require("path");

const catalogDir = "C:/Users/conta/OneDrive/Documents/Personal/Projects/Coding/AccessibleIMPACT/catalog";
const tokenMap = JSON.parse(fs.readFileSync(path.join(catalogDir, "token_map.json"), "utf8"));
const catalog = JSON.parse(fs.readFileSync(path.join(catalogDir, "catalog.json"), "utf8"));
const overlay = fs.readFileSync("C:/Users/conta/OneDrive/Documents/Personal/Projects/Coding/AccessibleIMPACT/overlay.js", "utf8");

const neededFiles = [
  "function_definition.svg",
  "gameinterval.svg",
  "pxt_controls_for.svg",
  "pxt_controls_for_of.svg",
  "controls_repeat_ext.svg",
  "controls_if.svg",
  "controls_then.svg",
  "controls_else.svg",
  "device_while.svg",
  "variables_set.svg",
  "variables_change.svg",
  "variables_get.svg",
  "variables_set_mySprite_spritescreate.svg",
  "text.svg",
  "math_number.svg",
  "math_arithmetic.svg",
  "logic_compare.svg",
  "device_random.svg",
  "play_icon.svg"
];

const svgData = {};
for (const f of neededFiles) {
  const p = path.join(catalogDir, f);
  if (fs.existsSync(p)) {
    svgData[f] = fs.readFileSync(p, "utf8");
  }
}

// Extract styles
const startStyleIdx = overlay.indexOf("style.textContent = `");
const endStyleIdx = overlay.indexOf("`;", startStyleIdx);
const cssStyles = (startStyleIdx !== -1 && endStyleIdx !== -1)
  ? overlay.slice(startStyleIdx + "style.textContent = `".length, endStyleIdx)
  : "";

// Extract overlay functions
const startFnIdx = overlay.indexOf("function escapeXml");
const endFnIdx = overlay.indexOf("function requestTokenRender");
const overlayLogic = overlay.slice(startFnIdx, endFnIdx);

const harnessBody = fs.readFileSync("C:/Users/conta/OneDrive/Documents/Personal/Projects/Coding/AccessibleIMPACT/scratch_harness.js", "utf8");

const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>AccessibleIMPACT Block Rendering & Stress Test Harness</title>
<style>
  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    background: #f1f5f9;
    margin: 0;
    padding: 24px;
    color: #1e293b;
  }
  h1 { margin-top: 0; font-size: 24px; color: #0f172a; }
  h2 { font-size: 18px; margin-top: 24px; margin-bottom: 8px; color: #334155; border-bottom: 2px solid #cbd5e1; padding-bottom: 4px; }
  .controls {
    display: flex;
    gap: 12px;
    align-items: center;
    background: #ffffff;
    padding: 12px 16px;
    border-radius: 8px;
    box-shadow: 0 1px 3px rgba(0,0,0,0.1);
    margin-bottom: 20px;
    flex-wrap: wrap;
    position: sticky;
    top: 0;
    z-index: 1000;
  }
  .controls label { font-weight: 600; font-size: 14px; }
  .btn {
    background: #2563eb;
    color: white;
    border: none;
    padding: 6px 14px;
    border-radius: 6px;
    cursor: pointer;
    font-size: 13px;
    font-weight: 500;
  }
  .btn:hover { background: #1d4ed8; }
  .btn.active { background: #0f172a; }
  .slider-label { font-family: monospace; font-size: 13px; font-weight: bold; }
  
  .test-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(360px, 1fr));
    gap: 20px;
  }
  .test-card {
    background: #ffffff;
    border-radius: 8px;
    padding: 16px;
    box-shadow: 0 1px 3px rgba(0,0,0,0.1);
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .test-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    font-size: 13px;
  }
  .test-title { font-weight: 700; color: #0f172a; }
  .test-token {
    font-family: Consolas, monospace;
    font-size: 11px;
    background: #f1f5f9;
    padding: 4px 8px;
    border-radius: 4px;
    color: #475569;
    word-break: break-all;
  }
  .test-viewport {
    background: #eef2f7;
    border: 1px dashed #94a3b8;
    border-radius: 6px;
    padding: 12px;
    transition: width 0.2s ease;
    box-sizing: border-box;
    overflow: visible;
    position: relative;
  }
  .status-badge {
    font-size: 11px;
    padding: 2px 8px;
    border-radius: 12px;
    font-weight: 600;
  }
  .status-pass { background: #dcfce7; color: #166534; }
  .status-fail { background: #fee2e2; color: #991b1b; }
  .status-info { font-size: 11px; color: #64748b; font-family: monospace; }

  /* Live AIFX styles under test */
  ${cssStyles}
</style>
</head>
<body>
<h1>AccessibleIMPACT Block Rendering & Stress Test Harness</h1>
<div class="controls">
  <label>Container Width Testing:</label>
  <button class="btn" onclick="setWidth(200)">200px (Narrow)</button>
  <button class="btn active" onclick="setWidth(233)">233px (User Image Exact)</button>
  <button class="btn" onclick="setWidth(275)">275px (CodeNinjas Default)</button>
  <button class="btn" onclick="setWidth(350)">350px (Wide)</button>
  <button class="btn" onclick="setWidth('100%')">100% (Unconstrained)</button>
  <span style="margin-left: 10px;">Width: <span id="currentWidthLabel" class="slider-label">233px</span></span>
  <button class="btn" style="margin-left: auto;" onclick="rerunAudit()">Re-check Visual Metrics</button>
</div>

<div id="suites-container"></div>

<script>
window.ALL_TOKENS = true;
const rawSvgCatalog = ${JSON.stringify(svgData)};
let catalogMap = ${JSON.stringify(catalog)};
let tokenRules = ${JSON.stringify(tokenMap.rules)}.map(r => ({
  ...r,
  regex: new RegExp(r.pattern, 'i')
}));
const svgCache = new Map();
function requestTokenRender(token, raw, span) {}
function applyCacheToPage() {}
function scan() {}

${overlayLogic}

// Mock Chrome runtime for test harness
window.chrome = {
  runtime: {
    getURL: (p) => p
  },
  storage: {
    local: {
      get: () => {},
      set: () => {},
      clear: () => {}
    }
  }
};

// Override rawSvgFileCache in overlay logic
for (const [k, v] of Object.entries(rawSvgCatalog)) {
  rawSvgFileCache.set(k, v);
}

const testSuites = [
  {
    title: "Suite 1: User Reported Failing Cases (media_1795195040570 & media_1795195117994)",
    cases: [
      { id: "user_fn", label: "function createBubbles (Image 1)", token: "[function createBubbles]" },
      { id: "user_for", label: "for index from 0 to 4 do (Image 1)", token: "[for index from 0 to 4 do]" },
      { id: "user_interval", label: "on game update every 500 ms (Image 2)", token: "[on game update every 500 ms]" }
    ]
  },
  {
    title: "Suite 2: C-Blocks with Input Parameters & Long Names",
    cases: [
      { id: "c_fn_base", label: "function loadTilemap (Base)", token: "[function loadTilemap]" },
      { id: "c_fn_long", label: "function with Extremely Long Name", token: "[function calculateUltraLongSuperComplexPlayerMovementScore]" },
      { id: "c_interval_long", label: "on game update every 25000 ms", token: "[on game update every 25000 ms]" },
      { id: "c_interval_extreme", label: "on game update every 9999999 ms", token: "[on game update every 9999999 ms]" },
      { id: "c_for_longvar", label: "for with Long Variable Name", token: "[for ultraSuperLongIteratorVariableName from 0 to 4 do]" },
      { id: "c_for_range", label: "for with Large Numeric Range", token: "[for count from 1000 to 5000000 do]" },
      { id: "c_for_of_long", label: "for element of List with Long Names", token: "[for projectileItem of superLongObstacleEnemyList do]" },
      { id: "c_repeat_long", label: "repeat times with Large Number", token: "[repeat 1000000 times do]" },
      { id: "c_if_long", label: "if conditional with Long Condition", token: "[if playerIsAliveAndHasEnoughEnergy then]" },
      { id: "c_while_long", label: "while loop with Long Condition", token: "[while playerIsAliveAndHasEnoughEnergy do]" }
    ]
  },
  {
    title: "Suite 3: Inline Tokens ([then] / [else] / [play] / variables)",
    cases: [
      { id: "inline_then", label: "Inline [then] Block", token: "[then]" },
      { id: "inline_else", label: "Inline [else] Block", token: "[else]" },
      { id: "inline_play", label: "Inline Play Icon [▶]", token: "▶" },
      { id: "inline_sentence", label: "Sentence with [then] and [else] Spacing", rawHtml: "block inside the <span class='aifx-rendered aifx-inline' data-token='[then]'></span> opening and the other block inside the <span class='aifx-rendered aifx-inline' data-token='[else]'></span> opening." }
    ]
  },
  {
    title: "Suite 4: Statement & Variable Blocks with Extreme Parameters",
    cases: [
      { id: "stmt_var_set_long", label: "set variable with Long Identifier & Large Value", token: "[set playerSuperHighCumulativeScore to 999999999]" },
      { id: "stmt_var_change_long", label: "change variable with Long Identifier", token: "[change playerSuperHighCumulativeScore by 500000]" },
      { id: "stmt_sprite_long", label: "set sprite with Long Variable & Kind", token: "[set userPlayerAvatarObject to sprite of kind UltraSuperLongEnemyKind]" },
      { id: "stmt_text_long", label: "text block with Long String Parameter", token: "[\\"This is an extraordinarily long string parameter designed to stress-test horizontal text expansion without clipping!\\"]" }
    ]
  },
  {
    title: "Suite 5: Reporters & Nested Arithmetic / Logic Expressions",
    cases: [
      { id: "rep_arith_long", label: "math_arithmetic with Large Operands", token: "[12345678 + 87654321]" },
      { id: "rep_compare_long", label: "logic_compare with Long Identifiers", token: "[superLongScoreVar >= ultraHighTargetScore]" },
      { id: "rep_random_long", label: "math_random with Large Limits", token: "[pick random 100000 to 9999999]" }
    ]
  }
];

${harnessBody}

window.addEventListener("DOMContentLoaded", buildHarness);
</script>
</body>
</html>`;

fs.writeFileSync("C:/Users/conta/OneDrive/Documents/Personal/Projects/Coding/AccessibleIMPACT/scratch_test.html", html, "utf8");
console.log("Successfully generated scratch_test.html, size:", html.length);
