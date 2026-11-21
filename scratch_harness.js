// Injected verbatim into scratch_test.html by build_scratch.js (NOT a template literal: no escaping needed).
// Adds: every catalog block with editable/nested content (default + stress), generated reporters/pills,
// nested composition cases, and a geometric audit (overflow, squish, text overlap, text past block edge).

const STRESS_PARAMS = {
  varName: 'ultraLongVariableNameForStressTest', var2: 'anotherExtremelyLongSpriteName',
  kind: 'UltraSuperLongKindName', kind2: 'AnotherVeryLongKindName',
  text: 'An extraordinarily long string parameter for stress testing',
  NAME: 'calculateUltraLongSuperComplexScore', from: '1234567',
  button: 'ReallyLongButton', player: '4', direction: 'bottomLongDirection',
  mode: 'longModeName', effect: 'longEffectName', flag: 'longFlagName',
  op: '\u2265', prop: 'someVeryLongPropertyName',
  val: '99999999', left: '99999999', right: '88888888', min: '77777777', max: '99999999',
  to: '5000000', x: '12345678', y: '87654321', vx: '99999', vy: '-99999',
  count: '1000000', percent: '100', interval: '9999999'
};

const LONG = 'ultraSuperLongIdentifierNameForStress';

const SVG_NS = 'http://www.w3.org/2000/svg';

// Catalog entries that carry editable fields or nested blocks (computed at load from the SVG text).
async function loadSvgText(file) {
  let t = rawSvgFileCache.get(file);
  if (!t) {
    const res = await fetch('./catalog/' + file);
    t = await res.text();
    rawSvgFileCache.set(file, t);
  }
  return t;
}

function isDynamicSvg(txt) {
  const body = txt.replace(/<style>[\s\S]*?<\/style>/g, '');
  const editable = (body.match(/blocklyEditableField/g) || []).length;
  const blocks = (body.match(/class="[^"]*blocklyBlock/g) || []).length;
  return editable > 0 || blocks > 1;
}

function mkResolution(key, params) {
  const e = catalogMap[key];
  return { template: key, params: params, rule: { category: (e && e.category) || 'common' } };
}

function buildGeneratedCases() {
  const cases = [];
  const add = (id, label, run, sentence) => cases.push({ id: id, label: label, run: run, sentence: !!sentence });
  const g = (fn) => async () => fn();

  add('gen_var_short', 'variable reporter (x)', g(() => generateVariableReporterBubble('x')), true);
  add('gen_var_long', 'variable reporter (long name)', g(() => generateVariableReporterBubble(LONG)), true);
  add('gen_bool_short', 'boolean reporter <isDizzy>', g(() => generateBooleanReporterBubble('isDizzy')), true);
  add('gen_bool_long', 'boolean reporter <long name>', g(() => generateBooleanReporterBubble(LONG)), true);
  ['variables', 'logic', 'scene', 'game', 'controller', 'music', 'scroller', 'sprites', 'statusbars_property', 'statusbars_kind'].forEach((cat) => {
    add('gen_pill_' + cat, 'isolated pill [' + cat + '] short', g(() => generateIsolatedPropertyPill('value', cat)), true);
    add('gen_pill_long_' + cat, 'isolated pill [' + cat + '] long', g(() => generateIsolatedPropertyPill(LONG, cat)), true);
  });
  ['WIN', 'LOSE', 'ON', 'OFF'].forEach((t) => add('gen_toggle_' + t, 'toggle ' + t, g(() => renderToggleToken(t)), true));
  add('gen_mut_plus', 'mutator (+)', g(() => generateMutatorButtonSvg('+')), true);
  add('gen_mut_minus', 'mutator (-)', g(() => generateMutatorButtonSvg('-')), true);
  add('gen_empty_bool', 'empty boolean slot', g(() => generateEmptyBooleanSlotSvg()), true);
  add('gen_ui_btn', 'UI button Make a Function...', g(() => generateUiButtonSvg('Make a Function...')), true);
  add('gen_section', 'section label pill', g(() => generateSectionLabelPill('Variables')), true);

  const nest = (outerKey, outerParams, innerKey, innerParams) => async () => {
    const o = await fetchAndRenderResolvedToken(mkResolution(outerKey, outerParams), '');
    const i = await fetchAndRenderResolvedToken(mkResolution(innerKey, innerParams), '');
    return composeNestedReporter(o, i) || o;
  };
  add('nest_len_default', '(length of array (array of sprites of kind Player))', nest('lists_length', {}, 'allOfKind', {}), true);
  add('nest_len_long', '(length of array (array of sprites of kind <long>))', nest('lists_length', {}, 'allOfKind', { kind: 'UltraSuperLongKindName' }), true);
  add('nest_loc_default', '((tilemap location of (mySprite)) column)', nest('tiles.Location_blockCombine_get', { prop: 'column' }, 'tiles_location_of_sprite', {}), true);
  add('nest_loc_long', '((tilemap location of (<long>)) row)', nest('tiles.Location_blockCombine_get', { prop: 'row' }, 'tiles_location_of_sprite', { varName: LONG }), true);
  return cases;
}

// Only feed a block the params it can actually use (a function NAME must never reshape an `if` block, etc.)
function stressParamsFor(svgTxt) {
  const body = svgTxt.replace(/<style>[\s\S]*?<\/style>/g, '');
  const p = {};
  if (/blocklyVariableField/.test(body)) { p.varName = STRESS_PARAMS.varName; p.var2 = STRESS_PARAMS.var2; }
  if (/data-aifx-kind="text"|class="text blocklyBlock|field-text-quote/.test(body)) p.text = STRESS_PARAMS.text;
  if (/blocklyNumberField|data-aifx-kind="number"|timePicker|math_number|positionPicker|spriteSpeedPicker/.test(body)) {
    ['val', 'left', 'right', 'min', 'max', 'to', 'count', 'percent', 'interval', 'x', 'y', 'vx', 'vy'].forEach((k) => { p[k] = STRESS_PARAMS[k]; });
  }
  if (/>function\s+[A-Za-z0-9_]+</.test(body)) p.NAME = STRESS_PARAMS.NAME;
  if (/>from\s+\d+\s+to</.test(body)) p.from = STRESS_PARAMS.from;
  if (/blocklyDropdownField/.test(body.replace(/blocklyVariableField/g, ''))) {
    ['kind', 'kind2', 'button', 'player', 'direction', 'mode', 'effect', 'flag', 'op', 'prop'].forEach((k) => { p[k] = STRESS_PARAMS[k]; });
  }
  return p;
}

async function buildCatalogSuites() {
  const keys = Object.keys(catalogMap);
  const texts = {};
  let idx = 0;
  const queue = keys.slice();
  async function worker() {
    while (queue.length) {
      const k = queue.shift();
      try { texts[k] = await loadSvgText(catalogMap[k].file); } catch (e) { texts[k] = ''; }
    }
  }
  await Promise.all([worker(), worker(), worker(), worker(), worker(), worker()]);

  const byCat = {};
  keys.forEach((k) => {
    if (!texts[k] || !isDynamicSvg(texts[k])) return;
    const cat = catalogMap[k].category || 'Uncategorized';
    (byCat[cat] = byCat[cat] || []).push(k);
  });

  const suites = [];
  suites.push({ title: 'Generated reporters, pills, toggles & nested compositions', cases: buildGeneratedCases() });
  Object.keys(byCat).sort().forEach((cat) => {
    const cases = [];
    byCat[cat].forEach((k) => {
      const small = (catalogMap[k].height || 99) <= 72 && !catalogMap[k].isMultiLine;
      const n = idx++;
      cases.push({ id: 'cat' + n + 'a', label: k + ' (default)', run: async () => fetchAndRenderResolvedToken(mkResolution(k, {}), k), sentence: false });
      cases.push({ id: 'cat' + n + 'b', label: k + ' (STRESS' + (small ? ', in sentence' : '') + ')', run: async () => fetchAndRenderResolvedToken(mkResolution(k, stressParamsFor(texts[k])), k), sentence: small });
    });
    suites.push({ title: 'Catalog: ' + cat + ' \u2014 ' + byCat[cat].length + ' blocks \u00d7 (default + stress)', cases: cases });
  });
  return suites;
}

function ensureHarnessUi() {
  if (document.getElementById('aifx-harness-ui')) return;
  const st = document.createElement('style');
  st.id = 'aifx-harness-ui';
  st.textContent = '.status-warn{background:#f59e0b;color:#fff}.hide-pass .test-card[data-status="pass"]{display:none}.hide-pass .test-grid:not(:has(.test-card:not([data-status="pass"]))){display:none}.hide-pass h2:has(+ .test-grid:not(:has(.test-card:not([data-status="pass"])))){display:none}#summary{font:600 13px monospace;margin-left:12px}';
  document.head.appendChild(st);
  const c = document.querySelector('.controls');
  const b = document.createElement('button');
  b.className = 'btn';
  b.textContent = 'Failures/warnings only';
  b.onclick = () => { document.body.classList.toggle('hide-pass'); b.classList.toggle('active'); };
  const s = document.createElement('span');
  s.id = 'summary';
  c.appendChild(b);
  c.appendChild(s);
  c.id = 'aifx-harness-ui';
}

function makeCard(tc, grid) {
  const card = document.createElement('div');
  card.className = 'test-card';
  card.id = 'card_' + tc.id;
  const header = document.createElement('div');
  header.className = 'test-header';
  const title = document.createElement('span');
  title.className = 'test-title';
  title.textContent = tc.label;
  const badge = document.createElement('span');
  badge.className = 'status-badge status-pass';
  badge.id = 'badge_' + tc.id;
  badge.textContent = 'RENDERED';
  header.appendChild(title);
  header.appendChild(badge);
  card.appendChild(header);
  if (tc.token || tc.rawHtml) {
    const tokenSpan = document.createElement('div');
    tokenSpan.className = 'test-token';
    tokenSpan.textContent = tc.token || tc.rawHtml;
    card.appendChild(tokenSpan);
  }
  const vp = document.createElement('div');
  vp.className = 'test-viewport';
  vp.id = 'vp_' + tc.id;
  vp.style.width = (window.__vpWidth || '233px');
  if (tc.rawHtml) {
    vp.innerHTML = tc.rawHtml;
  } else if (tc.run) {
    if (tc.sentence) vp.appendChild(document.createTextNode('Drag the '));
    const span = document.createElement('span');
    span.className = 'aifx-rendered';
    span.setAttribute('data-token', tc.label);
    vp.appendChild(span);
    if (tc.sentence) vp.appendChild(document.createTextNode(' block into the slot to finish the step.'));
  } else {
    const span = document.createElement('span');
    span.className = 'aifx-rendered';
    span.setAttribute('data-token', tc.token);
    span.textContent = tc.token;
    vp.appendChild(span);
  }
  card.appendChild(vp);
  const info = document.createElement('div');
  info.className = 'status-info';
  info.id = 'info_' + tc.id;
  info.textContent = 'Metrics: initializing...';
  card.appendChild(info);
  grid.appendChild(card);
  return card;
}

async function buildHarness() {
  ensureHarnessUi();
  const container = document.getElementById('suites-container');
  container.innerHTML = '';
  const summary = document.getElementById('summary');
  summary.textContent = 'loading catalog\u2026';

  let catalogSuites = [];
  try { catalogSuites = await buildCatalogSuites(); } catch (e) { console.error(e); }
  const allSuites = testSuites.concat(catalogSuites);
  testSuites.length = 0;
  allSuites.forEach((s) => testSuites.push(s));

  const runners = [];
  testSuites.forEach((suite) => {
    const sEl = document.createElement('div');
    const h2 = document.createElement('h2');
    h2.textContent = suite.title;
    sEl.appendChild(h2);
    const grid = document.createElement('div');
    grid.className = 'test-grid';
    suite.cases.forEach((tc) => {
      const card = makeCard(tc, grid);
      const span = card.querySelector('span.aifx-rendered');
      if (tc.run) runners.push({ tc: tc, span: span });
    });
    sEl.appendChild(grid);
    container.appendChild(sEl);
  });

  // Legacy token-driven cases
  document.querySelectorAll('span.aifx-rendered').forEach((span) => {
    if (span.hasAttribute('data-token') && !runners.some((r) => r.span === span)) {
      const raw = span.getAttribute('data-token') || span.textContent.trim();
      resolveAndRenderSpan(span, raw.replace(/^\[|\]$/g, ''));
    }
  });

  // Direct cases, bounded concurrency
  const q = runners.slice();
  let done = 0;
  async function worker() {
    while (q.length) {
      const r = q.shift();
      try {
        const data = await r.tc.run();
        if (data && data.svg) applySvg(r.span, data);
        else { r.span.setAttribute('data-render-failed', '1'); r.span.textContent = 'NO SVG'; }
      } catch (e) {
        r.span.setAttribute('data-render-failed', '1');
        r.span.textContent = 'ERR ' + e.message;
      }
      done++;
      if (done % 50 === 0) summary.textContent = 'rendering ' + done + '/' + runners.length + '\u2026';
    }
  }
  await Promise.all([worker(), worker(), worker(), worker()]);
  setTimeout(rerunAudit, 300);
}

function setWidth(w) {
  const label = typeof w === 'number' ? (w + 'px') : w;
  window.__vpWidth = label;
  document.getElementById('currentWidthLabel').textContent = label;
  document.querySelectorAll('.controls .btn').forEach((b) => {
    if (/px|%/.test(b.textContent) && b.textContent.indexOf('only') < 0) {
      if (b.textContent.includes(String(w))) b.classList.add('active'); else b.classList.remove('active');
    }
  });
  document.querySelectorAll('.test-viewport').forEach((vp) => { vp.style.width = label; });
  setTimeout(rerunAudit, 150);
}

function rectsOverlap(a, b, minW, minH) {
  const w = Math.min(a.right, b.right) - Math.max(a.left, b.left);
  const h = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
  return w > minW && h > minH;
}

function auditSvg(svg, vp) {
  const issues = [];
  let level = 0; // 1 warn, 2 fail
  const bump = (l, msg) => { issues.push(msg); if (l > level) level = l; };
  const sRect = svg.getBoundingClientRect();
  const vb = (svg.getAttribute('viewBox') || '').split(/\s+/).map(parseFloat);
  const span = svg.closest('.aifx-rendered');
  const scroller = span && getComputedStyle(span).overflowX === 'auto';
  const box = (scroller ? span : vp).getBoundingClientRect();

  if (!scroller && sRect.right - (box.right + 2) > 6) bump(2, 'OVERFLOW ' + Math.round(sRect.right - box.right) + 'px');
  if (vb[2] && sRect.width / vb[2] < 0.45) bump(1, 'SQUISH x' + (sRect.width / vb[2]).toFixed(2));
  if (scroller && span.scrollWidth > span.clientWidth + 2) issues.push('(scrolls horizontally)');

  const inView = (r) => r.width > 0 && r.height > 0 && r.right > sRect.left - 2 && r.left < sRect.right + 2 && r.bottom > sRect.top - 2 && r.top < sRect.bottom + 2;
  const texts = Array.from(svg.querySelectorAll('text')).filter((t) => t.textContent.trim() && !t.closest('defs')).map((t) => ({ el: t, r: t.getBoundingClientRect() })).filter((o) => inView(o.r));

  for (let i = 0; i < texts.length; i++) {
    for (let j = i + 1; j < texts.length; j++) {
      if (rectsOverlap(texts[i].r, texts[j].r, 2, 4)) {
        bump(2, 'TEXT_OVERLAP "' + texts[i].el.textContent.trim().slice(0, 18) + '" x "' + texts[j].el.textContent.trim().slice(0, 18) + '"');
      }
    }
  }
  texts.forEach((o) => {
    const field = o.el.closest('g.blocklyField');
    const fr = field && field.querySelector(':scope > rect.blocklyFieldRect');
    if (fr) {
      const r = fr.getBoundingClientRect();
      if (r.width > 0 && o.r.right > r.right + 1) bump(2, 'TEXT_PAST_FIELD "' + o.el.textContent.trim().slice(0, 18) + '" by ' + Math.round(o.r.right - r.right) + 'px');
      const img = field.querySelector(':scope > image');
      if (img) {
        const ir = img.getBoundingClientRect();
        if (rectsOverlap(o.r, ir, 1, 2)) bump(2, 'ARROW_OVERLAP "' + o.el.textContent.trim().slice(0, 18) + '"');
      }
    }
    let blk = o.el.parentElement;
    while (blk && !(blk.tagName.toLowerCase() === 'g' && blk.classList.contains('blocklyBlock'))) blk = blk.parentElement;
    const bp = blk && Array.from(blk.children).find((c) => c.tagName.toLowerCase() === 'path' && c.classList.contains('blocklyPath'));
    if (bp) {
      const r = bp.getBoundingClientRect();
      if (o.r.right > r.right + 1) bump(2, 'TEXT_PAST_BLOCK "' + o.el.textContent.trim().slice(0, 18) + '" by ' + Math.round(o.r.right - r.right) + 'px');
    }
  });

  // Child blocks sticking out of their parent block outline
  svg.querySelectorAll('g.blocklyBlock').forEach((child) => {
    const parent = child.parentElement && child.parentElement.closest('g.blocklyBlock');
    if (!parent || child.closest('defs')) return;
    const cp = Array.from(child.children).find((c) => c.tagName.toLowerCase() === 'path' && c.classList.contains('blocklyPath'));
    const pp = Array.from(parent.children).find((c) => c.tagName.toLowerCase() === 'path' && c.classList.contains('blocklyPath'));
    if (!cp || !pp) return;
    const a = cp.getBoundingClientRect(), b = pp.getBoundingClientRect();
    if (a.width === 0 || b.width === 0 || !inView(a)) return;
    if (a.right > b.right + 1.5) bump(2, 'CHILD_PAST_PARENT ' + Math.round(a.right - b.right) + 'px');
  });

  return { level: level, issues: issues, label: Math.round(sRect.width) + 'x' + Math.round(sRect.height) + ' VB ' + (vb[2] || 0) + 'x' + (vb[3] || 0) };
}

function rerunAudit() {
  const counts = { pass: 0, warn: 0, fail: 0 };
  testSuites.forEach((suite) => {
    suite.cases.forEach((tc) => {
      const card = document.getElementById('card_' + tc.id);
      const vp = document.getElementById('vp_' + tc.id);
      const badge = document.getElementById('badge_' + tc.id);
      const info = document.getElementById('info_' + tc.id);
      if (!card || !vp || !badge || !info) return;
      const svgs = Array.from(vp.querySelectorAll('svg'));
      let status = 'pass';
      if (!svgs.length) {
        status = 'fail';
        badge.className = 'status-badge status-fail';
        badge.textContent = 'NO SVG';
        info.textContent = 'Failed to render SVG';
      } else {
        let level = 0;
        const lines = [];
        svgs.forEach((svg) => {
          const a = auditSvg(svg, vp);
          if (a.level > level) level = a.level;
          lines.push(a.label + (a.issues.length ? ' | ' + a.issues.slice(0, 6).join(' | ') : ''));
        });
        status = level === 2 ? 'fail' : (level === 1 ? 'warn' : 'pass');
        badge.className = 'status-badge status-' + status;
        badge.textContent = status === 'pass' ? 'PASS' : (status === 'warn' ? 'WARN' : 'FAIL');
        info.textContent = lines.join(' || ');
      }
      card.setAttribute('data-status', status);
      counts[status]++;
    });
  });
  const s = document.getElementById('summary');
  if (s) s.textContent = 'PASS ' + counts.pass + ' | WARN ' + counts.warn + ' | FAIL ' + counts.fail;
}

window.__aifxAuditSummary = () => Array.from(document.querySelectorAll('.test-card')).filter((c) => c.getAttribute('data-status') !== 'pass').map((c) => c.id + ' ' + c.getAttribute('data-status') + ' ' + (c.querySelector('.test-title') || {}).textContent + ' :: ' + (c.querySelector('.status-info') || {}).textContent);
