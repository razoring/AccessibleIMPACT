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
  } catch (e) { }

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

  // ---------------------------------------------------------------------------
  // Text measurement + shared dropdown arrow icon
  // ---------------------------------------------------------------------------
  let _measureCtx = null;
  function measureTextWidth(text, px, weight, fontFamily) {
    const str = String(text === undefined || text === null ? '' : text);
    try {
      if (typeof document !== 'undefined') {
        if (!_measureCtx) {
          const c = document.createElement('canvas');
          _measureCtx = c.getContext('2d');
        }
        if (_measureCtx) {
          _measureCtx.font = (weight || 600) + ' ' + (px || 16) + 'px ' + (fontFamily || 'Consolas, Monaco, Menlo, "Ubuntu Mono", source-code-pro, monospace');
          const w = _measureCtx.measureText(str).width;
          // glyph advances are hinted at the displayed (scaled) size and render differently than canvas when scaled; leave a little headroom
          if (w > 0) return w * 1.005;
        }
      }
    } catch (e) { /* fall through */ }
    return str.length * (px || 16) * 0.6;
  }
  // Per-character advance of the font the SVGs actually render with on this machine (16px / 600)
  const CHAR_W = (() => {
    const w = measureTextWidth('0000000000', 16, 600) / 10;
    return (w > 6 && w < 14) ? w : 9.6;
  })();

  // The same dropdown-arrow image MakeCode uses inside every field (so pills match real blocks)
  const DROPDOWN_ARROW_URL = (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.getURL)
    ? chrome.runtime.getURL('catalog/dropdown_arrow.svg')
    : './catalog/dropdown_arrow.svg';
  function dropdownArrowImage(x, y) {
    return '<image width="12" height="12" x="' + x + '" y="' + y + '" xlink:href="' + DROPDOWN_ARROW_URL + '" href="' + DROPDOWN_ARROW_URL + '"/>';
  }

  // ---------------------------------------------------------------------------
  // Absolute-coordinate path utilities (used to offset block outlines, never scale them)
  // ---------------------------------------------------------------------------
  function parsePathAbs(d) {
    const toks = String(d || '').match(/[MmLlHhVvCcAaZz]|-?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?|[SsQqTt]/g) || [];
    const segs = [];
    let i = 0, cx = 0, cy = 0, sx = 0, sy = 0, cmd = null;
    const isCmd = (t) => /^[A-Za-z]$/.test(t);
    const num = () => parseFloat(toks[i++]);
    let guard = 0;
    while (i < toks.length) {
      if (++guard > 20000) return null;
      if (isCmd(toks[i])) { cmd = toks[i++]; }
      else if (cmd === 'M') cmd = 'L';
      else if (cmd === 'm') cmd = 'l';
      else if (cmd === null || cmd === 'Z' || cmd === 'z') return null;
      const rel = cmd === cmd.toLowerCase();
      switch (cmd.toUpperCase()) {
        case 'M': { let x = num(), y = num(); if (rel) { x += cx; y += cy; } cx = sx = x; cy = sy = y; segs.push({ c: 'M', a: [x, y] }); break; }
        case 'L': { let x = num(), y = num(); if (rel) { x += cx; y += cy; } cx = x; cy = y; segs.push({ c: 'L', a: [x, y] }); break; }
        case 'H': { let x = num(); if (rel) x += cx; cx = x; segs.push({ c: 'H', a: [x] }); break; }
        case 'V': { let y = num(); if (rel) y += cy; cy = y; segs.push({ c: 'V', a: [y] }); break; }
        case 'C': {
          const a = [num(), num(), num(), num(), num(), num()];
          if (rel) { for (let k = 0; k < 6; k += 2) { a[k] += cx; a[k + 1] += cy; } }
          cx = a[4]; cy = a[5]; segs.push({ c: 'C', a }); break;
        }
        case 'A': {
          const rx = num(), ry = num(), rot = num(), large = num(), sweep = num();
          let x = num(), y = num(); if (rel) { x += cx; y += cy; }
          cx = x; cy = y; segs.push({ c: 'A', a: [rx, ry, rot, large, sweep, x, y] }); break;
        }
        case 'Z': { cx = sx; cy = sy; segs.push({ c: 'Z', a: [] }); cmd = null; break; }
        default: return null;
      }
      for (const s of segs) for (const v of s.a) if (!isFinite(v)) return null;
    }
    return segs;
  }

  function pathXs(segs) {
    const xs = [];
    segs.forEach(s => {
      if (s.c === 'M' || s.c === 'L') xs.push(s.a[0]);
      else if (s.c === 'H') xs.push(s.a[0]);
      else if (s.c === 'C') xs.push(s.a[0], s.a[2], s.a[4]);
      else if (s.c === 'A') xs.push(s.a[5]);
    });
    return xs;
  }
  function pathMaxX(d) {
    const segs = parsePathAbs(d);
    if (!segs) return null;
    const xs = pathXs(segs);
    return xs.length ? Math.max.apply(null, xs) : null;
  }
  function pathMinX(d) {
    const segs = parsePathAbs(d);
    if (!segs) return null;
    const xs = pathXs(segs);
    return xs.length ? Math.min.apply(null, xs) : null;
  }

  // Moves the outline's right-hand edge (corner radius + everything right of it) by `delta`.
  // Notches, mouths and left corners stay put. Returns the new absolute path, or null if unparseable.
  function shiftPathRight(d, delta) {
    const segs = parsePathAbs(d);
    if (!segs) return null;
    const xs = pathXs(segs);
    if (!xs.length) return null;
    const xmax = Math.max.apply(null, xs);
    const firstArc = segs.find(s => s.c === 'A');
    const firstM = segs.find(s => s.c === 'M');
    const R = firstArc ? Math.abs(firstArc.a[0]) : (firstM ? Math.abs(firstM.a[0]) : 0);
    const T = xmax - R - 0.5;
    const sh = (x) => (x >= T ? x + delta : x);
    const f = (n) => String(Math.round(n * 1000) / 1000);
    return segs.map(s => {
      switch (s.c) {
        case 'M': return 'M ' + f(sh(s.a[0])) + ',' + f(s.a[1]);
        case 'L': return 'L ' + f(sh(s.a[0])) + ',' + f(s.a[1]);
        case 'H': return 'H ' + f(sh(s.a[0]));
        case 'V': return 'V ' + f(s.a[0]);
        case 'C': return 'C ' + f(sh(s.a[0])) + ',' + f(s.a[1]) + ' ' + f(sh(s.a[2])) + ',' + f(s.a[3]) + ' ' + f(sh(s.a[4])) + ',' + f(s.a[5]);
        case 'A': return 'A ' + f(s.a[0]) + ' ' + f(s.a[1]) + ' ' + f(s.a[2]) + ' ' + f(s.a[3]) + ' ' + f(s.a[4]) + ' ' + f(sh(s.a[5])) + ',' + f(s.a[6]);
        default: return 'Z';
      }
    }).join(' ');
  }

  // Exact category fills/strokes matching MakeCode catalog SVGs
  const PILL_THEME = {
    statusbars_property: ['#38364d', '#2a293a', 4],
    statusbars: ['#38364d', '#2a293a', 4],
    statusbars_kind: ['#5d4d8c', '#52447c', 15],
    logic: ['#45aaf2', '#3480b6', 6],
    scene: ['#4b6584', '#384c63', 6],
    game: ['#8854d0', '#663f9c', 6],
    controller: ['#d54322', '#a0321a', 6],
    music: ['#e30fc0', '#aa0b90', 6],
    scroller: ['#ff85a7', '#bf647d', 6],
    tileScanner: ['#4963ab', '#374a80', 6],
    mp: ['#207a77', '#185c59', 6],
    multiplayer: ['#207a77', '#185c59', 6],
    math: ['#a55eea', '#7c47b0', 6],
    loops: ['#20bf6b', '#188f50', 6],
    info: ['#cf6a87', '#9b5065', 6],
    images: ['#a5b1c2', '#7c8592', 6],
    animation: ['#03aa74', '#028057', 6],
    browserEvents: ['#9c1355', '#750e40', 6],
    story: ['#b36634', '#864d27', 6],
    miniMenu: ['#36b58b', '#298868', 6],
    functions: ['#1446a0', '#0f3578', 6],
    console: ['#002050', '#00183c', 6],
    sprites: ['#4b7bec', '#385cb1', 6]
  };

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
        charw: CHAR_W,
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
        charw: CHAR_W,
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
        charw: CHAR_W,
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
        charw: CHAR_W,
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
          charw: CHAR_W,
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
          charw: CHAR_W,
          value: m ? m[1] : '0',
          visualX: getVisualX(g)
        });
      }
    });

    const toggles = [];
    root.querySelectorAll('g.toggleOnOff, g.toggleWinLose').forEach(blockEl => {
      if (!isHiddenElement(blockEl)) toggles.push(blockEl);
    });


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

    // ---- geometry-driven reflow ---------------------------------------------
    // Everything below OFFSETS geometry by (measuredTextWidth - currentWidth); nothing is scaled or multiplied.
    //  * growBlock(): shifts the block's right-hand children by delta, moves the block outline's right edge by delta
    //    (absolute-coordinate path rewrite), then bubbles up through value-block ancestors to the root viewBox.
    //  * Fields are re-measured with the real rendered font, so unedited fields that were laid out for a narrower
    //    font are also corrected (arrow/text overlap).  Labels are pushed off their right-hand neighbours.
    const svgEl = doc.documentElement;
    let changed = toggleChanged;

    const setTx = (el, x, y) => el.setAttribute('transform', 'translate(' + x + ',' + y + ')');
    const directPath = (blockEl) => Array.from(blockEl.children || []).find(c => c.tagName === 'path' && c.classList.contains('blocklyPath'));
    const blockWidth = (blockEl) => {
      const p = directPath(blockEl);
      const m = p ? pathMaxX(p.getAttribute('d') || '') : null;
      return m === null ? 0 : m;
    };
    const isValueBlock = (blockEl) => {
      const p = directPath(blockEl);
      const d = p ? (p.getAttribute('d') || '') : '';
      return !!d && !/c\s*-?2,0\s+-?3,-?1/.test(d);
    };

    const growBlock = (blockEl, atX, delta) => {
      if (!blockEl || Math.abs(delta) < 0.01) return;
      const oldW = blockWidth(blockEl);
      Array.from(blockEl.children || []).forEach(ch => {
        if (ch.tagName === 'g') {
          if (ch.classList.contains('blocklyConnectionIndicatorParent')) return;
          // statement children live in the C-block mouth (left-anchored): never shift them
          if (ch.classList.contains('blocklyBlock') && !isValueBlock(ch)) return;
          const t = parseTranslate(ch);
          if (t && t.x >= atX - 0.5) setTx(ch, t.x + delta, t.y);
        } else if (ch.tagName === 'path' && ch.classList.contains('blocklyOutlinePath')) {
          // absolute-coordinate outline (e.g. empty shadow slot): offset as a whole
          const minX = pathMinX(ch.getAttribute('d') || '');
          if (minX !== null && minX >= atX - 0.5) {
            const t = parseTranslate(ch) || { x: 0, y: 0 };
            setTx(ch, t.x + delta, t.y);
          }
        }
      });
      const p = directPath(blockEl);
      if (p) {
        const nd = shiftPathRight(p.getAttribute('d') || '', delta);
        if (nd) p.setAttribute('d', nd);
      }
      changed = true;
      if (blockEl === root) {
        const vb = (svgEl.getAttribute('viewBox') || '').match(/^([\d.-]+)\s+([\d.-]+)\s+([\d.]+)\s+([\d.]+)$/);
        if (vb) {
          const nextW = Math.ceil((parseFloat(vb[3]) + delta) * 2) / 2;
          svgEl.setAttribute('viewBox', vb[1] + ' ' + vb[2] + ' ' + nextW + ' ' + vb[4]);
          if (svgEl.hasAttribute('width')) svgEl.setAttribute('width', String(Math.ceil(parseFloat(svgEl.getAttribute('width')) + delta)));
        }
        return;
      }
      // value blocks (reporters / shadows) sit inline in their parent row: the parent grows with them
      const parent = blockEl.parentNode;
      const bt = parseTranslate(blockEl);
      if (parent && parent.nodeType === 1 && parent.tagName === 'g' && bt && isValueBlock(blockEl)) {
        growBlock(parent, bt.x + oldW - 2, delta);
      }
    };

    const arrowOf = (g) => Array.from(g.children || []).find(c => c.tagName === 'image');
    const rectOf = (g) => Array.from(g.children || []).find(c => c.tagName === 'rect');

    const requiredFieldWidth = (g, len) => {
      const textEl = getMainTextEl(g);
      const textX = parseFloat((textEl && textEl.getAttribute('x')) || '0') || 0;
      const hasArrow = !!arrowOf(g);
      // text + gap(8) + arrow(12) + right pad(8 when the text is inset, 0 otherwise)
      const hasQuotes = !!g.querySelector('text.field-text-quote');
      const tail = hasArrow ? (textX > 0 ? 28 : 20) : (hasQuotes ? 12 : (textX > 0 ? 12 : 0));
      return Math.ceil((textX + len * CHAR_W + tail) * 2) / 2;
    };

    const applyFieldEdit = (f, newText, force) => {
      const g = f.g;
      const textEl = getMainTextEl(g);
      if (!textEl) return;
      const cBlock = f.containerBlock || root;
      const currentText = (textEl.textContent || '').replace(/\u00a0/g, ' ').trim();
      if (!force && currentText === newText) return;

      if (f.kind === 'function_name') {
        textEl.textContent = 'function ' + newText;
        changed = true;
        return; // label pass below pushes right-hand siblings / block edge
      }
      if (f.kind === 'from_label') {
        textEl.textContent = 'from ' + newText + ' to';
        changed = true;
        return;
      }

      const oldLen = currentText.length;
      if (!force) textEl.textContent = newText;
      const newLen = newText.length;

      // Convert white math_number shadow into red/magenta variable reporter when fed an identifier
      const isNumShadow = cBlock && (cBlock.classList.contains('math_number') || cBlock.classList.contains('math_whole_number'));
      const trimmedEdit = newText.trim();
      const isIdent = !force && isNumShadow && /^[a-zA-Z_][a-zA-Z0-9_\s]*$/.test(trimmedEdit) && !/^(true|false)$/i.test(trimmedEdit);
      if (isIdent) {
        const isInfoHud = /^(score|life)$/i.test(trimmedEdit);
        const fillCol = isInfoHud ? '#cf6a87' : '#ec3b59';
        const strokeCol = isInfoHud ? '#9b5065' : '#b12c43';
        cBlock.classList.remove('math_number', 'math_whole_number', 'blocklyShadow');
        cBlock.classList.add('variables_get');
        g.classList.remove('blocklyNumberField');
        const sp = directPath(cBlock);
        if (sp) {
          sp.setAttribute('fill', fillCol);
          sp.setAttribute('stroke', strokeCol);
          const st = sp.getAttribute('style') || '';
          sp.setAttribute('style', st.replace(/fill\s*:[^;]+;?/gi, '').replace(/stroke\s*:[^;]+;?/gi, '') + `fill:${fillCol};stroke:${strokeCol};`);
        }
        const tst = textEl.getAttribute('style') || '';
        textEl.setAttribute('style', tst.replace(/fill\s*:[^;]+;?/gi, '') + 'fill:#ffffff !important;');
      }

      const rect = rectOf(g);
      const arrow = arrowOf(g);
      const gtr = parseTranslate(g) || { x: 0, y: 0 };
      let delta = 0;
      let oldRight = gtr.x;

      if (rect) {
        const curW = parseFloat(rect.getAttribute('width') || '0');
        let newW = requiredFieldWidth(g, newLen);
        if (force) { if (newW <= curW + 0.5) return; }
        else if (newLen < oldLen) newW = Math.max(newW, arrow ? 40 : 17);
        delta = newW - curW;
        oldRight = gtr.x + curW;
        if (Math.abs(delta) > 0.01) rect.setAttribute('width', String(newW));
        const rq = Array.from(g.querySelectorAll('text.field-text-quote'))[1];
        if (rq) {
          const rqt = parseTranslate(rq) || { x: 0, y: 10 };
          setTx(rq, (parseFloat(textEl.getAttribute('x') || '0') || 0) + newLen * CHAR_W + 4, rqt.y);
        }
      } else {
        const textX = parseFloat(textEl.getAttribute('x') || '0') || 0;
        const closeQ = Array.from(g.querySelectorAll('text.field-text-quote'))[1];
        if (closeQ) {
          // quoted text: the closing quote sits right after the text; offset it, never scale
          const qt = parseTranslate(closeQ) || { x: 0, y: 10 };
          const wantX = textX + newLen * CHAR_W + 4;
          delta = wantX - qt.x;
          if (force && delta <= 0.5) return;
          setTx(closeQ, wantX, qt.y);
          oldRight = gtr.x + qt.x + 8;
        } else {
          if (force) return;
          if (isNumShadow && oldLen <= 1 && newLen > 1) {
            textEl.setAttribute('x', '0');
            setTx(g, 12, gtr.y);
          }
          const am = arrow ? parseTranslate(arrow) : null;
          oldRight = gtr.x + (am ? am.x + 12 : textX + oldLen * CHAR_W + 4);
          delta = (newLen - oldLen) * CHAR_W;
        }
      }

      if (Math.abs(delta) < 0.01) return;
      changed = true;
      if (arrow) {
        if (arrow.hasAttribute('x')) arrow.setAttribute('x', String(parseFloat(arrow.getAttribute('x')) + delta));
        const am = parseTranslate(arrow);
        if (am) setTx(arrow, am.x + delta, am.y);
      }
      growBlock(cBlock, oldRight - 2, delta);
    };

    // 1. requested edits
    for (const edit of edits) applyFieldEdit(edit.field, edit.text, false);

    // 2. re-measure every other editable field against the real rendered font
    for (const f of fields) {
      if (edits.some(e => e.field === f)) continue;
      if (f.kind === 'function_name' || f.kind === 'from_label') continue;
      const tEl = getMainTextEl(f.g);
      if (!tEl) continue;
      applyFieldEdit(f, (tEl.textContent || '').replace(/\u00a0/g, ' ').trim(), true);
    }

    // 3. labels: keep a gap to the next element in their row, and keep the block's right edge past the last one
    const allBlocks = [root].concat(Array.from(root.querySelectorAll('g.blocklyBlock'))).filter(b => !isHiddenElement(b));
    for (const blk of allBlocks.slice().reverse()) {
      for (let guard = 0; guard < 24; guard++) {
        let pushed = false;
        const kids = Array.from(blk.children || []).filter(c => c.tagName === 'g' && !c.classList.contains('blocklyConnectionIndicatorParent') && parseTranslate(c));
        const labels = kids.filter(c => c.classList.contains('blocklyLabelField')).sort((a, b) => parseTranslate(a).x - parseTranslate(b).x);
        for (const L of labels) {
          const txt = L.querySelector('text');
          const str = txt ? (txt.textContent || '') : '';
          if (!str.trim()) continue;
          const lt = parseTranslate(L);
          const right = lt.x + (parseFloat(txt.getAttribute('x') || '0') || 0) + str.length * CHAR_W;
          const next = kids
            .filter(s => s !== L && !isHiddenElement(s) && !(s.classList.contains('blocklyBlock') && !isValueBlock(s)))
            .map(s => ({ s, t: parseTranslate(s) }))
            .filter(o => o.t.x > lt.x + 0.5 && Math.abs(o.t.y - lt.y) < 30)
            .sort((a, b) => a.t.x - b.t.x)[0];
          if (next) {
            const gap = next.t.x - right;
            if (gap < 5) { growBlock(blk, next.t.x, right + 8 - next.t.x); pushed = true; break; }
          } else {
            const W = blockWidth(blk);
            if (W > 0 && right + 8 > W) { growBlock(blk, 1e9, right + 8 - W); pushed = true; break; }
          }
        }
        if (!pushed) break;
      }
    }

    if (!changed) return null;

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

    // 0a. Property pill template mutation
    if (s.includes('class="pill-rect"')) {
      let text = (params.prop !== undefined ? params.prop : (params.varName || '')).trim();
      while (
        (text.startsWith('[') && text.endsWith(']')) ||
        (text.startsWith('(') && text.endsWith(')')) ||
        (text.startsWith('<') && text.endsWith('>'))
      ) {
        text = text.slice(1, -1).trim();
      }
      const cat = params.pillCategory || 'sprites';
      const [bg, stroke, rx] = PILL_THEME[cat] || PILL_THEME.sprites;
      const textWidth = Math.ceil(measureTextWidth(text, 15, 600));
      const totalWidth = 10 + textWidth + 8 + 12 + 8;
      const height = 30;
      const arrowX = 10 + textWidth + 8;
      s = s.replace(/viewBox="0 0 \d+(?:\.\d+)? \d+(?:\.\d+)?"/, `viewBox="0 0 ${totalWidth} ${height}"`);
      s = s.replace(/width="\d+(?:\.\d+)?"/, `width="${totalWidth}"`);
      s = s.replace(/height="\d+(?:\.\d+)?"/, `height="${height}"`);
      s = s.replace(/class="pill-rect"[^>]*\/>/, `class="pill-rect" x="1" y="1" width="${totalWidth - 2}" height="${height - 2}" rx="${rx}" ry="${rx}" fill="${bg}" stroke="${stroke}" stroke-width="1.5"/>`);
      s = s.replace(/<text class="pill-text"[^>]*>[^<]*<\/text>/, `<text class="pill-text" x="10" y="${height / 2}" style="font-family:Consolas,Monaco,Menlo,monospace !important;font-size:15px !important;font-weight:600 !important;fill:#ffffff !important;stroke:none !important;text-anchor:start !important;dominant-baseline:central !important;">${escapeXml(text)}</text>`);
      s = s.replace(/class="pill-arrow"[^>]*\/>/, `class="pill-arrow" width="12" height="12" x="${arrowX}" y="9" xlink:href="${DROPDOWN_ARROW_URL}" href="${DROPDOWN_ARROW_URL}"/>`);
      return s;
    }

    // 0b. Variable reporter bubble template mutation
    if (s.includes('class="bubble-rect"')) {
      const label = (params.varName || '').replace(/[\[\]\(\)]/g, '').trim();
      const textWidth = Math.ceil(measureTextWidth(label, 16, 600));
      const totalWidth = Math.max(48, textWidth + 24);
      const height = 32;
      const r = (height - 1) / 2;
      const bg = params.bg || '#ec3b59';
      const stroke = params.stroke || '#b12c43';
      s = s.replace(/viewBox="0 0 \d+(?:\.\d+)? \d+(?:\.\d+)?"/, `viewBox="0 0 ${totalWidth} ${height}"`);
      s = s.replace(/width="\d+(?:\.\d+)?"/, `width="${totalWidth}"`);
      s = s.replace(/height="\d+(?:\.\d+)?"/, `height="${height}"`);
      s = s.replace(/class="bubble-rect"[^>]*\/>/, `class="bubble-rect" x="0.5" y="0.5" width="${totalWidth - 1}" height="${height - 1}" rx="${r}" ry="${r}" fill="${bg}" stroke="${stroke}" stroke-width="1.5"/>`);
      s = s.replace(/<text class="bubble-text"[^>]*>[^<]*<\/text>/, `<text class="bubble-text" x="${totalWidth / 2}" y="${height / 2}" style="font-family:Consolas,Monaco,Menlo,monospace !important;font-size:16px !important;font-weight:600 !important;fill:#ffffff !important;stroke:none !important;text-anchor:middle !important;dominant-baseline:central !important;">${escapeXml(label)}</text>`);
      return s;
    }

    // 0c. Boolean reporter bubble template mutation
    if (s.includes('class="bubble-poly"')) {
      const label = (params.varName || '').replace(/[<>\[\]\(\)]/g, '').trim();
      const textWidth = Math.ceil(measureTextWidth(label, 16, 600));
      const height = 32;
      const half = height / 2;
      const totalWidth = Math.max(60, textWidth + 24 + height);
      const pts = `${half},1 ${totalWidth - half},1 ${totalWidth - 1},${half} ${totalWidth - half},${height - 1} ${half},${height - 1} 1,${half}`;
      s = s.replace(/viewBox="0 0 \d+(?:\.\d+)? \d+(?:\.\d+)?"/, `viewBox="0 0 ${totalWidth} ${height}"`);
      s = s.replace(/width="\d+(?:\.\d+)?"/, `width="${totalWidth}"`);
      s = s.replace(/height="\d+(?:\.\d+)?"/, `height="${height}"`);
      s = s.replace(/class="bubble-poly"[^>]*\/>/, `class="bubble-poly" points="${pts}" fill="#ec3b59" stroke="#b12c43" stroke-width="1.5"/>`);
      s = s.replace(/<text class="bubble-text"[^>]*>[^<]*<\/text>/, `<text class="bubble-text" x="${totalWidth / 2}" y="${height / 2}" style="font-family:Consolas,Monaco,Menlo,monospace !important;font-size:16px !important;font-weight:600 !important;fill:#ffffff !important;stroke:none !important;text-anchor:middle !important;dominant-baseline:central !important;">${escapeXml(label)}</text>`);
      return s;
    }

    // 0d. Section label pill template mutation
    if (s.includes('class="section-rect"')) {
      const label = (params.label || params.prop || 'else').trim();
      const w = Math.max(54, Math.ceil(measureTextWidth(label, 15, 700) + 22));
      const h = 30;
      s = s.replace(/viewBox="0 0 \d+(?:\.\d+)? \d+(?:\.\d+)?"/, `viewBox="0 0 ${w} ${h}"`);
      s = s.replace(/width="\d+(?:\.\d+)?"/, `width="${w}"`);
      s = s.replace(/height="\d+(?:\.\d+)?"/, `height="${h}"`);
      s = s.replace(/class="section-rect"[^>]*\/>/, `class="section-rect" x="1" y="1" width="${w - 2}" height="${h - 2}" rx="6" ry="6" fill="#45aaf2" stroke="#3480b6" stroke-width="1.5"/>`);
      s = s.replace(/<text class="section-text"[^>]*>[^<]*<\/text>/, `<text class="section-text" x="${w / 2}" y="${h / 2}" style="font-family:Consolas,Monaco,Menlo,monospace !important;font-size:15px !important;font-weight:700 !important;fill:#ffffff !important;stroke:none !important;text-anchor:middle !important;dominant-baseline:central !important;">${escapeXml(label)}</text>`);
      return s;
    }

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

    // Only blocks that actually contain a unction <name> label take a NAME (never reshape unrelated blocks)
    if ((params.NAME || params.function_name) && /(?:>function\s+[a-zA-Z0-9_]+<\/text>)/.test(s)) {
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
        const mapUrl = (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.getURL) ? chrome.runtime.getURL('catalog/lookup.json') : './catalog/lookup.json';
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

  function getCleanNodeText(el) {
    if (!el) return '';
    let out = '';
    const walk = (n) => {
      if (!n) return;
      if (n.nodeType === 3) {
        out += n.nodeValue || '';
      } else if (n.nodeType === 1) {
        if (n.matches && n.matches('svg, style, .aifx-raw-fallback')) return;
        if (n.classList && n.classList.contains('aifx-rendered')) {
          out += ' ' + (n.getAttribute('data-token') || '') + ' ';
          return;
        }
        for (let c = n.firstChild; c; c = c.nextSibling) walk(c);
      }
    };
    walk(el);
    return out.replace(/\s+/g, ' ').trim();
  }

  function extractSpanContext(span) {
    const stepArea = (span && span.closest('app-step-information, [data-instruction], article, .lesson-content, .token-target-area')) || document.body;
    const stepText = getCleanNodeText(stepArea).toLowerCase();
    const overallText = (document.body ? document.body.textContent : '').toLowerCase();

    const localEl = (span && span.closest('p, li')) || stepArea;
    let beforeLocal = '';
    let afterLocal = '';
    let seenSpan = false;
    const walkSplit = (n) => {
      if (!n) return;
      if (n === span) { seenSpan = true; return; }
      if (n.nodeType === 3) {
        if (seenSpan) afterLocal += n.nodeValue || '';
        else beforeLocal += n.nodeValue || '';
      } else if (n.nodeType === 1) {
        if (n.matches && n.matches('svg, style, .aifx-raw-fallback')) return;
        if (n.classList && n.classList.contains('aifx-rendered')) {
          const tok = ' ' + (n.getAttribute('data-token') || '') + ' ';
          if (seenSpan) afterLocal += tok;
          else beforeLocal += tok;
          return;
        }
        for (let c = n.firstChild; c; c = c.nextSibling) walkSplit(c);
      }
    };
    if (localEl) walkSplit(localEl);

    const beforeNorm = beforeLocal.replace(/\s+/g, ' ').trim().toLowerCase();
    const afterNorm = afterLocal.replace(/\s+/g, ' ').trim().toLowerCase();
    const localText = (beforeNorm + ' ' + afterNorm).trim();

    const sentBefore = beforeNorm.split(/[.!?](?:\s+|$)/).pop() || '';
    const sentAfter = afterNorm.split(/[.!?](?:\s+|$)/)[0] || '';
    const sentenceText = (sentBefore + ' ' + sentAfter).trim();

    const rawNext = (span && span.nextElementSibling && span.nextElementSibling.classList.contains('aifx-raw-fallback'))
      ? span.nextElementSibling.nextSibling
      : (span ? span.nextSibling : null);
    const wrapEl = (span && !rawNext) ? span.closest('strong, em') : null;
    const nextNode = rawNext || (wrapEl ? wrapEl.nextSibling : null);
    const afterText = (nextNode && (nextNode.nodeValue || nextNode.textContent)) ? (nextNode.nodeValue || nextNode.textContent) : afterLocal;

    const allSpans = stepArea ? Array.from(stepArea.querySelectorAll('span.aifx-rendered')) : [];
    const idx = span ? allSpans.indexOf(span) : -1;
    const prevTokens = idx > 0
      ? allSpans.slice(Math.max(0, idx - 6), idx).map(s => (s.getAttribute('data-token') || '').toLowerCase().trim()).reverse()
      : [];
    const nextTokens = idx >= 0
      ? allSpans.slice(idx + 1, idx + 4).map(s => (s.getAttribute('data-token') || '').toLowerCase().trim())
      : [];

    return { stepText, overallText, localText, sentenceText, beforeLocal: beforeNorm, afterLocal: afterNorm, afterText, prevTokens, nextTokens };
  }

  function normalizeCtx(stepOrCtx, overallText, afterText) {
    if (stepOrCtx && typeof stepOrCtx === 'object') return stepOrCtx;
    const step = (stepOrCtx || '').toLowerCase();
    return {
      stepText: step,
      overallText: (overallText || '').toLowerCase(),
      localText: step,
      sentenceText: step,
      afterText: afterText || '',
      prevTokens: [],
      nextTokens: []
    };
  }

  // Evaluates category hint matchers in strict proximity order:
  //   1. current sentence  2. closest neighboring tokens (nearest wins)
  //   3. current paragraph 4. whole step  5. overall page
  // Strong block/explicit rules run across layers 1-3 before weak fallbacks.
  function pickCategoryFromHints(ctx, matchers, weakMatchers) {
    const testLayer = (list, text, useTokenRe) => {
      if (!text || !list) return null;
      for (const m of list) {
        const re = (useTokenRe && m.tokenRe) ? m.tokenRe : m.re;
        if (re && re.test(text)) return m.cat;
      }
      return null;
    };
    const scanProximity = (list) => {
      let hit = testLayer(list, ctx.sentenceText, false);
      if (hit) return hit;
      for (let i = 0; i < (ctx.prevTokens || []).length; i++) {
        hit = testLayer(list, ctx.prevTokens[i], true);
        if (hit) return hit;
      }
      for (let i = 0; i < (ctx.nextTokens || []).length; i++) {
        hit = testLayer(list, ctx.nextTokens[i], true);
        if (hit) return hit;
      }
      hit = testLayer(list, ctx.localText, false);
      if (hit) return hit;
      hit = testLayer(list, ctx.stepText, false);
      if (hit) return hit;
      return testLayer(list, ctx.overallText, false);
    };
    return scanProximity(matchers) || (weakMatchers ? scanProximity(weakMatchers) : null);
  }

  function getContextCategory(cleanFlat, stepOrCtx, overallText, trimmedOrig) {
    const ctx = normalizeCtx(stepOrCtx, overallText, '');
    const step = ctx.stepText;
    const overall = ctx.overallText;
    const isBracketed = !trimmedOrig || trimmedOrig.startsWith('[');

    // 1. Status Bar properties: value, max, zero (keep parenthesized `(value)` free for loop variables unless explicitly statusbar)
    if (/^(?:value|max|zero)$/i.test(cleanFlat)) {
      if (isBracketed || /status\s*bar|statusbar/i.test((ctx.sentenceText || '') + ' ' + (ctx.prevTokens || []).join(' '))) {
        return 'statusbars_property';
      }
      return null;
    }

    // 2. Status Bar kinds: Health, Hunger, Energy, Magic, Life, Heat, Cold (keep Info lowercase (life) as hudLife)
    if (/^(?:Health|Hunger|Energy|Magic|Heat|Cold)$/i.test(cleanFlat) || (/^Life$/.test(cleanFlat) && /status\s*bar|statusbar/i.test(step + ' ' + overall))) {
      return 'statusbars_kind';
    }

    // 3. Top / bottom / center / full screen: check nearby wall/direction/sprite/scanner/dialog hints
    if (/^(?:bottom|top|center|full\s*screen)$/i.test(cleanFlat)) {
      const isEdge = /^(?:bottom|top)$/i.test(cleanFlat);
      const strong = [
        { cat: 'tileScanner', re: /tile\s*scanner|scanner|\bscan\s+(?:from|in)\b/i },
        { cat: 'statusbars', re: /position\s+.*next\s+to|status\s*bar|statusbar/i }
      ];
      if (isEdge) {
        strong.push(
          { cat: 'scene', re: /hitting\s+wall|tile\s+to|neighboring|tilemap\s+location|\bwall\b/i },
          {
            cat: 'sprites',
            re: /\bmySprite\s+(?:x|y|vx|vy|top|bottom|left|right)\b|select\s+\[?(?:bottom|top|left|right)\]?\s+and\s+\[?(?:x|y)\]?/i,
            tokenRe: /\(\s*[a-zA-Z0-9_]+\s+(?:x|y|vx|vy|ax|ay|top|bottom|left|right|width|height)\s*\)|\[\s*(?:set|change)\s+(?:sprite|[a-zA-Z0-9_]+)\s+\[?(?:x|y|vx|vy|ax|ay|top|bottom|left|right)\]?\s*\]/i
          }
        );
      }
      strong.push({ cat: 'game', re: /show\s+long\s+text|long\s+text|dialog|splash|layout|text\s+box/i });
      const weak = isEdge ? [{ cat: 'scene', re: /\bdirection\b/i }] : null;
      return pickCategoryFromHints(ctx, strong, weak) || 'game';
    }

    // 4. Direction / button properties: left, right, up, down
    if (/^(?:left|right|up|down)$/i.test(cleanFlat)) {
      const isLR = /^(?:left|right)$/i.test(cleanFlat);
      const strong = [
        { cat: 'tileScanner', re: /tile\s*scanner|scanner|\bscan\s+(?:from|in)\b/i },
        { cat: 'mp', re: /(?:multiplayer|mp\.|player\s*[1234]).*(?:button|press)|(?:button|press).*(?:multiplayer|mp\.|player\s*[1234])/i },
        { cat: 'controller', re: /controller|button\s+pressed|\bon\s+(?:\[?[a-z]+\]?\s+)?button\b|\bis\s+(?:\[?[a-z]+\]?\s+)?button\b|\bbutton\b|press(?:ed)?/i },
        { cat: 'statusbars', re: /position\s+.*next\s+to|status\s*bar.*next\s+to/i },
        { cat: 'browserEvents', re: /mouse\s+button/i },
        { cat: 'scene', re: /hitting\s+wall|tile\s+to|neighboring|tilemap\s+location|\bwall\b/i }
      ];
      if (isLR) {
        strong.push({
          cat: 'sprites',
          re: /\bmySprite\s+(?:x|y|vx|vy|top|bottom|left|right)\b|select\s+\[?(?:bottom|top|left|right)\]?\s+and\s+\[?(?:x|y)\]?/i,
          tokenRe: /\(\s*[a-zA-Z0-9_]+\s+(?:x|y|vx|vy|ax|ay|top|bottom|left|right|width|height)\s*\)|\[\s*(?:set|change)\s+(?:sprite|[a-zA-Z0-9_]+)\s+\[?(?:x|y|vx|vy|ax|ay|top|bottom|left|right)\]?\s*\]/i
        });
      }
      const weak = [{ cat: 'scene', re: /\bdirection\b/i }];
      return pickCategoryFromHints(ctx, strong, weak) || 'scene';
    }

    // 4b. Standalone controller / multiplayer button pills: [A], [B], [menu]
    if (isBracketed && /^(?:A|B|menu)$/i.test(cleanFlat)) {
      const hit = pickCategoryFromHints(ctx, [
        { cat: 'mp', re: /(?:multiplayer|mp\.|player\s*[1234]).*(?:button|press)|(?:button|press).*(?:multiplayer|mp\.|player\s*[1234])/i },
        { cat: 'controller', re: /controller|button|press(?:ed)?/i }
      ]);
      if (hit) return hit;
    }

    // 4c. Bracketed [column] / [row] dropdowns (keep `(column)` / `(row)` free for loop variables)
    if (isBracketed && /^(?:column|row)$/i.test(cleanFlat)) {
      const hit = pickCategoryFromHints(ctx, [
        { cat: 'tileScanner', re: /tile\s*scanner|scanner|\bscan\b/i },
        { cat: 'scene', re: /tilemap\s+location/i }
      ]);
      if (hit) return hit;
    }

    // 5. Sprite / camera properties (x, y, vx, vy, etc.)
    if (/^(?:x|y)$/i.test(cleanFlat)) {
      const hit = pickCategoryFromHints(ctx, [
        { cat: 'scene', re: /\bcamera\b|cameraproperty/i },
        { cat: 'sprites', re: /sprite|mySprite|otherSprite|projectile|vx|vy/i }
      ]);
      return hit || 'sprites';
    }
    if (/^(?:vx|vy|ax|ay|lifespan|z|scale|sx|sy|fx|fy|rotation|vx\s*\(?velocity\s*x\)?|vy\s*\(?velocity\s*y\)?|ax\s*\(?acceleration\s*x\)?|ay\s*\(?acceleration\s*y\)?|fx\s*\(?friction\s*x\)?|fy\s*\(?friction\s*y\)?|sx\s*\(?scale\s*x\)?|sy\s*\(?scale\s*y\)?|z\s*\(?depth\)?)$/i.test(cleanFlat)) {
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

    // 8. Standalone visual effects (game over vs screen vs sprite effects)
    if (/^(?:confetti|spray|trail|fountain|hearts|smiles|rings|fire|warm\s*radial|cool\s*radial|halo|ashes|disintegrate|blizzard|bubbles|star\s*field|clouds|dust)$/i.test(cleanFlat)) {
      return pickCategoryFromHints(ctx, [
        { cat: 'game', re: /game\s*over|use\s*effect|\bwin\b|\blose\b/i },
        { cat: 'scene', re: /start\s+screen|end\s+screen|screen\s+.*\beffect\b/i },
        { cat: 'sprites', re: /\bdestroy\b.*\beffect|\bstart\s+(?:[a-z\s]+\s+)?effect\b|sprite\s+effect|\b(?:mySprite|otherSprite|projectile)\b.*\beffect/i }
      ]) || 'scene';
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

  function resolveTokenWithNLP(tokenText, stepOrCtx, overallText, afterText) {
    if (!tokenText) return null;
    const ctx = normalizeCtx(stepOrCtx, overallText, afterText);
    const stepText = ctx.stepText;
    const overall = ctx.overallText;
    const localAfterText = ctx.afterText || afterText || '';
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

    // Direct catalog tokens: empty boolean diamond, mutator (+)/(-), UI buttons, section labels, game over toggle
    if (/^<\s*>$/.test(trimmedOrig) || /^\[\s*<\s*>\s*\]$/.test(trimmedOrig)) {
      return { rule: { id: 'empty_boolean_slot', category: 'logic' }, template: 'empty_boolean_slot' };
    }
    const mutMatch = trimmedOrig.match(/^[\(\[]\s*([+-])\s*[\)\]]$/);
    if (mutMatch) {
      const isPlus = mutMatch[1] === '+';
      return { rule: { id: isPlus ? 'mutator_plus' : 'mutator_minus', category: 'common' }, template: isPlus ? 'mutator_plus' : 'mutator_minus' };
    }
    if (/^Make a Function(?:\.\.\.)?$/i.test(cleanFlat)) {
      return { rule: { id: 'make_a_function', category: 'functions' }, template: 'make_a_function' };
    }
    if (/^Make a Variable$/i.test(cleanFlat)) {
      return { rule: { id: 'make_a_variable', category: 'variables' }, template: 'make_a_variable' };
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
      return { rule: { id: 'boolean_reporter_bubble', category: 'variables' }, template: 'boolean_reporter_bubble', params: { varName: mAngleId[1] } };
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
    if (trimmedOrig.startsWith('[') && /^(?:value|max|zero)$/i.test(cleanFlat) && /status\s*bar|statusbar/i.test((stepText || '') + ' ' + overall)) {
      return { rule: { id: 'property_statusbars_property', category: 'statusbars_property' }, template: 'isolated_pill', params: { prop: cleanFlat, pillCategory: 'statusbars_property' } };
    }
    // Overlap-event parameter bubbles are plain reporter ovals (no dropdown arrow), same as (otherSprite).
    if (trimmedOrig.startsWith('[') && /^(?:sprite|otherSprite)$/.test(cleanFlat) && /overlap/i.test(stepText || '')) {
      return { rule: { id: 'variable_reporter_bubble', category: 'variables' }, template: 'variable_reporter_bubble', params: { varName: cleanFlat } };
    }
    if (/^game\s+over$/i.test(cleanFlat) && (localAfterText ? /^\s*toggle\b/i.test(localAfterText) : /\[game\s+over\]\s+toggle|replace\s+the\s+\[game\s+over\]\s+toggle/i.test(stepText || ''))) {
      return { rule: { id: 'toggle_win', category: 'game' }, template: 'toggle_win' };
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
    const funcNamedAfter = trimmedOrig.startsWith('[') && /^[a-z][a-zA-Z0-9_]+$/.test(cleanFlat) && !RESERVED_NON_FUNC.test(cleanFlat) && /^\s*function\b/i.test(localAfterText || '');
    // Known sprite properties ([lifespan], [x], [vx]...) are never function names even when the step mentions functions.
    const ctxCatPre = getContextCategory(cleanFlat, ctx, overall, trimmedOrig);
    const isSpritePropName = ctxCatPre === 'sprites';
    if (/^(?:makeEnemy|makeCoin|createBubbles)$/i.test(cleanFlat)
      || funcNamedAfter
      || (!isSpritePropName && trimmedOrig.startsWith('[') && !RESERVED_NON_FUNC.test(cleanFlat) && /function\s+(?:named|called)\s+/i.test(ctx.localText || stepText || '') && /^[a-z][a-zA-Z0-9_]+$/.test(cleanFlat))) {
      const isCall = /\bcall\b/i.test(ctx.sentenceText || '') || /^\s*function\s+(?:is\s+|gets\s+|will\s+be\s+)?(?:called|run|runs|executed)/i.test(localAfterText || '');
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
      && !ctxCatPre) {
      return {
        rule: { id: 'variable_reporter_bubble', category: 'variables' },
        template: 'variable_reporter_bubble',
        params: { varName: cleanFlat }
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
            rule: { id: 'variable_reporter_bubble', category: 'variables' },
            template: 'variable_reporter_bubble',
            params: { varName: cleanFlat }
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

    if (ctxCatPre) {
      return {
        rule: { id: 'property_' + ctxCatPre, category: ctxCatPre },
        template: 'isolated_pill',
        params: { prop: ctxCatPre === 'sprites' ? clean : cleanFlat, pillCategory: ctxCatPre }
      };
    }

    // Category whitelist: If the instructions do not include a category, the NLP will not choose it!
    const isTestBed = (typeof window !== 'undefined' && (window.ALL_TOKENS || document.querySelector('[data-instruction], .token-target-area')));
    const activeCategories = isTestBed ? null : getActiveCategories(stepText, overall);

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
        const segs = p && parsePathAbs(p.getAttribute('d') || '');
        if (!segs) return null;
        const arc = segs.find(s => s.c === 'A');
        const mx = pathMaxX(p.getAttribute('d') || '');
        if (!arc || mx === null) return null;
        const R = Math.abs(arc.a[0]);
        return { R, w: mx, h: 2 * R };
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
    if (resolution.template === 'toggleWinLose' || resolution.template === 'toggleOnOff') {
      const isWin = /win/i.test(tokenText);
      const isLose = /lose/i.test(tokenText);
      const isOn = /on/i.test(tokenText);
      const tName = isOn ? 'toggle_on' : (isWin ? 'toggle_win' : (isLose ? 'toggle_lose' : 'toggle_off'));
      return fetchAndRenderResolvedToken({ template: tName, rule: { category: 'game' } }, tokenText);
    }
    if (resolution.template === 'isolated_pill') {
      const prop = (resolution.params && resolution.params.prop !== undefined) ? resolution.params.prop : tokenText;
      const cat = (resolution.params && resolution.params.pillCategory) || resolution.rule.category;
      return fetchAndRenderResolvedToken({ template: 'property_pill', params: { prop, pillCategory: cat }, rule: { category: cat } }, tokenText);
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
  } catch (e) { }

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
  } catch (e) { }

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
        width: 100% !important;
        overflow: visible !important;
        margin: 6px 0 !important;
        padding: 2px 4px 6px 2px !important;
        clear: both !important;
        text-align: left !important;
        line-height: normal !important;
        box-sizing: border-box !important;
      }
      /* Linear (unhinted) glyph advances: text width scales exactly with the SVG so measured layouts never drift */
      .aifx-rendered svg text,
      .aifx-rendered svg .blocklyText {
        text-rendering: geometricPrecision !important;
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
    const isMultiLine = !isPlayIcon && !isInlineTokenOverride && (data.isMultiLine || h > 72 || !isInsideSentence);

    // Scope SVG pattern IDs per instance and strip redundant 315KB @font-face declarations
    const uid = ++svgInstanceCounter;
    let safeSvg = String(data.svg)
      .replace(/@font-face\s*\{[^}]*\}/g, '')
      .replace(/text,\s*\.blocklyText/g, '.blocklyText')
      .replace(/aifx-checkered-tile/g, `aifx-checkered-tile-${uid}`)
      .replace(/aifx-checker/g, `aifx-checker-${uid}`);

    span.className = 'aifx-rendered ' + (isPlayIcon ? 'aifx-play-icon' : (isMultiLine ? 'aifx-multiline' : 'aifx-inline'));
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
    } catch (e) { }

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
    const ctx = extractSpanContext(span);
    const resolution = (catalogMap && tokenRules.length > 0) ? resolveTokenWithNLP(tokenText, ctx) : null;
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
            // Renderer definitively failed — try the NLP fallback (lookup rules
            // + static catalog templates) before leaving the token as plain text.
            let nlpStarted = false;
            const liveWaiters = waiters.filter(s => s && s.isConnected && s.getAttribute('data-rendered') !== 'true');
            if (liveWaiters.length && catalogMap && tokenRules.length > 0) {
              const first = liveWaiters[0];
              const resolution = resolveTokenWithNLP(tokenText, extractSpanContext(first));
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
    const codeIconUrl = (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.getURL)
      ? chrome.runtime.getURL('catalog/code_icon.svg')
      : './catalog/code_icon.svg';
    btn.innerHTML = `
      <span>
        <img src="${codeIconUrl}" width="20" height="20" alt="Toggle blocks" style="display:block;" />
      </span>
    `;

    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      e.preventDefault();
      isAifxEnabled = !isAifxEnabled;
      try {
        localStorage.setItem('aifx_enabled', String(isAifxEnabled));
      } catch (err) { }

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
