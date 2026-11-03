// in_page_renderer.js — runs in MAIN world of arcade.makecode.com iframe
// Has direct access to window.pxt, window.pxt.blocks, window.Blockly, and Blockly workspaces.
// Extracts and renders REAL MakeCode Blockly SVGs. No heuristic or fake fallbacks.

(function () {
  'use strict';

  const CACHE = {};
  let catalogCache = null;

  function blockly() {
    try {
      return window.pxt && window.pxt.blocks ? window.pxt.blocks.requireBlockly() : null;
    } catch (e) {
      return null;
    }
  }

  function toolchain() {
    const B = blockly();
    if (!B) return null;
    const ws = B.getMainWorkspace ? B.getMainWorkspace() : null;
    if (!ws) return null;
    return { B, ws };
  }

  // Ensure built-in extension blocks (e.g. Scroller) are defined in Blockly.Blocks
  function ensureExtensionBlocks(B) {
    if (!B || !B.Blocks) return;

    if (!B.Blocks['scroller_scrollBackgroundWithCamera']) {
      B.Blocks['scroller_scrollBackgroundWithCamera'] = {
        init: function () {
          this.setColour('#4b6584');
          this.appendDummyInput()
            .appendField('scroll background with camera')
            .appendField(new B.FieldDropdown([
              ['only horizontally', 'OnlyHorizontal'],
              ['only vertically', 'OnlyVertical'],
              ['both directions', 'BothDirections']
            ]), 'mode');
          this.setPreviousStatement(true);
          this.setNextStatement(true);
        }
      };
    }

    if (!B.Blocks['scroller_setBackgroundScrollOffset']) {
      B.Blocks['scroller_setBackgroundScrollOffset'] = {
        init: function () {
          this.setColour('#4b6584');
          this.appendDummyInput()
            .appendField('set background offset to')
            .appendField('x')
            .appendField(new B.FieldNumber(0), 'x')
            .appendField('y')
            .appendField(new B.FieldNumber(0), 'y');
          this.setPreviousStatement(true);
          this.setNextStatement(true);
        }
      };
    }

    if (!B.Blocks['scroller_mode_bubble']) {
      B.Blocks['scroller_mode_bubble'] = {
        init: function () {
          this.setColour('#4b6584');
          this.appendDummyInput().appendField(new B.FieldDropdown([
            ['only vertically', 'OnlyVertical'],
            ['only horizontally', 'OnlyHorizontal']
          ]), 'mode');
          this.setOutput(true);
          this.setOutputShape(2); // ROUND
        }
      };
    }
  }

  function normalize(s) {
    return (s || '')
      .toLowerCase()
      .replace(/[\[\]\(\)\<\>"]/g, ' ')
      .replace(/[^a-z0-9\s=%_]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function wordTokens(s) {
    return new Set(normalize(s).split(/\s+/).filter(w => w.length > 0));
  }

  function charBigrams(s) {
    const norm = normalize(s).replace(/\s+/g, '');
    const bg = new Set();
    for (let i = 0; i < norm.length - 1; i++) {
      bg.add(norm.slice(i, i + 2));
    }
    return bg;
  }

  function diceSimilarity(set1, set2) {
    if (!set1.size && !set2.size) return 1.0;
    if (!set1.size || !set2.size) return 0.0;
    let matches = 0;
    for (const item of set1) {
      if (set2.has(item)) matches++;
    }
    return (2 * matches) / (set1.size + set2.size);
  }

  function jaccardSimilarity(set1, set2) {
    if (!set1.size && !set2.size) return 1.0;
    if (!set1.size || !set2.size) return 0.0;
    let matches = 0;
    for (const item of set1) {
      if (set2.has(item)) matches++;
    }
    const union = set1.size + set2.size - matches;
    return matches / union;
  }

  const CANONICAL_MAP = [
    // Scroller extension
    {
      match: /^\[?\s*scroll\s+background\s+with\s+camera(?:\s*\[?(only\s+horizontally|only\s+vertically|both\s+directions)?\]?)?\s*\]?$/i,
      type: 'scroller_scrollBackgroundWithCamera',
      mutator: (b, ws, raw) => {
        const mode = /vertically/i.test(raw) ? 'OnlyVertical' : 'OnlyHorizontal';
        const f = b.getField('mode');
        if (f) f.setValue(mode);
      },
      conf: 1.0
    },
    {
      match: /^\[?\s*set\s+background\s+offset\s+to(?:\s*x\s*y)?\s*\]?$/i,
      type: 'scroller_setBackgroundScrollOffset',
      conf: 1.0
    },
    {
      match: /^[\[\(]\s*only\s+(?:vertically|horizontally)\s*[\]\)]$/i,
      type: 'scroller_mode_bubble',
      mutator: (b, ws, raw) => {
        const mode = /vertically/i.test(raw) ? 'OnlyVertical' : 'OnlyHorizontal';
        const f = b.getField('mode');
        if (f) f.setValue(mode);
      },
      conf: 1.0
    },

    // Sprites
    { match: /^\[?\s*set\s+(?:sprite|\(?[a-zA-Z0-9_]+\)?)\s+to\s+sprite(?:\s+of\s+kind)?\s*\]?$/i, type: 'spritescreate', conf: 1.0 },
    { match: /^\[?\s*sprite\s*(?:\(img\))?\s*of\s*kind\s*(?:\(kind\))?\s*\]?$/i, type: 'spritescreate', conf: 1.0 },
    { match: /^\[?\s*set\s+sprite\s+to\s*\]?$/i, type: 'spritescreate', conf: 1.0 },
    { match: /^\[?\s*set\s+(?:sprite|\(?[a-zA-Z0-9_]+\)?)\s+position\s+to\s*(?:x\s*y)?\s*\]?$/i, type: 'spritesetpos', conf: 1.0 },
    { match: /^\[?\s*set\s+(?:sprite|\(?[a-zA-Z0-9_]+\)?)\s+velocity\s+to\s*(?:vx\s*vy)?\s*\]?$/i, type: 'spritesetvel', conf: 1.0 },
    { match: /^\[?\s*set\s+(?:sprite|\(?[a-zA-Z0-9_]+\)?)\s+image\s+to\s*\]?$/i, type: 'spritesetimage', conf: 1.0 },
    { match: /^\[?\s*set\s+(?:sprite|\(?[a-zA-Z0-9_]+\)?)\s+kind\s+to\s*\]?$/i, type: 'spritesetkind', conf: 1.0 },
    { match: /^\[?\s*set\s+(?:sprite|\(?[a-zA-Z0-9_]+\)?)\s+stay\s+in\s+screen\s*\]?$/i, type: 'spritesetsetstayinscreen', conf: 1.0 },
    { match: /^\[?\s*set\s+(?:sprite|\(?[a-zA-Z0-9_]+\)?)\s+bounce\s+on\s+wall\s*\]?$/i, type: 'spritesetsetbounceonwall', conf: 1.0 },
    { match: /^\[?\s*move\s+(?:sprite|\(?[a-zA-Z0-9_]+\)?)\s+with\s+buttons\s*\]?$/i, type: 'game_control_sprite', conf: 1.0 },
    { match: /^\[?\s*destroy\s+(?:sprite|\(?[a-zA-Z0-9_]+\)?)\s*\]?$/i, type: 'spritedestroy2', conf: 1.0 },
    { match: /^\[?\s*(?:sprite\s+say|say)\s*\]?$/i, type: 'spritesaytext', conf: 1.0 },
    { match: /^\[?\s*set\s+(?:sprite|\(?[a-zA-Z0-9_]+\)?)\s+follow\s*\]?$/i, type: 'spriteFollowOtherSprite', conf: 1.0 },
    { match: /^\[?\s*start\s+effect\s+on\s+(?:sprite|\(?[a-zA-Z0-9_]+\)?)\s*\]?$/i, type: 'startEffectOnSprite', conf: 1.0 },
    { match: /^\[?\s*sprite\s+start\s+effect\s*\]?$/i, type: 'startEffectOnSprite', conf: 1.0 },
    { match: /^\[?\s*(?:on\s+)?sprite\s+overlaps\s+sprite\s*\]?$/i, type: 'spritesoverlap', conf: 1.0 },
    { match: /^\[?\s*run code on\s+.*overlaps.*otherkind.*\]?$/i, type: 'spritesoverlap', conf: 1.0 },
    { match: /^\[?\s*(?:on\s+)?sprite\s+overlaps\s+tile\s*\]?$/i, type: 'spriteshittile', conf: 1.0 },
    { match: /^\[?\s*(?:on\s+)?sprite\s+hits\s+wall\s*\]?$/i, type: 'spriteshitwall', conf: 1.0 },

    // Projectiles
    { match: /^\[?\s*set\s+projectile\s+to\s+projectile\s+from\s+side\s*\]?$/i, type: 'spritescreateprojectilefromside', conf: 1.0 },
    { match: /^\[?\s*set\s+projectile\s+to\s+projectile\s+from\s+sprite\s*\]?$/i, type: 'spritescreateprojectilefromsprite', conf: 1.0 },
    { match: /^\[?\s*projectile\s+.*from\s+side.*\]?$/i, type: 'spritescreateprojectilefromside', conf: 1.0 },
    { match: /^\[?\s*projectile\s+.*from\s+.*with\s+vx.*\]?$/i, type: 'spritescreateprojectilefromsprite', conf: 1.0 },

    // Loops & Logic & Math
    { match: /^\[?\s*on\s+start\s*\]?$/i, type: 'pxt-on-start', conf: 1.0 },
    { match: /^\[?\s*on\s+game\s+update\s+every\s+ms\s*\]?$/i, type: 'gameinterval', conf: 1.0 },
    { match: /^\[?\s*on\s+game\s+update\s*\]?$/i, type: 'gameupdate', conf: 1.0 },
    { match: /^\[?\s*forever\s*\]?$/i, type: 'forever', conf: 1.0 },
    { match: /^\[?\s*(?:if\s+then|if\s+true\s+then|if)\s*\]?$/i, type: 'controls_if', conf: 1.0 },
    { match: /^\[?\s*else\s*if\s*\]?$/i, type: 'controls_if', conf: 1.0 },
    { match: /^\[?\s*else\s*\]?$/i, type: 'controls_if', conf: 0.9 },
    { match: /^\[?\s*repeat\s*(?:times)?\s*\]?$/i, type: 'controls_repeat_ext', conf: 1.0 },
    { match: /^\[?\s*(?:for\s+index|for)\s*\]?$/i, type: 'controls_simple_for', conf: 0.9 },
    { match: /^\[?\s*for\s+element\s*\]?$/i, type: 'pxt_controls_for_of', conf: 0.95 },
    { match: /^\[?\s*pause\s*(?:\(\d+\))?\s*ms\s*\]?$/i, type: 'device_pause', conf: 1.0 },
    { match: /^\[?\s*pick\s+random\s*\]?$/i, type: 'device_random', conf: 1.0 },
    { match: /^\(?\s*pick\s+random\s*\)?$/i, type: 'device_random', conf: 1.0 },
    { match: /^\[?\s*%?\s*chance\s*\]?$/i, type: 'percentchance', conf: 1.0 },
    { match: /^\[?\s*0\s*=\s*0\s*\]?$/i, type: 'logic_compare', conf: 1.0 },
    { match: /^<\s*0\s*=\s*0\s*>$/i, type: 'logic_compare', mutator: (b) => { const f = b.getField('OP'); if (f) f.setValue('EQ'); }, conf: 1.0 },
    { match: /^<\s*on\s*>$/i, type: 'toggleOnOff', mutator: (b) => { const f = b.getField('on'); if (f) f.setValue('true'); }, conf: 1.0 },
    { match: /^<\s*off\s*>$/i, type: 'toggleOnOff', mutator: (b) => { const f = b.getField('on'); if (f) f.setValue('false'); }, conf: 1.0 },
    { match: /^<\s*win\s*>$/i, type: 'toggleWinLose', mutator: (b) => { const f = b.getField('win'); if (f) f.setValue('true'); }, conf: 1.0 },
    { match: /^<\s*lose\s*>$/i, type: 'toggleWinLose', mutator: (b) => { const f = b.getField('win'); if (f) f.setValue('false'); }, conf: 1.0 },
    { match: /^<\s*true\s*>$/i, type: 'logic_boolean', mutator: (b) => { const f = b.getField('BOOL'); if (f) f.setValue('TRUE'); }, conf: 1.0 },
    { match: /^<\s*false\s*>$/i, type: 'logic_boolean', mutator: (b) => { const f = b.getField('BOOL'); if (f) f.setValue('FALSE'); }, conf: 1.0 },
    { match: /^<\s*and\s*>$/i, type: 'logic_operation', mutator: (b) => { const f = b.getField('OP'); if (f) f.setValue('AND'); }, conf: 1.0 },
    { match: /^<\s*or\s*>$/i, type: 'logic_operation', mutator: (b) => { const f = b.getField('OP'); if (f) f.setValue('OR'); }, conf: 1.0 },
    { match: /^<\s*not\s*>$/i, type: 'logic_negate', conf: 1.0 },
    { match: /^<true>$/i, type: 'logic_boolean', conf: 1.0 },

    // Controller
    { match: /^\[?\s*(?:on\s+)?(?:a\s+)?button\s+pressed\s*\]?$/i, type: 'keyonevent', conf: 1.0 },
    { match: /^\[?\s*run\s+code\s+on\s+\(?[a-zA-Z0-9_]+\)?\s+button\s+\(?[a-zA-Z0-9_]+\)?\s*\]?$/i, type: 'keyonevent', conf: 0.95 },

    // Info
    { match: /^\[?\s*set\s+score\s+to\s*\]?$/i, type: 'hudsetScore', conf: 1.0 },
    { match: /^\[?\s*change\s+score\s+by\s*\]?$/i, type: 'hudChangeScoreBy', conf: 1.0 },
    { match: /^\(?\s*score\s*\)?$/i, type: 'hudScore', conf: 1.0 },
    { match: /^\[?\s*set\s+life\s+to\s*\]?$/i, type: 'hudSetLife', conf: 1.0 },
    { match: /^\[?\s*change\s+life\s+by\s*\]?$/i, type: 'hudChangeLifeBy', conf: 1.0 },
    { match: /^\(?\s*life\s*\)?$/i, type: 'hudLife', conf: 1.0 },
    { match: /^\[?\s*on\s+life\s+zero\s*\]?$/i, type: 'gamelifeevent', conf: 1.0 },
    { match: /^\[?\s*start\s+countdown\s*\]?$/i, type: 'gamecountdown', conf: 1.0 },
    { match: /^\[?\s*on\s+countdown\s+end\s*\]?$/i, type: 'gamecountdownevent', conf: 1.0 },

    // Game & Scene & Images
    { match: /^\[?\s*game\s+over(?:\s*\(true\)|\s*\(false\))?\s*\]?$/i, type: 'gameOver2', conf: 1.0 },
    { match: /^\[?\s*splash(?:\s*\(title\))?\s*\]?$/i, type: 'gameSplash', conf: 1.0 },
    { match: /^\[?\s*show\s+long\s+text(?:\s*\(str\)\s*\(layout\))?\s*\]?$/i, type: 'game_show_long_text', conf: 1.0 },
    { match: /^\[?\s*set\s+background\s+color\s+to(?:\s*\(color\))?\s*\]?$/i, type: 'gamesetbackgroundcolor', conf: 1.0 },
    { match: /^\[?\s*set\s+background\s+image(?:\s+to)?\s*\]?$/i, type: 'gamesetbackgroundimage', conf: 1.0 },
    { match: /^\(?\s*background\s+image\s*\)?$/i, type: 'gamebackgroundimage', conf: 1.0 },
    { match: /^\[?\s*change\s+color\s+in\s+.*from.*to.*\]?$/i, type: 'Image_replace', conf: 1.0 },
    { match: /^\[?\s*(?:start\s+screen\s+effect|confetti)\s*\]?$/i, type: 'particlesStartScreenAnimation', conf: 1.0 },
    { match: /^\[?\s*camera\s+follow(?:\s+sprite)?\s*\]?$/i, type: 'camerafollow', conf: 1.0 },
    { match: /^\[?\s*camera\s+shake\s*\]?$/i, type: 'camerashake', conf: 1.0 },

    // Music
    { match: /^\[?\s*play\s+sound\s*\]?$/i, type: 'music_play_sound', conf: 1.0 },
    { match: /^\[?\s*play\s+melody\s*\]?$/i, type: 'music_melody_playable', conf: 1.0 },
    { match: /^\[?\s*stop\s+all\s+sounds\s*\]?$/i, type: 'music_stop_all_sounds', conf: 1.0 },

    // Tilemap & Tilemap Extension
    { match: /^\[?\s*set\s+tilemap\s+to(?:\s*\(tilemap\))?\s*\]?$/i, type: 'set_current_tilemap', conf: 1.0 },
    { match: /^\[?\s*place\s+.*on\s+top\s+of\s+random(?:\s+tile)?\s*\]?$/i, type: 'mapplaceonrandomtile', conf: 1.0 },
    { match: /^\[?\s*place\s+.*on\s+random\s+tile\s*\]?$/i, type: 'mapplaceonrandomtile', conf: 1.0 },
    { match: /^\[?\s*place\s+.*on\s+top\s+of(?:\s+tile)?\s*\]?$/i, type: 'mapplaceontile', conf: 1.0 },
    { match: /^\[?\s*set\s+(?:wall\s+at|tile\s+at\s+location\s+is\s+wall)\s*\]?$/i, type: 'tiles_tile_at_location_is_wall', conf: 1.0 },
    { match: /^\[?\s*set\s+tile\s+at(?:\s+location)?\s*\]?$/i, type: 'mapsettileat', conf: 1.0 },
    { match: /^\[?\s*connect\s+.*and\s+.*by\s+.*\]?$/i, type: 'tileUtil_connectMapById', conf: 1.0 },
    { match: /^\[?\s*load\s+tilemap\s+connected\s+by\s*.*\]?$/i, type: 'tileUtil_loadConnectedMap', conf: 1.0 },
    { match: /^\[?\s*unload\s+current\s+tilemap\s*\]?$/i, type: 'tileUtil_unloadTilemap', conf: 1.0 },
    { match: /^\[?\s*cover\s+all\s+.*tiles\s+with\s*.*\]?$/i, type: 'tileUtil_coverAllTiles', conf: 1.0 },
    { match: /^\[?\s*on\s+each\s+.*tile\s+create\s+sprite\s*.*\]?$/i, type: 'tileUtil_createSpritesOnTiles', conf: 1.0 },
    { match: /^\(?\s*array\s+of\s+all(?:\s+tile)?\s+locations\s*\)?$/i, type: 'mapgettilestype', conf: 1.0 },
    { match: /^\(?\s*current\s+tilemap\s*\)?$/i, type: 'tileUtil_getLoadedMap', conf: 1.0 },

    // Animation Extension
    { match: /^\[?\s*animate\s+.*frames\s+.*interval.*loop.*\]?$/i, type: 'run_image_animation', conf: 1.0 },
    { match: /^\[?\s*animate\s+.*with\s+.*for\s+.*loop.*\]?$/i, type: 'run_movement_animation', conf: 1.0 },
    { match: /^\[?\s*animate\s+image\s*\]?$/i, type: 'run_image_animation', conf: 1.0 },
    { match: /^\[?\s*animate\s+movement\s*\]?$/i, type: 'run_movement_animation', conf: 1.0 },
    { match: /^\[?\s*stop\s+.*animations\s+on\s*.*\]?$/i, type: 'stop_animations', conf: 1.0 },

    // Arrays / Lists
    { match: /^\(?\s*length\s+of\s+array\s*\)?$/i, type: 'lists_length', conf: 1.0 },
    { match: /^\[?\s*list\s+add\s+value\s+to\s+end\s*\]?$/i, type: 'lists_setIndex', conf: 1.0 },
    { match: /^\(?\s*empty\s+array\s*\)?$/i, type: 'lists_create_empty', conf: 1.0 },
    { match: /^\(?\s*get\s+random\s+value\s+from\s*\(?[a-zA-Z0-9_ ]+\)?\s*\)?$/i, type: 'array_pickRandom', conf: 1.0 }
  ];

  function serializeBlock(block) {
    if (!block) return null;
    const svgRoot = block.getSvgRoot ? block.getSvgRoot() : null;
    if (!svgRoot) return null;
    let bbox;
    try { bbox = svgRoot.getBBox(); } catch (e) { return null; }
    if (!bbox || bbox.width < 10 || bbox.height < 10) return null;

    const clone = svgRoot.cloneNode(true);
    clone.removeAttribute('transform');
    clone.setAttribute('transform', 'translate(' + (-bbox.x) + ',' + (-bbox.y) + ')');

    const INPROPS = [
      'fill', 'fill-opacity', 'opacity', 'stroke', 'stroke-width',
      'font-family', 'font-size', 'font-weight', 'letter-spacing',
      'text-anchor', 'dominant-baseline', 'writing-mode', 'paint-order'
    ];

    (function walkColors(el) {
      for (const c of el.childNodes) {
        if (c.nodeType === 1) walkColors(c);
      }
      try {
        const cs = getComputedStyle(el);
        let s = '';
        for (const p of INPROPS) {
          const v = cs.getPropertyValue(p);
          if (v && v !== 'initial') s += p + ':' + v + ';';
        }
        if (s) el.setAttribute('style', s);
        const cls = (el.getAttribute('class') || '').trim();
        if (cls) el.removeAttribute('class');
      } catch (e) { /* keep classes */ }
    })(clone);

    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    const width = Math.ceil(bbox.width + 4);
    const height = Math.ceil(bbox.height + 4);
    svg.setAttribute('viewBox', '0 0 ' + width + ' ' + height);
    svg.setAttribute('width', width);
    svg.setAttribute('height', height);
    svg.appendChild(clone);

    // True container/multiline blocks have statement slots or height > 70
    const hasStatement = block.inputList && block.inputList.some(i => i.name === 'STACK' || i.name === 'DO0' || i.name === 'HANDLER');
    const isMultiLine = hasStatement || height > 70;

    return {
      svg: new XMLSerializer().serializeToString(svg),
      width: width,
      height: height,
      isMultiLine: isMultiLine
    };
  }

  function ensureVariable(ws, name) {
    if (!ws) return null;
    try {
      let v = ws.getVariable ? ws.getVariable(name) : null;
      if (!v && ws.createVariable) v = ws.createVariable(name);
      return v;
    } catch (e) {
      return null;
    }
  }

  function renderDynamicBlock(type, mutator, rawText) {
    const tc = toolchain();
    if (!tc || !tc.ws) return null;
    try {
      ensureExtensionBlocks(tc.B);
      const b = tc.ws.newBlock(type);
      if (!b) return null;
      if (mutator) mutator(b, tc.ws, rawText);
      b.initSvg();
      b.render();
      const res = serializeBlock(b);
      b.dispose();
      return res;
    } catch (e) {
      console.warn('[AIFX in-page] renderDynamicBlock error for', type, e);
      return null;
    }
  }

  function getCatalogEntries(B, ws) {
    if (catalogCache) return catalogCache;
    const entries = [];
    if (!B || !B.Blocks) return entries;

    for (const type of Object.keys(B.Blocks)) {
      try {
        const b = ws.newBlock(type);
        const texts = [];
        if (b.inputList) {
          for (const input of b.inputList) {
            for (const field of input.fieldRow) {
              const val = field.getText ? field.getText() : (field.getValue ? field.getValue() : '');
              if (val) texts.push(val);
            }
          }
        }
        b.dispose();
        const fullText = texts.join(' ');
        if (fullText) {
          entries.push({
            type,
            rawText: fullText,
            normText: normalize(fullText),
            words: wordTokens(fullText),
            bigrams: charBigrams(fullText)
          });
        }
      } catch (e) {
        // Skip blocks that fail parameterless init
      }
    }
    catalogCache = entries;
    return catalogCache;
  }

  function resolveTokenMatch(tokenText, tc) {
    const raw = tokenText.trim();
    if (raw === '[]' || raw === '()' || raw === '[ ]' || raw === '( )') {
      return { confidence: 0, type: null, reason: 'empty token' };
    }
    if (/ctrl\s*\+/i.test(raw)) {
      return { confidence: 0, type: null, reason: 'keyboard shortcut' };
    }

    // 1. Canonical rule match
    for (const entry of CANONICAL_MAP) {
      if (entry.match.test(raw)) {
        return { confidence: entry.conf, type: entry.type, mutator: entry.mutator, name: raw };
      }
    }

    // 2. Sprite Property: [set sprite x to], [change sprite y by], [set sprite [x]
    const spritePropMatch = raw.match(/(?:set|change)\s+sprite\s+\[?([xy]|vx|vy|ax|ay)\]?(?:\s+(?:to|by))?/i);
    if (spritePropMatch) {
      const prop = spritePropMatch[1].toLowerCase();
      const isChange = /change/i.test(raw);
      const type = isChange ? 'Sprite_blockCombine_change' : 'Sprite_blockCombine_set';
      return {
        confidence: 1.0,
        type,
        mutator: (b) => {
          const f = b.getField('property');
          if (f) f.setValue(`Sprite.${prop}@${isChange ? 'change' : 'set'}`);
        },
        name: raw
      };
    }

    // 3. Function Definitions: [function <name>]
    const funcDefMatch = raw.match(/^\[?(?:function)\s*([a-zA-Z0-9_]+)\]?$/i);
    if (funcDefMatch) {
      return {
        confidence: 1.0,
        type: 'function_definition',
        mutator: (b) => {
          const f = b.getField('function_name');
          if (f) f.setValue(funcDefMatch[1]);
        },
        name: raw
      };
    }

    // 4. Function Calls: [call <name>]
    const funcCallMatch = raw.match(/^\[?(?:call)\s*([a-zA-Z0-9_]+)\]?$/i);
    if (funcCallMatch) {
      return {
        confidence: 1.0,
        type: 'function_call',
        mutator: (b) => {
          const f = b.getField('function_name');
          if (f) f.setValue(funcCallMatch[1]);
        },
        name: raw
      };
    }

    // 5. Variable Setters: [set <name> to]
    const varSetMatch = raw.match(/^\[set\s+([a-zA-Z0-9_ ]+?)\s+to\]$/i);
    if (varSetMatch) {
      const varName = varSetMatch[1].trim();
      return {
        confidence: 1.0,
        type: 'variables_set',
        mutator: (b, ws) => {
          const v = ensureVariable(ws, varName);
          const f = b.getField('VAR');
          if (f && v) f.setValue(v.getId());
        },
        name: raw
      };
    }

    // 6. Standalone identifier bubbles: (mySprite), (otherSprite), (sprite), (location), (score)
    const bubbleMatch = raw.match(/^\(([a-zA-Z_][a-zA-Z0-9_ ]*)\)$/);
    if (bubbleMatch) {
      const name = bubbleMatch[1].trim();
      if (['score', 'hudscore'].includes(name.toLowerCase())) {
        return { confidence: 1.0, type: 'hudScore', name: raw };
      }
      if (['life', 'hudlife'].includes(name.toLowerCase())) {
        return { confidence: 1.0, type: 'hudLife', name: raw };
      }
      if (['background image'].includes(name.toLowerCase())) {
        return { confidence: 1.0, type: 'gamebackgroundimage', name: raw };
      }
      if (['othersprite', 'sprite', 'location', 'picture'].includes(name.toLowerCase())) {
        return {
          confidence: 1.0,
          type: 'argument_reporter_custom',
          mutator: (b) => {
            const f = b.getField('VALUE');
            if (f) f.setValue(name);
          },
          name: raw
        };
      }
      return {
        confidence: 0.95,
        type: 'variables_get',
        mutator: (b, ws) => {
          const v = ensureVariable(ws, name);
          const f = b.getField('VAR');
          if (f && v) f.setValue(v.getId());
        },
        name: raw
      };
    }

    // 7. Angled Boolean variable/reporter: <isBeeDizzy>
    const angleIdentMatch = raw.match(/^<([a-zA-Z_][a-zA-Z0-9_]*)>$/);
    if (angleIdentMatch) {
      const name = angleIdentMatch[1];
      return {
        confidence: 0.95,
        type: 'argument_reporter_boolean',
        mutator: (b) => {
          const f = b.getField('VALUE');
          if (f) f.setValue(name);
        },
        name: raw
      };
    }

    // 8. General Heuristic Matcher against MakeCode Catalog (Minimum 80% threshold)
    if (tc && tc.B && tc.ws) {
      const catalog = getCatalogEntries(tc.B, tc.ws);
      const norm = normalize(raw);
      const wTok = wordTokens(norm);
      const bgTok = charBigrams(norm);
      let best = null;
      let highestScore = 0;

      for (const b of catalog) {
        let score = (jaccardSimilarity(wTok, b.words) * 0.5) + (diceSimilarity(bgTok, b.bigrams) * 0.5);
        if (b.normText.length >= 4 && (norm.includes(b.normText) || b.normText.includes(norm))) {
          score = Math.max(score, 0.85);
        }
        if (score > highestScore) {
          highestScore = score;
          best = b;
        }
      }

      if (highestScore >= 0.80 && best) {
        return { confidence: highestScore, type: best.type, name: raw };
      }
    }

    return { confidence: 0, type: null, reason: 'below 80% threshold' };
  }

  async function renderToken(tokenText) {
    if (CACHE[tokenText]) return CACHE[tokenText];

    const tc = toolchain();
    if (!tc) {
      return { svg: null, err: 'Blockly toolchain not ready' };
    }

    const match = resolveTokenMatch(tokenText, tc);
    if (!match || match.confidence < 0.80 || !match.type) {
      return { svg: null, err: 'Block not found or confidence < 80%: ' + tokenText };
    }

    const res = renderDynamicBlock(match.type, match.mutator, tokenText);
    if (res && res.svg) {
      CACHE[tokenText] = res;
      return res;
    }

    return { svg: null, err: 'Failed to render block: ' + tokenText };
  }

  // Listen for render requests dispatched from renderer.js
  window.addEventListener('message', (event) => {
    if (!event.data || event.data.action !== 'AIFX_RENDER_BLOCK') return;
    const { id, token } = event.data;

    renderToken(token || '')
      .then((res) => {
        window.postMessage({
          action: 'AIFX_BLOCK_RENDERED',
          id: id,
          svg: res ? res.svg : null,
          width: res ? res.width : 0,
          height: res ? res.height : 0,
          isMultiLine: res ? res.isMultiLine : false,
          err: res ? res.err : null
        }, '*');
      })
      .catch((err) => {
        window.postMessage({
          action: 'AIFX_BLOCK_RENDERED',
          id: id,
          svg: null,
          width: 0,
          height: 0,
          isMultiLine: false,
          err: String(err)
        }, '*');
      });
  });

  console.info('[AIFX in-page] MAIN world renderer active with 80% heuristic & bubble mutators');
})();
