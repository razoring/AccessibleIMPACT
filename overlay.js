// overlay.js — content script injected into https://impact.codeninjas.com/*
// Targets: text nodes containing [block] tokens from the instructions dump.
// Design rules (per user clarification):
//   - Only replaces [bracket] tokens (blocks.txt vocabulary) inline.
//   - Does NOT replace bubbles/prose standalone (bubbles.txt untouched).
//   - Does NOT rely on session data-ids; uses block type + toolbox verification.
//   - Produces inline SVG toolbox-default clones (not editable live blocks).

(function () {
  'use strict';

  // Simple normalization matching the corpus grammar.
  function normalizeToken(s) {
    return s.toLowerCase().replace(/\s+/g, ' ').trim();
  }

  // Token regex: bracket blocks ([...]), including nested parameters.
  // Matches tokens like [set background color to] or [set sprite [x]].
  const TOKEN_PATTERN = /\[[^\[\]]*(?:\[[^\[\]]*\][^\[\]]*)*\]/g;

  // Cache of resolved SVGs keyed by a small hash of the token string + category hint.
  // The real mapping is rebuilt from the rendered flyout categories (see renderer.js).
  const CACHE_KEY_PREFIX = 'aifx';

  function replaceInNode(node) {
    if (!node || node.nodeType !== 3 || node.parentElement && node.parentElement.closest('.aifx-replaced')) return;
    const text = node.nodeValue || '';
    const matches = text.match(TOKEN_PATTERN);
    if (!matches) return;
    const parent = node.parentElement;
    if (!parent) return;
    const parts = text.split(TOKEN_PATTERN);
    const fragment = document.createDocumentFragment();
    let replaced = false;
    for (let i = 0; i < matches.length; i++) {
      if (i > 0 || parts[0]) {
        fragment.appendChild(document.createTextNode(parts[i]));
      }
      const token = matches[i];
      const span = document.createElement('span');
      span.className = 'aifx-replaced';
      span.setAttribute('data-token', token);
      span.textContent = token; // placeholder; renderer.js injects SVG here
      span.setAttribute('aria-label', 'MakeCode block: ' + token);
      span.style.display = 'inline-block';
      span.style.verticalAlign = 'middle';
      fragment.appendChild(span);
      replaced |= true;
    }
    if (replaced) {
      parent.replaceChild(fragment, node);
    }
  }

  function scan() {
    const walker = document.createTreeWalker(
      document.body,
      NodeFilter.SHOW_TEXT,
      null,
      false
    );
    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    nodes.forEach(replaceInNode);
  }

  // The renderer.js sends messages back; overlay listens for ready signals
  // and also observes DOM mutations from Angular SPA navigation.
  const observer = new MutationObserver((mutations) => {
    // Lightweight throttle
    window.__aifxScanTimer = window.__aifxScanTimer || 0;
    clearTimeout(window.__aifxScanTimer);
    window.__aifxScanTimer = setTimeout(scan, 150);
  });

  observer.observe(document.body, { subtree: true, childList: true, characterData: true });
  // Initial scan after load (page may already have instructions loaded).
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => setTimeout(scan, 300));
  } else {
    setTimeout(scan, 300);
  }
})();
