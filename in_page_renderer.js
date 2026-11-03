// in_page_renderer.js — runs in MAIN world of arcade.makecode.com iframe
// Has direct access to window.pxt, window.pxt.blocks, window.Blockly, and Blockly workspaces.
// Extracts and renders REAL MakeCode Blockly SVGs. No heuristic or fake fallbacks.

(function () {
  'use strict';

  const CACHE = { byType: {}, byKey: {} };
  let buildPromise = null;

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
    const tb = ws.getToolbox ? ws.getToolbox() : null;
    const fly = tb && tb.getFlyout ? tb.getFlyout() : null;
    const fws = fly && fly.getWorkspace ? fly.getWorkspace() : null;
    return { B, ws, tb, fly, fws };
  }

  const BLOCK_MAP = {
    // Sprite creation & properties
    'set sprite to': { type: 'spritescreate' },
    'sprite img of kind kind': { type: 'spritescreate' },
    'set sprite position to': { type: 'spritesetpos' },
    'set sprite velocity to': { type: 'spritesetvel' },
    'set sprite image to': { type: 'spritesetimage' },
    'set sprite kind to': { type: 'spritesetkind' },
    'set sprite stay in screen': { type: 'spritesetsetstayinscreen' },
    'set sprite bounce on wall': { type: 'spritesetsetbounceonwall' },
    'destroy sprite': { type: 'spritedestroy2' },
    'sprite say': { type: 'spritesaytext' },
    'say': { type: 'spritesaytext' },
    'set sprite follow': { type: 'spriteFollowOtherSprite' },
    'move sprite with buttons': { type: 'game_control_sprite' },
    'on sprite overlaps sprite': { type: 'spritesoverlap' },
    'on sprite overlaps tile': { type: 'spritesoverlap' },
    'on sprite hits wall': { type: 'spriteshitwall' },
    'on created': { type: 'spritesoncreated' },
    'on destroyed': { type: 'spritesondestroyed' },
    'sprite start effect': { type: 'startEffectOnSprite' },
    'use effect': { type: 'startEffectOnSprite' },

    // Dynamic Sprite_blockCombine_set properties
    'set sprite x to': { type: 'Sprite_blockCombine_set', field: 'property', value: 'Sprite.x@set' },
    'set sprite y to': { type: 'Sprite_blockCombine_set', field: 'property', value: 'Sprite.y@set' },
    'set sprite vx to': { type: 'Sprite_blockCombine_set', field: 'property', value: 'Sprite.vx@set' },
    'set sprite vy to': { type: 'Sprite_blockCombine_set', field: 'property', value: 'Sprite.vy@set' },
    'set sprite ax to': { type: 'Sprite_blockCombine_set', field: 'property', value: 'Sprite.ax@set' },
    'set sprite ay to': { type: 'Sprite_blockCombine_set', field: 'property', value: 'Sprite.ay@set' },
    'change sprite x': { type: 'Sprite_blockCombine_set', field: 'property', value: 'Sprite.x@set' },
    'change sprite x to': { type: 'Sprite_blockCombine_set', field: 'property', value: 'Sprite.x@set' },
    'change sprite y': { type: 'Sprite_blockCombine_set', field: 'property', value: 'Sprite.y@set' },
    'change sprite y to': { type: 'Sprite_blockCombine_set', field: 'property', value: 'Sprite.y@set' },

    // Projectiles
    'set projectile to projectile from side': { type: 'spritescreateprojectilefromside' },
    'set projectile to projectile from sprite': { type: 'spritescreateprojectilefromsprite' },

    // Events & Game loops
    'on start': { type: 'pxt-on-start' },
    'on game update every ms': { type: 'gameinterval' },
    'on a button pressed': { type: 'keyonevent' },
    'on button pressed': { type: 'keyonevent' },
    'game over': { type: 'gameOver2' },
    'splash': { type: 'gameSplash' },
    'show long text': { type: 'game_show_long_text' },

    // Scene & Background & Tilemap
    'set background color to': { type: 'gamesetbackgroundcolor' },
    'set background image to img': { type: 'gamesetbackgroundimage' },
    'set background image to': { type: 'gamesetbackgroundimage' },
    'start screen effect': { type: 'particlesStartScreenAnimation' },
    'confetti': { type: 'particlesStartScreenAnimation' },
    'camera follow sprite': { type: 'camerafollow' },
    'camera shake': { type: 'camerashake' },
    'set tilemap to': { type: 'set_current_tilemap' },
    'place sprite on top of': { type: 'mapplaceonrandomtile' },
    'place sprite on top of random tile': { type: 'mapplaceonrandomtile' },
    'set wall at': { type: 'tiles_tile_at_location_is_wall' },

    // Info: Life & Score & Countdown
    'set life to': { type: 'hudSetLife' },
    'change life by': { type: 'hudChangeLifeBy' },
    'on life zero': { type: 'gamelifeevent' },
    'set score to': { type: 'hudsetScore' },
    'change score by': { type: 'hudChangeScoreBy' },
    'score value block': { type: 'hudScore' },
    'start countdown': { type: 'gamecountdown' },
    'on countdown end': { type: 'gamecountdownevent' },

    // Music & Sound
    'play sound': { type: 'music_playable_play' },
    'ba ding': { type: 'music_playable_play' },
    'play melody': { type: 'music_melody_playable' },
    'stop all sounds': { type: 'music_stop_all_sounds' },
    'set volume': { type: 'synth_set_volume' },

    // Logic & Math & Loops
    'pick random': { type: 'device_random' },
    'if true then': { type: 'controls_if' },
    'if true then else': { type: 'controls_if' },
    'else': { type: 'controls_if' },
    '0=0': { type: 'logic_compare' },
    '0 = 0': { type: 'logic_compare' },
    'true': { type: 'logic_boolean' },
    'looping in background': { type: 'forever' },
    'until done': { type: 'forever' },
    'repeat times': { type: 'controls_repeat_ext' },

    // Variables & Animation
    'set name to': { type: 'variables_set' },
    'animate image': { type: 'run_image_animation' },
    'animate movement': { type: 'run_image_animation' },
    'ask for string': { type: 'gameaskforstring' },
    'othersprite': { type: 'argument_reporter_custom' },
    'sprite': { type: 'argument_reporter_custom' },
    'score': { type: 'hudScore' },
    'chance': { type: 'percentchance' },
    '% chance': { type: 'percentchance' },
    'percent chance': { type: 'percentchance' }
  };

  function normalizeKey(str) {
    return (str || '')
      .toLowerCase()
      .replace(/^[\[\(\<]+|[\]\)\>]+$/g, '')
      .replace(/[\[\]\(\)\<\>]/g, ' ')
      .replace(/[^a-z0-9\s=\.%]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

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
    svg.setAttribute('viewBox', '0 0 ' + Math.ceil(bbox.width + 4) + ' ' + Math.ceil(bbox.height + 4));
    svg.setAttribute('width', Math.ceil(bbox.width + 4));
    svg.setAttribute('height', Math.ceil(bbox.height + 4));
    svg.appendChild(clone);

    return {
      svg: new XMLSerializer().serializeToString(svg),
      width: Math.ceil(bbox.width + 4),
      height: Math.ceil(bbox.height + 4)
    };
  }

  function renderDynamicBlock(type, mutator) {
    const tc = toolchain();
    if (!tc || !tc.ws) return null;
    try {
      const b = tc.ws.newBlock(type);
      if (!b) return null;
      if (mutator) mutator(b);
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

  async function buildCatalog() {
    const tc = toolchain();
    if (!tc || !tc.tb || !tc.fws) {
      buildPromise = null;
      return;
    }

    const rows = Array.from(document.querySelectorAll('.blocklyTreeRow[data-ns]'));
    if (!rows.length) return;

    for (const row of rows) {
      row.click();
      await new Promise(r => setTimeout(r, 160));
      let blocks = [];
      try { blocks = tc.fws.getAllBlocks(false); } catch (e) { continue; }
      for (const b of blocks) {
        if (!CACHE.byType[b.type]) {
          const out = serializeBlock(b);
          if (out) CACHE.byType[b.type] = out;
        }
      }
    }

    try { tc.tb.getFlyout().hide(); } catch (e) {}
    console.info('[AIFX in-page] catalog ready, cached types:', Object.keys(CACHE.byType).length);
  }

  async function renderToken(tokenText) {
    const key = normalizeKey(tokenText);
    const mapping = BLOCK_MAP[key];

    // 1. Dynamic property mutation (e.g. Sprite.x@set vs Sprite.y@set)
    if (mapping && mapping.field && mapping.value) {
      const dyn = renderDynamicBlock(mapping.type, (b) => {
        const f = b.getField(mapping.field);
        if (f) f.setValue(mapping.value);
      });
      if (dyn) return dyn;
    }

    // 2. Mapped block type
    if (mapping && mapping.type) {
      if (CACHE.byType[mapping.type]) return CACHE.byType[mapping.type];
      const direct = renderDynamicBlock(mapping.type);
      if (direct) {
        CACHE.byType[mapping.type] = direct;
        return direct;
      }
    }

    // 3. Check catalog; warm up if needed
    if (Object.keys(CACHE.byType).length === 0) {
      if (!buildPromise) buildPromise = buildCatalog().catch(() => { buildPromise = null; });
      await buildPromise;
    }

    if (mapping && mapping.type && CACHE.byType[mapping.type]) {
      return CACHE.byType[mapping.type];
    }

    // 4. Exact block type requested
    if (CACHE.byType[tokenText]) {
      return CACHE.byType[tokenText];
    }

    // 5. Direct fallback generation from Blockly.Blocks[type]
    const tc = toolchain();
    if (tc && tc.B && tc.B.Blocks) {
      const typeCandidates = [
        key.replace(/\s+/g, '_'),
        key.replace(/\s+/g, ''),
        mapping ? mapping.type : null
      ].filter(Boolean);

      for (const t of typeCandidates) {
        if (tc.B.Blocks[t]) {
          const out = renderDynamicBlock(t);
          if (out) {
            CACHE.byType[t] = out;
            return out;
          }
        }
      }
    }

    return { svg: null, err: 'Block not found: ' + tokenText };
  }

  // Listen for render requests dispatched from renderer.js (isolated world)
  window.addEventListener('message', (event) => {
    if (!event.data || event.data.action !== 'AIFX_RENDER_BLOCK') return;
    const { id, token } = event.data;

    renderToken(token || '')
      .then((res) => {
        window.postMessage({
          action: 'AIFX_BLOCK_RENDERED',
          id: id,
          svg: res ? res.svg : null,
          err: res ? res.err : null
        }, '*');
      })
      .catch((err) => {
        window.postMessage({
          action: 'AIFX_BLOCK_RENDERED',
          id: id,
          svg: null,
          err: String(err)
        }, '*');
      });
  });

  // Warm up catalog after editor initializes
  try {
    setTimeout(() => {
      if (!buildPromise) buildPromise = buildCatalog().catch(() => { buildPromise = null; });
    }, 2000);
  } catch (e) {}

  console.info('[AIFX in-page] MAIN world renderer active');
})();