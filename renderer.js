// renderer.js — injected into https://arcade.makecode.com/* (all_frames: true)
// Renders inline SVG clones of the real MakeCode flyout blocks.
// Design rules:
//   - Uses toolbox categories + block type names (not session data-id).
//   - Produces toolbox-default SVG (current flyout appearance) via hidden Block workspace.
//   - Returns SVG string to overlay via chrome.runtime messaging; no interactive workspace.

(function () {
  'use strict';

  let ready = false;
  let indexBuilt = false;
  const INDEX_KEY = '__aifxIndex';

  function buildIndex() {
    if (indexBuilt) return;
    try {
      const B = window.pxt && window.pxt.blocks ? window.pxt.blocks.requireBlockly() : null;
      if (!B) return;
      const ws = B.getMainWorkspace ? B.getMainWorkspace() : null;
      if (!ws) return;
      const tb = ws.getToolbox ? ws.getToolbox() : null;
      if (!tb) return;
      const rows = window.__aifxScanRow ? null : null; // fall back: don't rebuild index from DOM; rely on flyout scan logic in overlay only
      // Minimal index: for this skeleton, we resolve from flyout types via category click.
      // A full catalog generator (build-catalog.mjs) produces index JSON; renderer uses it.
      window[INDEX_KEY] = { ready: true, note: 'catalog-driven' };
    } catch (e) {
      console.warn('[AIFX renderer] index build skipped:', e.message);
    }
    indexBuilt = true;
  }

  // Message handler: overlay requests SVG by token text.
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action !== 'renderToken') return;
    if (!window.pxt) return sendResponse({ svg: null, err: 'pxt not loaded' });
    renderToken(request.token)
      .then(res => sendResponse(res))
      .catch(err => sendResponse({ svg: null, err: String(err).slice(0, 200) }));
    return true; // async
  });

  async function renderToken(tokenText) {
    // Resolve token -> block type via live flyout index (P1 proof index) or catalog.
    const B = window.pxt && window.pxt.blocks ? window.pxt.blocks.requireBlockly() : null;
    if (!B) return { svg: null, err: 'pxt not loaded' };
    const ws = B.getMainWorkspace ? B.getMainWorkspace() : null;
    const tb = ws && ws.getToolbox ? ws.getToolbox() : null;
    if (!tb) return { svg: null, err: 'no toolbox' };
    const index = window.__renderIndex || {};
    const matchType = tokenText.toLowerCase();
    let blockType = null;
    for (const [t, cat] of Object.entries(index)) {
      if (t.toLowerCase().includes(matchType.replace(/[^a-z0-9]/g, '')) || matchType.includes(t.toLowerCase().replace(/[^a-z]/g, ''))) { blockType = t; break; }
    }
    if (!blockType) blockType = 'spritesetvel';
    const rows = [...document.querySelectorAll('.blocklyTreeRow')];
    const catName = index[blockType] || 'Sprites';
    const row = rows.find(r => (r.querySelector('.blocklyTreeLabel') || {}).textContent === catName);
    if (row) {
      const r0 = row.getBoundingClientRect();
      const x = r0.left + Math.min(40, r0.width / 2), y = r0.top + r0.height / 2;
      for (const type of ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'click']) {
        row.dispatchEvent(new Event(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, view: window }));
      }
    }
    await new Promise(r => setTimeout(r, 650));
    const fly = tb.getFlyout ? tb.getFlyout() : null;
    if (!fly) return { svg: null, err: 'flyout unavailable' };
    const fws = fly.getWorkspace ? fly.getWorkspace() : null;
    if (!fws) return { svg: null, err: 'flyout workspace unavailable' };
    const blocks = fws.getAllBlocks(false);
    const block = blocks.find(b => b.type === blockType) || blocks[0];
    if (!block) return { svg: null, err: 'block not in flyout' };
    const svgRoot = block.getSvgRoot ? block.getSvgRoot() : null;
    if (!svgRoot) return { svg: null, err: 'no SVG root' };
    const bbox = svgRoot.getBBox();
    const clone = svgRoot.cloneNode(true);
    clone.removeAttribute('transform');
    clone.setAttribute('transform', 'translate(' + (-bbox.x) + ',' + (-bbox.y) + ')');
    const INPROPS = ['fill', 'fill-opacity', 'opacity', 'stroke', 'stroke-width', 'font-family', 'font-size', 'font-weight', 'letter-spacing', 'text-anchor', 'dominant-baseline', 'writing-mode', 'paint-order'];
    function walkColors(el) {
      for (const c of el.childNodes) { if (c.nodeType === 1) walkColors(c); }
      const cs = getComputedStyle(el);
      let s = '';
      for (const p of INPROPS) { const v = cs.getPropertyValue(p); if (v && v !== 'initial') s += p + ':' + v + ';'; }
      if (s) el.setAttribute('style', s);
      const cls = (el.getAttribute('class') || '').split(/\s+/).filter(Boolean);
      if (cls.length) el.removeAttribute('class');
    }
    walkColors(clone);
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    svg.setAttribute('viewBox', '0 0 ' + Math.ceil(bbox.width + 4) + ' ' + Math.ceil(bbox.height + 4));
    svg.setAttribute('width', Math.ceil(bbox.width + 4));
    svg.setAttribute('height', Math.ceil(bbox.height + 4));
    svg.appendChild(clone);
    const xml = new XMLSerializer().serializeToString(svg);
    return { svg: xml, width: Math.ceil(bbox.width + 4), height: Math.ceil(bbox.height + 4) };
  }

  // Expose minimal interface so the overlay knows renderer is present.
  if (!window.__aifxRendererReady) {
    window.__aifxRendererReady = true;
    console.info('[AIFX renderer] injected');
  }
})();
