// slot-engine-route-test.mjs
// Extracts the REAL engine code from in_page_renderer.js (between the
// __AIFX_SLOT_ENGINE markers), evaluates it with stubbed Blockly helpers,
// and verifies the routing matrix: nested-parameter tokens route correctly
// and prose/compound statements NEVER hijack.
import fs from 'node:fs';

const src = fs.readFileSync('in_page_renderer.js', 'utf8');
const m = src.match(/\/\* __AIFX_SLOT_ENGINE_START__[\s\S]*?__AIFX_SLOT_ENGINE_END__ \*\//);
if (!m) { console.error('engine markers not found'); process.exit(1); }
const engineSrc = m[0];

// Recording stubs so we can assert what the mutators connect.
function makeWs() {
  const created = [];
  return {
    created,
    blocks: [],
    lastText: null,
    newBlock(type) {
      const b = { type, fields: {}, inputs: connected => connected, inputList: [] };
      return b;
    }
  };
}

// Stubbed sub-block factory: records the expression it resolved and pretends
// to detect literals / vars (mirrors createSubBlock's coverage).
function stubCreateSubBlock(expr, ws) {
  if (expr == null) return null;
  const s = String(expr).trim();
  if (!s) return null;
  const clean = s.replace(/^[\[\(\{]/, '').replace(/[\]\)\}]$/, '').trim();
  const rec = { kind: 'sub', expr: s };
  ws.blocks.push(rec);
  return { __rec: rec, outputConnection: {} };
}

function stubEnsureVariable(ws, name) {
  const existing = ws.created.find(v => v.name === name);
  if (existing) return existing;
  const v = { name, id: 'var:' + name, getId() { return v.id; } };
  ws.created.push(v);
  return v;
}

const connectLog = [];
function stubConnectInput(parent, inputName, child) {
  if (!parent || !child) return;
  (parent.inputs__ = parent.inputs__ || {});
  parent.inputs__[inputName] = child.__rec ? child.__rec.expr : '(child)';
  connectLog.push(parent.type + '.' + inputName);
}

// Evaluate the engine source with stubs, exposing what we need.
const factory = new Function(
  'createSubBlock', 'ensureVariable', 'connectInput',
  engineSrc + '\nreturn { resolveTemplateMatch, splitTopChildren, variadicUnused: null };'
);
const engine = factory(stubCreateSubBlock, stubEnsureVariable, stubConnectInput);

function run(raw) {
  connectLog.length = 0;
  const ws = makeWs();
  const res = engine.resolveTemplateMatch(raw, { ws }, 0);
  return { ws, res, connectLog };
}

let failures = 0;
function expect(name, raw, checks) {
  const { ws, res, connectLog } = run(raw);
  const type = res ? res.type : null;
  let detail = type;
  if (res && res.mutator) {
    const b = {
      type,
      fields: {}, inputs__: {},
      getField(name) { return { setValue: (v) => { b.fields[name] = v; } }; },
      elseCount_: 0,
      updateShape_() { b.fields['__elseShaped'] = b.elseCount_; }
    };
    res.mutator(b, ws, raw);
    detail = `${type} fields=${JSON.stringify(b.fields)} inputs=${JSON.stringify(withExprs(b))} created=${ws.created.map(v => v.name)} log=${connectLog.join('|')}`;
  }
  const ok = checks(type, res, ws, connectLog);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}\n      ${raw}\n      -> ${detail}`);
  if (!ok) failures++;
}
function withExprs(b) {
  const out = {};
  for (const k of Object.keys(b.inputs__ || {})) out[k] = b.inputs__[k];
  return out;
}

// --- variables_set / change -------------------------------------------------
expect('nested set var (no value)', '[set (list) to]',
  (t, r, ws) => t === 'variables_set' && ws.created.some(v => v.name === 'list'));
expect('nested set var+val', '[set (score) to (0)]',
  (t, r, ws) => t === 'variables_set' && ws.created.some(v => v.name === 'score'));
expect('set (variable) to', '[set (variable) to]',
  (t) => t === 'variables_set');
expect('set (mySprite) to sprite of kind MUST NOT hijack', '[set (mySprite) to sprite (img) of kind (Player)]',
  (t) => t === null);
expect('set sprite velocity to (no children) untouched', '[set sprite velocity to]',
  (t) => t === null);
expect('set background color to untouched', '[set background color to]',
  (t) => t === null);
expect('set sprite x to untouched', '[set sprite x to]',
  (t) => t === null);
expect('nested change by', '[change (life) by (1)]',
  (t, r, ws) => t === 'variables_change' && ws.created.some(v => v.name === 'life'));
expect('change life by (no children) untouched (legacy path)', '[change life by]',
  (t) => t === null);
expect('prose val rejected', '[set (list) to of tiles being careful]',
  (t) => t === null);
expect('unknown literal ident val rejected', '[set (list) to nametag]',
  (t) => t === null);
expect('known literal ident val allowed', '[set (count) to index]',
  (t) => t === 'variables_set');
expect('literal boolean val allowed', '[set (question) to true]',
  (t) => t === 'variables_set');

// --- logic templates (outer <...> / (...) only) -----------------------------
expect('nested and', '<(a) and (b)>',
  (t) => t === 'logic_operation');
expect('nested or paren', '(isDizzy) and (scared)',
  (t) => t === 'logic_operation');
expect('placeholder + angle child or', '<(isDizzy) and <true>>',
  (t) => t === 'logic_operation');
expect('unknown literal operand rejected', '(magicLevel and <true>)',
  (t) => t === null);
expect('statement with and NOT hijacked', '[on each (myTile) tile create sprite with image and kind (item)]',
  (t) => t === null);
expect('tile cover and NOT hijacked', '[cover all tiles with wall and set tilemap]',
  (t) => t === null);
expect('nested not', '<not (isDizzy)>',
  (t) => t === 'logic_negate');
expect('bare <and> untouched (canonical path)', '<and>',
  (t) => t === null);
expect('bare <true> untouched', '<true>',
  (t) => t === null);
expect('plain <0=0> untouched (no children)', '<0=0>',
  (t) => t === null);
expect('bracket [0=0] untouched (brackets excluded)', '[0=0]',
  (t) => t === null);
expect('prose operand rejected', '<(careful with) and (that)>',
  (t) => t === null);

// --- controls_if ------------------------------------------------------------
expect('if true then', '[if true then]',
  (t) => t === 'controls_if');
expect('if (0=0) then', '[if (0=0) then]',
  (t) => t === 'controls_if');
expect('if true then / else', '[if true then / else]',
  (t) => t === 'controls_if');
expect('else untouched', '[else]',
  (t) => t === null);
expect('is button pressed untouched', '[is (A) button pressed]',
  (t) => t === null);
expect('tile overlap untouched', '[on sprite overlaps sprite]',
  (t) => t === null);
expect('pick random untouched', '[pick random]',
  (t) => t === null);

console.log(failures ? `\n${failures} FAILURE(S)` : '\nALL ROUTING TESTS PASSED');
process.exit(failures ? 1 : 0);
