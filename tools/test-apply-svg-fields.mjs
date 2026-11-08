// Test applySvgFields (extracted from overlay.js) against real catalog SVGs.
// Validates: text swap, pill resize (grow + shrink), arrow shift, sibling
// shift, path h-run patch, viewBox widen, opaque groups untouched.
import fs from 'node:fs';
import { parseXml, XMLSerializer } from './dom-shim.mjs';

// ---- extract applySvgFields from overlay.js ----
const src = fs.readFileSync('overlay.js', 'utf8');
const start = src.indexOf('function applySvgFields');
const end = src.indexOf('function mutateSvgWithParams');
if (start < 0 || end < 0 || end < start) { console.error('applySvgFields not found'); process.exit(1); }
const fnCode = src.slice(start, end);

const NodeShim = { DOCUMENT_POSITION_CONTAINED_BY: 16, DOCUMENT_POSITION_FOLLOWING: 4, DOCUMENT_POSITION_CONTAINS: 8 };
const DOMParser = class { parseFromString(s) { return parseXml(s); } };

const applySvgFields = new Function('DOMParser', 'XMLSerializer', 'Node', `
  ${fnCode}
  return applySvgFields;
`)(DOMParser, XMLSerializer, NodeShim);

let pass = 0, fail = 0;
const check = (name, cond, detail) => {
  if (cond) { pass++; console.log('  ok  ' + name); }
  else { fail++; console.log('  FAIL ' + name + (detail ? '  — ' + detail : '')); }
};

// ---------- Test 1: variables_set.svg shrink (mySprite -> BossMan) ----------
{
  const svg = fs.readFileSync('catalog/variables_set.svg', 'utf8');
  const out = applySvgFields(svg, { varName: 'BossMan' });
  check('shrink: returns svg', !!out && out !== svg);
  const d = parseXml(out);
  const root = d.querySelector('g[data-aifx-type]');
  const vg = root.querySelectorAll('g[data-aifx-field]').find(g => g.getAttribute('data-aifx-field') === 'VAR');
  const txt = vg.querySelectorAll('text')[0];
  check('shrink: text replaced', txt.textContent === 'BossMan', txt.textContent);
  const rect = vg.querySelector('rect');
  const w = parseFloat(rect.getAttribute('width'));
  // mySprite=8 chars, BossMan=7 chars, charw 8.82 => delta ~ -8.82
  check('shrink: pill width ~97.5', Math.abs(w - 97.5) < 1, 'w=' + w);
  // arrow is positioned via transform="translate(x,y)"
  const img = vg.querySelector('image');
  const am = (img.getAttribute('transform') || '').match(/translate\((-?[\d.]+)/);
  const ax = am ? parseFloat(am[1]) : null;
  // original arrow position (from file) should have moved ~ -8.8
  const orig = parseXml(svg);
  const ovg = orig.querySelector('g[data-aifx-type]').querySelectorAll('g[data-aifx-field]').find(g => g.getAttribute('data-aifx-field') === 'VAR');
  const oimg = ovg.querySelector('image');
  const oam = (oimg.getAttribute('transform') || '').match(/translate\((-?[\d.]+)/);
  const oax = oam ? parseFloat(oam[1]) : null;
  check('shrink: arrow shifted', ax !== null && oax !== null && Math.abs((ax - oax) + 8.82) < 1.5, `ax ${oax} -> ${ax}`);
  // "to" label (was at 162.375) should shift left
  const labels = root.querySelectorAll('g[data-aifx-field]').filter(g => g.getAttribute('data-aifx-field') === '');
  const toLabel = labels.map(g => parseFloat(g.getAttribute('transform').match(/translate\(([\d.]+)/)[1]));
  check('shrink: label moved to ~153.5', toLabel.some(x => Math.abs(x - 153.55) < 2), JSON.stringify(toLabel));
  // path h run 469.109375 -> ~460.29
  const path = root.querySelectorAll('path.blocklyPath').find(p => p.parentNode === root);
  const runs = [...path.getAttribute('d').matchAll(/h\s(-?[\d.]+)/g)].map(m => parseFloat(m[1]));
  check('shrink: long h run patched', runs.some(v => Math.abs(v - 460.29) < 1.5), runs.join(','));
  check('shrink: bottom h run patched', runs.some(v => Math.abs(v + 460.734) < 1.5), runs.join(','));
  check('shrink: notch runs untouched', runs.includes(8) || runs.includes(-8) || runs.includes(12) || runs.includes(-12), runs.join(','));
  // viewBox widened
  const vb = d.documentElement.getAttribute('viewBox').split(/\s+/).map(parseFloat);
  check('shrink: viewBox shrunk', Math.abs(vb[2] - 517.29) < 1.5, 'w=' + vb[2]);
  // opaque groups untouched
  const opq = root.querySelectorAll('g[data-aifx-opaque="1"]');
  check('shrink: opaque groups still present', opq.length >= 1);
}

// ---------- Test 2: grow case (mySprite -> AVeryLongVariableName) ----------
{
  const svg = fs.readFileSync('catalog/variables_set.svg', 'utf8');
  const out = applySvgFields(svg, { varName: 'AVeryLongVariableName' });
  const d = parseXml(out);
  const root = d.querySelector('g[data-aifx-type]');
  const vg = root.querySelectorAll('g[data-aifx-field]').find(g => g.getAttribute('data-aifx-field') === 'VAR');
  const rect = vg.querySelector('rect');
  const w = parseFloat(rect.getAttribute('width'));
  // 21 chars * 8.82 = 185.22; curW 106.375 + (21-8)*8.82 = 221.0 -> 221.5
  check('grow: pill width ~221.5', Math.abs(w - 221.5) < 2, 'w=' + w);
  const labels = root.querySelectorAll('g[data-aifx-field]').filter(g => g.getAttribute('data-aifx-field') === '');
  const toX = labels.map(g => parseFloat(g.getAttribute('transform').match(/translate\(([\d.]+)/)[1]));
  check('grow: label moved right', toX.some(x => x > 240), JSON.stringify(toX));
  const path = root.querySelectorAll('path.blocklyPath').find(p => p.parentNode === root);
  const runs = [...path.getAttribute('d').matchAll(/h\s(-?[\d.]+)/g)].map(m => parseFloat(m[1]));
  // top + bottom long runs both widen: 469.109 + 115.125 = 584.234
  check('grow: top h run patched', runs.some(v => Math.abs(v - 584.234) < 1.5), runs.join(','));
  check('grow: bottom h run patched', runs.some(v => Math.abs(v + 584.234) < 1.5), runs.join(','));
  const vb = d.documentElement.getAttribute('viewBox').split(/\s+/).map(parseFloat);
  check('grow: viewBox widened', vb[2] > 610, 'w=' + vb[2]);
  const wattr = parseFloat(d.documentElement.getAttribute('width'));
  check('grow: width attr widened', wattr > 610, 'w=' + wattr);
}

// ---------- Test 3: no relevant params -> null (legacy fallback) ----------
{
  const svg = fs.readFileSync('catalog/variables_set.svg', 'utf8');
  const out = applySvgFields(svg, { nonExistent: 'x' });
  check('no-op: returns null', out === null);
  const out2 = applySvgFields('no annotations here', { varName: 'x' });
  check('no-op: unannotated svg returns null', out2 === null);
}

// ---------- Test 4: number field (find a catalog block with a number field) ----------
{
  const cat = JSON.parse(fs.readFileSync('catalog/catalog.json', 'utf8'));
  const numEntry = Object.entries(cat).find(([, e]) =>
    e.fields && e.fields.some(f => f.kind === 'number') &&
    e.fields.some(f => f.name === '' && f.text));
  if (numEntry) {
    const [key, entry] = numEntry;
    const svg = fs.readFileSync('catalog/' + entry.file, 'utf8');
    const out = applySvgFields(svg, { val: '42' });
    if (out) {
      const d = parseXml(out);
      const nf = d.querySelector('g[data-aifx-type]').querySelectorAll('g[data-aifx-field]')
        .find(g => g.getAttribute('data-aifx-kind') === 'number');
      const txt = nf.querySelectorAll('text')[0];
      check('number: text=42', txt.textContent === '42', txt.textContent);
      console.log('       (tested on ' + key + ')');
    } else {
      check('number: mutation applied', false, 'applySvgFields returned null for ' + key);
    }
  } else {
    console.log('  --   no number-field entry found; skipping test 4');
  }
}

// ---------- Test 5: opaque dropdown untouched when param targets it ----------
{
  const svg = fs.readFileSync('catalog/variables_set.svg', 'utf8');
  const out = applySvgFields(svg, { varName: 'BossMan' });
  const orig = parseXml(svg);
  const d = parseXml(out);
  const opqO = orig.querySelector('g[data-aifx-type]').querySelectorAll('g[data-aifx-opaque="1"]');
  const opqN = d.querySelector('g[data-aifx-type]').querySelectorAll('g[data-aifx-opaque="1"]');
  let same = opqO.length === opqN.length;
  for (let i = 0; same && i < opqO.length; i++) {
    // labels/opaque pickers may SHIFT as siblings (transform changes are fine);
    // their inner text and rect geometry must not change
    same = opqO[i].textContent === opqN[i].textContent;
  }
  check('opaque: text content unchanged', same);
}

// ---------- Test 6: variables_get.svg pill stretch (item -> otherSprite) ----------
{
  const svg = fs.readFileSync('catalog/variables_get.svg', 'utf8');
  const out = applySvgFields(svg, { varName: 'otherSprite' });
  check('variables_get: returns svg', !!out && out !== svg);
  const d = parseXml(out);
  const root = d.querySelector('g[data-aifx-type]');
  const txt = root.querySelectorAll('text')[0];
  check('variables_get: text is otherSprite', txt.textContent === 'otherSprite', txt.textContent);
  const pathD = root.querySelector('path.blocklyPath').getAttribute('d');
  check('variables_get: pill path widened to ~114.5', pathD.includes('h 114.5'), pathD);
  const vb = d.documentElement.getAttribute('viewBox');
  check('variables_get: viewBox widened', vb.includes('159.3125'), vb);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
