// overlay.js — scans instruction steps and upgrades tokens to live MakeCode block SVGs
// Option B: exact block SVGs extracted from the embedded MakeCode iframe.
// No fallback SVGs — unresolved tokens (<80% confidence) remain untouched as plain text.

(function () {
  'use strict';

  // Matches [nested [bracket]] blocks, parenthesized (nested (bubbles)), and <angled> blocks
  const TOKEN_REGEX = /\[(?:[^\[\]\r\n]|\[[^\]\r\n]*\])+\]|\((?:[^\(\)\r\n]|\([^\)\r\n]*\))+\)|<[a-zA-Z0-9_=\s]+>/g;
  const svgCache = new Map();
  let scanTimer = null;

  function injectStyles() {
    if (document.getElementById('aifx-styles')) return;
    const style = document.createElement('style');
    style.id = 'aifx-styles';
    style.textContent = `
      .aifx-rendered.aifx-inline {
        display: inline-block !important;
        vertical-align: middle !important;
        margin: 0 3px !important;
        line-height: 1 !important;
      }
      .aifx-rendered.aifx-inline svg {
        display: inline-block !important;
        vertical-align: middle !important;
        width: auto !important;
        max-width: 100% !important;
        filter: drop-shadow(0 1px 2px rgba(0,0,0,0.15)) !important;
        transition: transform 0.15s ease !important;
      }
      .aifx-rendered.aifx-inline:hover svg {
        transform: scale(1.08) !important;
        position: relative !important;
        z-index: 10 !important;
      }
      .aifx-rendered.aifx-multiline {
        display: block !important;
        margin: 12px 0 !important;
        clear: both !important;
        text-align: left !important;
        line-height: normal !important;
      }
      .aifx-rendered.aifx-multiline svg {
        display: block !important;
        height: auto !important;
        max-width: 100% !important;
        filter: drop-shadow(0 2px 4px rgba(0,0,0,0.2)) !important;
        transition: transform 0.15s ease !important;
      }
      .aifx-rendered.aifx-multiline:hover svg {
        transform: scale(1.03) !important;
        position: relative !important;
        z-index: 10 !important;
      }
    `;
    (document.head || document.documentElement).appendChild(style);
  }

  function isInstructionArea(el) {
    if (!el) return false;
    // Strictly match content area — NEVER match stepper, tabs, or navigation controls
    return !!el.closest('app-step-information content, [data-instruction], article, .lesson-content');
  }

  function applySvg(span, data) {
    if (!span || !data || !data.svg) return;
    const isMultiLine = data.isMultiLine || data.height > 70;
    span.className = 'aifx-rendered ' + (isMultiLine ? 'aifx-multiline' : 'aifx-inline');
    span.innerHTML = data.svg;
    span.setAttribute('data-rendered', 'true');

    const svgEl = span.querySelector('svg');
    if (svgEl) {
      if (isMultiLine) {
        svgEl.style.display = 'block';
        // Benchmark: scale factor 2.25 / 44 keeps font size consistent at ~13-14px visual (17px text bounding box)
        const emScale = 2.25 / 44;
        const emWidth = ((data.width || 100) * emScale).toFixed(3);
        const emHeight = ((data.height || 70) * emScale).toFixed(3);
        svgEl.style.setProperty('width', `${emWidth}em`, 'important');
        svgEl.style.setProperty('height', `${emHeight}em`, 'important');
        svgEl.style.maxWidth = '100%';
      } else {
        svgEl.style.display = 'inline-block';
        svgEl.style.verticalAlign = 'middle';
        // Benchmark: 44px bubble/reporter viewBox height scales to 2.25em
        // Scale proportionally by viewBox height so text font size is identical across all blocks
        const h = data.height || 44;
        const emHeight = ((h / 44) * 2.25).toFixed(3);
        svgEl.style.setProperty('height', `${emHeight}em`, 'important');
        svgEl.style.setProperty('width', 'auto', 'important');
      }
    }
  }

  function replaceInNode(node) {
    if (!node || node.nodeType !== 3) return;
    if (node.parentElement && (node.parentElement.closest('.aifx-rendered') || node.parentElement.closest('[data-token]'))) return;

    const text = node.nodeValue || '';
    if (!text.includes('[') && !text.includes('(') && !text.includes('<')) return;

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
        span.className = 'aifx-rendered'; // Set immediately to prevent re-wrapping
        span.setAttribute('data-token', tokenText);

        if (svgCache.has(tokenText)) {
          const cached = svgCache.get(tokenText);
          if (cached && cached.svg) {
            applySvg(span, cached);
          } else {
            span.textContent = tokenText;
          }
        } else {
          span.textContent = tokenText;
          try {
            chrome.runtime.sendMessage({ action: 'renderToken', token: tokenText }, (res) => {
              if (chrome.runtime.lastError) {
                return;
              }
              if (res && res.svg && span.isConnected) {
                svgCache.set(tokenText, res);
                applySvg(span, res);
              } else {
                svgCache.set(tokenText, { svg: null });
                span.textContent = tokenText;
              }
            });
          } catch (e) {
            span.textContent = tokenText;
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
    // Strictly query content containers only
    const areas = document.querySelectorAll('app-step-information content, [data-instruction], article, .lesson-content');
    for (const area of areas) {
      const walker = document.createTreeWalker(area, NodeFilter.SHOW_TEXT, {
        acceptNode(n) {
          if (!n || !n.nodeValue) return NodeFilter.FILTER_REJECT;
          if (n.parentElement && (n.parentElement.closest('.aifx-rendered') || n.parentElement.closest('[data-token]'))) {
            return NodeFilter.FILTER_REJECT;
          }
          if (n.nodeValue.includes('[') || n.nodeValue.includes('(') || n.nodeValue.includes('<')) {
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
