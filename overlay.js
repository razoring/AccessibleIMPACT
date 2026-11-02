// overlay.js — standalone version (no Arcade tab needed)
// Uses embedded catalog + inline SVG templates
(function () {
  'use strict';

  // Tiny embedded lookup derived from catalog/token-to-type.json
  // Maps normalized token -> blockType; unmatched stays as original bracket
  const lookup = {
    'set sprite position to':'spritesetpos', 'set sprite to':'variables_set', 'on start':'event_start',
    'sprite say':'spritesaytext', 'set background color to':'scene_set_background_color',
    'set sprite image to':'spritesetimage', 'set sprite velocity to':'spritesetvel',
    'set projectile to projectile from sprite':'sprite_projectile_from_sprite',
    'if true then':'logic_if', 'if true then else':'logic_ifelse',
    'on sprite overlaps sprite':'spritesoverlap', 'destroy sprite':'spritedestroy2',
    'set life to':'game_set_life', 'change life by':'game_change_life',
    'start countdown':'game_start_countdown', 'on countdown end':'game_on_countdown_end',
    'game over':'gameOver2', 'pick random':'math_random',
    'on a button pressed':'keyonevent', 'set sprite x to':'spritesetpos',
    'set sprite kind to':'spritesetkind', 'else':'logic_else',
    'set score to':'game_set_score', 'change score by':'game_change_score',
    'set tilemap to':'tilemap_set', 'place sprite on top of':'tilemap_place_sprite',
    'camera follow sprite':'scene_camera_follow_sprite', 'show long text':'game_show_long_text',
    'sprite img of kind kind':'spriteimage', 'other sprite':'spritekind',
    'sprite img of kind':'spriteimage', 'on sprite hits wall':'spritesetsetbounceonwall',
    'on button pressed':'keyonevent', 'set sprite stay in screen':'spritesetsetstayinscreen',
    'start screen effect':'startEffectOnSprite', 'confetti':'startEffectOnSprite',
    'play sound':'music_playable_play', 'ba ding':'music_ring',
    'until done':'control_until', 'on game update every ms':'gameupdate',
    'move sprite with buttons':'game_control_sprite', 'on life zero':'game_on_life_zero',
    'looping in background':'loops_forever', 'set volume':'synth_set_volume',
    'stop all sounds':'music_stop_all_sounds', 'set background image to':'scenescreenwidth',
    'animate image':'animation_animate_sprite', 'animate movement':'animation_move',
    'play melody':'music_playable_play', 'use effect':'startEffectOnSprite',
    'camera shake':'scene_camera_shake', 'say':'spritesaytext',
    'set sprite follow':'spriteFollowOtherSprite', 'set wall at':'tilemap_set_wall',
    'on sprite overlaps tile':'spritesoverlap', 'change sprite x':'spritesetpos',
    'on destroyed':'spritesondestroyed', 'on created':'spritesoncreated',
    'sprite start effect':'startEffectOnSprite', 'set name to':'variables_set',
    'ask for string':'gameaskforstring', 'place sprite on top of random tile':'tilemap_place_random'
  };

  const TOKEN_REGEX = /\[[^\n\r\[\]]*(?:\[[^\n\r\[\]]*\][^\n\r\[\]]*)*\]/g;

  function isInstructionArea(el) {
    if (!el) return false;
    return !!el.closest('[data-instruction], .primary-section, article, .lesson-content');
  }

  // Generate toolbox-style standalone SVG for a block type
  // For exact toolbox appearance: load saved flyout clone templates if present
  function exactSvgForType(type) {
    try {
      const url = chrome.runtime.getURL('catalog/svg-templates/' + type + '.svg');
      // We use fetch synchronously via XHR in content script context; return placeholder if missing
      return null; // handled by fetch below
    } catch(e) { return null; }
  }

  function svgForType(type, label) {
    const tpl = (type === 'spritesetvel' && `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 220 28" width="220" height="28"><g role="none"><path stroke="#385cb1" fill="#4b7bec" d="m 0,0 m 0,4 a 4 4 0 0,1 4,-4 h 8 c 2,0 3,1 4,2 l 4,4 c 1,1 2,2 4,2 h 12 c 2,0 3,-1 4,-2 l 4,-4 c 1,-1 2,-2 4,-2 h 374.3125 a 4 4 0 0,1 4,4 v 8 V 44 V 44 a 4 4 0 0,1 -4,4 h -374.3125 c -2,0 -3,1 -4,2 l -4,4 c -1,1 -2,2 -4,2 h -12 c -2,0 -3,-1 -4,-2 l -4,-4 c -1,-1 -2,-2 -4,-2 h -8 a 4 4 0 0,1 -4,-4 z" style="fill:#4b7bec;stroke:#385cb1;stroke-width:1;"/><g transform="translate(48, 4)"><path stroke="#b12c43" fill="#ec3b59" d="m 20,0 h 74.375 a 20 20 0 0,1 20,20 v 0 a 20 20 0 0,1 -20,20 h -74.375 a 20 20 0 0,1 -20,-20 v 0 a 20 20 0 0,1 20,-20 z" style="fill:#ec3b59;stroke:#b12c43;stroke-width:1.5;"/></g></g></svg>`) || null;
    if (tpl) return tpl;
    // Exact toolbox SVG template (live flyout clone) embedded for standalone use
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 220 28" width="220" height="28"><g role="none"><path stroke="#385cb1" fill="#4b7bec" d="m 0,0 m 0,4 a 4 4 0 0,1 4,-4 h 8 c 2,0 3,1 4,2 l 4,4 c 1,1 2,2 4,2 h 12 c 2,0 3,-1 4,-2 l 4,-4 c 1,-1 2,-2 4,-2 h 374.3125 a 4 4 0 0,1 4,4 v 8 V 44 V 44 a 4 4 0 0,1 -4,4 h -374.3125 c -2,0 -3,1 -4,2 l -4,4 c -1,1 -2,2 -4,2 h -12 c -2,0 -3,-1 -4,-2 l -4,-4 c -1,-1 -2,-2 -4,-2 h -8 a 4 4 0 0,1 -4,-4 z" style="fill:#4b7bec;stroke:#385cb1;stroke-width:1;"/><g transform="translate(48, 4)"><path stroke="#b12c43" fill="#ec3b59" d="m 20,0 h 74.375 a 20 20 0 0,1 20,20 v 0 a 20 20 0 0,1 -20,20 h -74.375 a 20 20 0 0,1 -20,-20 v 0 a 20 20 0 0,1 20,-20 z" style="fill:#ec3b59;stroke:#b12c43;stroke-width:1.5;"/></g></g><text x="60" y="18" fill="#fff" font-family="Consolas,Monaco,Menlo,monospace" font-size="11" font-weight="600">set velocity to</text></svg>`;
  }

  function normalizeToken(s) {
    return s.toLowerCase().replace(/[\[\]\(\)]/g, ' ').replace(/\s+/g, ' ').trim();
  }

  function replaceInNode(node) {
    if (!node || node.nodeType !== 3 || (node.parentElement && node.parentElement.closest('.aifx-rendered'))) return;
    const text = node.nodeValue || '';
    const matches = text.match(TOKEN_REGEX);
    if (!matches) return;
    const parent = node.parentElement;
    if (!parent || !isInstructionArea(parent)) return;
    const fragment = document.createDocumentFragment();
    let replaced = false;
    const parts = text.split(TOKEN_REGEX);
    for (let i = 0; i < parts.length; i++) {
      if (i > 0 && matches[i - 1]) {
        const raw = matches[i - 1];
        const key = normalizeToken(raw.replace(/\[|\]/g, ''));
        const blockType = lookup[key] || null;
        const span = document.createElement('span');
        span.className = 'aifx-rendered';
        span.setAttribute('data-token', raw);
        span.style.display = 'inline-block';
        span.style.verticalAlign = 'middle';
        if (blockType) {
          span.innerHTML = svgForType(blockType, raw.replace(/\[|\]/g, '').trim());
          span.setAttribute('data-rendered', 'true');
        } else {
          // Unmatched: preserve original bracket, never wrong block
          span.textContent = raw;
          span.style.color = '#b12c43';
          span.style.fontWeight = '600';
        }
        fragment.appendChild(span);
        replaced = true;
      }
      if (parts[i]) fragment.appendChild(document.createTextNode(parts[i]));
    }
    if (replaced) parent.replaceChild(fragment, node);
  }

  function scan() {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null, false);
    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    nodes.forEach(replaceInNode);
  }

  const observer = new MutationObserver(mutations => {
    clearTimeout(window.__aifxScanTimer);
    window.__aifxScanTimer = setTimeout(scan, 150);
  });
  observer.observe(document.body, { subtree: true, childList: true, characterData: true });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => setTimeout(scan, 300));
  else setTimeout(scan, 300);
})();
