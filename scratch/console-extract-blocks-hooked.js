/*!
 * tools/console-extract-blocks.js — AIFX toolbox-exact block catalog extractor
 *
 * Run this in the browser console on https://arcade.makecode.com/#editor with
 * the Blocks editor open.
 *
 * What it does:
 *   1. Locates the REAL blocks workspace (B.Workspace.getAll() scan).
 *   2. Automatically expands the "Advanced" drawer if collapsed so all
 *      standard Advanced categories (Loops, Logic, Variables, Math, Functions,
 *      Arrays, Text) and Extension categories are exposed in the toolbox tree.
 *      Strictly avoids clicking "Extensions" (which launches a modal).
 *   3. Collects every visible category row (standard, advanced, and extensions).
 *   4. Iterates each category by dispatching click events on '.blocklyTreeRow'.
 *   5. Waits for flyout block signature to stabilize.
 *   6. Serializes every flyout block WYSIWYG:
 *      - Gray checkered tile pattern (<pattern id="aifx-checkered-tile">)
 *        injected directly into image/sprite/tile sockets, respecting block
 *        corners and borders (rx="4" ry="4") without superimposed black/white rings.
 *      - Accurate filmstrip reel icon (18x24, 2 columns x 3 rows grid) and centered
 *        preview box in the [animate frames] block.
 *      - Boolean toggle buttons (toggleOnOff, toggleWinLose, WIN/LOSE, ON/OFF)
 *        centered horizontally and vertically with correct thumb and text styling.
 *      - Embedded icon fonts and SVG glyphs preserved with absolute URLs.
 *   7. Annotates editable fields (data-aifx-*) for overlay mutators.
 *   8. Exports to window.__AIFX_BLOCK_CATALOG__ and window.__AIFX_DOWNLOAD_CATALOG__().
 */
(() => {
  'use strict';

  if (window.__AIFX_EXTRACT_STATE__ && window.__AIFX_EXTRACT_STATE__.catalog && !window.__AIFX_FORCE_REEXTRACT__) {
    console.log('[AIFX] Catalog already extracted:', Object.keys(window.__AIFX_EXTRACT_STATE__.catalog.blocks).length, 'blocks');
    console.log('[AIFX] Set window.__AIFX_FORCE_REEXTRACT__ = true to force a re-run.');
    return { already: true, progress: window.__AIFX_EXTRACT_STATE__.progress };
  }

  const CHECKERED_PATTERN_ID = 'aifx-checkered-tile';
  const SKIP_CATEGORIES = new Set(['advanced', 'extensions', 'search']);

  const state = {
    progress: { phase: 'init', category: null, index: 0, total: 0, captured: 0, errors: 0 },
    catalog: null,
    error: null
  };
  window.__AIFX_EXTRACT_STATE__ = state;

  const sleep = (ms) => new Promise(r => setTimeout(r, ms));

  // ------------------------------------------------------------------ discovery

  function findMainWorkspace() {
    const B = window.pxt && window.pxt.blocks && window.pxt.blocks.requireBlockly
      ? window.pxt.blocks.requireBlockly()
      : window.Blockly;
    if (!B || !B.Workspace) throw new Error('Blockly / pxt.blocks not available');
    const ws = B.Workspace.getAll().find(w => w.getToolbox && w.getToolbox() && !w.internalIsFlyout);
    if (!ws) throw new Error('No blocks workspace with a toolbox found');
    return { B, ws };
  }

  async function expandAdvanced() {
    const rows = Array.from(document.querySelectorAll('.blocklyTreeRow'));
    const advRow = rows.find(r => {
      const txt = (r.textContent || '').trim().toLowerCase();
      return txt === 'advanced' || txt.startsWith('advanced');
    });
    if (!advRow) return false;

    const isExpanded = advRow.getAttribute('aria-expanded') === 'true' ||
      (advRow.parentElement && advRow.parentElement.getAttribute('aria-expanded') === 'true');

    if (!isExpanded) {
      console.log('[AIFX] Expanding "Advanced" category tree...');
      advRow.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
      advRow.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }));
      advRow.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      await sleep(600);
      return true;
    }
    return false;
  }

  function getCategories(tb) {
    const found = [];
    const seen = new Set();
    const rows = Array.from(document.querySelectorAll('.blocklyTreeRow'));

    for (const r of rows) {
      if (r.offsetHeight <= 0) continue;
      const labelEl = r.querySelector('.blocklyTreeLabel') || r;
      const name = (labelEl.textContent || '').trim();
      const lower = name.toLowerCase();

      // Strictly skip Advanced header, Extensions modal opener, and Search
      if (!name || seen.has(lower) || SKIP_CATEGORIES.has(lower)) continue;
      if (r.getAttribute('aria-label') === 'Extensions') continue;

      seen.add(lower);
      found.push(name);
    }

    if (tb && typeof tb.getToolboxItems === 'function') {
      try {
        const items = tb.getToolboxItems() || [];
        for (const it of items) {
          const name = (it.getName && it.getName()) || '';
          const lower = name.toLowerCase();
          if (!name || seen.has(lower) || SKIP_CATEGORIES.has(lower)) continue;
          seen.add(lower);
          found.push(name);
        }
      } catch (e) {}
    }
    return found;
  }

  function clickCategoryRow(name) {
    let label = Array.from(document.querySelectorAll('.blocklyTreeLabel'))
      .find(l => (l.textContent || '').trim().toLowerCase() === name.toLowerCase());
    let row = label ? (label.closest('.blocklyTreeRow') || label) : null;
    if (!row) {
      row = Array.from(document.querySelectorAll('.blocklyTreeRow'))
        .find(r => (r.textContent || '').trim().toLowerCase() === name.toLowerCase());
    }
    if (!row) return false;
    row.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
    row.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }));
    row.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    return true;
  }

  function flyoutSig(fws) {
    return fws.getTopBlocks(false).map(b => b.type).join('|');
  }

  async function waitForFlyout(fws, prevSig) {
    const deadline = Date.now() + 6000;
    await sleep(250);
    let last = null;
    while (Date.now() < deadline) {
      const sig = flyoutSig(fws);
      if (sig !== prevSig && sig === last && sig.length > 0) return sig;
      last = sig;
      await sleep(150);
    }
    return flyoutSig(fws);
  }

  // --------------------------------------------------------- measurement host

  let measureSvg = null;

  function getMeasureSvg() {
    if (measureSvg && measureSvg.isConnected) return measureSvg;
    const host = document.createElement('div');
    host.setAttribute('aria-hidden', 'true');
    host.style.cssText = 'position:fixed;left:-10000px;top:0;width:10px;height:10px;overflow:hidden;pointer-events:none;opacity:0;';
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.style.cssText = 'width:10px;height:10px;overflow:visible;';
    host.appendChild(svg);
    document.body.appendChild(host);
    measureSvg = svg;
    return svg;
  }

  // ------------------------------------------------------------ field annotation

  function fieldKind(f, B) {
    try {
      if (f instanceof B.FieldTextInput) return 'text';
      if (f instanceof B.FieldNumber) return 'number';
      if (f instanceof B.FieldVariable) return 'variable';
      if (f instanceof B.FieldDropdown || (f && typeof f.getOptions === 'function' && f.isMenu_ !== false)) {
        const cn = (f.constructor && f.constructor.name) || '';
        if (/sprite|image|tile|colour|color|music|note|animation|matrix/i.test(cn)) return null;
        let fr = null;
        try { fr = f.getSvgRoot(); } catch (e) { fr = null; }
        if (fr) {
          const t = fr.querySelector('text');
          const s = (t && t.textContent || '').replace(/[\uE000-\uF8FF]/g, '');
          if (!s.length) return null;
        }
        return 'dropdown';
      }
    } catch (e) { /* fall through */ }
    return null;
  }

  function measureCharW(fieldGroup) {
    try {
      const texts = Array.prototype.filter.call(
        fieldGroup.querySelectorAll('text'),
        t => !t.classList.contains('field-text-quote') && (t.textContent || '').length > 0
      );
      for (const t of texts) {
        const bb = t.getBBox();
        const w = bb.width / Math.max(1, (t.textContent || '').length);
        if (isFinite(w) && w > 4 && w < 16) return Math.round(w * 100) / 100;
      }
    } catch (e) { /* not measurable */ }
    return 8.8;
  }

  function indexPathWithin(root, el) {
    const path = [];
    let n = el;
    while (n && n !== root) {
      const p = n.parentNode;
      if (!p) return null;
      path.unshift(Array.prototype.indexOf.call(p.childNodes, n));
      n = p;
    }
    return n === root ? path : null;
  }

  function resolvePath(root, path) {
    let n = root;
    for (const i of path) {
      if (!n || !n.childNodes || !n.childNodes[i]) return null;
      n = n.childNodes[i];
    }
    return n;
  }

  // --------------------------------------------------------------- serialization

  const INPROPS = [
    'fill', 'fill-opacity', 'opacity', 'stroke', 'stroke-width',
    'font-family', 'font-size', 'font-weight', 'letter-spacing',
    'text-anchor', 'dominant-baseline', 'writing-mode', 'paint-order'
  ];

  function extractPageFonts() {
    let fontCss = '';
    try {
      for (const sheet of document.styleSheets) {
        try {
          const rules = sheet.cssRules || sheet.rules;
          if (!rules) continue;
          for (const rule of rules) {
            if (rule.type === CSSRule.FONT_FACE_RULE || (rule.cssText && rule.cssText.startsWith('@font-face'))) {
              let txt = rule.cssText;
              if (/icons|pxt|semantic/i.test(txt)) {
                // Convert relative font URLs to absolute arcade.makecode.com URLs for standalone resilience
                txt = txt.replace(/url\(\s*['"]?([^'")]+)['"]?\s*\)/g, (match, url) => {
                  if (/^https?:\/\/|^data:/i.test(url)) return match;
                  try {
                    const abs = new URL(url, document.baseURI || 'https://arcade.makecode.com/').href;
                    return `url("${abs}")`;
                  } catch (e) {
                    return match;
                  }
                });
                fontCss += txt + '\n';
              }
            }
          }
        } catch (e) { /* cross-origin sheet, ignore */ }
      }
    } catch (e) {}
    return fontCss;
  }

  function collectStyles(el, map) {
    for (let i = 0; i < el.childNodes.length; i++) {
      const c = el.childNodes[i];
      if (c.nodeType === 1) collectStyles(c, map);
    }
    try {
      const tag = el.tagName.toLowerCase();
      const cs = getComputedStyle(el);
      let s = '';

      if (tag === 'g') {
        // Group containers cascade fill/stroke to children
      } else if (tag === 'text') {
        if (el.classList.contains('field-text-quote')) {
          s += 'fill:#a31515 !important;stroke:none !important;stroke-width:0 !important;font-size:16px !important;opacity:1 !important;';
        } else if (el.classList.contains('blocklyToggleText')) {
          s += 'fill:#ffffff !important;stroke:none !important;stroke-width:0 !important;';
          s += 'font-family:Consolas, Monaco, Menlo, "Ubuntu Mono", source-code-pro, monospace !important;';
          s += 'font-size:16px !important;font-weight:700 !important;text-anchor:middle !important;dominant-baseline:central !important;paint-order:fill !important;';
        } else {
          const isInput = !!el.closest('.blocklyTextInputField, .blocklyNumberField');
          const fill = isInput ? '#575e75' : '#ffffff';
          s += 'fill:' + fill + ' !important;stroke:none !important;stroke-width:0 !important;';
          s += 'font-family:Consolas, Monaco, Menlo, "Ubuntu Mono", source-code-pro, monospace !important;';
          s += 'font-size:16px !important;font-weight:600 !important;text-anchor:start;dominant-baseline:central;paint-order:fill !important;';
        }
      } else if (tag === 'rect') {
        const isTextInput = el.classList.contains('blocklyFieldRect') && el.closest('.blocklyTextInputField, .blocklyNumberField');
        const isDropdown = el.classList.contains('blocklyDropdownRect') || !!el.closest('.blocklyDropdownField');
        const isToggle = el.getAttribute('cursor') === 'pointer' || el.classList.contains('blocklyToggleRect');
        const isAnimation = el.classList.contains('blocklyAnimationField') || el.closest('.animation_editor');
        const isSpriteOrImage = el.classList.contains('blocklySpriteField') || el.closest('.screen_image_picker, .tileset_tile_picker, .image_picker');

        if (isTextInput) {
          s += 'fill:#ffffff !important;stroke:none !important;stroke-width:0 !important;display:block !important;';
        } else if (isDropdown) {
          s += 'fill:transparent !important;stroke:rgba(0,0,0,0.15) !important;';
        } else if (isToggle) {
          s += 'fill:#718093 !important;stroke:#485460 !important;stroke-width:1.5px !important;rx:4px !important;ry:4px !important;';
        } else if (isAnimation) {
          s += 'fill:url(#' + CHECKERED_PATTERN_ID + ') !important;stroke:#ffffff !important;stroke-width:2.5px !important;rx:4px !important;ry:4px !important;opacity:1 !important;';
        } else if (isSpriteOrImage) {
          s += 'fill:url(#' + CHECKERED_PATTERN_ID + ') !important;stroke:#000000 !important;stroke-width:2.5px !important;rx:4px !important;ry:4px !important;opacity:1 !important;';
        } else {
          for (const p of INPROPS) {
            if (p === 'opacity' || p === 'fill-opacity') continue;
            const v = cs.getPropertyValue(p);
            if (v && v !== 'initial') s += p + ':' + v + ';';
          }
        }
      } else if (tag === 'polygon' && (el.classList.contains('blocklyToggleRect') || el.closest('.blocklyToggle'))) {
        const isParentOn = !!el.closest('.blocklyToggleOn');
        s += 'fill:' + (isParentOn ? '#2ecc71' : '#718093') + ' !important;';
        s += 'stroke:' + (isParentOn ? '#27ae60' : '#485460') + ' !important;stroke-width:1.5px !important;';
      } else {
        for (const p of INPROPS) {
          if (p === 'opacity' || p === 'fill-opacity') continue;
          const v = cs.getPropertyValue(p);
          if (v && v !== 'initial') s += p + ':' + v + ';';
        }
      }

      if (s) map.set(el, s);
    } catch (e) { /* keep element intact */ }
  }

  function applyStyles(el, map) {
    const s = map.get(el);
    if (s) el.setAttribute('style', s);
    for (let i = 0; i < el.childNodes.length; i++) {
      const c = el.childNodes[i];
      if (c.nodeType === 1) applyStyles(c, map);
    }
  }

  // ---------------------------------------------------- field & artifact handlers

  function processAnimationFrames(clone) {
    const animFields = clone.querySelectorAll('.blocklyAnimationField, .animation_editor rect[width="40"], .animation_editor rect[width="40px"], g[data-aifx-field="frames"] rect');
    animFields.forEach(rect => {
      const parentG = rect.parentNode;
      if (!parentG) return;

      // Remove superimposed transparent or black placeholder images inside the preview socket
      // while preserving any genuine SVG icons or glyphs
      parentG.querySelectorAll('image').forEach(img => {
        const href = img.getAttribute('href') || img.getAttribute('xlink:href') || '';
        const isIcon = href.indexOf('film') !== -1 || href.indexOf('reel') !== -1 || href.indexOf('movie') !== -1;
        if (!isIcon) {
          img.remove();
        }
      });

      // Style the preview box with checkered pattern and crisp white border
      rect.setAttribute('rx', '4');
      rect.setAttribute('ry', '4');
      rect.setAttribute('fill', 'url(#' + CHECKERED_PATTERN_ID + ')');
      rect.setAttribute('stroke', '#ffffff');
      rect.setAttribute('stroke-width', '2.5');
      rect.setAttribute('style', 'fill:url(#' + CHECKERED_PATTERN_ID + ') !important;stroke:#ffffff !important;stroke-width:2.5px !important;rx:4px !important;ry:4px !important;opacity:1 !important;');
    });
  }

  function processImageAndSpriteSockets(clone) {
    const imageFieldElements = clone.querySelectorAll(
      '.blocklySpriteField, ' +
      'g.screen_image_picker rect, ' +
      'g.tileset_tile_picker rect, ' +
      'g.image_picker rect, ' +
      'g.bitmap_picker rect, ' +
      'g.blocklyEditableField rect[width="40"], ' +
      'g.blocklyEditableField rect[width="40px"], ' +
      'g.blocklyEditableField rect[width="36"], ' +
      'g.blocklyEditableField rect[width="36px"], ' +
      'g.blocklyEditableField rect[width="32"], ' +
      'g.blocklyEditableField rect[width="32px"]'
    );

    imageFieldElements.forEach(rect => {
      // Skip animation fields handled by processAnimationFrames
      if (rect.classList.contains('blocklyAnimationField') || rect.closest('.animation_editor')) {
        return;
      }
      // Skip text input backgrounds, toggle rects, dropdowns
      if (rect.closest('.blocklyTextInputField, .blocklyNumberField, .blocklyDropdownField, .blocklyToggle')) {
        return;
      }

      const parentG = rect.parentNode;
      if (parentG) {
        // Strip superimposed preview images (transparent PNGs, black rectangles, broken mkcd data URIs)
        // while preserving dropdown arrows
        parentG.querySelectorAll('image').forEach(img => {
          const href = img.getAttribute('href') || img.getAttribute('xlink:href') || '';
          const isDropdownArrow = href.indexOf('dropdown-arrow') !== -1 || (parseFloat(img.getAttribute('width') || '0') <= 14 && parseFloat(img.getAttribute('height') || '0') <= 14);
          if (!isDropdownArrow) {
            img.remove();
          }
        });
      }

      // Fill with checkered pattern and crisp black border respecting rounded corners (rx="4" ry="4")
      rect.setAttribute('fill', 'url(#' + CHECKERED_PATTERN_ID + ')');
      rect.setAttribute('stroke', '#000000');
      rect.setAttribute('stroke-width', '2.5');
      rect.setAttribute('rx', '4');
      rect.setAttribute('ry', '4');
      rect.setAttribute('style', 'fill:url(#' + CHECKERED_PATTERN_ID + ') !important;stroke:#000000 !important;stroke-width:2.5px !important;rx:4px !important;ry:4px !important;opacity:1 !important;');
    });

    // Clean any stray placeholder images across the block that are not dropdown arrows
    clone.querySelectorAll('image').forEach(img => {
      const href = img.getAttribute('href') || img.getAttribute('xlink:href') || '';
      if (!href) {
        img.remove();
        return;
      }
      const isArrow = href.indexOf('dropdown-arrow') !== -1 || (parseFloat(img.getAttribute('width') || '0') <= 14 && parseFloat(img.getAttribute('height') || '0') <= 14);
      if (!isArrow && (href.indexOf('iVBORw0KGgoAAAANSUhEUgAA') !== -1 || href.indexOf('image/x-mkcd') !== -1 || href.indexOf('image/png') !== -1)) {
        if (img.closest('.blocklyEditableField, .blocklySpriteField, .screen_image_picker, .tileset_tile_picker')) {
          img.remove();
        }
      }
    });
  }

  function processToggleSwitches(clone) {
    const togglePolygons = clone.querySelectorAll('polygon.blocklyToggleRect, .blocklyToggle polygon');
    togglePolygons.forEach(poly => {
      const toggleG = poly.closest('.blocklyToggle') || poly.parentNode;
      const fieldG = poly.closest('.blocklyEditableField') || toggleG || poly.parentNode;

      // Detect ON vs OFF state
      const textEl = (toggleG ? toggleG.querySelector('text.blocklyToggleText, text') : null) ||
                     (fieldG ? fieldG.querySelector('text.blocklyToggleText, text') : null);
      const textVal = textEl ? (textEl.textContent || '').trim().toUpperCase() : '';
      const isParentOn = !!(toggleG && toggleG.classList.contains('blocklyToggleOn')) ||
                         textVal === 'ON' || textVal === 'WIN' || textVal === 'TRUE';

      const thumbFill = isParentOn ? '#2ecc71' : '#718093';
      const thumbStroke = isParentOn ? '#27ae60' : '#485460';
      poly.setAttribute('style', `fill:${thumbFill} !important;stroke:${thumbStroke} !important;stroke-width:1.5px !important;`);
      poly.setAttribute('fill', thumbFill);
      poly.setAttribute('stroke', thumbStroke);
      poly.setAttribute('stroke-width', '1.5');

      // Ensure hexagonal track background is styled cleanly
      if (toggleG) {
        const trackPath = toggleG.querySelector('path.blocklyPath');
        if (trackPath) {
          trackPath.setAttribute('style', 'fill:#3d3568 !important;stroke:none !important;opacity:1 !important;');
          trackPath.setAttribute('fill', '#3d3568');
        }
      }

      // Compute geometric center of the polygon thumb
      const pointsAttr = poly.getAttribute('points') || '';
      const coords = pointsAttr.trim().split(/[\s,]+/).map(parseFloat).filter(isFinite);
      if (coords.length >= 4) {
        const xs = [];
        const ys = [];
        for (let i = 0; i < coords.length; i += 2) {
          xs.push(coords[i]);
          ys.push(coords[i + 1]);
        }
        const minX = Math.min(...xs);
        const maxX = Math.max(...xs);
        const minY = Math.min(...ys);
        const maxY = Math.max(...ys);

        let targetX = (minX + maxX) / 2;
        let targetY = (minY + maxY) / 2;

        if (textEl) {
          // If textEl is in fieldG but poly is inside toggleG, add toggleG translation
          if (textEl.parentNode !== poly.parentNode && toggleG && textEl.parentNode === fieldG) {
            const tMatch = (toggleG.getAttribute('transform') || '').match(/translate\(\s*([-\d.]+)(?:[\s,]+([-\d.]+))?\s*\)/);
            if (tMatch) {
              targetX += parseFloat(tMatch[1]) || 0;
              targetY += parseFloat(tMatch[2]) || 0;
            }
          }

          textEl.setAttribute('x', String(targetX));
          textEl.setAttribute('y', String(targetY));
          textEl.removeAttribute('dy');
          textEl.removeAttribute('transform');
          textEl.setAttribute('dominant-baseline', 'central');
          textEl.setAttribute('text-anchor', 'middle');
          textEl.setAttribute('style', 'fill:#ffffff !important;stroke:none !important;stroke-width:0 !important;font-family:Consolas, Monaco, Menlo, "Ubuntu Mono", source-code-pro, monospace !important;font-size:16px !important;font-weight:700 !important;text-anchor:middle !important;dominant-baseline:central !important;paint-order:fill !important;');
        }
      }
    });
  }

  function serializeFlyoutBlock(block, B) {
    const svgRoot = block.getSvgRoot ? block.getSvgRoot() : null;
    if (!svgRoot) return null;

    // Work on an offscreen clone; live flyout stays pristine
    const clone = svgRoot.cloneNode(true);

    try {
      clone.querySelectorAll('.blocklyPathLight, .blocklyPathDark, [filter]').forEach(el => {
        if (el.hasAttribute('filter')) el.removeAttribute('filter');
        if (el.classList.contains('blocklyPathLight') || el.classList.contains('blocklyPathDark')) el.remove();
      });
      clone.querySelectorAll('.blocklyDisabled, .blocklyDisabledPattern, .pxtFlyoutHidden').forEach(el => {
        el.classList.remove('blocklyDisabled', 'blocklyDisabledPattern', 'pxtFlyoutHidden');
      });
      if (clone.classList) {
        clone.classList.remove('blocklyDisabled', 'blocklyDisabledPattern', 'pxtFlyoutHidden');
      }
    } catch (e) {}

    const host = getMeasureSvg();
    host.appendChild(clone);
    const styleMap = new Map();
    collectStyles(clone, styleMap);
    applyStyles(clone, styleMap);

    let bbox;
    try { bbox = clone.getBBox(); } catch (e) { clone.remove(); return null; }
    if (!bbox || bbox.width < 10 || bbox.height < 10) { clone.remove(); return null; }

    // ---- modularity annotations -------------------------------------------
    block.inputList.forEach(inp => {
      (inp.fieldRow || []).forEach(f => {
        let fr = null;
        try { fr = f.getSvgRoot(); } catch (e) { fr = null; }
        if (!fr) return;
        const path = indexPathWithin(svgRoot, fr);
        if (!path) return;
        const cloneGroup = resolvePath(clone, path);
        if (!cloneGroup || cloneGroup.nodeType !== 1) return;

        const kind = fieldKind(f, B);
        const value = (f.getText && f.getText()) || '';
        cloneGroup.setAttribute('data-aifx-field', f.name || '');
        if (!kind) {
          cloneGroup.setAttribute('data-aifx-opaque', '1');
          return;
        }
        cloneGroup.setAttribute('data-aifx-kind', kind);
        cloneGroup.setAttribute('data-aifx-charw', String(measureCharW(cloneGroup)));
        cloneGroup.setAttribute('data-aifx-value', value);
      });
    });
    if (/\bblocklyBlock\b/.test(String(clone.getAttribute('class') || ''))) {
      clone.setAttribute('data-aifx-type', block.type);
    }

    clone.removeAttribute('transform');
    clone.setAttribute('transform', 'translate(' + (-bbox.x) + ',' + (-bbox.y) + ')');

    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    const width = Math.ceil(bbox.width + 4);
    const height = Math.ceil(bbox.height + 4);
    svg.setAttribute('viewBox', '0 0 ' + width + ' ' + height);
    svg.setAttribute('width', width);
    svg.setAttribute('height', height);

    // Defs: embed checkered pattern with pixel-accurate 8x8 checkerboard (16x16 repeat)
    const defsEl = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
    defsEl.innerHTML =
      '<pattern id="' + CHECKERED_PATTERN_ID + '" width="16" height="16" patternUnits="userSpaceOnUse">' +
      '<rect width="16" height="16" fill="#c0c2c7"/>' +
      '<rect x="0" y="0" width="8" height="8" fill="#ffffff"/>' +
      '<rect x="8" y="8" width="8" height="8" fill="#ffffff"/>' +
      '</pattern>';
    svg.appendChild(defsEl);

    const styleEl = document.createElementNS('http://www.w3.org/2000/svg', 'style');
    const fontCss = extractPageFonts();
    styleEl.textContent =
      (fontCss ? fontCss + '\n' : '') +
      'text, .blocklyText { fill: #ffffff !important; stroke: none !important; stroke-width: 0 !important; paint-order: fill !important; font-family: Consolas, Monaco, Menlo, "Ubuntu Mono", source-code-pro, monospace !important; font-size: 16px !important; font-weight: 600 !important; text-anchor: start; dominant-baseline: central; }\n' +
      '.blocklyToggleText { text-anchor: middle !important; dominant-baseline: central !important; fill: #ffffff !important; font-weight: 700 !important; }\n' +
      '.field-text-quote { fill: #a31515 !important; }\n' +
      '.blocklyTextInputField .blocklyFieldRect, .blocklyNumberField .blocklyFieldRect { fill: #ffffff !important; }\n' +
      '.blocklyDropdownRect, .blocklyDropdownField .blocklyFieldRect { fill: transparent !important; }\n' +
      '.blocklyTextInputField text, .blocklyNumberField text { fill: #575e75 !important; }\n' +
      '.blocklyDropdownField text { fill: #ffffff !important; }\n' +
      'rect[cursor="pointer"] { fill: #718093 !important; stroke: #485460 !important; rx: 4px !important; ry: 4px !important; }\n' +
      '.blocklyToggleRect { fill: #718093 !important; stroke: #485460 !important; stroke-width: 1.5px !important; }\n' +
      '.blocklyToggleOn .blocklyToggleRect { fill: #2ecc71 !important; stroke: #27ae60 !important; }\n' +
      '.blocklyToggleOff .blocklyToggleRect { fill: #718093 !important; stroke: #485460 !important; }\n';
    svg.appendChild(styleEl);

    // Apply accurate field transformations and artifact fixes
    processAnimationFrames(clone);
    processImageAndSpriteSockets(clone);
    processToggleSwitches(clone);

    // Id / artifact hygiene
    try {
      const html = clone.outerHTML || '';
      const referenced = new Set();
      referenced.add(CHECKERED_PATTERN_ID);
      const re = /url\(#([^)]+)\)/g;
      let m;
      while ((m = re.exec(html))) referenced.add(m[1]);
      clone.querySelectorAll('[id]').forEach(el => {
        if (!referenced.has(el.id)) el.removeAttribute('id');
      });
      clone.querySelectorAll('[aria-owns]').forEach(el => el.removeAttribute('aria-owns'));
      clone.querySelectorAll('[data-id]').forEach(el => el.removeAttribute('data-id'));
      if (clone.hasAttribute('data-id')) clone.removeAttribute('data-id');
      if (clone.hasAttribute('aria-owns')) clone.removeAttribute('aria-owns');
    } catch (e) {}

    host.removeChild(clone);
    svg.appendChild(clone);

    const hasStatement = block.inputList && block.inputList.some(i => i.name === 'STACK' || i.name === 'DO0' || i.name === 'HANDLER');
    const isMultiLine = hasStatement || height > 70;

    return {
      svg: new XMLSerializer().serializeToString(svg),
      width: width,
      height: height,
      isMultiLine: isMultiLine
    };
  }

  // ------------------------------------------------------------------- metadata

  function blockMeta(block, B) {
    const fields = [];
    const inputs = [];
    (block.inputList || []).forEach(inp => {
      (inp.fieldRow || []).forEach(f => {
        fields.push({
          name: f.name || '',
          kind: fieldKind(f, B) || ((f.constructor && f.constructor.name) || 'field'),
          text: (f.getText && f.getText()) || ''
        });
      });
      let shadow = '';
      try {
        const conn = inp.connection;
        const tgt = conn && conn.targetBlock();
        if (tgt && tgt.isShadow && tgt.isShadow()) shadow = tgt.type;
      } catch (e) {}
      inputs.push(shadow);
    });
    return { fields, inputs };
  }

  // ------------------------------------------------------------------- pipeline

  function captureFlyout(fws, B, categoryName, blocksOut, seenSig, errors, progress) {
    const blocks = fws.getTopBlocks(false);
    blocks.forEach(b => {
      const type = b.type;
      if (!type || type === 'variables_get_dynamic' || type === 'variables_set_dynamic') return;
      try {
        let sig = type;
        try {
          const shadows = [];
          const walk = (bl) => {
            (bl.inputList || []).forEach(inp => {
              const t = inp.connection && inp.connection.targetBlock();
              if (t) { if (t.isShadow && t.isShadow()) shadows.push(t.type); walk(t); }
            });
          };
          walk(b);
          if (shadows.length) sig = type + '::' + shadows.slice().sort().join(',');
        } catch (e) {}

        if (blocksOut[sig]) return;

        const ser = serializeFlyoutBlock(b, B);
        if (!ser) { errors.push({ category: categoryName, type, error: 'serialize returned null' }); return; }
        const meta = blockMeta(b, B);

        let key = type;
        seenSig[type] = (seenSig[type] || 0) + 1;
        if (seenSig[type] > 1) key = type + '__' + seenSig[type];

        blocksOut[sig] = {
          key,
          type,
          category: categoryName,
          svg: ser.svg,
          width: ser.width,
          height: ser.height,
          isMultiLine: ser.isMultiLine,
          fields: meta.fields,
          inputs: meta.inputs
        };
        progress.captured = Object.keys(blocksOut).length;
      } catch (e) {
        errors.push({ category: categoryName, type, error: String(e && e.message || e) });
        progress.errors = errors.length;
      }
    });
  }

  async function extractAll() {
    await (document.fonts && document.fonts.ready ? document.fonts.ready : Promise.resolve());

    const { B, ws } = findMainWorkspace();
    const tb = ws.getToolbox();
    const flyout = tb.getFlyout();
    const fws = flyout.getWorkspace();

    // 1. Expand "Advanced" category so all Advanced & Extension categories are exposed.
    // Strictly avoid clicking "Extensions" (which launches a modal).
    await expandAdvanced();

    // 2. Discover all categories (standard, advanced, and loaded extension blocks)
    const names = getCategories(tb);
    state.progress.total = names.length;
    state.progress.phase = 'extracting';
    console.log('[AIFX] Discovered categories (' + names.length + '):', names.join(', '));

    const blocksOut = {};
    const errors = [];
    const seenSig = {};

    for (let ci = 0; ci < names.length; ci++) {
      const name = names[ci];
      state.progress.category = name;
      state.progress.index = ci + 1;

      const prevSig = flyoutSig(fws);
      if (!clickCategoryRow(name)) {
        errors.push({ category: name, error: 'toolbox row not found' });
        continue;
      }
      let sig = await waitForFlyout(fws, prevSig);
      if (!sig || sig === prevSig) {
        clickCategoryRow(name);
        sig = await waitForFlyout(fws, prevSig);
      }
      if (!sig || sig === prevSig) {
        // If clicking category row opened sub-rows, traverse them
        const currentNames = getCategories(tb);
        for (const sub of currentNames) {
          if (names.includes(sub)) continue;
          const subPrev = flyoutSig(fws);
          if (!clickCategoryRow(sub)) continue;
          const subSig = await waitForFlyout(fws, subPrev);
          if (!subSig || subSig === subPrev) continue;
          captureFlyout(fws, B, sub, blocksOut, seenSig, errors, state.progress);
        }
        continue;
      }

      captureFlyout(fws, B, name, blocksOut, seenSig, errors, state.progress);
      console.log(`[AIFX] Category [${ci + 1}/${names.length}] "${name}" captured. Total: ${Object.keys(blocksOut).length} blocks.`);
    }

    return {
      generated: new Date().toISOString(),
      source: 'arcade.makecode.com flyout (WYSIWYG)',
      renderer: (ws.options && ws.options.renderer) || 'unknown',
      count: Object.keys(blocksOut).length,
      blocks: blocksOut,
      errors
    };
  }

  // ------------------------------------------------------------------- exports

  window.__AIFX_DOWNLOAD_CATALOG__ = function () {
    const data = window.__AIFX_BLOCK_CATALOG__;
    if (!data) { console.warn('[AIFX] No catalog yet — check window.__AIFX_EXTRACT_STATE__.progress'); return null; }
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'aifx-block-catalog.json';
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
    return 'aifx-block-catalog.json';
  };

  (async () => {
    try {
      console.log('[AIFX] Starting WYSIWYG block catalog extraction...');
      const catalog = await extractAll();
      state.catalog = catalog;
      window.__AIFX_BLOCK_CATALOG__ = catalog;
      fetch("http://127.0.0.1:45678", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(catalog) }).catch(console.error);
      state.progress.phase = 'complete';
      console.log('[AIFX] Extraction complete: ' + catalog.count + ' blocks, ' + catalog.errors.length + ' errors.');
      console.log('[AIFX] Retrieve via window.__AIFX_BLOCK_CATALOG__ or download via window.__AIFX_DOWNLOAD_CATALOG__()');
    } catch (e) {
      state.error = String((e && e.stack) || e);
      state.progress.phase = 'error';
      console.error('[AIFX] Extraction failed:', e);
    }
  })();

  return { started: true, progress: state.progress };
})();
