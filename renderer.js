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
    // 1. Load/create a hidden hidden workspace (clone approach) or use flyout workspace.
    // For skeleton: use the editor's flyout workspace (opened by selecting category in overlay click flow).
    // Simplified approach for P1 skeleton:
    const B = window.pxt.blocks.requireBlockly();
    const ws = B.getMainWorkspace();

    // 2. Resolve token -> flyout workspace block type; skeleton returns placeholder with explanation.
    // The full version uses category selection + flyout type scan (see proof-of-concept).
    // Here we return a minimal placeholder to demonstrate the message flow.
    return { svg: '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="30"><text x="8" y="20" style="font:600 12pt Consolas;fill:#385cb1">[rendered: ' + tokenText.slice(0, 40) + ']</text></svg>', width: 240, height: 30 };
  }

  // Expose minimal interface so the overlay knows renderer is present.
  if (!window.__aifxRendererReady) {
    window.__aifxRendererReady = true;
    console.info('[AIFX renderer] injected');
  }
})();
