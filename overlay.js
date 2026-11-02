// overlay.js — tries live iframe SVG first; falls back to exact saved catalog template
(function () {
  'use strict';
  const FAST = {
    'set sprite velocity to':'spritesetvel','set sprite position to':'spritesetpos','on start':'event_start',
    'sprite say':'spritesaytext','set background color to':'scene_set_background_color',
    'set sprite image to':'spritesetimage','if true then':'logic_if','destroy sprite':'spritedestroy2',
    'set life to':'game_set_life','game over':'gameOver2','show long text':'game_show_long_text',
    'set tilemap to':'tilemap_set','on button pressed':'keyonevent','set score to':'game_set_score',
    'animate image':'animation_animate_sprite','play sound':'music_playable_play',
    'stop all sounds':'music_stop_all_sounds','looping in background':'loops_forever',
    'set volume':'synth_set_volume','say':'spritesaytext','on destroyed':'spritesondestroyed',
    'on created':'spritesoncreated','sprite start effect':'startEffectOnSprite',
    'set name to':'variables_set','ask for string':'gameaskforstring',
    'place sprite on top of random tile':'tilemap_place_random',
    'on sprite overlaps tile':'spritesoverlap','change sprite x':'spritesetpos',
    'set sprite follow':'spriteFollowOtherSprite','camera shake':'scene_camera_shake',
    'use effect':'startEffectOnSprite','camera follow sprite':'scene_camera_follow_sprite',
    'set wall at':'tilemap_set_wall','set sprite stay in screen':'spritesetsetstayinscreen',
    'start screen effect':'startEffectOnSprite','confetti':'startEffectOnSprite',
    'ba ding':'music_ring','until done':'control_until',
    'on game update every ms':'gameupdate','move sprite with buttons':'game_control_sprite',
    'on life zero':'game_on_life_zero','set projectile to projectile from sprite':'sprite_projectile_from_sprite'
  };
  const TOKEN_REGEX = /\[[^\n\r\[\]]*(?:\[[^\n\r\[\]]*\][^\n\r\[\]]*)*\]/g;
  const lookup = { ...FAST };
  function isInstructionArea(el) { if (!el) return false; return !!el.closest('[data-instruction], .primary-section, article, .lesson-content'); }
  function normalizeToken(s) { return s.toLowerCase().replace(/[\[\]\(\)]/g,' ').replace(/\s+/g,' ').trim(); }
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
        const tokenText = matches[i - 1];
        const key = normalizeToken(tokenText.replace(/\[|\]/g, ''));
        const blockType = (lookup[key] || FAST[key] || null);
        const span = document.createElement('span');
        span.className = 'aifx-rendered';
        span.setAttribute('data-token', tokenText);
        span.style.display = 'inline-block';
        span.style.verticalAlign = 'middle';

        // LIVE FIRST: ask embedded iframe renderer for exact SVG
        try {
          chrome.runtime.sendMessage({ action: 'renderToken', token: tokenText }, (res) => {
            if (res && res.svg && span && span.parentElement) {
              span.innerHTML = res.svg;
              span.setAttribute('data-rendered', 'true');
            } else {
              loadExactFile(span, blockType, tokenText);
            }
          });
        } catch (e) {
          loadExactFile(span, blockType, tokenText);
        }
        replaced = true;
      }
      if (parts[i]) fragment.appendChild(document.createTextNode(parts[i]));
    }
    if (replaced) parent.replaceChild(fragment, node);
  }

  function loadExactFile(span, blockType, tokenText) {
    if (!blockType) { span.textContent = tokenText; span.style.color = '#b12c43'; span.style.fontWeight = '600'; return; }
    // Direct embedded exact toolbox template (no fetch needed — saved from live flyout)
    span.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 429 58" width="429" height="58"><g role="none"><path stroke="#385cb1" fill="#4b7bec" d="m 0,0 m 0,4 a 4 4 0 0,1 4,-4 h 8 c 2,0 3,1 4,2 l 4,4 c 1,1 2,2 4,2 h 12 c 2,0 3,-1 4,-2 l 4,-4 c 1,-1 2,-2 4,-2 h 374.3125 a 4 4 0 0,1 4,4 v 8 V 44 V 44 a 4 4 0 0,1 -4,4 h -374.3125 c -2,0 -3,1 -4,2 l -4,4 c -1,1 -2,2 -4,2 h -12 c -2,0 -3,-1 -4,-2 l -4,-4 c -1,-1 -2,-2 -4,-2 h -8 a 4 4 0 0,1 -4,-4 z" style="fill:#4b7bec;stroke:#385cb1;stroke-width:1;"/><g transform="translate(48, 4)"><path stroke="#b12c43" fill="#ec3b59" d="m 20,0 h 74.375 a 20 20 0 0,1 20,20 v 0 a 20 20 0 0,1 -20,20 h -74.375 a 20 20 0 0,1 -20,-20 v 0 a 20 20 0 0,1 20,-20 z" style="fill:#ec3b59;stroke:#b12c43;stroke-width:1.5;"/></g></g><text x="60" y="18" fill="#fff" font-family="Consolas,Monaco,Menlo,monospace" font-size="11" font-weight="600">${(tokenText.replace(/\[|\]/g,'').trim()).slice(0,22)}</text></svg>`;
    span.setAttribute('data-rendered', 'true');
  }

  function scan() {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null, false);
    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    nodes.forEach(replaceInNode);
  }

  const observer = new MutationObserver((mutations) => {
    clearTimeout(window.__aifxScanTimer);
    window.__aifxScanTimer = setTimeout(scan, 150);
  });
  observer.observe(document.body, { subtree: true, childList: true, characterData: true });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => setTimeout(scan, 300));
  else setTimeout(scan, 300);
})();
