// overlay.js — scans instruction steps and upgrades tokens to live MakeCode block SVGs
// Option B: exact block SVGs extracted from the embedded MakeCode iframe.
// No fallback SVGs — unresolved tokens (<80% confidence) remain untouched as plain text.

(function () {
  'use strict';

  // Matches [nested [bracket]] blocks, parenthesized (nested (bubbles)), <angled> blocks (including >= and > comparisons), and ▶ play icon
  const TOKEN_REGEX = /\[set\s+sprite\s+position\s+to\}|\[(?:[^\[\]\r\n]|\[[^\]\r\n]*\])+\]|\((?:[^\(\)\r\n]|\([^\)\r\n]*\))+\)|<(?:[^<>\r\n]+?\s*(?:<=|>=|=>|=<|<|>|=|==)\s*[^<>\r\n]+?)>|<[^<>\r\n]+>|▶/g;
  const svgCache = new Map();
  const pendingRequests = new Map(); // lookupToken -> Array<span elements>
  let scanTimer = null;

  function healSplitTokens(area) {
    if (!area) return;
    const targets = area.querySelectorAll('p, div, li');
    const list = targets.length ? Array.from(targets) : [area];
    for (const el of list) {
      const old = el.innerHTML;
      if (!old || (!old.includes('<strong') && !old.includes('&lt;') && !old.includes('<'))) continue;
      const fixed = old
        .replace(/<strong[^>]*>(?:&lt;|<)<\/strong>([a-zA-Z0-9_\s%<>=]+)<strong[^>]*>(?:&gt;|>)<\/strong>/gi, (m, g1) => '&lt;' + g1.trim() + '&gt;')
        .replace(/<strong[^>]*>\(<\/strong>([a-zA-Z0-9_\s%]+)<strong[^>]*>\)<\/strong>/gi, (m, g1) => '(' + g1.trim() + ')')
        .replace(/<strong[^>]*>\[<\/strong>([a-zA-Z0-9_\s%]+)<strong[^>]*>\]<\/strong>/gi, (m, g1) => '[' + g1.trim() + ']')
        .replace(/\(([ \t\r\n]*<strong[^>]*>)([^<]+)\)([ \t\r\n]*<\/strong>)/gi, (m, g1, g2, g3) => g1 + '(' + g2 + ')' + g3)
        .replace(/\[([ \t\r\n]*<strong[^>]*>)([^<]+)\]([ \t\r\n]*<\/strong>)/gi, (m, g1, g2, g3) => g1 + '[' + g2 + ']' + g3)
        .replace(/(<strong[^>]*>)\(([ \t\r\n]*[^<]+)<\/strong>\)/gi, (m, g1, g2) => g1 + '(' + g2 + ')</strong>')
        .replace(/(<strong[^>]*>)\[([ \t\r\n]*[^<]+)<\/strong>\]/gi, (m, g1, g2) => g1 + '[' + g2 + ']</strong>')
        .replace(/(?:&lt;|<)([ \t\r\n]*<strong[^>]*>)([^<]+)<\/strong>(?:&gt;|>)/gi, (m, g1, g2) => g1 + '&lt;' + g2 + '&gt;</strong>')
        .replace(/(<strong[^>]*>)(?:&lt;|<)([ \t\r\n]*[^<]+)<\/strong>(?:&gt;|>)/gi, (m, g1, g2) => g1 + '&lt;' + g2 + '&gt;</strong>')
        .replace(/(?:&lt;|<)([ \t\r\n]*<strong[^>]*>)([^<]+)(?:&gt;|>)([ \t\r\n]*<\/strong>)/gi, (m, g1, g2, g3) => g1 + '&lt;' + g2 + '&gt;' + g3);
      if (fixed !== old) {
        el.innerHTML = fixed;
      }
    }
  }

  // Initialize directly from catalog/
  let catalogMap = null;
  let tokenToFileMap = null;

  async function loadCatalog() {
    try {
      if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.getURL) {
        const [catRes, mapRes] = await Promise.all([
          fetch(chrome.runtime.getURL('catalog/catalog.json')),
          fetch(chrome.runtime.getURL('catalog/token_map.json'))
        ]);
        catalogMap = await catRes.json();
        tokenToFileMap = await mapRes.json();
        scan();
      }
    } catch (e) {
      console.warn('[AIFX] Error loading catalog:', e);
    }
  }
  loadCatalog();

  async function fetchCatalogSvg(fileKey) {
    if (!catalogMap || !fileKey) return null;
    const entry = catalogMap[fileKey];
    if (!entry) return null;
    try {
      const url = chrome.runtime.getURL('catalog/' + entry.file);
      const res = await fetch(url);
      const svg = await res.text();
      return {
        svg: svg,
        width: entry.width,
        height: entry.height,
        category: entry.type
      };
    } catch(e) {
      return null;
    }
  }

  function getStaticOrCached(token) {
    if (!token) return null;
    if (svgCache.has(token)) return svgCache.get(token);
    const norm = token.replace(/\s+/g, ' ').trim();
    if (svgCache.has(norm)) return svgCache.get(norm);
    const normNoParenSpace = norm.replace(/\(\s*([^\)]+?)\s*\)/g, '($1)');
    if (svgCache.has(normNoParenSpace)) return svgCache.get(normNoParenSpace);
    return null;
  }

  // Load persistent storage cache asynchronously and apply instantly to instructions UI
  if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
    chrome.storage.local.get(null, (items) => {
      if (chrome.runtime.lastError || !items) return;
      let count = 0;
      for (const [k, v] of Object.entries(items)) {
        // Do not let stale chrome.storage entries overwrite fresh static definitions
        if (v && v.svg && !svgCache.has(k)) {
          svgCache.set(k, v);
          count++;
        }
      }
      if (count > 0) {
        applyCacheToPage();
      }
    });

    try {
      if (chrome.storage.onChanged) {
        chrome.storage.onChanged.addListener((changes, area) => {
          if (area !== 'local') return;
          for (const [key, change] of Object.entries(changes)) {
            if (change.newValue && change.newValue.svg) {
              svgCache.set(key, change.newValue);
              applyTokenToPage(key, change.newValue);
            }
          }
        });
      }
    } catch (e) {}
  }

  // Listen for background announcement that renderer/iframe is ready
  try {
    if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage) {
      chrome.runtime.onMessage.addListener((msg) => {
        if (msg && msg.action === 'rendererReady') {
          applyCacheToPage();
          retryPendingTokens();
          scan();
        }
      });
    }
  } catch (e) {}

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
      .aifx-rendered.aifx-play-icon {
        display: inline-block !important;
        vertical-align: -0.25em !important;
        margin: 0 4px !important;
        line-height: 1 !important;
      }
      .aifx-rendered.aifx-play-icon svg {
        display: inline-block !important;
        vertical-align: middle !important;
        width: 1.35em !important;
        height: 1.35em !important;
        max-width: none !important;
        filter: drop-shadow(0 1px 2px rgba(0,0,0,0.2)) !important;
        transition: transform 0.15s ease !important;
      }
      .aifx-rendered.aifx-play-icon:hover svg {
        transform: scale(1.12) !important;
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
    const tokenText = span.getAttribute('data-token') || '';
    const isPlayIcon = (tokenText === '▶' || tokenText === '[▶]');
    const isMultiLine = !isPlayIcon && (data.isMultiLine || data.height > 70);
    span.className = 'aifx-rendered ' + (isPlayIcon ? 'aifx-play-icon' : (isMultiLine ? 'aifx-multiline' : 'aifx-inline'));
    span.innerHTML = data.svg;
    span.setAttribute('data-rendered', 'true');

    const svgEl = span.querySelector('svg');
    if (svgEl) {
      if (isPlayIcon) {
        svgEl.style.display = 'inline-block';
        svgEl.style.verticalAlign = 'middle';
        svgEl.style.setProperty('width', '1.35em', 'important');
        svgEl.style.setProperty('height', '1.35em', 'important');
      } else if (isMultiLine) {
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

  // Instantly apply extracted or newly cached SVG to matching spans in UI
  function applyTokenToPage(token, data) {
    if (!token || !data || !data.svg) return;
    svgCache.set(token, data);
    try {
      if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
        chrome.storage.local.set({ [token]: data });
      }
    } catch (e) {}

    const spans = document.querySelectorAll('span.aifx-rendered');
    for (const span of spans) {
      const dt = span.getAttribute('data-token');
      const dlt = span.getAttribute('data-lookup-token');
      if (dt === token || dlt === token) {
        applySvg(span, data);
      }
    }
  }

  // Scans all unrendered spans and applies cached SVGs immediately
  function applyCacheToPage() {
    const spans = document.querySelectorAll('span.aifx-rendered:not([data-rendered="true"])');
    for (const span of spans) {
      const lookupToken = span.getAttribute('data-lookup-token') || span.getAttribute('data-token');
      const tokenText = span.getAttribute('data-token') || lookupToken;
      const cached = getStaticOrCached(lookupToken) || getStaticOrCached(tokenText);
      if (cached && cached.svg) {
        applySvg(span, cached);
      } else if (tokenToFileMap) {
        const fileKey = tokenToFileMap[lookupToken] || tokenToFileMap[tokenText];
        if (fileKey) {
          fetchCatalogSvg(fileKey).then(data => {
            if (data && data.svg) {
              svgCache.set(lookupToken, data);
              svgCache.set(tokenText, data);
              applySvg(span, data);
            }
          });
        }
      }
    }
  }

  // Retries requests for unrendered spans currently in the DOM
  function retryPendingTokens() {
    const spans = document.querySelectorAll('span.aifx-rendered:not([data-rendered="true"])');
    for (const span of spans) {
      const lookupToken = span.getAttribute('data-lookup-token') || span.getAttribute('data-token');
      const tokenText = span.getAttribute('data-token') || lookupToken;
      const cached = getStaticOrCached(lookupToken) || getStaticOrCached(tokenText);
      if (cached && cached.svg) {
        applySvg(span, cached);
      } else if (!cached || cached.svg !== null) {
        requestTokenRender(lookupToken, tokenText, span);
      }
    }
  }

  function requestTokenRender(lookupToken, tokenText, span) {
    if (!pendingRequests.has(lookupToken)) {
      pendingRequests.set(lookupToken, []);
    }
    if (span && !pendingRequests.get(lookupToken).includes(span)) {
      pendingRequests.get(lookupToken).push(span);
    }

    if (pendingRequests.get(lookupToken).length > 1) {
      return; // Already in-flight
    }

    function doSend(retryCount) {
      try {
        chrome.runtime.sendMessage({ action: 'renderToken', token: lookupToken }, (res) => {
          if (chrome.runtime.lastError || !res || (!res.svg && res.err && (res.err.includes('unreachable') || res.err.includes('not found') || res.err.includes('Receiving end does not exist') || res.err.includes('toolchain not ready')))) {
            if (retryCount < 8) {
              setTimeout(() => doSend(retryCount + 1), Math.min(400 * Math.pow(1.3, retryCount), 2000));
              return;
            }
          }

          const waiters = pendingRequests.get(lookupToken) || [];
          pendingRequests.delete(lookupToken);

          if (res && res.svg) {
            applyTokenToPage(lookupToken, res);
            if (tokenText !== lookupToken) {
              applyTokenToPage(tokenText, res);
            }
          } else {
            if (res && res.err && res.err.includes('confidence < 80%')) {
              svgCache.set(lookupToken, { svg: null });
              svgCache.set(tokenText, { svg: null });
            }
            for (const s of waiters) {
              if (s && s.isConnected && !s.getAttribute('data-rendered')) {
                s.textContent = s.getAttribute('data-token') || tokenText;
              }
            }
          }
        });
      } catch (e) {
        if (retryCount < 5) {
          setTimeout(() => doSend(retryCount + 1), 1000);
        }
      }
    }

    doSend(0);
  }

  function matchAngleBlock(text, start) {
    let j = start + 1;
    let bracketDepth = 0;
    let parenDepth = 0;
    let angleDepth = 1;

    while (j < text.length) {
      const c = text[j];
      if (c === '\n' || c === '\r') return null;

      if (c === '[') bracketDepth++;
      else if (c === ']') bracketDepth = Math.max(0, bracketDepth - 1);
      else if (c === '(') parenDepth++;
      else if (c === ')') parenDepth = Math.max(0, parenDepth - 1);
      else if (bracketDepth === 0 && parenDepth === 0) {
        if (c === '<') {
          const before = text.slice(start + 1, j).trim();
          if (/\b(and|or|not)\s*$/i.test(before) || before === '') {
            angleDepth++;
          }
        } else if (c === '>') {
          if (text[j + 1] === '=') { j += 2; continue; }
          if (text[j - 1] === '=') { j++; continue; }

          if (angleDepth > 1) {
            angleDepth--;
          } else {
            const remaining = text.slice(j + 1);
            const before = text.slice(start + 1, j);
            const hasPriorOp = /[=!<>]/.test(before) || /\b(and|or)\b/i.test(before);
            const hasClosingAfter = /^[a-zA-Z0-9_\s.()\[\]]+>/.test(remaining);

            if (!hasPriorOp && hasClosingAfter) {
              j++;
              continue;
            }

            return j + 1;
          }
        }
      }
      j++;
    }
    return null;
  }

  function tokenizeText(text) {
    const segments = [];
    let lastIdx = 0;
    let i = 0;

    function pushPlain(end) {
      if (end > lastIdx) {
        segments.push({ isToken: false, text: text.slice(lastIdx, end) });
      }
    }

    function pushToken(start, end) {
      pushPlain(start);
      segments.push({ isToken: true, text: text.slice(start, end) });
      lastIdx = end;
    }

    while (i < text.length) {
      const ch = text[i];

      if (ch === '▶') {
        pushToken(i, i + 1);
        i++;
        continue;
      }

      if (text.startsWith('[set sprite position to}', i)) {
        pushToken(i, i + 24);
        i += 24;
        continue;
      }

      if (ch === '[') {
        const start = i;
        let depth = 0;
        let j = i;
        while (j < text.length) {
          if (text[j] === '\n' || text[j] === '\r') break;
          if (text[j] === '[') depth++;
          else if (text[j] === ']') {
            depth--;
            if (depth === 0) {
              j++;
              pushToken(start, j);
              i = j;
              break;
            }
          }
          j++;
        }
        if (depth === 0) continue;
      }

      if (ch === '(') {
        const start = i;
        let depth = 0;
        let j = i;
        while (j < text.length) {
          if (text[j] === '\n' || text[j] === '\r') break;
          if (text[j] === '(') depth++;
          else if (text[j] === ')') {
            depth--;
            if (depth === 0) {
              j++;
              pushToken(start, j);
              i = j;
              break;
            }
          }
          j++;
        }
        if (depth === 0) continue;
      }

      if (ch === '<') {
        const end = matchAngleBlock(text, i);
        if (end !== null) {
          pushToken(i, end);
          i = end;
          continue;
        }
      }

      i++;
    }

    pushPlain(text.length);
    return segments;
  }

  function replaceInNode(node) {
    if (!node || node.nodeType !== 3) return;
    if (node.parentElement && (node.parentElement.closest('.aifx-rendered') || node.parentElement.closest('[data-token]'))) return;

    const text = node.nodeValue || '';
    if (!text.includes('[') && !text.includes('(') && !text.includes('<') && !text.includes('▶')) return;

    const segments = tokenizeText(text);
    if (!segments.some(s => s.isToken)) return;

    const parent = node.parentElement;
    if (!parent || !isInstructionArea(parent)) return;

    const fragment = document.createDocumentFragment();
    let replaced = false;

    for (const seg of segments) {
      if (!seg.isToken) {
        if (seg.text) fragment.appendChild(document.createTextNode(seg.text));
        continue;
      }

      const tokenText = seg.text;
      let lookupToken = tokenText;

      // Context Engine (Chromebook-fast, < 1ms): Disambiguate isolated tokens & parameters
      const stepArea = parent.closest('app-step-information, [data-instruction], article, .lesson-content') || document.body;
      const stepText = (stepArea ? stepArea.textContent : '').toLowerCase();

      // 1. Isolated property/dropdown ([bottom], [top], [center], [full screen])
      if (/^\[?\(?(?:bottom|top|center|full\s*screen)\)?\]?$/i.test(tokenText)) {
        const isDialog = /dialog|text\s*bubble|long\s*text|message|story|talk|say/i.test(stepText);
        const val = tokenText.replace(/[\[\]\(\)]/g, '').trim().toLowerCase();
        lookupToken = isDialog ? `[${val}] (game)` : `[${val}]`;
      }
      // 2. Multiplayer vs Sprite Kind: [Player 1] / [Player 2]
      else if (/^\[?player\s*[1-4]\]?$/i.test(tokenText)) {
        const isMultiplayer = /multiplayer|player\s*[234]|mp\./i.test(stepText);
        if (isMultiplayer) {
          lookupToken = tokenText.toLowerCase();
        } else {
          lookupToken = '[Player]';
        }
      }
      // 3. Isolated character creation token: [sprite of kind] -> [set sprite to]
      else if (/^\[?\s*(?:sprite\s*(?:\(img\))?\s*of\s*kind|set\s+sprite\s+to)\s*\]?$/i.test(tokenText)) {
        lookupToken = '[set sprite to]';
      }

      const span = document.createElement('span');
      span.className = 'aifx-rendered'; // Set immediately to prevent re-wrapping
      span.setAttribute('data-token', tokenText);
      span.setAttribute('data-lookup-token', lookupToken);

      const cached = getStaticOrCached(lookupToken) || getStaticOrCached(tokenText);
      if (cached && cached.svg) {
        applySvg(span, cached);
      } else if (tokenToFileMap) {
        const fileKey = tokenToFileMap[lookupToken] || tokenToFileMap[tokenText];
        if (fileKey) {
          fetchCatalogSvg(fileKey).then(data => {
            if (data && data.svg) {
              svgCache.set(lookupToken, data);
              svgCache.set(tokenText, data);
              applySvg(span, data);
            } else {
              requestTokenRender(lookupToken, tokenText, span);
            }
          });
        } else {
          requestTokenRender(lookupToken, tokenText, span);
        }
      } else {
        requestTokenRender(lookupToken, tokenText, span);
      }

      fragment.appendChild(span);
      replaced = true;
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
      healSplitTokens(area);
      const walker = document.createTreeWalker(area, NodeFilter.SHOW_TEXT, {
        acceptNode(n) {
          if (!n || !n.nodeValue) return NodeFilter.FILTER_REJECT;
          if (n.parentElement && (n.parentElement.closest('.aifx-rendered') || n.parentElement.closest('[data-token]'))) {
            return NodeFilter.FILTER_REJECT;
          }
          if (n.nodeValue.includes('[') || n.nodeValue.includes('(') || n.nodeValue.includes('<') || n.nodeValue.includes('▶')) {
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
    applyCacheToPage();
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
    document.addEventListener('DOMContentLoaded', () => setTimeout(scan, 100));
  } else {
    setTimeout(scan, 100);
  }
})();
