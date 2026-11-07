// Spot-check derived token rules: curated-first ordering, no over-broad theft.
import fs from 'node:fs';

const tm = JSON.parse(fs.readFileSync('catalog/token_map.json', 'utf8'));
const rules = tm.rules.map(r => ({ ...r, regex: new RegExp(r.pattern, 'i') }));

// all categories active (worst case: no context gate)
function resolve(text) {
  const flat = text.toLowerCase().replace(/[[\]()]/g, ' ').replace(/\s+/g, ' ').trim();
  for (const rule of rules) {
    const m = flat.match(rule.regex);
    if (m) {
      const params = {};
      if (rule.params) {
        for (const [name, idx] of Object.entries(rule.params)) params[name] = m[idx];
      }
      return { id: rule.id, source: rule.source || 'curated', params };
    }
  }
  return null;
}

const cases = [
  // curated must win (actual curated ids from token_map)
  ['set BossMan position to x 5 y 3', 'curated'],
  ['change mySprite scale by 5', 'curated'],
  ['set mySprite image to', 'curated'],
  ['set mySprite kind to Player', 'curated'],
  ['on start', 'curated'],
  ['if true then', 'curated'],
  // derived should fire
  ['console log hello world', 'derived_console_log'],
  ['8x8 tilemap', 'derived_tileUtil_createSmallMap'],
  ['use high score as best score', 'derived_game_setgameoverscoringtype'],
  ['on tilemap loaded', 'derived_tileUtil_onMapLoaded'],
  ['unload current tilemap', 'derived_tileUtil_unloadTilemap'],
  ['start screen confetti effect for 500 ms', 'derived_particlesStartScreenAnimation'],
  ['set tempo to 120 bpm', 'derived_device_set_tempo'],
  ['change tempo by 40 bpm', 'derived_device_change_tempo'],
  // generic statements must NOT be stolen by derived rules
  ['set score to 5', 'curated'],
  ['set life to 3', 'curated'],
  ['set background color to red', 'curated'],
];

let pass = 0, fail = 0;
for (const [text, expectSub] of cases) {
  const r = resolve(text);
  const ok = expectSub === 'curated'
    ? (r && r.source === 'curated')
    : (r && r.id.includes(expectSub));
  if (ok) { pass++; console.log('  ok  "' + text + '" -> ' + (r ? r.id : 'null')); }
  else { fail++; console.log('  FAIL "' + text + '" -> ' + (r ? r.id + ' (' + r.source + ')' : 'null') + '  expected: ' + expectSub); }
}

// audit: derived rules starting with ultra-generic verbs
console.log('\n-- derived rules anchored on set/change/get only (audit) --');
rules.filter(r => r.source === 'console-extract' && /^(?:\^set|\^change|\^get)/.test(r.pattern))
  .forEach(r => console.log('  ' + r.id + '  ' + r.pattern));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
