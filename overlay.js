// overlay.js — scans instruction steps and upgrades tokens to live MakeCode block SVGs
// Option B: exact block SVGs extracted from the embedded MakeCode iframe.
// No fallback SVGs — unresolved tokens remain untouched as plain text.

(function () {
  'use strict';

  const TOKEN_REGEX = /\[[^\]\r\n]+(?:\s*\[[^\]\r\n]+\])*\]|\([^\)\r\n]+\)|<true>/g;
  const svgCache = new Map();
  let scanTimer = null;

  function injectStyles() {
    if (document.getElementById('aifx-styles')) return;
    const style = document.createElement('style');
    style.id = 'aifx-styles';
    style.textContent = `
      .aifx-rendered {
        display: inline-block !important;
        vertical-align: middle !important;
        margin: 0 4px !important;
        line-height: 1 !important;
      }
      .aifx-rendered svg {
        display: inline-block !important;
        vertical-align: middle !important;
        height: 2.2em !important;
        width: auto !important;
        max-width: 100% !important;
        filter: drop-shadow(0 1px 2px rgba(0,0,0,0.15)) !important;
        transition: transform 0.15s ease !important;
      }
      .aifx-rendered:hover svg {
        transform: scale(1.15) !important;
        position: relative !important;
        z-index: 10 !important;
      }
    `;
    (document.head || document.documentElement).appendChild(style);
  }

  function isInstructionArea(el) {
    if (!el) return false;
    return !!el.closest('app-step-information, [data-instruction], .primary-section, article, .lesson-content');
  }

  function applySvg(span, svgMarkup) {
    if (!span || !svgMarkup) return;
    span.innerHTML = svgMarkup;
    span.setAttribute('data-rendered', 'true');
    const svgEl = span.querySelector('svg');
    if (svgEl) {
      svgEl.style.height = '2.2em';
      svgEl.style.width = 'auto';
      svgEl.style.verticalAlign = 'middle';
      svgEl.style.display = 'inline-block';
    }
  }

  function replaceInNode(node) {
    if (!node || node.nodeType !== 3) return;
    if (node.parentElement && node.parentElement.closest('.aifx-rendered')) return;

    const text = node.nodeValue || '';
    if (!text.includes('[') && !text.includes('(') && !text.includes('<true>')) return;

    const matches = text.match(TOKEN_REGEX);
    if (!matches || !matches.length) return;

    const parent = node.parentElement;
    if (!parent || !isInstructionArea(parent)) return;

    const fragment = document.createDocumentFragment();
    const parts = text.split(TOKEN_REGEX);
    let replaced = false;

    for (let i = 0; i < parts.length; i++) {
      if (parts[i]) {
        fragment.appendChild(document.createTextNode(parts[i]));
      }

      if (i < matches.length) {
        const tokenText = matches[i];
        const span = document.createElement('span');
        span.className = 'aifx-rendered';
        span.setAttribute('data-token', tokenText);

        if (svgCache.has(tokenText)) {
          applySvg(span, svgCache.get(tokenText));
        } else {
          span.textContent = tokenText;
          try {
            chrome.runtime.sendMessage({ action: 'renderToken', token: tokenText }, (res) => {
              if (chrome.runtime.lastError) {
                console.warn('[AIFX overlay] relay error:', chrome.runtime.lastError.message);
                return;
              }
              if (res && res.svg && span.isConnected) {
                console.info('[AIFX overlay] applied live SVG for:', tokenText);
                svgCache.set(tokenText, res.svg);
                applySvg(span, res.svg);
              } else if (res && res.err) {
                console.warn('[AIFX overlay] render err:', res.err);
              }
            });
          } catch (e) {
            console.warn('[AIFX overlay] sendMessage exception:', e);
          }
        }

        fragment.appendChild(span);
        replaced = true;
      }
    }

    if (replaced && parent.contains(node)) {
      parent.replaceChild(fragment, node);
    }
  }

  function scan() {
    injectStyles();
    const areas = document.querySelectorAll('app-step-information, [data-instruction], .primary-section, article, .lesson-content');
    for (const area of areas) {
      const walker = document.createTreeWalker(area, NodeFilter.SHOW_TEXT, {
        acceptNode(n) {
          if (!n || !n.nodeValue) return NodeFilter.FILTER_REJECT;
          if (n.parentElement && n.parentElement.closest('.aifx-rendered')) return NodeFilter.FILTER_REJECT;
          if (n.nodeValue.includes('[') || n.nodeValue.includes('(') || n.nodeValue.includes('<true>')) {
            return NodeFilter.FILTER_ACCEPT;
          }
          return NodeFilter.FILTER_REJECT;
        }
      });
      const textNodes = [];
      while (walker.nextNode()) {
        textNodes.push(walker.currentNode);
      }
      for (const node of textNodes) {
        replaceInNode(node);
      }
    }
  }

  const observer = new MutationObserver(() => {
    clearTimeout(scanTimer);
    scanTimer = setTimeout(scan, 60);
  });

  observer.observe(document.body || document.documentElement, {
    subtree: true,
    childList: true,
    characterData: true
  });

  injectStyles();
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => setTimeout(scan, 150));
  } else {
    setTimeout(scan, 150);
  }
})();