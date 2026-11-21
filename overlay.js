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

  function shouldSkipToken(fullText, start, end) {
    const raw = fullText.slice(start, end);
    if (raw === '▶') return false;
    const ch = raw[0];
    const inner = raw.slice(1, -1).trim();
    const prefix = fullText.slice(0, start);
    const suffix = fullText.slice(end);

    // 1. Empty () or [] (keep <> and < > for empty boolean slot)
    if ((ch === '(' || ch === '[') && inner === '') return true;

    // 2. Function/method call or array indexing in JS: fn(x), obj.method(x), a(n), arr[i]
    if ((ch === '(' || ch === '[') && /[a-zA-Z0-9_.$]$/.test(prefix)) return true;

    // 3. JS control-flow headers: if (...) { / while (...) { / function (...) { / else if (...)
    if (ch === '(' && (/^\s*\{/.test(suffix) || /\b(?:if|else\s+if|while|for|switch|function|catch)\s*$/.test(prefix))) return true;

    // 4. JS expressions / parameter doc lists inside token
    if (/===|!==|==|!=|&&|\|\||;|[{}]|\bfunction\s*\(|\blet\b|\bconst\b/.test(inner)) return true;
    if (ch === '(' && /^[a-zA-Z_]\w*\s*(?:,\s*[a-zA-Z_]\w*\s*)+$/.test(inner)) return true;
    if (ch === '(' && /\.[a-zA-Z_]\w*\s*\(/.test(inner)) return true;
    if (ch === '(' && /^\d+\s*-\s*[a-z]+[A-Z][a-zA-Z0-9]*$/.test(inner)) return true;

    // 5. Keyboard shortcuts: (Ctrl + C), (Ctrl + V), (Ctrl + X)
    if (/^Ctrl\s*\+\s*[A-Za-z]$/i.test(inner)) return true;

    // 6. Numeric coordinate ranges: (0-160), (0-120). `(0-0)` is the math subtraction placeholder, not a range.
    if (ch === '(' && /^\d+-\d+$/.test(inner) && !/^0-0$/.test(inner)) return true;

    // 7. Prose operator explanations: "greater than (>)", "less than (<)", "equal to (=)"
    if (ch === '(' && /^(?:>|<|=|>=|<=|≥|≤|\+|-|\*)$/.test(inner)) {
      if (/\b(?:than|equal\s+to|equals|operator|sign|symbol|plus|minus|addition|subtraction|multiplication|asterisk)\s*$/i.test(prefix)) {
        return true;
      }
    }

    // 8. Known English parenthetical clarifications in prose
    if (ch === '(' && /^(?:frog|cake|shark|octopus|starfish|uppercase|lowercase|second|first|third|ms|s|n|human|computer|optional|default|by pressing the A button|using the columns and rows)$/i.test(inner)) {
      return true;
    }

    return false;
  }

  function healSplitTokens(area) {
    if (!area) return;
    const targets = area.querySelectorAll('p, div, li');
    const list = targets.length ? Array.from(targets) : [area];
    for (const el of list) {
      const old = el.innerHTML;
      if (!old || (!old.includes('<strong') && !old.includes('&lt;') && !old.includes('<span') && !old.includes('<'))) continue;
      const fixed = old
        // Author typo: unclosed outer bracket before a nested pill, e.g. "[set sprite [ay (acceleration y)] block" -> close it.
        .replace(/\[(set\s+sprite\s+)(\[[^\[\]]+\])(?![^\[\]]*\])/gi, '[$1$2]')
        .replace(/<strong[^>]*>(?:&lt;|<)<\/strong>([a-zA-Z0-9_\s%<>=≤≥]+)<strong[^>]*>(?:&gt;|>)<\/strong>/gi, (m, g1) => '&lt;' + g1.trim() + '&gt;')
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

    // Balanced DOM text-node pass: heals nested tokens split across <span>, <strong>, <em>, etc.
    for (const blockEl of area.querySelectorAll('p, li')) {
      for (let pass = 0; pass < 6; pass++) {
        const walker = document.createTreeWalker(blockEl, NodeFilter.SHOW_TEXT, {
          acceptNode(n) {
            if (!n || !n.nodeValue) return NodeFilter.FILTER_REJECT;
            if (n.parentElement && n.parentElement.closest('.aifx-rendered, .aifx-raw-fallback, [data-token], code, pre, .ql-font-monospace')) {
              return NodeFilter.FILTER_REJECT;
            }
            return NodeFilter.FILTER_ACCEPT;
          }
        });
        const nodes = [];
        while (walker.nextNode()) nodes.push(walker.currentNode);
        if (nodes.length < 2) break;

        let full = '';
        const spans = [];
        for (const n of nodes) {
          const start = full.length;
          full += n.nodeValue;
          spans.push({ node: n, start, end: full.length });
        }

        let mergedThisPass = false;
        let i = 0;
        while (i < full.length) {
          const ch = full[i];
          let tokenEnd = null;
          if (ch === '[' || ch === '(') {
            const closeCh = ch === '[' ? ']' : ')';
            let depth = 0;
            let j = i;
            while (j < full.length) {
              if (full[j] === '\n' || full[j] === '\r') break;
              if (full[j] === ch) depth++;
              else if (full[j] === closeCh) {
                depth--;
                if (depth === 0) { tokenEnd = j + 1; break; }
              }
              j++;
            }
          } else if (ch === '<') {
            tokenEnd = matchAngleBlock(full, i);
          }

          if (tokenEnd && tokenEnd > i) {
            const startIdx = spans.findIndex(s => i >= s.start && i < s.end);
            const endIdx = spans.findIndex(s => (tokenEnd - 1) >= s.start && (tokenEnd - 1) < s.end);
            if (startIdx !== -1 && endIdx > startIdx && !shouldSkipToken(full, i, tokenEnd)) {
              const tok = full.slice(i, tokenEnd);
              const firstSpan = spans[startIdx];
              const keepPrefix = firstSpan.node.nodeValue.slice(0, i - firstSpan.start);
              let rem = tok.slice(firstSpan.end - i);
              firstSpan.node.nodeValue = keepPrefix + tok;
              for (let k = startIdx + 1; k <= endIdx; k++) {
                const sp = spans[k];
                const len = sp.node.nodeValue.length;
                if (rem.length >= len) {
                  rem = rem.slice(len);
                  sp.node.nodeValue = '';
                } else {
                  sp.node.nodeValue = sp.node.nodeValue.slice(rem.length);
                  rem = '';
                }
              }
              mergedThisPass = true;
              break;
            }
            i = tokenEnd;
          } else {
            i++;
          }
        }
        if (!mergedThisPass) break;
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

  function renderToggleToken(rawText) {
    const isWin = /win/i.test(rawText);
    const isLose = /lose/i.test(rawText);
    const isOn = /on/i.test(rawText);

    let label = 'OFF';
    let isRight = false;
    let thumbFill = '#879599';
    let thumbStroke = '#636e72';

    if (isOn) {
      label = 'ON';
      isRight = true;
      thumbFill = '#2ecc71';
      thumbStroke = '#27ae60';
    } else if (isWin) {
      label = 'WIN';
      isRight = true;
      thumbFill = '#2ecc71';
      thumbStroke = '#27ae60';
    } else if (isLose) {
      label = 'LOSE';
      isRight = false;
      thumbFill = '#e74c3c';
      thumbStroke = '#c0392b';
    }

    const tx = isRight ? 34 : 0;
    const textX = isRight ? 51 : 17;

    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 108 32" width="108" height="32"><path class="blocklyPath" stroke="#413663" fill="#52447c" stroke-width="1" d="m 16,0 h 76 l 16,16 l -16,16 V 32 h -76 l -16,-16 l 16,-16 z" /><g transform="translate(20, 16)"><g class="blocklyToggle ${isRight ? 'blocklyToggleOn' : 'blocklyToggleOff'}" transform="translate(${tx}, 0)"><polygon class="blocklyToggleRect" points="0,-14 -14,0 0,14 34,14 48,0 34,-14" fill="${thumbFill}" stroke="${thumbStroke}" stroke-width="1.5" /></g><text class="blocklyText blocklyToggleText" x="${textX}" y="0" fill="#ffffff" font-family="Consolas, Monaco, Menlo, 'Ubuntu Mono', monospace" font-size="16px" font-weight="700" text-anchor="middle" dominant-baseline="central">${label}</text></g></svg>`;

    return {
      svg: svg,
      width: 108,
      height: 32,
      category: 'game',
      isMultiLine: false
    };
  }

  function generateVariableReporterBubble(varName, bg = '#ec3b59', stroke = '#b12c43') {
    const label = (varName || '').replace(/[\[\]\(\)]/g, '').trim();
    const textWidth = Math.ceil(label.length * 9.6);
    const totalWidth = Math.max(48, textWidth + 24);
    const height = 32;
    const r = (height - 1) / 2;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${totalWidth} ${height}" width="${totalWidth}" height="${height}"><rect x="0.5" y="0.5" width="${totalWidth - 1}" height="${height - 1}" rx="${r}" ry="${r}" fill="${bg}" stroke="${stroke}" stroke-width="1.5"/><text x="${totalWidth / 2}" y="${height / 2}" style="font-family:Consolas,Monaco,Menlo,monospace !important;font-size:16px !important;font-weight:600 !important;fill:#ffffff !important;stroke:none !important;text-anchor:middle !important;dominant-baseline:central !important;">${escapeXml(label)}</text></svg>`;
    return { svg, width: totalWidth, height, category: 'variables', isMultiLine: false };
  }

  // Hexagonal Boolean reporter, e.g. <isBeeDizzy>
  function generateBooleanReporterBubble(varName) {
    const label = (varName || '').replace(/[<>\[\]\(\)]/g, '').trim();
    const textWidth = Math.ceil(label.length * 9.6);
    const height = 32;
    const half = height / 2;
    const totalWidth = Math.max(60, textWidth + 24 + height);
    const pts = `${half},1 ${totalWidth - half},1 ${totalWidth - 1},${half} ${totalWidth - half},${height - 1} ${half},${height - 1} 1,${half}`;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${totalWidth} ${height}" width="${totalWidth}" height="${height}"><polygon points="${pts}" fill="#ec3b59" stroke="#b12c43" stroke-width="1.5"/><text x="${totalWidth / 2}" y="${height / 2}" style="font-family:Consolas,Monaco,Menlo,monospace !important;font-size:16px !important;font-weight:600 !important;fill:#ffffff !important;stroke:none !important;text-anchor:middle !important;dominant-baseline:central !important;">${escapeXml(label)}</text></svg>`;
    return { svg, width: totalWidth, height, category: 'variables', isMultiLine: false };
  }

  function generateMutatorButtonSvg(sign) {
    const isPlus = sign === '+';
    const d = isPlus
      ? '<rect x="12" y="7" width="4" height="14" rx="1" fill="#ffffff"/><rect x="7" y="12" width="14" height="4" rx="1" fill="#ffffff"/>'
      : '<rect x="7" y="12" width="14" height="4" rx="1" fill="#ffffff"/>';
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 28 28" width="28" height="28"><circle cx="14" cy="14" r="11" fill="#3455db" stroke="#ffffff" stroke-width="2"/>${d}</svg>`;
    return { svg, width: 28, height: 28, category: 'common', isMultiLine: false };
  }

  function generateEmptyBooleanSlotSvg() {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 52 30" width="52" height="30"><polygon points="2,15 15,2 37,2 50,15 37,28 15,28" fill="#3480b6" stroke="#296691" stroke-width="1.5"/></svg>`;
    return { svg, width: 52, height: 30, category: 'logic', isMultiLine: false };
  }

  function generateSectionLabelPill(label) {
    const w = Math.max(54, Math.ceil(label.length * 9.6 + 22));
    const h = 30;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}"><rect x="1" y="1" width="${w - 2}" height="${h - 2}" rx="6" ry="6" fill="#45aaf2" stroke="#3480b6" stroke-width="1.5"/><text x="${w / 2}" y="${h / 2}" style="font-family:Consolas,Monaco,Menlo,monospace !important;font-size:15px !important;font-weight:700 !important;fill:#ffffff !important;stroke:none !important;text-anchor:middle !important;dominant-baseline:central !important;">${escapeXml(label)}</text></svg>`;
    return { svg, width: w, height: h, category: 'logic', isMultiLine: false };
  }

  function generateUiButtonSvg(label, bg = '#2c5aa0', stroke = '#1c3b6e') {
    const w = Math.max(120, Math.ceil(label.length * 9.6 + 32));
    const h = 34;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}"><rect x="1" y="1" width="${w - 2}" height="${h - 2}" rx="6" ry="6" fill="${bg}" stroke="${stroke}" stroke-width="1.5"/><text x="${w / 2}" y="${h / 2}" style="font-family:'Segoe UI',Roboto,Helvetica,Arial,sans-serif !important;font-size:15px !important;font-weight:700 !important;fill:#ffffff !important;stroke:none !important;text-anchor:middle !important;dominant-baseline:central !important;">${escapeXml(label)}</text></svg>`;
    return { svg, width: w, height: h, category: 'ui', isMultiLine: false };
  }

  function generateIsolatedPropertyPill(propText, category) {
    let text = (propText || '').trim();
    while (
      (text.startsWith('[') && text.endsWith(']')) ||
      (text.startsWith('(') && text.endsWith(')')) ||
      (text.startsWith('<') && text.endsWith('>'))
    ) {
      text = text.slice(1, -1).trim();
    }
    // Variable dropdown pills mirror the catalog `variables_get` capsule (40px pill in a 44px viewBox)
    // so [mySprite], [text list] and [userResponseList] share one height, radius and arrow style.
    if (category === 'variables') {
      const tW = Math.ceil(text.length * 9.6);
      const pw = tW + 46;
      const vw = pw + 4;
      const arrowX = 2 + pw - 24;
      const vsvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${vw} 44" width="${vw}" height="44"><rect x="2" y="2" width="${pw}" height="40" rx="20" ry="20" fill="#ec3b59" stroke="#b12c43" stroke-width="1"/><text class="blocklyText" x="14" y="22" style="font-family:Consolas,Monaco,Menlo,monospace !important;font-size:16px !important;font-weight:600 !important;fill:#ffffff !important;stroke:none !important;text-anchor:start !important;dominant-baseline:central !important;">${escapeXml(text)}</text><polygon points="${arrowX},19 ${arrowX + 12},19 ${arrowX + 6},26" fill="#ffffff"/></svg>`;
      return { svg: vsvg, width: vw, height: 44, category: 'variables', isMultiLine: false };
    }

    const charWidth = 9.6;
    const textWidth = Math.max(24, text.length * charWidth);
    const totalWidth = Math.ceil(textWidth + 34); // text + arrow + padding
    const height = 30;

    let bg = '#4b7bec'; // default sprites/scene blue
    let stroke = '#385cb1';
    let rx = 6;
    let ry = 6;

    if (category === 'statusbars_property' || category === 'statusbars') {
      bg = '#312f43';
      stroke = '#1f1e2b';
      rx = 4;
      ry = 4;
    } else if (category === 'statusbars_kind') {
      bg = '#5d4d8c';
      stroke = '#52447c';
      rx = 15;
      ry = 15;
    } else if (category === 'variables') {
      bg = '#ec3b59';
      stroke = '#b12c43';
      rx = 6;
      ry = 6;
    } else if (category === 'logic') {
      bg = '#45aaf2';
      stroke = '#3480b6';
      rx = 6;
      ry = 6;
    } else if (category === 'scene') {
      bg = '#4b6584';
      stroke = '#384c63';
      rx = 6;
      ry = 6;
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
      bg = '#e30fc0';
      stroke = '#aa0b90';
      rx = 6;
      ry = 6;
    } else if (category === 'scroller') {
      bg = '#ff85a7';
      stroke = '#bf647d';
      rx = 6;
      ry = 6;
    }

    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${totalWidth} ${height}" width="${totalWidth}" height="${height}">
<g>
  <rect x="1" y="1" width="${totalWidth - 2}" height="${height - 2}" rx="${rx}" ry="${ry}" fill="${bg}" stroke="${stroke}" stroke-width="1.5" />
  <text class="blocklyText" x="10" y="${height / 2}" style="font-family:Consolas,Monaco,Menlo,monospace !important;font-size:15px !important;font-weight:600 !important;fill:#ffffff !important;stroke:none !important;text-anchor:start !important;dominant-baseline:central !important;">${escapeXml(text)}</text>
  <text class="blocklyText" x="${totalWidth - 14}" y="${height / 2}" style="font-family:Consolas,Monaco,Menlo,monospace !important;font-size:12px !important;font-weight:700 !important;fill:#ffffff !important;stroke:none !important;text-anchor:middle !important;dominant-baseline:central !important;">▾</text>
</g>
</svg>`;

    return {
      svg,
      width: totalWidth,
      height: height,
      category: category || 'property',
      isMultiLine: false
    };
  }

  // ---------------------------------------------------------------------------
  // Annotation-driven field mutation (WYSIWYG auto-resize).
  //
  // Extracted catalog SVGs carry data-aifx-* annotations on their editable
  // field groups (see tools/console-extract-blocks.js):
  //   data-aifx-field  field name ('' on labels)
  //   data-aifx-kind   text | number | variable | dropdown
  //   data-aifx-charw  measured per-character advance (Consolas 16px w600)
  //   data-aifx-value  the default value the SVG was extracted with
  //
  // applySvgFields maps resolution params onto those fields, replaces the text
  // and re-flows the geometry: pill rect width, dropdown arrow, same-row
  // siblings (labels, sockets, shadow blocks), the block path's long h-runs and
  // the viewBox/width. Opaque groups (image/colour/effect pickers, labels) are
  // never touched. Returns null when the SVG is not annotated or no param
  // applies — the caller then falls back to the legacy regex mutator.
  function applySvgFields(svgStr, params) {
    if (!params || !svgStr) return null;
    if (typeof DOMParser === 'undefined') return null;

    let doc;
    try {
      doc = new DOMParser().parseFromString(svgStr, 'image/svg+xml');
      if (doc.querySelector('parsererror')) return null;
    } catch (e) { return null; }

    const root = doc.querySelector('g[data-aifx-type]')
      || doc.querySelector('svg > g.blocklyBlock')
      || doc.documentElement.querySelector('g');
    if (!root) return null;

    const escapeXml = (v) => String(v)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&apos;');

    const parseTranslate = (el) => {
      const m = (el && el.getAttribute('transform') || '').match(/translate\((-?[\d.]+),\s*(-?[\d.]+)\)/);
      return m ? { x: parseFloat(m[1]), y: parseFloat(m[2]) } : null;
    };

    const isHiddenElement = (el) => {
      let cur = el;
      while (cur && cur !== root && cur.nodeType === 1) {
        const st = cur.getAttribute('style') || '';
        if (/display\s*:\s*none/i.test(st)) return true;
        const tr = parseTranslate(cur);
        if (tr && tr.y < -2) return true;
        cur = cur.parentNode;
      }
      const r = el.querySelector && el.querySelector(':scope > rect');
      if (r && (r.getAttribute('width') === '0' || r.getAttribute('height') === '0')) return true;
      return false;
    };

    const findEnclosingBlock = (el) => {
      let cur = el ? el.parentNode : null;
      while (cur && cur !== root && cur.nodeType === 1) {
        if (cur.tagName === 'g' && (cur.hasAttribute('data-aifx-type') || cur.classList.contains('blocklyBlock'))) {
          return cur;
        }
        cur = cur.parentNode;
      }
      return null;
    };

    const getVisualX = (el) => {
      let x = 0;
      let cur = el;
      while (cur && cur !== root && cur.nodeType === 1) {
        const tr = parseTranslate(cur);
        if (tr) x += tr.x;
        cur = cur.parentNode;
      }
      return x;
    };

    const getMainTextEl = (g) => {
      let textEl = g.querySelector('text.blocklyFieldText:not(.field-text-quote), text.blocklyDropdownText:not(.field-text-quote)');
      if (!textEl) {
        textEl = Array.from(g.querySelectorAll('text')).find(t => !t.classList.contains('field-text-quote'));
      }
      return textEl || null;
    };

    const readTextVal = (g) => {
      const t = getMainTextEl(g);
      return t ? (t.textContent || '').replace(/\u00a0/g, ' ').trim() : '';
    };

    const measureBlockWidth = (blockEl) => {
      if (!blockEl) return 40;
      const p = Array.from(blockEl.children || []).find(c => c.tagName === 'path' && c.classList.contains('blocklyPath'));
      const d = p ? (p.getAttribute('d') || '') : '';
      const pm = d.match(/m\s*(-?[\d.]+)\s*,\s*0\s+h\s*(-?[\d.]+)/i);
      if (pm) return Math.abs(parseFloat(pm[1])) * 2 + Math.abs(parseFloat(pm[2]));
      return 40;
    };

    // ---- collect editable field groups (annotated + unannotated shadows) ---
    const fields = [];
    const seenGroups = new Set();

    root.querySelectorAll('g[data-aifx-field]').forEach(g => {
      if (g.getAttribute('data-aifx-opaque') === '1') return;
      const kind = g.getAttribute('data-aifx-kind') || '';
      if (!kind || isHiddenElement(g)) return;
      seenGroups.add(g);
      const containerBlock = findEnclosingBlock(g);
      fields.push({
        g,
        containerBlock,
        name: g.getAttribute('data-aifx-field') || '',
        kind,
        charw: Math.max(parseFloat(g.getAttribute('data-aifx-charw') || '8.8') || 8.8, 9.2),
        value: (g.getAttribute('data-aifx-value') || readTextVal(g)).replace(/\u00a0/g, ' ').trim(),
        visualX: getVisualX(g)
      });
    });

    root.querySelectorAll('g.blocklyVariableField').forEach(g => {
      if (seenGroups.has(g) || isHiddenElement(g)) return;
      seenGroups.add(g);
      fields.push({
        g,
        containerBlock: findEnclosingBlock(g),
        name: 'VAR',
        kind: 'variable',
        charw: 9.4,
        value: readTextVal(g),
        visualX: getVisualX(g)
      });
    });

    root.querySelectorAll('g.blocklyDropdownField').forEach(g => {
      if (seenGroups.has(g) || isHiddenElement(g)) return;
      seenGroups.add(g);
      const val = readTextVal(g);
      if (!val) return;
      fields.push({
        g,
        containerBlock: findEnclosingBlock(g),
        name: g.closest && g.closest('g.spritekind') ? 'kind' : 'dropdown',
        kind: 'dropdown',
        charw: 9.2,
        value: val,
        visualX: getVisualX(g)
      });
    });

    const shadowInputSel = 'g.math_number, g.math_whole_number, g.math_number_minmax, g.positionPicker, g.spriteSpeedPicker, g.timePicker, g.text';
    root.querySelectorAll(shadowInputSel).forEach(blockEl => {
      if (isHiddenElement(blockEl)) return;
      const g = blockEl.querySelector('g.blocklyEditableField');
      if (!g || seenGroups.has(g) || isHiddenElement(g)) return;
      seenGroups.add(g);
      fields.push({
        g,
        containerBlock: blockEl,
        name: blockEl.classList.contains('text') ? 'TEXT' : 'NUM',
        kind: blockEl.classList.contains('text') ? 'text' : 'number',
        charw: 9.4,
        value: readTextVal(g),
        visualX: getVisualX(g)
      });
    });

    root.querySelectorAll('g.blocklyLabelField').forEach(g => {
      if (seenGroups.has(g) || isHiddenElement(g)) return;
      const val = readTextVal(g);
      if (/^function\s+[a-zA-Z0-9_]+/i.test(val)) {
        seenGroups.add(g);
        fields.push({
          g,
          containerBlock: null,
          name: 'function_name',
          kind: 'function_name',
          charw: 9.6,
          value: val.replace(/^function\s+/i, '').trim(),
          visualX: getVisualX(g)
        });
      } else if (/^from\s+\d+\s+to$/i.test(val)) {
        seenGroups.add(g);
        const m = val.match(/^from\s+(\d+)\s+to$/i);
        fields.push({
          g,
          containerBlock: null,
          name: 'from_label',
          kind: 'from_label',
          charw: 9.4,
          value: m ? m[1] : '0',
          visualX: getVisualX(g)
        });
      }
    });

    const toggles = [];
    root.querySelectorAll('g.toggleOnOff, g.toggleWinLose').forEach(blockEl => {
      if (!isHiddenElement(blockEl)) toggles.push(blockEl);
    });

    if (!fields.length && !toggles.length) return null;

    // Sort by visual left-to-right position so left/right and var1/var2 always match visual layout
    fields.sort((a, b) => a.visualX - b.visualX);

    // ---- map params onto fields ---------------------------------------------
    const want = (p) => (params[p] !== undefined && params[p] !== null && String(params[p]).trim() !== '') ? String(params[p]).trim() : null;
    const edits = []; // { field, text }
    const pushEdit = (f, text) => {
      if (!f || text === undefined || text === null || String(text) === '') return;
      const cleanTxt = String(text);
      if (cleanTxt === f.value) return;
      if (edits.some(e => e.field === f)) return;
      edits.push({ field: f, text: cleanTxt });
    };

    const varFields = fields.filter(f => f.kind === 'variable');
    const bothSbSprite = !!(want('statusbar') && want('sprite'));
    const v1 = bothSbSprite ? want('statusbar') : (want('varName') || want('var1') || want('sprite') || want('list') || want('statusbar') || want('follower'));
    const v2 = bothSbSprite ? want('sprite') : (want('var2') || want('target') || want('parentSprite'));
    if (v1 && varFields[0]) pushEdit(varFields[0], v1);
    if (v2 && varFields[1]) pushEdit(varFields[1], v2);

    const nameVal = want('NAME') || want('function_name');
    if (nameVal) pushEdit(fields.find(f => f.kind === 'function_name' || f.name === 'function_name' || f.name === 'NAME'), nameVal);

    const fromVal = want('from');
    if (fromVal) pushEdit(fields.find(f => f.kind === 'from_label'), fromVal);

    const btnVal = want('button');
    if (btnVal) pushEdit(fields.find(f => f.kind === 'dropdown' && (f.name === 'button' || f.value === 'A')), btnVal);

    const playerVal = want('player');
    if (playerVal) pushEdit(fields.find(f => f.kind === 'dropdown' && (f.name === 'player' || f.name === 'number' || ['1', '2'].includes(f.value))), playerVal);

    const dirVal = want('direction');
    if (dirVal) pushEdit(fields.find(f => f.kind === 'dropdown' && (f.name === 'direction' || ['left', 'right', 'top', 'bottom', 'up', 'down'].includes(f.value))), dirVal);

    const modeVal = want('mode');
    if (modeVal) pushEdit(fields.find(f => f.kind === 'dropdown' && f.name === 'mode'), modeVal);

    const effVal = want('effect');
    if (effVal) pushEdit(fields.find(f => f.kind === 'dropdown' && f.name === 'effect'), effVal);

    const flagVal = want('flag');
    if (flagVal) pushEdit(fields.find(f => f.kind === 'dropdown' && f.name === 'flag'), flagVal);

    const kindDefaults = ['Player', 'Health', 'Hunger', 'Energy', 'Magic', 'Life'];
    const kindDropdowns = fields.filter(f => f.kind === 'dropdown' && (f.name === 'kind' || kindDefaults.includes(f.value)));
    const k1 = want('kind') || want('kind1');
    const k2 = want('kind2');
    if (k1) pushEdit(kindDropdowns[0], k1);
    if (k2) pushEdit(kindDropdowns[1], k2);

    let opVal = want('op');
    if (opVal) {
      const opNorm = { '>=': '\u2265', '=>': '\u2265', '<=': '\u2264', '=<': '\u2264', '!=': '\u2260', '==': '=', '*': '\u00d7', 'x': '\u00d7' };
      opVal = opNorm[opVal] || opVal;
      pushEdit(fields.find(f => f.name === 'OP' || (f.kind === 'dropdown' && ['=', '+', '-', '/', '\u00d7', '*', '<', '>', '!=', '\u2260', '%', '\u2264', '\u2265'].includes(f.value))), opVal);
    }

    const propVal = want('prop') || want('property');
    if (propVal) pushEdit(fields.find(f => f.name === 'property' || (f.kind === 'dropdown' && ['x', 'value', 'column'].includes(f.value))), propVal);

    const textVal = want('text');
    if (textVal) {
      const txtFields = fields.filter(f => f.kind === 'text');
      if (txtFields[0]) pushEdit(txtFields[0], textVal.replace(/^["']|["']$/g, ''));
    }

    // Numeric / input shadow params (handle single-input `pxt_controls_for` preferring `to` over `from`)
    const numFields = fields.filter(f => f.kind === 'number');
    let numOrder;
    if (numFields.length === 1) {
      numOrder = ['val', 'to', 'count', 'percent', 'interval', 'x', 'y', 'vx', 'vy', 'left', 'right', 'min', 'max', 'from'];
    } else {
      numOrder = ['val', 'left', 'right', 'min', 'max', 'from', 'to', 'x', 'y', 'vx', 'vy', 'count', 'percent', 'interval'];
    }
    const numVals = numOrder.map(want).filter(v => v !== null);
    numVals.forEach((v, i) => pushEdit(numFields[i], v));

    // Toggle edits (WIN/LOSE or ON/OFF)
    let toggleChanged = false;
    const outcomeVal = want('outcome');
    const toggleTarget = outcomeVal ? outcomeVal.toUpperCase() : (want('val') && toggles.some(t => t.classList.contains('toggleOnOff')) ? want('val').toUpperCase() : null);
    if (toggleTarget && toggles.length) {
      toggles.forEach(tBlock => {
        const isWinLose = tBlock.classList.contains('toggleWinLose');
        const toggleG = tBlock.querySelector('g.blocklyToggle');
        const poly = tBlock.querySelector('polygon.blocklyToggleRect');
        const txt = tBlock.querySelector('text.blocklyToggleText');
        if (!toggleG || !poly || !txt) return;
        if (isWinLose && (toggleTarget === 'WIN' || toggleTarget === 'LOSE')) {
          const isWin = toggleTarget === 'WIN';
          toggleG.setAttribute('class', 'blocklyToggle ' + (isWin ? 'blocklyToggleOn' : 'blocklyToggleOff'));
          toggleG.setAttribute('transform', isWin ? 'translate(34, 0)' : 'translate(0, 0)');
          poly.setAttribute('fill', isWin ? '#2ecc71' : '#e74c3c');
          poly.setAttribute('stroke', isWin ? '#27ae60' : '#c0392b');
          txt.setAttribute('x', isWin ? '51' : '17');
          txt.textContent = toggleTarget;
          toggleChanged = true;
        } else if (!isWinLose && ['ON', 'OFF', 'TRUE', 'FALSE'].includes(toggleTarget)) {
          const isOn = toggleTarget === 'ON' || toggleTarget === 'TRUE';
          toggleG.setAttribute('class', 'blocklyToggle ' + (isOn ? 'blocklyToggleOn' : 'blocklyToggleOff'));
          toggleG.setAttribute('transform', isOn ? 'translate(26.5, 0)' : 'translate(0, 0)');
          poly.setAttribute('fill', isOn ? '#2ecc71' : '#718093');
          poly.setAttribute('stroke', isOn ? '#27ae60' : '#485460');
          txt.setAttribute('x', isOn ? '39.75' : '13.25');
          txt.textContent = isOn ? 'ON' : 'OFF';
          toggleChanged = true;
        }
      });
    }

    if (!edits.length && !toggleChanged) return null;

    // ---- apply edits with hierarchical reflow -------------------------------
    const svgEl = doc.documentElement;

    const widenBlockPath = (blockEl, delta, allowAllH) => {
      if (!blockEl || Math.abs(delta) < 0.01) return;
      Array.from(blockEl.children || []).forEach(p => {
        if (p.tagName !== 'path' || !p.classList.contains('blocklyPath')) return;
        const d = p.getAttribute('d') || '';
        const hasNotch = d.includes('c 2,0') || d.includes('c -2,0');
        let nd = d.replace(/h\s*(-?[\d.]+)/g, (m0, num) => {
          const v = parseFloat(num);
          if (!allowAllH || hasNotch) {
            if (Math.abs(v) < 19.5) return m0;
          }
          return 'h ' + (v + (v >= 0 ? delta : -delta));
        });
        // Also extend uppercase H runs on the outer right edge of C-blocks (leave inner left mouth H untouched)
        const hMatches = [...nd.matchAll(/\bH\s*([\d.]+)/g)].map(m => parseFloat(m[1]));
        if (hMatches.length) {
          const maxH = Math.max(...hMatches);
          if (maxH > 80) {
            nd = nd.replace(/\bH\s*([\d.]+)/g, (m0, num) => {
              const v = parseFloat(num);
              if (v >= maxH - 5) return 'H ' + (v + delta);
              return m0;
            });
          }
        }
        if (nd !== d) p.setAttribute('d', nd);
      });
    };

    const propagateReflowUp = (startChild, origWidthInParent, delta) => {
      let curChild = startChild;
      let curOrigW = origWidthInParent;
      let parent = curChild ? curChild.parentNode : null;
      while (parent && parent.nodeType === 1 && parent.tagName === 'g') {
        const tr = parseTranslate(curChild);
        if (tr) {
          const rightEdge = tr.x + curOrigW - 2;
          Array.from(parent.children || []).forEach(sib => {
            if (sib === curChild) return;
            const st = parseTranslate(sib);
            if (!st) return;
            if (st.x >= rightEdge && Math.abs(st.y - tr.y) < 28) {
              sib.setAttribute('transform', 'translate(' + (st.x + delta) + ',' + st.y + ')');
            }
          });
        }
        const isRoot = parent === root;
        const parentOrigW = !isRoot ? measureBlockWidth(parent) : 0;
        widenBlockPath(parent, delta, !isRoot);
        if (isRoot) break;
        curChild = parent;
        curOrigW = parentOrigW;
        parent = curChild.parentNode;
      }
    };

    for (const edit of edits) {
      const f = edit.field;
      if (f.value === edit.text) continue;
      const g = f.g;
      const textEl = getMainTextEl(g);
      if (!textEl) continue;

      if (f.kind === 'function_name') {
        textEl.textContent = 'function ' + edit.text;
      } else if (f.kind === 'from_label') {
        textEl.textContent = 'from ' + edit.text + ' to';
      } else {
        textEl.textContent = edit.text;
      }

      // Convert white math_number shadow into red/magenta variable reporter when fed an identifier
      const cBlock = f.containerBlock;
      const isNumShadow = cBlock && (cBlock.classList.contains('math_number') || cBlock.classList.contains('math_whole_number'));
      const trimmedEdit = edit.text.trim();
      const isIdent = isNumShadow && /^[a-zA-Z_][a-zA-Z0-9_\s]*$/.test(trimmedEdit) && !/^(true|false)$/i.test(trimmedEdit);
      if (isIdent) {
        const isInfoHud = /^(score|life)$/i.test(trimmedEdit);
        const fillCol = isInfoHud ? '#cf6a87' : '#ec3b59';
        const strokeCol = isInfoHud ? '#9b5065' : '#b12c43';
        cBlock.classList.remove('math_number', 'math_whole_number', 'blocklyShadow');
        cBlock.classList.add('variables_get');
        g.classList.remove('blocklyNumberField');
        const sp = Array.from(cBlock.children || []).find(c => c.tagName === 'path' && c.classList.contains('blocklyPath'));
        if (sp) {
          sp.setAttribute('fill', fillCol);
          sp.setAttribute('stroke', strokeCol);
          const st = sp.getAttribute('style') || '';
          sp.setAttribute('style', st.replace(/fill\s*:[^;]+;?/gi, '').replace(/stroke\s*:[^;]+;?/gi, '') + `fill:${fillCol};stroke:${strokeCol};`);
        }
        const tst = textEl.getAttribute('style') || '';
        textEl.setAttribute('style', tst.replace(/fill\s*:[^;]+;?/gi, '') + 'fill:#ffffff !important;');
      }

      // Compute width delta and resize rect/quotes/arrow/capsule
      const rect = Array.from(g.children || []).find(c => c.tagName === 'rect');
      const arrow = Array.from(g.children || []).find(c => c.tagName === 'image');
      const oldLen = f.value.length;
      const newLen = edit.text.length;
      let delta = 0;
      let origWForParent = 0;

      if (rect) {
        const curW = parseFloat(rect.getAttribute('width') || '0');
        origWForParent = cBlock ? measureBlockWidth(cBlock) : curW;
        const textX = parseFloat(textEl.getAttribute('x') || '0');
        const rightPad = arrow ? (textX > 0 ? 28 : 20) : (textX > 0 ? 12 : 8);
        const minWidth = Math.ceil((textX + newLen * f.charw + rightPad) * 2) / 2;
        let newW = Math.max(minWidth, curW + (newLen - oldLen) * f.charw);
        if (newLen < oldLen) newW = Math.max(arrow ? 40 : 32, minWidth);
        newW = Math.ceil(newW * 2) / 2;
        delta = newW - curW;
        if (Math.abs(delta) > 0.01) rect.setAttribute('width', String(newW));
      } else if (f.kind === 'function_name') {
        const oldFullLen = ('function ' + f.value).length;
        const newFullLen = ('function ' + edit.text).length;
        delta = Math.ceil((newFullLen - oldFullLen) * f.charw);
        origWForParent = oldFullLen * f.charw;
      } else if (f.kind === 'from_label') {
        const oldFullLen = ('from ' + f.value + ' to').length;
        const newFullLen = ('from ' + edit.text + ' to').length;
        delta = Math.ceil((newFullLen - oldFullLen) * f.charw);
        origWForParent = oldFullLen * f.charw;
      } else if (cBlock && cBlock !== root) {
        const curCapW = measureBlockWidth(cBlock);
        origWForParent = curCapW;
        const isQuoteText = cBlock.classList.contains('text');
        delta = Math.ceil((newLen - oldLen) * Math.max(f.charw, 9.4));
        if (isNumShadow && f.value.length <= 1 && newLen > 1) {
          textEl.setAttribute('x', '0');
          const gtr = parseTranslate(g);
          if (gtr) g.setAttribute('transform', 'translate(12,' + gtr.y + ')');
        }
        if (isQuoteText && Math.abs(delta) > 0.01) {
          const quotes = Array.from(g.querySelectorAll('text.field-text-quote'));
          const closeQ = quotes[1];
          if (closeQ) {
            const qt = parseTranslate(closeQ);
            if (qt) closeQ.setAttribute('transform', 'translate(' + (qt.x + delta) + ',' + qt.y + ')');
          }
        }
      } else {
        delta = Math.ceil((newLen - oldLen) * f.charw + (newLen > oldLen ? 12 : 0));
        origWForParent = oldLen * f.charw;
      }

      if (Math.abs(delta) < 0.01) continue;

      if (arrow) {
        if (arrow.hasAttribute('x')) arrow.setAttribute('x', String(parseFloat(arrow.getAttribute('x')) + delta));
        const am = parseTranslate(arrow);
        if (am) arrow.setAttribute('transform', 'translate(' + (am.x + delta) + ',' + am.y + ')');
      }

      if (cBlock) {
        // Shift anything right of g inside cBlock, widen cBlock, then propagate up through ancestors to root
        const gtr = parseTranslate(g);
        const fOrigW = rect ? parseFloat(rect.getAttribute('width') || '0') - delta : origWForParent - 24;
        if (gtr) {
          Array.from(cBlock.children || []).forEach(sib => {
            if (sib === g) return;
            const st = parseTranslate(sib);
            if (st && st.x >= gtr.x + fOrigW - 2 && Math.abs(st.y - gtr.y) < 25) {
              sib.setAttribute('transform', 'translate(' + (st.x + delta) + ',' + st.y + ')');
            }
          });
        }
        widenBlockPath(cBlock, delta, true);
        propagateReflowUp(cBlock, origWForParent, delta);
      } else {
        propagateReflowUp(g, origWForParent, delta);
      }

      const vb = (svgEl.getAttribute('viewBox') || '').match(/^([\d.-]+)\s+([\d.-]+)\s+([\d.]+)\s+([\d.]+)$/);
      if (vb) {
        const nextW = Math.ceil(parseFloat(vb[3]) + delta);
        svgEl.setAttribute('viewBox', vb[1] + ' ' + vb[2] + ' ' + nextW + ' ' + vb[4]);
        if (svgEl.hasAttribute('width')) {
          svgEl.setAttribute('width', String(Math.ceil(parseFloat(svgEl.getAttribute('width')) + delta)));
        }
      }
    }

    try {
      return new XMLSerializer().serializeToString(doc.documentElement);
    } catch (e) { return null; }
  }

  function mutateSvgWithParams(svgStr, params) {
    if (!svgStr) return '';
    if (params) {
      const applied = applySvgFields(svgStr, params);
      if (applied) return applied;
    }
    let s = svgStr;
    if (s.includes('</style>')) {
      s = s.replace('</style>', '.blocklyNumberField text, .blocklyTextInputField text, .blocklyInputField text, .math_number text, .timePicker text { fill: #575e75 !important; }\n</style>');
    }
    if (!params) return s;

    // 1. Variable name replacement & dynamic pill stretch for variables_get
    if (params.varName) {
      const v = escapeXml(params.varName);
      if (s.includes('data-aifx-type="variables_get"') && !s.includes('variables_set')) {
        const charWidth = 9.5;
        const textWidth = Math.max(30, v.length * charWidth);
        const hStretch = Math.round(textWidth + 16);
        const totalWidth = hStretch + 44;

        s = s.replace(/viewBox="0 0 \d+(?:\.\d+)? 40"/, `viewBox="0 0 ${totalWidth} 40"`);
        s = s.replace(/width="\d+(?:\.\d+)?"/, `width="${totalWidth}"`);
        s = s.replace(/h\s+74\.375/, `h ${hStretch}`);
        s = s.replace(/h\s+-74\.375/, `h -${hStretch}`);
        s = s.replace(/>mySprite<\/text>/, `>${v}<\/text>`);
        const arrowX = Math.round(textWidth + 18);
        s = s.replace(/transform="translate\([0-9\.]+,3\.5\)"/, `transform="translate(${arrowX},3.5)"`);
        s = s.replace(/width="90\.375"/, `width="${hStretch + 16}"`);
      } else {
        s = s.replace(/>mySprite</g, `>${v}<`);
        s = s.replace(/>projectile</g, `>${v}<`);
        s = s.replace(/>statusbar</g, `>${v}<`);
        s = s.replace(/>item</g, `>${v}<`);
      }
    }

    if (params.NAME || params.function_name) {
      const fnName = escapeXml(params.NAME || params.function_name);
      const m = s.match(/>function\s+([a-zA-Z0-9_]+)<\/text>/);
      const oldFn = m ? m[1] : 'loadTilemap';
      const oldLen = oldFn.length;
      const newLen = fnName.length;
      const delta = Math.max(0, Math.ceil((newLen - oldLen) * 9.6));
      s = s.replace(/>function\s+[a-zA-Z0-9_]+<\/text>/, `>function ${fnName}</text>`);
      if (delta > 0) {
        s = s.replace(/h\s+(\d+(?:\.\d+)?)\s+a\s+4\s+4/, (m0, w) => 'h ' + (parseFloat(w) + delta) + ' a 4 4');
        s = s.replace(/\bH\s+(\d+(?:\.\d+)?)\s+a\s+4\s+4/, (m0, w) => 'H ' + (parseFloat(w) + delta) + ' a 4 4');
        s = s.replace(/h\s+-(\d+(?:\.\d+)?)/, (m0, w) => 'h -' + (parseFloat(w) + delta));
        s = s.replace(/viewBox="0 0 (\d+(?:\.\d+)?) (\d+(?:\.\d+)?)"/, (m0, w, h) => `viewBox="0 0 ${Math.ceil(parseFloat(w) + delta)} ${h}"`);
        s = s.replace(/width="(\d+(?:\.\d+)?)"/, (m0, w) => `width="${Math.ceil(parseFloat(w) + delta)}"`);
      }
    }

    // 2. Kind replacement (only generic single-kind fallback)
    if (params.kind && !params.kind1 && !params.kind2) {
      const k = escapeXml(params.kind);
      s = s.replace(/>Player</g, `>${k}<`);
      s = s.replace(/>Health</g, `>${k}<`);
    }

    // 3. Button / Property / Operator fallback
    if (params.button) {
      s = s.replace(/>A</g, `>${escapeXml(params.button)}<`);
    }
    if (params.prop) {
      const p = escapeXml(params.prop);
      s = s.replace(/>x</g, `>${p}<`).replace(/>value</g, `>${p}<`);
    }
    if (params.op) {
      const safeOp = escapeXml(params.op);
      s = s.replace(/>=<\/text>/g, `>${safeOp}</text>`).replace(/>&lt;<\/text>/g, `>${safeOp}</text>`).replace(/>&gt;<\/text>/g, `>${safeOp}</text>`).replace(/>\+<\/text>/g, `>${safeOp}</text>`);
    }

    return s;
  }

  async function loadCatalog() {
    try {
      if (true) {
        const catUrl = (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.getURL) ? chrome.runtime.getURL('catalog/catalog.json') : './catalog/catalog.json';
        const mapUrl = (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.getURL) ? chrome.runtime.getURL('catalog/token_map.json') : './catalog/token_map.json';
        const [catRes, mapRes] = await Promise.all([
          fetch(catUrl),
          fetch(mapUrl)
        ]);
        catalogMap = await catRes.json();
        const mapData = await mapRes.json();
        if (mapData && Array.isArray(mapData.rules)) {
          tokenRules = mapData.rules.map(r => ({
            ...r,
            regex: new RegExp(r.pattern, 'i')
          }));
        }
        applyCacheToPage();
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
      if (/status\s*bar|statusbar/i.test(step) || /status\s*bar|statusbar/i.test(overall)) return 'statusbars_property';
      return 'statusbars_property';
    }

    // 2. Status Bar kinds: Health, Hunger, Energy, Magic, Life, Heat, Cold (keep Info lowercase (life) as hudLife)
    if (/^(?:Health|Hunger|Energy|Magic|Heat|Cold)$/i.test(cleanFlat) || (/^Life$/.test(cleanFlat) && /status\s*bar|statusbar/i.test(step + ' ' + overall))) {
      return 'statusbars_kind';
    }

    // 3. Dialog layouts: bottom, top, center, full screen
    if (/^(?:bottom|top|center|full\s*screen)$/i.test(cleanFlat)) {
      return 'game';
    }

    // 4. Direction properties: left, right, up, down
    if (/^(?:left|right|up|down)$/i.test(cleanFlat)) {
      if (/tile\s*scanner|scanner|scan/i.test(step)) return 'tileScanner';
      if (/controller|button|press/i.test(step)) return 'controller';
      if (/tile\s*scanner|scanner|scan/i.test(overall)) return 'tileScanner';
      return 'scene';
    }

    // 5. Sprite properties (short and long dropdown names, with or without parens)
    if (/^(?:x|y|vx|vy|ax|ay|lifespan|z|scale|sx|sy|fx|fy|rotation|vx\s*\(?velocity\s*x\)?|vy\s*\(?velocity\s*y\)?|ax\s*\(?acceleration\s*x\)?|ay\s*\(?acceleration\s*y\)?|fx\s*\(?friction\s*x\)?|fy\s*\(?friction\s*y\)?|sx\s*\(?scale\s*x\)?|sy\s*\(?scale\s*y\)?|z\s*\(?depth\)?)$/i.test(cleanFlat)) {
      return 'sprites';
    }

    // 6. Sprite boolean flags
    if (/^(?:auto\s*destroy|destroy\s*on\s*wall|bounce\s*on\s*wall|stay\s*in\s*screen|ghost|ghost\s*through\s*walls|ghost\s*through\s*sprites|ghost\s*through\s*tiles|invisible|relative\s*to\s*camera)$/i.test(cleanFlat)) {
      return 'sprites';
    }

    // 7. Standalone sound effects and playback modes
    if (/^(?:ba\s*ding|jump\s*up|jump\s*down|magic\s*wand|power\s*up|power\s*down|pew|siren|wawawawaa|footstep|knock|thump|small\s*crash|big\s*crash|sonar|zapped|beam\s*up|until\s*done|in\s*background|looping)$/i.test(cleanFlat)) {
      return 'music';
    }

    // 8. Standalone visual effects (confetti, spray, trail, etc.)
    if (/^(?:confetti|spray|trail|fountain|hearts|smiles|rings|fire|warm\s*radial|cool\s*radial|halo|ashes|disintegrate|blizzard|bubbles|star\s*field|clouds|dust)$/i.test(cleanFlat)) {
      return /game\s*over|use\s*effect/i.test(step) ? 'game' : 'scene';
    }

    // 9. Scroller modes
    if (/^(?:only\s*horizontally|only\s*vertically|both\s*directions)$/i.test(cleanFlat)) {
      return 'scroller';
    }

    return null;
  }

  function getActiveCategories(stepText, overallText) {
    const combined = ((stepText || '') + ' ' + (overallText || '')).toLowerCase();
    const active = new Set(['variables', 'common', 'logic', 'loops', 'math', 'functions']);

    if (/status\s*bars?|statusbar/i.test(combined)) active.add('statusbars');
    if (/scene|tilemap|camera|background|wall|tile|location|neighboring|place|start\s+screen|screen\s+.*effect|effects?/i.test(combined)) active.add('scene');
    if (/sprites?|projectile|overlap|destroy|velocity|position|kind|follow|\bsay\b|speech/i.test(combined)) active.add('sprites');
    if (/controller|button|press|dx|dy/i.test(combined)) active.add('controller');
    if (/music|sound|melody|tune|tempo|ba\s+ding/i.test(combined)) active.add('music');
    if (/tilemap|\btile\b|\btiles\b|tile\s*util|wall/i.test(combined)) active.add('tileUtil');
    if (/tile\s*scanner|\bscan(ning)?\b|\bdirection\b/i.test(combined)) active.add('tileScanner');
    if (/scroll/i.test(combined)) active.add('scroller');
    if (/multiplayer|mp\.|player\s*[1234]/i.test(combined)) active.add('mp');
    if (/animation|animat/i.test(combined)) active.add('animation');
    if (/game|dialog|splash|use\s+effect|game\s*over|win|lose|countdown|interval|ask\s+for/i.test(combined)) active.add('game');
    if (/info|score|life|countdown/i.test(combined)) active.add('info');
    if (/functions?|procedure|call\b|return\b/i.test(combined)) active.add('functions');
    if (/image|pixel|draw|flip|picture/i.test(combined)) active.add('images');
    if (/array|list\b|element\s+of|\bindex\b|get\s+value\s+at/i.test(combined)) active.add('arrays');
    if (/text|string|char|join|split|length\s+of/i.test(combined)) active.add('text');
    if (/console|\blog\b/i.test(combined)) active.add('console');

    return active;
  }

  // Boolean bubbles (<a and b>, <x = y>, <not z>) are SHORT and verb-free.
  // Instruction statements containing and/or/not must never resolve to logic blocks.
  const LOGIC_VERB_BLACKLIST = /\b(connect|create|destroy|remove|clear|draw|drap|splash|show|play|press|move|place|follow|overlap|on\s+each|on\s+game|on\s+life|on\s+countdown|stay\s+in\s+screen|bounce|of\s+kind|tile|tilemap|camera|screen|volume|sound|melody|effect|image|animat|set\b|change\b|game\s+over|score\b|life\b|countdown)\b/i;

  function isBooleanBubble(cleanFlat) {
    const words = cleanFlat.split(/\s+/).filter(Boolean);
    if (words.length > 3) return false;                 // "a and b" = 3 words max
    if (cleanFlat.length > 45) return false;            // statements are longer
    if (LOGIC_VERB_BLACKLIST.test(cleanFlat)) return false;
    return true;
  }

  function resolveTokenWithNLP(tokenText, stepText, overallText, afterText) {
    if (!tokenText) return null;
    const trimmedOrig = tokenText.trim();
    let clean = trimmedOrig;
    if ((clean.startsWith('[') && clean.endsWith(']')) ||
        (clean.startsWith('(') && clean.endsWith(')')) ||
        (clean.startsWith('<') && clean.endsWith('>'))) {
      clean = clean.slice(1, -1).trim();
    }
    const cleanFlat = clean
      .replace(/[\[\]\(\)]/g, ' ')
      .replace(/<\s*([^<>]*?)\s*>/g, ' $1 ')
      .replace(/\s+/g, ' ')
      .trim();

    // Direct SVG tokens: empty boolean diamond, mutator (+)/(-), UI buttons, section labels, game over toggle
    if (/^<\s*>$/.test(trimmedOrig) || /^\[\s*<\s*>\s*\]$/.test(trimmedOrig)) {
      return { rule: { id: 'empty_boolean_slot', category: 'logic' }, template: 'direct_svg', svgData: generateEmptyBooleanSlotSvg() };
    }
    const mutMatch = trimmedOrig.match(/^[\(\[]\s*([+-])\s*[\)\]]$/);
    if (mutMatch) {
      return { rule: { id: 'mutator_button', category: 'common' }, template: 'direct_svg', svgData: generateMutatorButtonSvg(mutMatch[1]) };
    }
    if (/^Make a Function(?:\.\.\.)?$/i.test(cleanFlat)) {
      return { rule: { id: 'ui_make_function', category: 'functions' }, template: 'direct_svg', svgData: generateUiButtonSvg('Make a Function...', '#1e88e5', '#1565c0') };
    }
    if (/^Make a Variable$/i.test(cleanFlat)) {
      return { rule: { id: 'ui_make_variable', category: 'variables' }, template: 'direct_svg', svgData: generateUiButtonSvg('Make a Variable', '#ec3b59', '#b12c43') };
    }
    if (/^else$/i.test(cleanFlat)) {
      return { template: 'controls_else', rule: { id: 'controls_else', category: 'logic', template: 'controls_else', blockType: 'controls_else' } };
    }
    if (/^then$/i.test(cleanFlat)) {
      return { template: 'controls_then', rule: { id: 'controls_then', category: 'logic', template: 'controls_then', blockType: 'controls_then' } };
    }
    if (/^else\s+if(?:\s+true)?$/i.test(cleanFlat)) {
      const tmpl = /true/i.test(cleanFlat) ? 'controls_else_if_true' : 'controls_else_if';
      return { template: tmpl, rule: { id: tmpl, category: 'logic', template: tmpl, blockType: tmpl } };
    }

    // Exact block names must never be hijacked by nearby "Variables"/category prose.
    if (/^on\s+countdown\s+end$/i.test(cleanFlat) && catalogMap && catalogMap.gamecountdownevent) {
      return { rule: { id: 'gamecountdownevent', category: 'info' }, template: 'gamecountdownevent', params: {} };
    }
    const mLogicAngle = trimmedOrig.match(/^<\s*(and|or)\s*>$/i);
    if (mLogicAngle) {
      return { rule: { id: 'logic_operation', category: 'logic' }, template: 'logic_operation_' + mLogicAngle[1].toLowerCase(), params: {} };
    }
    // <isBeeDizzy>: custom Boolean variable/parameter reporter -> hexagonal pill
    const mAngleId = trimmedOrig.match(/^<\s*([a-z][a-z0-9]*[A-Z][a-zA-Z0-9_]*)\s*>$/);
    if (mAngleId) {
      return { rule: { id: 'boolean_reporter', category: 'variables' }, template: 'direct_svg', svgData: generateBooleanReporterBubble(mAngleId[1]) };
    }
    // Nested reporters: ((tilemap location of (sprite)) row) and (length of array (array of sprites of kind))
    const mNestLen = trimmedOrig.match(/^\(\s*length\s+of\s+array\s*\(\s*array\s+of\s+sprites\s+of\s+kind(?:\s+\(?\s*([A-Za-z0-9_]+)\s*\)?)?\s*\)\s*\)$/i);
    if (mNestLen) {
      const innerParams = (mNestLen[1] && !/^kind$/i.test(mNestLen[1])) ? { kind: mNestLen[1] } : {};
      return {
        rule: { id: 'nested_lists_length', category: 'arrays' },
        template: 'nested_compose',
        params: { outer: { template: 'lists_length', params: {} }, inner: { template: 'allOfKind', params: innerParams } }
      };
    }
    const mNestLoc = trimmedOrig.match(/^\(\s*\(\s*tilemap\s+location\s+of(?:\s+\(?\s*([A-Za-z0-9_]+)\s*\)?)?\s*\)\s*(row|column)\s*\)$/i);
    if (mNestLoc) {
      const innerParams = (mNestLoc[1] && !/^sprite$/i.test(mNestLoc[1])) ? { varName: mNestLoc[1] } : {};
      return {
        rule: { id: 'nested_location_prop', category: 'scene' },
        template: 'nested_compose',
        params: { outer: { template: 'tiles.Location_blockCombine_get', params: { prop: mNestLoc[2].toLowerCase() } }, inner: { template: 'tiles_location_of_sprite', params: innerParams } }
      };
    }
    // [value] / [max] / [zero] inside a Status Bar step are Status Bar property dropdowns, not variables.
    if (trimmedOrig.startsWith('[') && /^(?:value|max|zero)$/i.test(cleanFlat) && /status\s*bar|statusbar/i.test((stepText || '') + ' ' + (overallText || ''))) {
      return { rule: { id: 'property_statusbars_property', category: 'statusbars_property' }, template: 'isolated_pill', params: { prop: cleanFlat, pillCategory: 'statusbars_property' } };
    }
    // Overlap-event parameter bubbles are plain reporter ovals (no dropdown arrow), same as (otherSprite).
    if (trimmedOrig.startsWith('[') && /^(?:sprite|otherSprite)$/.test(cleanFlat) && /overlap/i.test(stepText || '')) {
      return { rule: { id: 'variables_get', category: 'variables' }, template: 'direct_svg', svgData: generateVariableReporterBubble(cleanFlat) };
    }
    if (/^game\s+over$/i.test(cleanFlat) && (afterText ? /^\s*toggle\b/i.test(afterText) : /\[game\s+over\]\s+toggle|replace\s+the\s+\[game\s+over\]\s+toggle/i.test(stepText || ''))) {
      return { rule: { id: 'toggle_win', category: 'game' }, template: 'direct_svg', svgData: renderToggleToken('WIN') };
    }

    // Standalone comparison operators: (>), (<), (>=), (<=), (=), (==), (!=), (≥), (≤), (≠)
    const compOpRaw = clean.replace(/[\[\]\(\)]/g, '').trim();
    if (/^(?:>|<|>=|<=|=>|=<|==|!=|=|\u2264|\u2265|\u2260)$/.test(compOpRaw)) {
      const compNorm = { '>=': '\u2265', '=>': '\u2265', '<=': '\u2264', '=<': '\u2264', '!=': '\u2260', '==': '=' };
      return {
        rule: { id: 'logic_compare_standalone', category: 'logic' },
        template: 'isolated_pill',
        params: { prop: compNorm[compOpRaw] || compOpRaw, pillCategory: 'logic' }
      };
    }

    // Function identifiers in instructions (e.g. [makeEnemy], [makeCoin], [createBubbles])
    const RESERVED_NON_FUNC = /^(?:true|false|yes|no|win|lose|on|off|not|and|or|null|undefined|return|break|continue|then|else|forever|repeat|pause|splash|score|life|sprite|list|item|value|index)$/i;
    // "[makeBee] function is called" -> the prose itself says it is a function
    const funcNamedAfter = trimmedOrig.startsWith('[') && /^[a-z][a-zA-Z0-9_]+$/.test(cleanFlat) && !RESERVED_NON_FUNC.test(cleanFlat) && /^\s*function\b/i.test(afterText || '');
    // Known sprite properties ([lifespan], [x], [vx]...) are never function names even when the step mentions functions.
    const isSpritePropName = getContextCategory(cleanFlat, stepText, overallText) === 'sprites';
    if (/^(?:makeEnemy|makeCoin|createBubbles)$/i.test(cleanFlat)
      || funcNamedAfter
      || (!isSpritePropName && trimmedOrig.startsWith('[') && !RESERVED_NON_FUNC.test(cleanFlat) && /function\s+(?:named|called)\s+/i.test(stepText || '') && /^[a-z][a-zA-Z0-9_]+$/.test(cleanFlat))) {
      const isCall = /\bcall\b/i.test(stepText || '') || /^\s*function\s+(?:is\s+|gets\s+|will\s+be\s+)?(?:called|run|runs|executed)/i.test(afterText || '');
      return {
        rule: { id: isCall ? 'function_call' : 'function_definition', category: 'functions' },
        template: isCall ? 'function_call' : 'function_definition',
        params: { NAME: cleanFlat }
      };
    }

    // Parenthesized lowercase identifier -> plain variable / parameter reporter oval, e.g. (name), (speed), (column), (coin).
    // Known property/direction/effect words are left to the dropdown logic below.
    if (trimmedOrig.startsWith('(') && /^[a-z][a-zA-Z0-9_]*$/.test(cleanFlat)
      && !/^(?:true|false|yes|no|win|lose|on|off|not|and|or|null|undefined|score|life|countdown|random|then|else|bpm|px|pixels|degrees|radians|seconds|secs|sec|ms|hz|optional|default)$/i.test(cleanFlat)
      && !getContextCategory(cleanFlat, stepText, overallText)) {
      return {
        rule: { id: 'variables_get', category: 'variables' },
        template: 'direct_svg',
        svgData: generateVariableReporterBubble(cleanFlat)
      };
    }

    // Variable references (keep score and life as magenta Info hudScore/hudLife blocks)
    if (!/^(?:score|life)$/i.test(cleanFlat)) {
      const esc = cleanFlat.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const varRegex = new RegExp('(?:variable\\s+[\\[\\(]?' + esc + '[\\]\\)]?|[\\[\\(]?' + esc + '[\\]\\)]?\\s+variable)', 'i');
      const isExplicitVariable = varRegex.test(stepText || '');
      const isCamelCaseVar = /^[a-z][a-z0-9]*(?:[A-Z][a-z0-9]*)+$/.test(cleanFlat);
      const isParenSpriteArg = /^sprite$/i.test(cleanFlat) && trimmedOrig.startsWith('(');
      const isKnownVarPattern = isParenSpriteArg || isCamelCaseVar || /^(?:mySprite|otherSprite|projectile|statusbar|item|index|value|list|tilemap\d+|magicLevel|question|columnNumber|hiddenFossils|foundFossils|seaweedList|seaweedSprite|fishSprite|archaeologist|snack|color|level|picture|location|myEnemy|customerSprite|burgerMaker|burgerProjectile|customerList|[a-zA-Z_][a-zA-Z0-9_]*(?:Sprite|List|Location|Tile|Number|Count|Speed|Level))$/i.test(cleanFlat);

      if (isExplicitVariable || (isKnownVarPattern && !cleanFlat.includes(' '))) {
        if (trimmedOrig.startsWith('(')) {
          return {
            rule: { id: 'variables_get', category: 'variables' },
            template: 'direct_svg',
            svgData: generateVariableReporterBubble(cleanFlat)
          };
        }
        return {
          rule: { id: 'variable_dropdown', category: 'variables' },
          template: 'isolated_pill',
          params: { prop: cleanFlat, pillCategory: 'variables' }
        };
      }
    }

    // Hardcode [set list to] to the arrays version
    if (/^set\s+(?:\(list\)|list)\s+to$/i.test(cleanFlat)) {
      return {
        rule: { id: 'arrays_set_list_to', category: 'arrays' },
        template: 'variables_set__9',
        params: { varName: 'list' }
      };
    }

    // Contextual handler for set <var> to tilemap (require bare tilemap, not tilemap1/tilemap2)
    const mSetTilemap = cleanFlat.match(/^set\s+[\(\[]?([a-zA-Z0-9_]+)[\)\]]?\s+to\s+[\(\[]?tilemap[\)\]]?$/i);
    if (mSetTilemap) {
      return {
        rule: { id: 'variables_set_tilemap', category: 'variables' },
        template: 'variables_set_tilemap',
        params: { varName: mSetTilemap[1] === 'variable' ? 'variable' : mSetTilemap[1] }
      };
    }

    // Contextual toggle checks
    if (/^lose$/i.test(cleanFlat)) {
      return { rule: { id: 'toggle_lose', category: 'game' }, template: 'toggle_lose', params: {} };
    }
    if (/^win$/i.test(cleanFlat)) {
      return { rule: { id: 'toggle_win', category: 'game' }, template: 'toggle_win', params: {} };
    }
    if (/^(?:on|off)$/i.test(cleanFlat)) {
      return { rule: { id: 'toggle_on_off', category: 'game' }, template: 'toggleOnOff', params: {} };
    }

    const ctxCategory = getContextCategory(cleanFlat, stepText, overallText);
    if (ctxCategory) {
      return {
        rule: { id: 'property_' + ctxCategory, category: ctxCategory },
        template: 'isolated_pill',
        params: { prop: ctxCategory === 'sprites' ? clean : cleanFlat, pillCategory: ctxCategory }
      };
    }

    // Category whitelist: If the instructions do not include a category, the NLP will not choose it!
    const isTestBed = (typeof window !== 'undefined' && (window.ALL_TOKENS || document.querySelector('[data-instruction], .token-target-area')));
    const activeCategories = isTestBed ? null : getActiveCategories(stepText, overallText);

    for (const rule of tokenRules) {
      if (activeCategories && rule.category && !activeCategories.has(rule.category)) continue;

      // Strictness gate: and/or/not/compare rules only fire on short, verb-free
      // boolean bubbles — never on multi-item instruction statements.
      if (rule.id === 'logic_operation' || rule.id === 'logic_compare' || rule.id === 'logic_negate') {
        if (!isBooleanBubble(cleanFlat)) continue;
      }

      const m = (rule.id === 'sprites_say')
        ? (clean.match(rule.regex) || cleanFlat.match(rule.regex))
        : (cleanFlat.match(rule.regex) || clean.match(rule.regex));
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
        if (rule.id === 'sprites_say' && params.text === undefined && m[3] !== undefined) {
          params.text = m[3];
        }

        // Sprites block default fallback: if token is literal "set sprite to", keep default variables
        if (rule.category === 'sprites' && rule.blockType === 'variables_set') {
          if (rule.id === 'sprites_set_sprite_to' || cleanFlat.toLowerCase() === 'set sprite to') {
            delete params.varName;
            delete params.kind;
          }
        }

        if (params.prop) {
          const pLower = String(params.prop).toLowerCase().trim();
          const spritePropMap = {
            'vx': 'vx (velocity x)',
            'vy': 'vy (velocity y)',
            'fx': 'fx (friction x)',
            'fy': 'fy (friction y)',
            'sx': 'sx (scale x)',
            'sy': 'sy (scale y)',
            'rotation': 'rotation (degrees)',
            'degrees': 'rotation (degrees)',
            'radians': 'rotation (radians)',
            'z': 'z (depth)'
          };
          if (spritePropMap[pLower]) params.prop = spritePropMap[pLower];
        }
        const syntaxStopwords = new Set(['of', 'kind', 'sprite', 'and', 'image', 'tile', 'variable', 'to', 'with', 'for']);
        if (params.kind && syntaxStopwords.has(String(params.kind).toLowerCase().trim())) {
          delete params.kind;
        }
        if (params.kind1 && syntaxStopwords.has(String(params.kind1).toLowerCase().trim())) {
          delete params.kind1;
        }
        if (params.kind2 && syntaxStopwords.has(String(params.kind2).toLowerCase().trim())) {
          delete params.kind2;
        }
        if (params.varName && (params.varName.toLowerCase() === 'sprite' || syntaxStopwords.has(String(params.varName).toLowerCase().trim()))) {
          delete params.varName;
        }
        // "set projectile to projectile from ..." — the word `projectile` is the literal label, not a sprite variable to inject into `from`.
        if (params.varName && /^variables_set_projectile_/.test(String(rule.template || '')) && /^projectile$/i.test(String(params.varName).trim())) {
          delete params.varName;
        }
        if (params.button && /^button$/i.test(String(params.button).trim())) {
          delete params.button;
        }
        if (params.effect && /^effect$/i.test(String(params.effect).trim())) {
          delete params.effect;
        }

        return {
          rule,
          template: rule.template,
          params
        };
      }
    }

    // Fallback: direct matching against catalog keys or multi-word shadow-free fields
    if (catalogMap) {
      if (catalogMap[cleanFlat]) {
        const directEntry = catalogMap[cleanFlat];
        const directCat = (directEntry.category || '').toLowerCase();
        if (!activeCategories || !directCat || activeCategories.has(directCat)) {
          return { rule: { id: 'catalog_' + cleanFlat, category: directEntry.category || 'common' }, template: cleanFlat, params: {} };
        }
      }
      for (const [cKey, cVal] of Object.entries(catalogMap)) {
        const cCat = (cVal.category || '').toLowerCase();
        if (activeCategories && cCat && !activeCategories.has(cCat)) continue;
        if (cVal.fields && cVal.fields.length) {
          const fText = cVal.fields.map(f => f.text).filter(Boolean).join(' ').trim().toLowerCase();
          if (fText.split(/\s+/).length >= 2 && !(cVal.svg && cVal.svg.includes('blocklyShadow')) && fText === cleanFlat.toLowerCase()) {
            return { rule: { id: 'catalog_' + cKey, category: cVal.category || 'common' }, template: cKey, params: {} };
          }
        }
      }
    }

    return null;
  }

  const rawSvgFileCache = new Map();

  // Embeds `innerData` (a reporter SVG) into the first `variables_get` slot of `outerData` (a pill-shaped reporter).
  // Offsets (never scales): the outer pill grows by (innerWidth - slotWidth) horizontally and, when the inner
  // reporter is taller than the slot, vertically (outer radius follows height/2); siblings right of the slot shift by dx.
  function composeNestedReporter(outerData, innerData) {
    if (!outerData || !outerData.svg || !innerData || !innerData.svg || typeof DOMParser === 'undefined') return null;
    try {
      const parse = (s) => new DOMParser().parseFromString(s, 'image/svg+xml');
      const od = parse(outerData.svg);
      const idoc = parse(innerData.svg);
      if (od.querySelector('parsererror') || idoc.querySelector('parsererror')) return null;
      const oSvg = od.documentElement;
      const oRoot = od.querySelector('g[data-aifx-type]') || od.querySelector('svg > g.blocklyBlock');
      const iRoot = idoc.querySelector('g[data-aifx-type]') || idoc.querySelector('svg > g.blocklyBlock');
      if (!oRoot || !iRoot) return null;

      const tr = (el) => {
        const m = (el.getAttribute('transform') || '').match(/translate\(\s*(-?[\d.]+)[\s,]+(-?[\d.]+)\s*\)/);
        return m ? { x: parseFloat(m[1]), y: parseFloat(m[2]) } : null;
      };
      const pathOf = (g) => Array.from(g.children).find(c => c.tagName === 'path' && c.classList.contains('blocklyPath'));
      const pill = (g) => {
        const p = pathOf(g);
        const m = p && (p.getAttribute('d') || '').match(/m\s*(-?[\d.]+)\s*,\s*0\s+h\s*(-?[\d.]+)/i);
        if (!m) return null;
        const R = Math.abs(parseFloat(m[1]));
        return { R, w: 2 * R + Math.abs(parseFloat(m[2])), h: 2 * R };
      };

      const slot = Array.from(oRoot.children).find(c => c.tagName === 'g' && c.classList.contains('variables_get'));
      const oPill = pill(oRoot), sPill = slot && pill(slot), iPill = pill(iRoot);
      const slotTr = slot && tr(slot);
      if (!slot || !oPill || !sPill || !iPill || !slotTr) return null;

      const dx = iPill.w - sPill.w;
      const pad = Math.max(0, (oPill.h - sPill.h) / 2);
      const newH = Math.max(oPill.h, iPill.h + pad * 2);
      const dy = (newH - oPill.h) / 2;
      const newR = newH / 2;
      const newW = oPill.w + dx;
      const W = Math.max(0, newW - 2 * newR);

      // Rebuild the outer pill outline at its new size
      const oPath = pathOf(oRoot);
      oPath.setAttribute('d', ` m ${newR},0  h ${W} a ${newR} ${newR} 0 0,1 ${newR},${newR}  v 0 a ${newR} ${newR} 0 0,1 -${newR},${newR}  V ${newH}  h -${W} a ${newR} ${newR} 0 0,1 -${newR},-${newR}  v 0 a ${newR} ${newR} 0 0,1 ${newR},-${newR} z`);

      // Reflow siblings: shift right of the slot by dx, recentre vertically by dy
      Array.from(oRoot.children).forEach(c => {
        if (c === slot || c === oPath || c.tagName !== 'g') return;
        if (c.classList.contains('blocklyConnectionIndicatorParent')) return;
        const t = tr(c);
        if (!t) return;
        const nx = t.x >= slotTr.x + sPill.w - 1 ? t.x + dx : t.x;
        c.setAttribute('transform', `translate(${nx},${t.y + dy})`);
      });
      Array.from(oRoot.querySelectorAll(':scope > path.blocklyHighlightedConnectionPath')).forEach(p => p.remove());

      // Swap the slot for the inner reporter (inner block origin = pill top-left)
      const innerClone = od.importNode(iRoot, true);
      innerClone.querySelectorAll('path.blocklyHighlightedConnectionPath').forEach(p => p.remove());
      innerClone.removeAttribute('data-aifx-type');
      innerClone.setAttribute('transform', `translate(${slotTr.x},${(newH - iPill.h) / 2})`);
      oRoot.replaceChild(innerClone, slot);

      // Carry over pattern defs the inner SVG may reference
      const iDefs = idoc.querySelector('defs');
      if (iDefs) {
        let oDefs = od.querySelector('defs');
        if (!oDefs) { oDefs = od.createElementNS('http://www.w3.org/2000/svg', 'defs'); oSvg.insertBefore(oDefs, oSvg.firstChild); }
        Array.from(iDefs.children).forEach(ch => {
          const id = ch.getAttribute('id');
          if (!id || !oDefs.querySelector('[id="' + id + '"]')) oDefs.appendChild(od.importNode(ch, true));
        });
      }

      const vb = (oSvg.getAttribute('viewBox') || '').trim().split(/\s+/).map(parseFloat);
      const vbW = (vb.length === 4 ? vb[2] : oPill.w + 4) + dx;
      const vbH = (vb.length === 4 ? vb[3] : oPill.h + 4) + (newH - oPill.h);
      oSvg.setAttribute('viewBox', `0 0 ${Math.ceil(vbW)} ${Math.ceil(vbH)}`);
      oSvg.setAttribute('width', String(Math.ceil(vbW)));
      oSvg.setAttribute('height', String(Math.ceil(vbH)));

      return {
        svg: new XMLSerializer().serializeToString(oSvg),
        width: Math.ceil(vbW),
        height: Math.ceil(vbH),
        category: outerData.category,
        isMultiLine: false
      };
    } catch (e) {
      return null;
    }
  }

  function getResolutionCacheKey(tokenText, resolution) {
    if (isNlpRenderable(resolution)) {
      return `${tokenText}::${resolution.template}::${JSON.stringify(resolution.params || {})}`;
    }
    return tokenText;
  }

  async function fetchAndRenderResolvedToken(resolution, tokenText) {
    if (!resolution) return null;
    if (resolution.template === 'nested_compose' && resolution.params && resolution.params.outer && resolution.params.inner) {
      const sub = (s) => fetchAndRenderResolvedToken({ template: s.template, params: s.params || {}, rule: { category: 'common' } }, '');
      const [outerData, innerData] = await Promise.all([sub(resolution.params.outer), sub(resolution.params.inner)]);
      return composeNestedReporter(outerData, innerData) || outerData;
    }
    if (resolution.template === 'direct_svg' && resolution.svgData) {
      return resolution.svgData;
    }
    if (resolution.template === 'toggleWinLose' || resolution.template === 'toggleOnOff') {
      return renderToggleToken(tokenText);
    }
    if (resolution.template === 'isolated_pill') {
      const prop = (resolution.params && resolution.params.prop !== undefined) ? resolution.params.prop : tokenText;
      const cat = (resolution.params && resolution.params.pillCategory) || resolution.rule.category;
      return generateIsolatedPropertyPill(prop, cat);
    }

    if (!catalogMap || !resolution.template) return null;
    const entry = catalogMap[resolution.template];
    if (!entry) return null;

    try {
      let rawSvg = rawSvgFileCache.get(entry.file);
      if (!rawSvg) {
        const url = (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.getURL) ? chrome.runtime.getURL('catalog/' + entry.file) : ('./catalog/' + entry.file);
        const res = await fetch(url);
        rawSvg = await res.text();
        rawSvgFileCache.set(entry.file, rawSvg);
      }
      const mutatedSvg = mutateSvgWithParams(rawSvg, resolution.params);

      let w = entry.width;
      let h = entry.height;
      const wMatch = mutatedSvg.match(/viewBox="0 0 ([\d.]+) ([\d.]+)"/);
      if (wMatch) {
        w = Math.ceil(parseFloat(wMatch[1]));
        h = Math.ceil(parseFloat(wMatch[2]));
      }

      return {
        svg: mutatedSvg,
        width: w,
        height: h,
        category: entry.type,
        isMultiLine: entry.isMultiLine
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

      /* Fix boolean toggles and switches so they never appear as black polygons */
      .aifx-rendered .blocklyToggleRect {
        fill: #808e9b !important;
        stroke: #485460 !important;
        stroke-width: 1.5px !important;
      }
      .aifx-rendered .blocklyToggleOn .blocklyToggleRect {
        fill: #2ecc71 !important;
        stroke: #27ae60 !important;
      }
      .aifx-rendered .blocklyToggleOff .blocklyToggleRect {
        fill: #808e9b !important;
        stroke: #485460 !important;
      }

      /* Prevent disabled or orphaned scratch workspace blocks from rendering faded */
      .aifx-rendered .blocklyDisabled {
        opacity: 1 !important;
      }
      .aifx-rendered .blocklyDisabled .blocklyPath,
      .aifx-rendered path.blocklyPath {
        fill-opacity: 1 !important;
        stroke-opacity: 1 !important;
      }

      /* Hide Blockly connection path highlights and indicators so puzzle piece notches/tabs and sockets never render black */
      .aifx-rendered .blocklyHighlightedConnectionPath,
      .aifx-rendered .blocklyConnectionIndicatorParent,
      .aifx-rendered .blocklyConnectionIndicator {
        display: none !important;
        fill: none !important;
        stroke: none !important;
        opacity: 0 !important;
      }

      .aifx-rendered.aifx-inline {
        display: inline-block !important;
        vertical-align: middle !important;
        max-width: 100% !important;
        margin: 1px 2px !important;
        line-height: 1 !important;
      }
      .aifx-rendered.aifx-inline svg {
        display: inline-block !important;
        vertical-align: middle !important;
        max-width: 100% !important;
        height: auto !important;
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
      app-step-information content,
      app-step-information content p,
      app-step-information content div,
      app-step-information content ul,
      app-step-information content ol,
      app-step-information content li {
        max-width: 100% !important;
        min-width: 0 !important;
        box-sizing: border-box !important;
      }
      app-step-information content {
        width: 100% !important;
        overflow-x: hidden !important;
        overflow-y: auto !important;
        max-height: none !important;
      }
      .aifx-rendered.aifx-multiline {
        display: block !important;
        max-width: 100% !important;
        width: fit-content !important;
        overflow: visible !important;
        margin: 6px 0 !important;
        padding: 2px 8px 6px 2px !important;
        clear: both !important;
        text-align: left !important;
        line-height: normal !important;
        box-sizing: border-box !important;
      }
      .aifx-rendered.aifx-multiline.aifx-wide {
        overflow-x: auto !important;
        overflow-y: hidden !important;
        padding: 6px 14px 14px 6px !important;
        scrollbar-width: thin !important;
      }
      .aifx-rendered svg,
      .aifx-rendered.aifx-multiline svg,
      .aifx-rendered.aifx-inline svg {
        overflow: visible !important;
      }
      .lesson-content,
      [data-instruction] {
        overflow-y: auto !important;
        max-height: none !important;
      }
      /* When extension is enabled */
      html:not(.aifx-disabled) .aifx-rendered:not([data-rendered="true"]) {
        display: none !important;
      }
      html:not(.aifx-disabled) .aifx-rendered:not([data-rendered="true"]) + .aifx-raw-fallback {
        display: inline !important;
      }
      html:not(.aifx-disabled) .aifx-rendered[data-rendered="true"] + .aifx-raw-fallback {
        display: none !important;
      }
      html:not(.aifx-disabled) .aifx-raw-fallback {
        display: none !important;
      }

      /* When extension is DISABLED: completely hide all rendered SVGs and show all original raw tokens */
      .aifx-disabled .aifx-rendered,
      .aifx-disabled .aifx-rendered.aifx-multiline,
      .aifx-disabled .aifx-rendered.aifx-inline,
      .aifx-disabled .aifx-rendered.aifx-play-icon {
        display: none !important;
      }
      .aifx-disabled .aifx-raw-fallback {
        display: inline !important;
      }
      .aifx-disabled strong:has(> .aifx-rendered.aifx-multiline),
      .aifx-disabled em:has(> .aifx-rendered.aifx-multiline) {
        display: inline !important;
        max-width: none !important;
      }
      .aifx-rendered.aifx-multiline svg {
        display: block !important;
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
    return !!el.closest('app-step-information content, [data-instruction], article, .lesson-content, .token-target-area');
  }

  let svgInstanceCounter = 0;

  function applySvg(span, data) {
    if (!span || !data || !data.svg) return;
    const tokenText = span.getAttribute('data-token') || '';
    const isPlayIcon = (tokenText === '▶' || tokenText === '[▶]');
    const blockParent = span.closest('p, li, div, app-step-information, article, .step, [data-instruction]') || span.parentElement;

    let proseLen = 0;
    if (blockParent) {
      const walker = document.createTreeWalker(blockParent, NodeFilter.SHOW_TEXT, null);
      let tNode;
      while ((tNode = walker.nextNode())) {
        const el = tNode.parentElement;
        if (el && el.closest('svg, style, .aifx-raw-fallback, .aifx-rendered')) continue;
        proseLen += (tNode.nodeValue || '').trim().length;
        if (proseLen > 2) break;
      }
    }
    const isInsideSentence = proseLen > 2;
    const h = data.height || 44;
    const isInlineTokenOverride = (tokenText === '[then]' || tokenText === '[else]' || tokenText === 'then' || tokenText === 'else');
    // Ultra-wide blocks (>520 units) must never shrink into micro-ribbons: keep a legible floor scale and scroll horizontally.
    const vbEarly = String(data.svg).match(/viewBox="\s*[-\d.]+\s+[-\d.]+\s+([\d.]+)\s+[\d.]+/);
    const svgWNat = vbEarly ? parseFloat(vbEarly[1]) : (data.width || 0);
    const isWide = !isPlayIcon && !isInlineTokenOverride && svgWNat > 520;
    const isMultiLine = !isPlayIcon && !isInlineTokenOverride && (isWide || data.isMultiLine || h > 72 || !isInsideSentence);

    // Scope SVG pattern IDs per instance and strip redundant 315KB @font-face declarations
    const uid = ++svgInstanceCounter;
    let safeSvg = String(data.svg)
      .replace(/@font-face\s*\{[^}]*\}/g, '')
      .replace(/text,\s*\.blocklyText/g, '.blocklyText')
      .replace(/aifx-checkered-tile/g, `aifx-checkered-tile-${uid}`)
      .replace(/aifx-checker/g, `aifx-checker-${uid}`);

    span.className = 'aifx-rendered ' + (isPlayIcon ? 'aifx-play-icon' : (isMultiLine ? 'aifx-multiline' : 'aifx-inline')) + (isWide ? ' aifx-wide' : '');
    span.innerHTML = safeSvg;
    span.setAttribute('data-rendered', 'true');

    const svgEl = span.querySelector('svg');
    if (svgEl) {
      if (isPlayIcon) {
        svgEl.style.display = 'inline-block';
        svgEl.style.verticalAlign = 'middle';
        svgEl.style.setProperty('width', '1.25em', 'important');
        svgEl.style.setProperty('height', '1.25em', 'important');
      } else {
        const vbMatch = (svgEl.getAttribute('viewBox') || '').trim().split(/\s+/);
        const actualSvgW = (vbMatch.length >= 3 ? parseFloat(vbMatch[2]) : null) || parseFloat(svgEl.getAttribute('width')) || data.width || 100;
        const actualSvgH = (vbMatch.length >= 4 ? parseFloat(vbMatch[3]) : null) || parseFloat(svgEl.getAttribute('height')) || data.height || 100;

        if (isMultiLine) {
          svgEl.style.display = 'block';
          const emScale = 1 / 22;
          const naturalEmWidth = (actualSvgW * emScale).toFixed(2);
          svgEl.style.setProperty('width', `${naturalEmWidth}em`, 'important');
          svgEl.style.setProperty('max-width', '100%', 'important');
          svgEl.style.setProperty('height', 'auto', 'important');
          if (isWide) {
            // min-width overrides max-width: block may shrink to 65% of natural size, then the wrapper scrolls.
            svgEl.style.setProperty('min-width', `${(actualSvgW * emScale * 0.65).toFixed(2)}em`, 'important');
            svgEl.style.setProperty('flex-shrink', '0', 'important');
          }
        } else {
          svgEl.style.display = 'inline-block';
          svgEl.style.verticalAlign = 'middle';
          let emH;
          if (actualSvgH <= 36) emH = 1.45;
          else if (actualSvgH <= 52) emH = 1.85;
          else if (actualSvgH <= 72) emH = 2.35;
          else emH = actualSvgH / 24;
          const emWidth = ((actualSvgW / actualSvgH) * emH).toFixed(2);
          svgEl.style.setProperty('width', `${emWidth}em`, 'important');
          svgEl.style.setProperty('max-width', '100%', 'important');
          svgEl.style.setProperty('height', 'auto', 'important');
        }
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
      if (dlt ? dlt === token : dt === token) {
        applySvg(span, data);
      }
    }
  }

  function isNlpRenderable(resolution) {
    return !!(resolution && (
      resolution.template === 'direct_svg' ||
      resolution.template === 'nested_compose' ||
      resolution.template === 'isolated_pill' ||
      resolution.template === 'toggleWinLose' ||
      resolution.template === 'toggleOnOff' ||
      (catalogMap && catalogMap[resolution.template] && catalogMap[resolution.template].file)
    ));
  }

  function resolveAndRenderSpan(span, tokenText) {
    if (!span || !tokenText) return;
    const stepArea = span.closest('app-step-information, [data-instruction], article, .lesson-content') || document.body;
    const stepText = (stepArea ? stepArea.textContent : '').toLowerCase();
    const overallText = (document.body ? document.body.textContent : '').toLowerCase();
    const rawNext = (span.nextElementSibling && span.nextElementSibling.classList.contains('aifx-raw-fallback'))
      ? span.nextElementSibling.nextSibling
      : span.nextSibling;
    const wrapEl = !rawNext ? span.closest('strong, em') : null;
    const nextNode = rawNext || (wrapEl ? wrapEl.nextSibling : null);
    const afterText = (nextNode && (nextNode.nodeValue || nextNode.textContent)) ? (nextNode.nodeValue || nextNode.textContent) : '';
    const resolution = (catalogMap && tokenRules.length > 0) ? resolveTokenWithNLP(tokenText, stepText, overallText, afterText) : null;
    const cacheKey = getResolutionCacheKey(tokenText, resolution);
    span.setAttribute('data-lookup-token', cacheKey);

    const cached = getStaticOrCached(cacheKey);
    if (cached && cached.svg) {
      applySvg(span, cached);
    } else if (cached && cached.svg === null) {
      span.textContent = tokenText;
      span.setAttribute('data-rendered', 'rejected');
    } else if (isNlpRenderable(resolution)) {
      fetchAndRenderResolvedToken(resolution, tokenText).then(data => {
        if (data && data.svg) {
          applyTokenToPage(cacheKey, data);
        } else {
          requestTokenRender(tokenText, tokenText, span);
        }
      }).catch(() => {
        requestTokenRender(tokenText, tokenText, span);
      });
    } else {
      requestTokenRender(tokenText, tokenText, span);
    }
  }

  // Scans all unrendered spans and applies cached SVGs immediately
  function applyCacheToPage() {
    if (!isTargetBelt()) return;
    const spans = document.querySelectorAll('span.aifx-rendered:not([data-rendered="true"])');
    for (const span of spans) {
      const tokenText = span.getAttribute('data-token') || span.textContent || '';
      resolveAndRenderSpan(span, tokenText);
    }
  }

  // Retries requests for unrendered spans currently in the DOM
  function retryPendingTokens() {
    const spans = document.querySelectorAll('span.aifx-rendered:not([data-rendered="true"])');
    for (const span of spans) {
      const tokenText = span.getAttribute('data-token') || span.getAttribute('data-lookup-token') || '';
      resolveAndRenderSpan(span, tokenText);
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

    const markRejected = (s) => {
      if (!s) return;
      s.textContent = s.getAttribute('data-token') || tokenText;
      s.setAttribute('data-rendered', 'rejected');
    };

    function doSend(retryCount) {
      try {
        chrome.runtime.sendMessage({ action: 'renderToken', token: tokenText }, (res) => {
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
            let nlpStarted = false;
            const liveWaiters = waiters.filter(s => s && s.isConnected && s.getAttribute('data-rendered') !== 'true');
            if (liveWaiters.length && catalogMap && tokenRules.length > 0) {
              const first = liveWaiters[0];
              const stepArea = first.closest('app-step-information, [data-instruction], article, .lesson-content') || document.body;
              const stepText = (stepArea ? stepArea.textContent : '').toLowerCase();
              const overallText = (document.body ? document.body.textContent : '').toLowerCase();
              const resolution = resolveTokenWithNLP(tokenText, stepText, overallText);
              if (resolution) {
                nlpStarted = true;
                fetchAndRenderResolvedToken(resolution, tokenText).then(data => {
                  if (data && data.svg) {
                    svgCache.set(tokenText, data);
                    applyTokenToPage(tokenText, data);
                    if (tokenText !== lookupToken) applyTokenToPage(lookupToken, data);
                  } else {
                    liveWaiters.forEach(markRejected);
                  }
                }).catch(() => {
                  liveWaiters.forEach(markRejected);
                });
              }
            }
            if (!nlpStarted) {
              liveWaiters.forEach(markRejected);
            }
          }
        });
      } catch (e) {
        if (retryCount < 5) {
          setTimeout(() => doSend(retryCount + 1), 1000);
        } else {
          const waiters = pendingRequests.get(lookupToken) || [];
          pendingRequests.delete(lookupToken);
          waiters.forEach(markRejected);
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
            const hasPriorOp = /[=!<>\u2264\u2265\u2260]/.test(before) || /\b(and|or)\b/i.test(before);
            const hasClosingAfter = /^[a-zA-Z0-9_\s.()\[\]\u2264\u2265\u2260]+>/.test(remaining);

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
        if (!shouldSkipToken(text, i, i + 24)) pushToken(i, i + 24);
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
              if (!shouldSkipToken(text, start, j)) pushToken(start, j);
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
          const end = i + compMatch[0].length;
          if (!shouldSkipToken(text, i, end)) pushToken(i, end);
          i = end;
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
              if (!shouldSkipToken(text, start, j)) pushToken(start, j);
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
          if (!shouldSkipToken(text, i, end)) pushToken(i, end);
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
    if (!isTargetBelt()) return;
    if (!node || node.nodeType !== 3) return;
    if (node.parentElement && (
      node.parentElement.closest('.aifx-rendered') ||
      node.parentElement.closest('.aifx-raw-fallback') ||
      node.parentElement.closest('[data-token]') ||
      node.parentElement.closest('code, pre, .ql-font-monospace, .code-block')
    )) return;

    const text = node.nodeValue || '';
    if (!text.includes('[') && !text.includes('(') && !text.includes('<') && !text.includes('▶')) return;

    const segments = tokenizeText(text);
    if (!segments.some(s => s.isToken)) return;

    const parent = node.parentElement;
    if (!parent || !isInstructionArea(parent)) return;

    const fragment = document.createDocumentFragment();
    const mountedTasks = [];
    let replaced = false;

    for (const seg of segments) {
      if (!seg.isToken) {
        if (seg.text) fragment.appendChild(document.createTextNode(seg.text));
        continue;
      }

      const tokenText = seg.text;

      const span = document.createElement('span');
      span.className = 'aifx-rendered';
      span.setAttribute('data-token', tokenText);

      const fallback = document.createElement('span');
      fallback.className = 'aifx-raw-fallback';
      fallback.textContent = tokenText;

      mountedTasks.push({ span, tokenText });

      fragment.appendChild(span);
      fragment.appendChild(fallback);
      replaced = true;
    }

    if (replaced && parent.contains(node)) {
      parent.replaceChild(fragment, node);
      for (const { span, tokenText } of mountedTasks) {
        resolveAndRenderSpan(span, tokenText);
      }
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
    const cta = document.querySelector('.header-cta') || document.querySelector('#aifx-toggle-slot');
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

  function isTargetBelt() {
    // Strictly optimize for White Belt through Green Belt; exclude Blue Belt and beyond
    const headingEl = document.querySelector('app-activity-title h3, .title-container h3, app-activity-title, app-activity-bar, app-makecode-top-bar, .heading-container');
    const heading = headingEl ? headingEl.textContent.trim().toLowerCase() : '';
    if (heading) {
      if (heading.includes('blue belt')) return false;
      if (/purple\s+belt|brown\s+belt|red\s+belt|black\s+belt/.test(heading)) return false;
      if (/white\s+belt|yellow\s+belt|orange\s+belt|green\s+belt/.test(heading)) return true;
    }

    const bodyText = document.body ? document.body.innerText.slice(0, 1500).toLowerCase() : '';
    if (bodyText.includes('blue belt')) return false;
    if (/purple\s+belt|brown\s+belt|red\s+belt|black\s+belt/.test(bodyText)) return false;

    return true;
  }

  function scan() {
    if (!isTargetBelt()) return;
    // Disconnect observer temporarily to avoid self-triggering during DOM mutations
    observer.disconnect();
    try {
    injectStyles();
    ensureToggleButton();
    // Strictly query content containers only
    const areas = document.querySelectorAll('app-step-information content, [data-instruction], article, .lesson-content, .token-target-area');
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
    } finally {
      // Reconnect observer after scan completes
      observer.observe(document.body || document.documentElement, {
        subtree: true,
        childList: true,
        characterData: true
      });
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
    document.addEventListener('DOMContentLoaded', () => setTimeout(scan, 100));
  } else {
    setTimeout(scan, 100);
  }
})();
