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

  const TOKEN_REGEX = /\[[^\n\r\[\]]*(?:\[[^\n\r\[\]]*\][^\n\r\[\]]*)*\]/g;

  // Only apply to instruction panel / content area; do NOT touch standalone bubbles/prose.
  function isInstructionArea(el) {
    if (!el) return false;
    const best = el.closest ? el.closest('[data-instruction], .primary-section, article, .lesson-content') : null;
    if (best) return true;
    return false;
  }

  // Cache of resolved SVGs keyed by a small hash of the token string + category hint.
  // The real mapping is rebuilt from the rendered flyout categories (see renderer.js).
  const CACHE_KEY_PREFIX = 'aifx';

  function replaceInNode(node) {
    if (!node || node.nodeType !== 3 || node.parentElement && node.parentElement.closest('.aifx-rendered')) return;
    const text = node.nodeValue || '';
    const matches = text.match(TOKEN_REGEX);
    if (!matches) return;
    const parent = node.parentElement;
    if (!parent || !isInstructionArea(parent)) return; // don't touch bubbles/prose outside instruction area
    const fragment = document.createDocumentFragment();
    let replaced = false;
    const parts = text.split(TOKEN_REGEX);
    for (let i = 0; i < parts.length; i++) {
      if (i > 0 && matches[i - 1]) { // after each token
        const tokenText = matches[i - 1];
        const placeholder = document.createElement('span');
        placeholder.className = 'aifx-rendered';
        placeholder.setAttribute('data-token', tokenText);
        placeholder.textContent = tokenText; // original text preserved (accessible fallback)
        placeholder.style.display = 'inline-block';
        placeholder.style.verticalAlign = 'middle';
        placeholder.setAttribute('aria-label', 'MakeCode block: ' + tokenText);
        fragment.appendChild(placeholder);
        try {
          chrome.runtime.sendMessage({ action: 'renderToken', token: tokenText }, (res) => {
            if (res && res.svg && placeholder && placeholder.parentElement) {
              placeholder.innerHTML = res.svg;
              placeholder.setAttribute('data-rendered', 'true');
            } else {
              placeholder.style.color = '#b12c43';
              placeholder.style.fontWeight = '600';
            }
          });
        } catch (e) {
          // Extension message unavailable; keep original token text (never invent block)
        }
        replaced = true;
      }
      if (parts[i]) fragment.appendChild(document.createTextNode(parts[i]));
    }
    if (replaced) parent.replaceChild(fragment, node);
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
