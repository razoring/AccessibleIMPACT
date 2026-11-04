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
  let isAifxEnabled = true;

  try {
    const saved = localStorage.getItem('aifx_enabled');
    if (saved !== null) {
      isAifxEnabled = (saved === 'true');
    }
  } catch (e) {}

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
    const charWidth = 9.5;
    const textWidth = Math.max(30, text.length * charWidth);
    const totalWidth = textWidth + 34; // text + arrow + padding
    const height = 30;

    let bg = '#4b7bec'; // default scene blue
    let stroke = '#385cb1';
    let rx = 6;
    let ry = 6;

    if (category === 'statusbars_property' || category === 'statusbars') {
      // Exact dropdown from [statusbar value]: dark slate rectangular button with rounded corners
      bg = '#312f43';
      stroke = '#1f1e2b';
      rx = 4;
      ry = 4;
    } else if (category === 'statusbars_kind') {
      // Exact status bar kind dropdown: purple pill
      bg = '#5d4d8c';
      stroke = '#52447c';
      rx = 15;
      ry = 15;
    } else if (category === 'game') {
      bg = '#8b449b';
      stroke = '#6c3483';
      rx = 6;
      ry = 6;
    } else if (category === 'controller') {
      bg = '#d63031';
      stroke = '#c0392b';
      rx = 6;
      ry = 6;
    } else if (category === 'music') {
      bg = '#e67e22';
      stroke = '#d35400';
      rx = 6;
      ry = 6;
    } else if (category === 'scroller') {
      bg = '#ff85a7';
      stroke = '#bf647d';
      rx = 6;
      ry = 6;
    }

    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${totalWidth} ${height}" width="${totalWidth}" height="${height}">
<style>
.blocklyText { font-family: Consolas, Monaco, Menlo, monospace; font-size: 15px; font-weight: 600; fill: #fff; }
</style>
<g>
  <rect x="1" y="1" width="${totalWidth - 2}" height="${height - 2}" rx="${rx}" ry="${ry}" fill="${bg}" stroke="${stroke}" stroke-width="1.5" />
  <text class="blocklyText" x="10" y="${height / 2 + 1}" dominant-baseline="central" fill="#ffffff">${text}</text>
  <text class="blocklyText" x="${totalWidth - 14}" y="${height / 2 + 1}" dominant-baseline="central" font-size="12" fill="#ffffff">▾</text>
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
    if (!svgStr) return '';
    let s = svgStr;
    if (s.includes('</style>')) {
      s = s.replace('</style>', '.blocklyNumberField text, .blocklyTextInputField text, .blocklyInputField text, .math_number text, .timePicker text { fill: #575e75 !important; }\n</style>');
    }
    if (!params) return s;

    // 1. Variable name replacement & dynamic pill stretch for variables_get
    if (params.varName) {
      const v = escapeXml(params.varName);
      if (s.includes('class="variables_get ') && !s.includes('variables_set')) {
        const charWidth = 9.5;
        const textWidth = Math.max(30, v.length * charWidth);
        const hStretch = Math.round(textWidth + 16);
        const totalWidth = hStretch + 44;

        s = s.replace(/viewBox="0 0 \d+ 40"/, `viewBox="0 0 ${totalWidth} 40"`);
        s = s.replace(/width="\d+"/, `width="${totalWidth}"`);
        s = s.replace(/h\s+74\.375/, `h ${hStretch}`);
        s = s.replace(/h\s+-74\.375/, `h -${hStretch}`);
        s = s.replace(/>mySprite<\/text>/, `>${v}<\/text>`);
        const arrowX = Math.round(textWidth + 18);
        s = s.replace(/transform="translate\([0-9\.]+,3\.5\)"/, `transform="translate(${arrowX},3.5)"`);
        s = s.replace(/width="90\.375"/, `width="${hStretch + 16}"`);
      } else {
        s = s.replace(/>mySprite</g, `>${v}<`);
        s = s.replace(/>projectile</g, `>${v}<`);
        s = s.replace(/>sprite</g, `>${v}<`);
        s = s.replace(/>statusbar</g, `>${v}<`);
        s = s.replace(/>item</g, `>${v}<`);
      }
    }

    // 2. Kind replacement
    if (params.kind1) {
      const k1 = escapeXml(params.kind1);
      s = s.replace(/>Player</, `>${k1}<`);
    }
    if (params.kind2) {
      const k2 = escapeXml(params.kind2);
      s = s.replace(/>Player</, `>${k2}<`);
    }
    if (params.kind) {
      const k = escapeXml(params.kind);
      s = s.replace(/>Player</g, `>${k}<`);
      s = s.replace(/>Health</g, `>${k}<`);
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

    // 7. Re-measure variable dropdown pills after text replacement: a longer var
    //    name must stretch the pill rect, shift the dropdown arrow, the following
    //    label + value child, the parent path runs, and the viewBox together.
    if (params.varName) {
      const charW = 9.5;
      const fieldRe = /<g [^>]*?class="[^"]*blocklyDropdownField[^"]*"[^>]*?transform="translate\(([\d.]+),([\d.]+)\)"[^>]*>((?:.(?!<\/g>))*.)<\/g>/;
      const fm = s.match(fieldRe);
      if (fm) {
        const group = fm[3];
        const rectM = group.match(/<rect[^>]*width="([\d.]+)"/);
        const textM = group.match(/<text[^>]*>([^<]*)<\/text>/);
        if (rectM && textM) {
          const textW = textM[1].length * charW;
          // original proportions: 8 left pad + text + 5 gap + 12 arrow + 8 right pad
          const needed = Math.ceil((8 + textW + 5 + 12 + 8) * 2) / 2;
          const cur = parseFloat(rectM[1]);
          const delta = needed - cur;
          if (delta > 0) {
            // a+b. widen the pill rect and shift the dropdown arrow inside the group
            const newGroup = group
              .replace(/(<rect[^>]*width=")([\d.]+)"/, (m0, a, w) => a + (parseFloat(w) + delta) + '"')
              .replace(/(<image[^>]*transform="translate\()([\d.]+)(,)/, (m0, a, x, c) => a + (parseFloat(x) + delta) + c);
            // c. shift the following label AND the value child (shadow, which
            //    appears earlier in document order) right by delta
            let shifts = 0;
            let after = s.slice(fm.index + fm[0].length).replace(/(<g [^>]*?transform="translate\()([\d.]+)(,)/g, (m0, a, x, c) => {
              if (shifts++ < 1) return a + (parseFloat(x) + delta) + c;
              return m0;
            });
            let head = s.slice(0, fm.index).replace(/(<g [^>]*?blocklyShadow[^>]*?transform="translate\()([\d.]+)(,)/, (m0, a, x, c) => a + (parseFloat(x) + delta) + c);
            s = head + fm[0].replace(group, newGroup) + after;
            // d. widen the main block path's straight runs (first h N / h -N)
            s = s.replace(/h (\d+(?:\.\d+)?) a 4 4/, (m0, num) => 'h ' + (parseFloat(num) + delta) + ' a 4 4');
            s = s.replace(/h -(\d+(?:\.\d+)?)/, (m0, num) => 'h -' + (parseFloat(num) + delta));
            // e. widen viewBox + width
            s = s.replace(/viewBox="0 0 (\d+(?:\.\d+)?) (\d+(?:\.\d+)?)"/, (m0, w, h) => `viewBox="0 0 ${parseFloat(w) + delta} ${h}"`);
            s = s.replace(/width="(\d+(?:\.\d+)?)"/, (m0, w) => `width="${parseFloat(w) + delta}"`);
          }
        }
      }
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

  function getContextCategory(cleanFlat, stepText, overallText) {
    const step = (stepText || '').toLowerCase();
    const overall = (overallText || '').toLowerCase();

    // 1. Status Bar properties: value, max, zero
    if (/^(?:value|max|zero)$/i.test(cleanFlat)) {
      if (/status\s*bar|statusbar/i.test(step)) return 'statusbars_property';
      if (/status\s*bar|statusbar/i.test(overall)) return 'statusbars_property';
      return 'statusbars_property';
    }

    // 2. Status Bar kinds: Health, Hunger, Energy, Magic, Life, Heat, Cold
    if (/^(?:Health|Hunger|Energy|Magic|Life|Heat|Cold)$/i.test(cleanFlat)) {
      if (/status\s*bar|statusbar/i.test(step)) return 'statusbars_kind';
      if (/status\s*bar|statusbar/i.test(overall)) return 'statusbars_kind';
      return 'statusbars_kind';
    }

    // 3. Dialog layouts: bottom, top, center, full screen
    if (/^(?:bottom|top|center|full\s*screen)$/i.test(cleanFlat)) {
      if (/dialog|show\s*long\s*text|splash|text\s*at/i.test(step)) return 'game';
      if (/dialog|show\s*long\s*text|splash/i.test(overall)) return 'game';
      return 'game';
    }

    // 4. Direction properties: left, right, up, down
    if (/^(?:left|right|up|down)$/i.test(cleanFlat)) {
      if (/tile\s*scanner|scanner|scan/i.test(step)) return 'tileScanner';
      if (/controller|button|press/i.test(step)) return 'controller';
      if (/tile\s*scanner|scanner|scan/i.test(overall)) return 'tileScanner';
      return 'scene';
    }

    // 5. Sprite properties: x, y, vx, vy, ax, ay, lifespan
    if (/^(?:x|y|vx|vy|ax|ay|lifespan)$/i.test(cleanFlat)) {
      if (/sprite|velocity|position/i.test(step) || /sprite|velocity|position/i.test(overall)) {
        return 'sprites';
      }
    }

    // 6. Scroller modes: only horizontally, only vertically, both directions
    if (/^(?:only\s*horizontally|only\s*vertically|both\s*directions)$/i.test(cleanFlat)) {
      return 'scroller';
    }

    return null;
  }

  function getActiveCategories(stepText, overallText) {
    const combined = ((stepText || '') + ' ' + (overallText || '')).toLowerCase();
    const active = new Set(['variables', 'common', 'logic', 'loops', 'math']);

    if (/status\s*bars?|statusbar/i.test(combined)) active.add('statusbars');
    if (/scene|tilemap|camera|background/i.test(combined)) active.add('scene');
    if (/sprites?|projectile/i.test(combined)) active.add('sprites');
    if (/controller|button/i.test(combined)) active.add('controller');
    if (/music|sound|melody|tune/i.test(combined)) active.add('music');
    if (/tilemap|\btile\b|\btiles\b|tile\s*util/i.test(combined)) active.add('tileUtil');
    if (/tile\s*scanner|\bscan(ning)?\b|\bdirection\b/i.test(combined)) active.add('tileScanner');
    if (/scroll/i.test(combined)) active.add('scroller');
    if (/multiplayer|mp\.|player\s*[234]/i.test(combined)) active.add('mp');
    if (/animation|animat/i.test(combined)) active.add('animation');
    if (/game|dialog|splash/i.test(combined)) active.add('game');
    if (/info|score|life/i.test(combined)) active.add('info');

    return active;
  }

  // Boolean bubbles (<a and b>, <x = y>, <not z>) are SHORT and verb-free.
  // Instruction statements containing and/or/not must never resolve to logic blocks.
  const LOGIC_VERB_BLACKLIST = /\b(create|destroy|remove|clear|draw|drap|splash|show|play|press|move|place|follow|overlap|on\s+each|on\s+game|on\s+life|on\s+countdown|stay\s+in\s+screen|bounce|of\s+kind|tile|tilemap|camera|screen|volume|sound|melody|effect|image|animat|set\b|change\b|game\s+over|score\b|life\b|countdown)\b/i;

  function isBooleanBubble(cleanFlat) {
    const words = cleanFlat.split(/\s+/).filter(Boolean);
    if (words.length > 3) return false;                 // "a and b" = 3 words max
    if (cleanFlat.length > 45) return false;            // statements are longer
    if (LOGIC_VERB_BLACKLIST.test(cleanFlat)) return false;
    return true;
  }

  function resolveTokenWithNLP(tokenText, stepText, overallText) {
    if (!tokenText) return null;
    let clean = tokenText.trim();
    if ((clean.startsWith('[') && clean.endsWith(']')) ||
        (clean.startsWith('(') && clean.endsWith(')')) ||
        (clean.startsWith('<') && clean.endsWith('>'))) {
      clean = clean.slice(1, -1).trim();
    }
    const cleanFlat = clean.replace(/[\[\]\(\)]/g, ' ').replace(/\s+/g, ' ').trim();

    // Context check 1: Variable references in instructions (e.g. "Click on the (mySprite) variable")
    const esc = cleanFlat.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const varRegex = new RegExp('(?:variable\\s+[\\[\\(]?' + esc + '[\\]\\)]?|[\\[\\(]?' + esc + '[\\]\\)]?\\s+variable)', 'i');
    const isExplicitVariable = varRegex.test(stepText || '');
    const isKnownVarPattern = /^(?:mySprite|customerSprite|burgerMaker|burgerProjectile|customerList|statusbar|item|[a-zA-Z_][a-zA-Z0-9_]*Sprite|[a-zA-Z_][a-zA-Z0-9_]*List)$/i.test(cleanFlat);

    if (isExplicitVariable || (isKnownVarPattern && !cleanFlat.includes(' '))) {
      return {
        rule: { id: 'variables_get', category: 'variables' },
        template: 'variables_get',
        params: { varName: cleanFlat }
      };
    }

    // Contextual property / dropdown check
    const ctxCategory = getContextCategory(cleanFlat, stepText, overallText);
    if (ctxCategory) {
      return {
        rule: { id: 'property_' + ctxCategory, category: ctxCategory },
        template: 'isolated_pill',
        params: { prop: cleanFlat, pillCategory: ctxCategory }
      };
    }

    // Category whitelist: If the instructions do not include a category, the NLP will not choose it!
    const activeCategories = getActiveCategories(stepText, overallText);

    for (const rule of tokenRules) {
      if (rule.category && !activeCategories.has(rule.category)) continue;

      // Strictness gate: and/or/not/compare rules only fire on short, verb-free
      // boolean bubbles — never on multi-item instruction statements.
      if (rule.id === 'logic_operation' || rule.id === 'logic_compare' || rule.id === 'logic_negate') {
        if (!isBooleanBubble(cleanFlat)) continue;
      }

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

      let w = entry.width;
      const wMatch = mutatedSvg.match(/viewBox="0 0 (\d+) (\d+)"/);
      if (wMatch) {
        w = parseInt(wMatch[1], 10);
      }

      return {
        svg: mutatedSvg,
        width: w,
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
      /* Fix number and text input fields blending in with white background */
      .aifx-rendered .blocklyNumberField text,
      .aifx-rendered .blocklyTextInputField text,
      .aifx-rendered .timePicker text,
      .aifx-rendered .math_number text,
      .aifx-rendered .blocklyNumberField .blocklyText,
      .aifx-rendered .blocklyTextInputField .blocklyText,
      .aifx-rendered .timePicker .blocklyText,
      .aifx-rendered .math_number .blocklyText,
      .aifx-rendered g[class*="math_number"] text,
      .aifx-rendered g[class*="timePicker"] text,
      .aifx-rendered g[class*="blocklyNumberField"] text,
      .aifx-rendered g[class*="blocklyTextInputField"] text {
        fill: #575e75 !important;
      }

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
        display: inline-flex !important;
        vertical-align: middle !important;
        align-items: center !important;
        justify-content: center !important;
        margin: 0 4px !important;
        position: relative !important;
        top: -1.5px !important;
        line-height: 1 !important;
      }
      .aifx-rendered.aifx-play-icon svg {
        display: block !important;
        width: 1.25em !important;
        height: 1.25em !important;
        max-width: none !important;
        filter: drop-shadow(0 1px 2px rgba(0,0,0,0.2)) !important;
        transition: transform 0.15s ease !important;
      }
      .aifx-rendered.aifx-play-icon:hover svg {
        transform: scale(1.12) !important;
        position: relative !important;
        z-index: 10 !important;
      }
      strong:has(> .aifx-rendered.aifx-multiline),
      em:has(> .aifx-rendered.aifx-multiline),
      p:has(> strong > .aifx-rendered.aifx-multiline),
      p:has(> .aifx-rendered.aifx-multiline) {
        display: block !important;
        max-width: 100% !important;
      }
      .aifx-rendered.aifx-multiline {
        display: block !important;
        max-width: 100% !important;
        overflow-x: hidden !important;
        overflow-y: hidden !important;
        margin: 12px 0 !important;
        padding-bottom: 2px !important;
        clear: both !important;
        text-align: left !important;
        line-height: normal !important;
        box-sizing: border-box !important;
      }
      .aifx-disabled .aifx-rendered,
      .aifx-disabled .aifx-rendered.aifx-multiline,
      .aifx-disabled .aifx-rendered.aifx-inline,
      .aifx-disabled .aifx-rendered.aifx-play-icon {
        display: none !important;
      }
      .aifx-disabled strong:has(> .aifx-rendered.aifx-multiline),
      .aifx-disabled em:has(> .aifx-rendered.aifx-multiline),
      .aifx-disabled p:has(> strong > .aifx-rendered.aifx-multiline),
      .aifx-disabled p:has(> .aifx-rendered.aifx-multiline) {
        display: inline !important;
        max-width: none !important;
      }
      .aifx-raw-fallback {
        display: none !important;
      }
      .aifx-disabled .aifx-raw-fallback {
        display: inline !important;
      }
      .aifx-rendered.aifx-multiline svg {
        display: block !important;
        width: auto !important;
        max-width: 100% !important;
        height: auto !important;
        filter: drop-shadow(0 2px 4px rgba(0,0,0,0.2)) !important;
        transition: transform 0.15s ease !important;
      }
      .aifx-rendered.aifx-multiline:hover svg {
        transform: scale(1.02) !important;
        position: relative !important;
        z-index: 10 !important;
      }
      .mode-aifx-toggle {
        display: flex !important;
        align-items: center !important;
        justify-content: center !important;
        margin-right: 3px !important;
        cursor: pointer !important;
      }
      .mode-aifx-toggle span {
        display: flex !important;
        align-items: center !important;
        justify-content: center !important;
        width: 34px !important;
        height: 34px !important;
        background-color: #4b7bec !important;
        border-radius: 4px !important;
        box-shadow: 0 1px 2px rgba(0,0,0,0.15) !important;
        transition: opacity 0.2s ease, filter 0.2s ease !important;
      }
      .mode-aifx-toggle.aifx-off span {
        background-color: #8892b0 !important;
        opacity: 0.6 !important;
      }
      .mode-aifx-toggle:hover span {
        filter: brightness(1.1) !important;
      }
      .header {
        margin-bottom: 16px !important;
      }
      .step {
        font-size: 21px !important;
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
    const isStatementBlock = data.svg && (data.svg.includes('class="variables_set') || data.svg.includes('gameinterval') || data.svg.includes('statusbars_create') || data.svg.includes('StatusBarSprite_blockCombine_set')) && !data.svg.includes('class="variables_get');
    const isMultiLine = !isPlayIcon && (data.isMultiLine || data.height > 70 || data.width > 260 || isStatementBlock);
    span.className = 'aifx-rendered ' + (isPlayIcon ? 'aifx-play-icon' : (isMultiLine ? 'aifx-multiline' : 'aifx-inline'));
    span.innerHTML = data.svg;
    span.setAttribute('data-rendered', 'true');

    const svgEl = span.querySelector('svg');
    if (svgEl) {
      if (isPlayIcon) {
        svgEl.style.display = 'inline-block';
        svgEl.style.verticalAlign = 'middle';
        svgEl.style.setProperty('width', '1.25em', 'important');
        svgEl.style.setProperty('height', '1.25em', 'important');
      } else if (isMultiLine) {
        svgEl.style.display = 'block';
        // Benchmark: scale factor 2.25 / 44 matches regular text size (~13-14px visual font)
        let emScale = 2.25 / 44;
        if ((data.height || 0) <= 60 && (data.width || 0) > 300) {
          emScale = 2.25 / data.height;
        }
        const naturalEmWidth = ((data.width || 100) * emScale).toFixed(3);
        svgEl.style.setProperty('width', `${naturalEmWidth}em`, 'important');
        svgEl.style.setProperty('max-width', '100%', 'important');
        svgEl.style.setProperty('height', 'auto', 'important');
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
      } else {
        // Live renderer first; NLP is only a fallback inside requestTokenRender
        requestTokenRender(tokenText, tokenText, span);
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
            // Renderer definitively failed — try the NLP fallback (token_map rules
            // + static catalog templates) before leaving the token as plain text.
            let nlpApplied = false;
            for (const s of waiters) {
              if (s && s.isConnected && !s.getAttribute('data-rendered')) {
                if (!nlpApplied && catalogMap && tokenRules.length > 0) {
                  nlpApplied = true;
                  const stepArea = s.closest('app-step-information, [data-instruction], article, .lesson-content') || document.body;
                  const stepText = (stepArea ? stepArea.textContent : '').toLowerCase();
                  const overallText = (document.body ? document.body.textContent : '').toLowerCase();
                  const resolution = resolveTokenWithNLP(tokenText, stepText, overallText);
                  if (resolution) {
                    fetchAndRenderResolvedToken(resolution, tokenText).then(data => {
                      if (data && data.svg) {
                        svgCache.set(tokenText, data);
                        applyTokenToPage(tokenText, data);
                        if (tokenText !== lookupToken) applyTokenToPage(lookupToken, data);
                      } else {
                        s.textContent = s.getAttribute('data-token') || tokenText;
                      }
                    }).catch(() => {
                      s.textContent = s.getAttribute('data-token') || tokenText;
                    });
                    continue;
                  }
                }
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
        const sub = text.slice(i);
        const compMatch = sub.match(/^\(?\s*\(\s*([a-zA-Z0-9_]+)\s*\)\s*\[\s*([a-zA-Z0-9_]+)\s*\]\s*\)?/);
        if (compMatch) {
          pushToken(i, i + compMatch[0].length);
          i += compMatch[0].length;
          continue;
        }

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
    if (node.parentElement && (node.parentElement.closest('.aifx-rendered') || node.parentElement.closest('.aifx-raw-fallback') || node.parentElement.closest('[data-token]'))) return;

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
      const overallText = (document.body ? document.body.textContent : '').toLowerCase();

      const span = document.createElement('span');
      span.className = 'aifx-rendered';
      span.setAttribute('data-token', tokenText);

      const fallback = document.createElement('span');
      fallback.className = 'aifx-raw-fallback';
      fallback.textContent = tokenText;

      const cached = getStaticOrCached(tokenText);
      if (cached && cached.svg) {
        applySvg(span, cached);
      } else {
        // Live renderer first; NLP is only a fallback inside requestTokenRender
        // when the renderer definitively fails (e.g. block type unavailable).
        requestTokenRender(tokenText, tokenText, span);
      }

      fragment.appendChild(span);
      fragment.appendChild(fallback);
      replaced = true;
    }

    if (replaced && parent.contains(node)) {
      parent.replaceChild(fragment, node);
    }
  }

  // Window event bridge for programmatic block extraction & diagnostics
  window.addEventListener('AIFX_EXTRACT_BLOCK', (e) => {
    const token = e.detail && e.detail.token;
    if (!token) return;
    chrome.runtime.sendMessage({ action: 'renderToken', token: token }, (res) => {
      window.postMessage({ action: 'AIFX_EXTRACT_RESULT', result: res }, '*');
    });
  });

  function updateAifxStateClass() {
    if (isAifxEnabled) {
      document.documentElement.classList.remove('aifx-disabled');
    } else {
      document.documentElement.classList.add('aifx-disabled');
    }
  }

  function ensureToggleButton() {
    updateAifxStateClass();
    const cta = document.querySelector('.header-cta');
    if (!cta) return;
    if (document.getElementById('aifx-toggle-container')) return;

    const btn = document.createElement('div');
    btn.id = 'aifx-toggle-container';
    btn.className = 'mode-aifx-toggle' + (isAifxEnabled ? '' : ' aifx-off');
    btn.setAttribute('title', isAifxEnabled ? 'Disable block graphics' : 'Enable block graphics');
    btn.innerHTML = `
      <span>
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="#ffffff" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="16 18 22 12 16 6"></polyline>
          <polyline points="8 6 2 12 8 18"></polyline>
        </svg>
      </span>
    `;

    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      e.preventDefault();
      isAifxEnabled = !isAifxEnabled;
      try {
        localStorage.setItem('aifx_enabled', String(isAifxEnabled));
      } catch (err) {}

      updateAifxStateClass();

      if (isAifxEnabled) {
        btn.classList.remove('aifx-off');
        btn.setAttribute('title', 'Disable block graphics');
      } else {
        btn.classList.add('aifx-off');
        btn.setAttribute('title', 'Enable block graphics');
      }
    });

    cta.insertBefore(btn, cta.firstChild);
  }

  function scan() {
    injectStyles();
    ensureToggleButton();
    // Strictly query content containers only
    const areas = document.querySelectorAll('app-step-information content, [data-instruction], article, .lesson-content');
    for (const area of areas) {
      healSplitTokens(area);
      const walker = document.createTreeWalker(area, NodeFilter.SHOW_TEXT, {
        acceptNode(n) {
          if (!n || !n.nodeValue) return NodeFilter.FILTER_REJECT;
          if (n.parentElement && (n.parentElement.closest('.aifx-rendered') || n.parentElement.closest('.aifx-raw-fallback') || n.parentElement.closest('[data-token]'))) {
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
