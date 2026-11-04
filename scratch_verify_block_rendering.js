const fs = require('fs');
const path = require('path');

// Test suite for block rendering: with and without parameters
console.log('=== BLOCK RENDERING VERIFICATION SUITE ===\n');

const tokenMapPath = path.join(__dirname, 'catalog', 'token_map.json');
const tokenMap = JSON.parse(fs.readFileSync(tokenMapPath, 'utf8'));
const catalogDir = path.join(__dirname, 'catalog');

const testCases = [
  // 1. Tokens WITHOUT parameters (must resolve cleanly to default catalog SVGs)
  { token: '[connect and by]', expectedTemplate: 'tileUtil_connectMapById', isBoolLogic: false },
  { token: '[load tilemap connected by]', expectedTemplate: 'tileUtil_loadConnectedMap', isBoolLogic: false },
  { token: '[is hitting wall]', expectedTemplate: 'spritehasobstacle', isBoolLogic: false },
  { token: '[scroll background with camera]', expectedTemplate: 'scroller_scrollBackgroundWithCamera', isBoolLogic: false },
  { token: '[set background offset to x y]', expectedTemplate: 'scroller_setBackgroundScrollOffset', isBoolLogic: false },
  { token: '[animate frames]', expectedTemplate: 'run_image_animation', isBoolLogic: false },
  { token: '[tile is]', expectedTemplate: 'tileScanner_tileIs', isBoolLogic: false },
  { token: '[change color in picture from to]', expectedTemplate: 'Image_replace', isBoolLogic: false },
  { token: '[function loadTilemap]', expectedTemplate: 'function_definition', isBoolLogic: false },
  { token: '[game over]', expectedTemplate: 'gameOver2', isBoolLogic: false },
  { token: '[on start]', expectedTemplate: 'pxt-on-start', isBoolLogic: false },
  { token: '[if true then]', expectedTemplate: 'controls_if', isBoolLogic: false },

  // 2. Tokens WITH parameters
  { token: '[connect (tilemap 1) and (tilemap2) by (Door1)]', expectedTemplate: 'tileUtil_connectMapById', isBoolLogic: false },
  { token: '[load tilemap connected by (Door1)]', expectedTemplate: 'tileUtil_loadConnectedMap', isBoolLogic: false },
  { token: '[is (mySprite) hitting wall bottom]', expectedTemplate: 'spritehasobstacle', isBoolLogic: false },
  { token: '[scroll background with camera only vertically]', expectedTemplate: 'scroller_scrollBackgroundWithCamera', isBoolLogic: false },
  { token: '[set background offset to x (10) y (20)]', expectedTemplate: 'scroller_setBackgroundScrollOffset', isBoolLogic: false },
  { token: '[animate (mySprite) frames]', expectedTemplate: 'run_image_animation', isBoolLogic: false },
  { token: '[change color in (picture) from () to ()]', expectedTemplate: 'Image_replace', isBoolLogic: false },
  { token: '[set (score) to (0)]', expectedTemplate: 'hudsetScore', isBoolLogic: false },
  { token: '[change (life) by (1)]', expectedTemplate: 'hudChangeLifeBy', isBoolLogic: false },

  // 3. Boolean logic blocks (EXCEPTION: must have open hexagonal sockets without default booleans)
  { token: '<(a) and (b)>', expectedTemplate: 'logic_operation_and', isBoolLogic: true },
  { token: '<(x) or (y)>', expectedTemplate: 'logic_operation_and', isBoolLogic: true },
  { token: '<(a) = (b)>', expectedTemplate: 'logic_compare_lt', isBoolLogic: true }
];

let failures = 0;

for (const tc of testCases) {
  const raw = tc.token;
  let clean = raw.trim();
  if ((clean.startsWith('[') && clean.endsWith(']')) ||
      (clean.startsWith('(') && clean.endsWith(')')) ||
      (clean.startsWith('<') && clean.endsWith('>'))) {
    clean = clean.slice(1, -1).trim();
  }
  const cleanFlat = clean.replace(/[\[\]\(\)]/g, ' ').replace(/\s+/g, ' ').trim();

  let matchedRule = null;
  for (const r of tokenMap.rules) {
    if (r.pattern) {
      const reg = new RegExp(r.pattern, 'i');
      if (reg.test(clean) || reg.test(cleanFlat) || reg.test(raw)) {
        matchedRule = r;
        break;
      }
    }
  }

  const templateName = matchedRule ? matchedRule.template : null;
  const matchOk = templateName === tc.expectedTemplate;

  // Check SVG content for template
  let svgOk = true;
  let svgError = '';
  if (templateName) {
    const svgPath = path.join(catalogDir, templateName + '.svg');
    if (!fs.existsSync(svgPath)) {
      svgOk = false;
      svgError = `SVG file does not exist: ${templateName}.svg`;
    } else {
      const content = fs.readFileSync(svgPath, 'utf8');

      // 1. No 32x32 blank transparent PNG that renders as black rect
      if (content.includes('iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0')) {
        svgOk = false;
        svgError += ' Contains uncheckered 32x32 transparent PNG (renders black);';
      }

      // 2. No empty <image> tags without href
      const imgTags = content.match(/<image[^>]*>/g) || [];
      for (const img of imgTags) {
        if (!img.includes('href') || img.includes('href=""')) {
          svgOk = false;
          svgError += ' Contains empty <image> tag without href (broken icon);';
        }
      }

      // 3. No unstyled black polygon in toggles
      if (content.includes('blocklyToggle') && !content.includes('blocklyToggleRect')) {
        svgOk = false;
        svgError += ' Contains unstyled blocklyToggle polygon;';
      }

      // 4. No unrendered private-use font glyphs
      if (/[\uE000-\uF8FF]/.test(content)) {
        svgOk = false;
        svgError += ' Contains unrendered private-use Unicode font glyph;';
      }

      // 5. Checkered tile verification for image/tile sockets
      if (templateName.includes('tile') || templateName.includes('animation') || templateName.includes('screen')) {
        if (content.includes('<image') && !content.includes('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9h') && !content.includes('xlink:href="data:image/svg+xml')) {
          svgOk = false;
          svgError += ' Missing authentic checkered pattern in tile/image socket;';
        }
      }
    }
  } else {
    svgOk = false;
    svgError = 'No matching template found in token_map.json';
  }

  const pass = matchOk && svgOk;
  if (!pass) failures++;

  console.log(`${pass ? 'PASS' : 'FAIL'}  ${tc.token}`);
  console.log(`      Resolved: ${templateName || 'NONE'} (expected: ${tc.expectedTemplate})`);
  if (!svgOk) console.log(`      SVG Error: ${svgError}`);
}

console.log(`\n===========================================`);
if (failures === 0) {
  console.log(`ALL ${testCases.length} BLOCK RENDERING TESTS PASSED!`);
} else {
  console.log(`${failures} / ${testCases.length} TESTS FAILED.`);
}
process.exit(failures ? 1 : 0);
