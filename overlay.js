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
  let tokenRules = [];

  function escapeXml(str) {
    if (typeof str !== 'string') str = String(str);
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function generateIsolatedPropertyPill(propText, category) {
    const text = (propText || '').replace(/[\[\]\(\)]/g, '').trim();
    const charWidth = 9;
    const textWidth = Math.max(30, text.length * charWidth);
    const totalWidth = textWidth + 34; // text + arrow + padding
    const height = 30;

    let bg = '#4b7bec'; // default scene blue
    let stroke = '#385cb1';
    if (category === 'game') {
      bg = '#8b449b'; stroke = '#6c3483';
    } else if (category === 'controller') {
      bg = '#d63031'; stroke = '#c0392b';
    } else if (category === 'statusbars') {
      bg = '#20bf6b'; stroke = '#0fb9b1';
    } else if (category === 'music') {
      bg = '#e67e22'; stroke = '#d35400';
    }

    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${totalWidth} ${height}" width="${totalWidth}" height="${height}">
<style>
.blocklyText { font-family: Consolas, Monaco, Menlo, monospace; font-size: 15px; font-weight: 600; fill: #fff; }
</style>
<g>
  <rect x="1" y="1" width="${totalWidth - 2}" height="${height - 2}" rx="6" ry="6" fill="${bg}" stroke="${stroke}" stroke-width="1.5" />
  <text class="blocklyText" x="10" y="${height / 2 + 1}" dominant-baseline="central">${text}</text>
  <text class="blocklyText" x="${totalWidth - 16}" y="${height / 2 + 1}" dominant-baseline="central" font-size="12">▾</text>
</g>
</svg>`;

    return {
      svg,
      width: totalWidth,
      height: height,
      category: category || 'property'
    };
  }

  function mutateSvgWithParams(svgStr, params) {
    if (!svgStr || !params) return svgStr;
    let s = svgStr;

    // 1. Variable name replacement
    if (params.varName) {
      const v = escapeXml(params.varName);
      s = s.replace(/>mySprite</g, `>${v}<`);
      s = s.replace(/>projectile</g, `>${v}<`);
      s = s.replace(/>sprite</g, `>${v}<`);
    }

    // 2. Kind replacement
    if (params.kind) {
      const k = escapeXml(params.kind);
      s = s.replace(/>Player</g, `>${k}<`);
    }

    // 3. Button replacement
    if (params.button) {
      const b = escapeXml(params.button);
      s = s.replace(/>A</g, `>${b}<`);
    }

    // 4. Property replacement
    if (params.prop) {
      const p = escapeXml(params.prop);
      s = s.replace(/>x</g, `>${p}<`);
      s = s.replace(/>value</g, `>${p}<`);
    }

    // 5. Operator replacement (math & logic)
    if (params.op) {
      const safeOp = escapeXml(params.op);
      s = s.replace(/>=<\/text>/g, `>${safeOp}</text>`);
      s = s.replace(/>&lt;<\/text>/g, `>${safeOp}</text>`);
      s = s.replace(/>‏&lt;<\/text>/g, `>${safeOp}</text>`);
      s = s.replace(/>&gt;<\/text>/g, `>${safeOp}</text>`);
      s = s.replace(/>\+<\/text>/g, `>${safeOp}</text>`);
    }

    // 6. Values & Operands
    if (params.left !== undefined) {
      const l = escapeXml(params.left);
      s = s.replace(/>0<\/text>/, `>${l}</text>`);
    }
    if (params.right !== undefined) {
      const r = escapeXml(params.right);
      s = s.replace(/>0<\/text>/, `>${r}</text>`);
    }
    if (params.val !== undefined) {
      const val = escapeXml(params.val);
      s = s.replace(/>0<\/text>/, `>${val}</text>`);
    }
    if (params.x !== undefined) {
      const x = escapeXml(params.x);
      s = s.replace(/>0<\/text>/, `>${x}</text>`);
    }
    if (params.y !== undefined) {
      const y = escapeXml(params.y);
      s = s.replace(/>0<\/text>/, `>${y}</text>`);
    }
    if (params.vx !== undefined) {
      const vx = escapeXml(params.vx);
      s = s.replace(/>0<\/text>/, `>${vx}</text>`);
    }
    if (params.vy !== undefined) {
      const vy = escapeXml(params.vy);
      s = s.replace(/>0<\/text>/, `>${vy}</text>`);
    }

    return s;
  }

  async function loadCatalog() {
    try {
      if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.getURL) {
        const [catRes, mapRes] = await Promise.all([
          fetch(chrome.runtime.getURL('catalog/catalog.json')),
          fetch(chrome.runtime.getURL('catalog/token_map.json'))
        ]);
        catalogMap = await catRes.json();
        const mapData = await mapRes.json();
        if (mapData && Array.isArray(mapData.rules)) {
          tokenRules = mapData.rules.map(r => ({
            ...r,
            regex: new RegExp(r.pattern, 'i')
          }));
        }
        scan();
      }
    } catch (e) {
      console.warn('[AIFX] Error loading catalog:', e);
    }
  }
  loadCatalog();

  function resolveTokenWithNLP(tokenText, stepText) {
    if (!tokenText) return null;
    let clean = tokenText.trim();
    if ((clean.startsWith('[') && clean.endsWith(']')) ||
        (clean.startsWith('(') && clean.endsWith(')')) ||
        (clean.startsWith('<') && clean.endsWith('>'))) {
      clean = clean.slice(1, -1).trim();
    }
    const cleanFlat = clean.replace(/[\[\]\(\)]/g, ' ').replace(/\s+/g, ' ').trim();

    // Context disambiguation for multiplayer
    const isMultiplayer = /multiplayer|player\s*[234]|mp\./i.test(stepText || '');

    for (const rule of tokenRules) {
      if (rule.category === 'mp' && !isMultiplayer) continue;

      const m = cleanFlat.match(rule.regex) || clean.match(rule.regex);
      if (m) {
        const params = {};
        if (rule.params) {
          for (const [pName, grpIdx] of Object.entries(rule.params)) {
            if (typeof grpIdx === 'number' && m[grpIdx] !== undefined) {
              params[pName] = m[grpIdx];
            } else if (typeof grpIdx === 'string') {
              params[pName] = grpIdx;
            }
          }
        }

        // Contextual NLP assistance for missing parameters
        if (rule.category === 'sprites' && rule.blockType === 'variables_set') {
          if (!params.varName) {
            const varM = (stepText || '').match(/(?:variable|add a|create a|sprite named|named|called)\s+['"\[]?([a-zA-Z0-9_]+)['"\]]?/i);
            if (varM && !['sprite', 'the', 'a', 'an', 'new', 'block'].includes(varM[1].toLowerCase())) {
              params.varName = varM[1];
            } else {
              params.varName = 'mySprite';
            }
          }
          if (!params.kind) {
            const kindM = (stepText || '').match(/kind\s+['"\[]?([a-zA-Z0-9_]+)['"\]]?/i);
            params.kind = kindM ? kindM[1] : 'Player';
          }
        }

        if (rule.id === 'controller_on_button_pressed' || rule.id === 'controller_is_button_pressed') {
          if (!params.button) {
            const btnM = (stepText || '').match(/(?:button|press)\s+['"\[]?([AB]|up|down|left|right)['"\]]?/i);
            params.button = btnM ? btnM[1].toUpperCase() : 'A';
          }
        }

        return {
          rule,
          template: rule.template,
          params
        };
      }
    }

    return null;
  }

  async function fetchAndRenderResolvedToken(resolution, tokenText) {
    if (!resolution) return null;
    if (resolution.template === 'isolated_pill') {
      const prop = (resolution.params && resolution.params.prop !== undefined) ? resolution.params.prop : tokenText;
      const cat = (resolution.params && resolution.params.pillCategory) || resolution.rule.category;
      return generateIsolatedPropertyPill(prop, cat);
    }

    if (!catalogMap || !resolution.template) return null;
    const entry = catalogMap[resolution.template];
    if (!entry) return null;

    try {
      const url = chrome.runtime.getURL('catalog/' + entry.file);
      const res = await fetch(url);
      const rawSvg = await res.text();
      const mutatedSvg = mutateSvgWithParams(rawSvg, resolution.params);

      return {
        svg: mutatedSvg,
        width: entry.width,
        height: entry.height,
        category: entry.type
      };
    } catch (e) {
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

  // svgCache holds in-memory rendered SVGs for instant reuse across steps
  try {
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      // Clear legacy storage cache so stale extractions never override dynamic NLP engine
      chrome.storage.local.clear();
    }
  } catch (e) {}

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
      const tokenText = span.getAttribute('data-token') || span.textContent || '';
      const cached = getStaticOrCached(tokenText);
      if (cached && cached.svg) {
        applySvg(span, cached);
      } else if (catalogMap && tokenRules.length > 0) {
        const stepArea = span.closest('app-step-information, [data-instruction], article, .lesson-content') || document.body;
        const stepText = (stepArea ? stepArea.textContent : '').toLowerCase();
        const resolution = resolveTokenWithNLP(tokenText, stepText);
        if (resolution) {
          fetchAndRenderResolvedToken(resolution, tokenText).then(data => {
            if (data && data.svg) {
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
      const stepArea = parent.closest('app-step-information, [data-instruction], article, .lesson-content') || document.body;
      const stepText = (stepArea ? stepArea.textContent : '').toLowerCase();

      const span = document.createElement('span');
      span.className = 'aifx-rendered'; // Set immediately to prevent re-wrapping
      span.setAttribute('data-token', tokenText);

      const cached = getStaticOrCached(tokenText);
      if (cached && cached.svg) {
        applySvg(span, cached);
      } else if (catalogMap && tokenRules.length > 0) {
        const resolution = resolveTokenWithNLP(tokenText, stepText);
        if (resolution) {
          fetchAndRenderResolvedToken(resolution, tokenText).then(data => {
            if (data && data.svg) {
              svgCache.set(tokenText, data);
              applySvg(span, data);
            } else {
              requestTokenRender(tokenText, tokenText, span);
            }
          });
        } else {
          requestTokenRender(tokenText, tokenText, span);
        }
      } else {
        requestTokenRender(tokenText, tokenText, span);
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
