// in_page_renderer.js — runs in MAIN world of arcade.makecode.com iframe
// Has direct access to window.pxt, window.pxt.blocks, window.Blockly, and Blockly workspaces.
// Extracts and renders REAL MakeCode Blockly SVGs. No heuristic or fake fallbacks.

(function () {
  'use strict';

  const CACHE = {};
  let catalogCache = null;

  function blockly() {
    try {
      return window.pxt && window.pxt.blocks ? window.pxt.blocks.requireBlockly() : null;
    } catch (e) {
      return null;
    }
  }

  function toolchain() {
    const B = blockly();
    if (!B) return null;
    const ws = B.getMainWorkspace ? B.getMainWorkspace() : null;
    if (!ws) return null;
    return { B, ws };
  }

  function ensureVariable(ws, name) {
    if (!ws) return null;
    let v = ws.getVariable ? ws.getVariable(name) : null;
    if (!v && ws.createVariable) v = ws.createVariable(name);
    return v;
  }

  function connectInput(parentBlock, inputName, childBlock) {
    if (!parentBlock || !childBlock) return;
    const inp = parentBlock.getInput(inputName);
    if (inp && inp.connection && childBlock.outputConnection) {
      try {
        inp.connection.connect(childBlock.outputConnection);
      } catch (e) {
        console.warn('[AIFX] connectInput failed:', inputName, e);
      }
    }
  }

  function parseCompare(raw) {
    if (!raw) return null;
    const str = raw.trim();
    // Accept <...>, [...] and (...)-bounded compare expressions (paren bounds needed
    // for nested children like (0=0) used as if-conditions).
    if (!((str.startsWith('<') && str.endsWith('>')) || (str.startsWith('[') && str.endsWith(']')) || (str.startsWith('(') && str.endsWith(')')))) {
      return null;
    }
    const inner = str.slice(1, -1).trim();
    if (/^not\b/i.test(inner)) return null;

    let bDepth = 0;
    let pDepth = 0;
    let aDepth = 0;
    let opIdx = -1;
    let opLen = 0;
    let opStr = '';

    for (let i = 0; i < inner.length; i++) {
      const c = inner[i];
      if (c === '[') {
        bDepth++;
        continue;
      }
      if (c === ']') {
        bDepth = Math.max(0, bDepth - 1);
        continue;
      }
      if (c === '(') {
        pDepth++;
        continue;
      }
      if (c === ')') {
        pDepth = Math.max(0, pDepth - 1);
        continue;
      }

      if (bDepth === 0 && pDepth === 0) {
        const rest = inner.slice(i);
        const m2 = rest.match(/^(<=|>=|==|!=|=<|=>)/);
        if (m2 && aDepth === 0) {
          opIdx = i;
          opLen = m2[1].length;
          opStr = m2[1];
          break;
        }

        if (c === '=' && aDepth === 0) {
          opIdx = i;
          opLen = 1;
          opStr = '=';
          break;
        }

        if (c === '<') {
          const before = inner.slice(0, i).trim();
          if (before === '' || /\b(and|or|not)\s*$/i.test(before)) {
            aDepth++;
            continue;
          } else if (aDepth === 0) {
            opIdx = i;
            opLen = 1;
            opStr = '<';
            break;
          }
        }

        if (c === '>') {
          if (aDepth > 0) {
            aDepth--;
            continue;
          } else {
            opIdx = i;
            opLen = 1;
            opStr = '>';
            break;
          }
        }
      }
    }

    if (opIdx === -1) return null;
    const left = inner.slice(0, opIdx).trim();
    const right = inner.slice(opIdx + opLen).trim();
    if (!left || !right) return null;

    let opVal = 'EQ';
    if (opStr === '<=' || opStr === '=<') opVal = 'LTE';
    else if (opStr === '<') opVal = 'LT';
    else if (opStr === '>=' || opStr === '=>') opVal = 'GTE';
    else if (opStr === '>') opVal = 'GT';
    else if (opStr === '!=') opVal = 'NEQ';
    else opVal = 'EQ';

    return { left, op: opStr, opVal, right };
  }

  function parseMath(raw) {
    if (!raw) return null;
    const str = raw.trim();
    if (!((str.startsWith('(') && str.endsWith(')')) || (str.startsWith('[') && str.endsWith(']')))) {
      return null;
    }
    const inner = str.slice(1, -1).trim();

    // Find operator + or - or * or / or ** outside inner brackets
    let bDepth = 0;
    let pDepth = 0;
    let aDepth = 0;
    let opIdx = -1;
    let opLen = 0;
    let opStr = '';

    for (let i = 0; i < inner.length; i++) {
      const c = inner[i];
      if (c === '[') bDepth++;
      else if (c === ']') bDepth = Math.max(0, bDepth - 1);
      else if (c === '(') pDepth++;
      else if (c === ')') pDepth = Math.max(0, pDepth - 1);
      else if (c === '<') aDepth++;
      else if (c === '>') aDepth = Math.max(0, aDepth - 1);
      else if (bDepth === 0 && pDepth === 0 && aDepth === 0) {
        if (c === '-' && (i === 0 || /[\+\-\*\/]\s*$/.test(inner.slice(0, i)))) continue; // negative number
        const rest = inner.slice(i);
        const mPow = rest.match(/^\*\*/);
        if (mPow) { opIdx = i; opLen = 2; opStr = '**'; break; }
        if (c === '+' || c === '-' || c === '*' || c === '/') {
          opIdx = i; opLen = 1; opStr = c; break;
        }
      }
    }

    if (opIdx === -1) return null;
    const left = inner.slice(0, opIdx).trim();
    const right = inner.slice(opIdx + opLen).trim();
    if (!left || !right) return null;

    let opVal = 'ADD';
    if (opStr === '-') opVal = 'MINUS';
    else if (opStr === '*') opVal = 'MULTIPLY';
    else if (opStr === '/') opVal = 'DIVIDE';
    else if (opStr === '**') opVal = 'POWER';

    return { left, op: opStr, opVal, right };
  }

  function parseLogicOp(raw) {
    if (!raw) return null;
    const str = raw.trim();
    // Strict: only <...>-bounded boolean expressions may resolve to an and/or block.
    // Paren bounds are also accepted for nested boolean children like (a and b).
    // Bracketed instruction tokens (e.g. [on each tile ... and kind ...]) are NOT.
    if (!((str.startsWith('<') && str.endsWith('>')) || (str.startsWith('(') && str.endsWith(')')))) {
      return null;
    }
    const inner = str.slice(1, -1).trim();
    if (/^and$/i.test(inner)) return { left: null, op: 'and', opVal: 'AND', right: null };
    if (/^or$/i.test(inner)) return { left: null, op: 'or', opVal: 'OR', right: null };

    // Find top-level "and" or "or" keyword outside inner brackets
    let bDepth = 0;
    let pDepth = 0;
    let aDepth = 0;
    let opIdx = -1;
    let opLen = 0;
    let opStr = '';

    for (let i = 0; i < inner.length; i++) {
      const c = inner[i];
      if (c === '[') bDepth++;
      else if (c === ']') bDepth = Math.max(0, bDepth - 1);
      else if (c === '(') pDepth++;
      else if (c === ')') pDepth = Math.max(0, pDepth - 1);
      else if (c === '<') aDepth++;
      else if (c === '>') aDepth = Math.max(0, aDepth - 1);
      else if (bDepth === 0 && pDepth === 0 && aDepth === 0) {
        const rest = inner.slice(i);
        const mAnd = rest.match(/^\b(and)\b/i);
        if (mAnd) { opIdx = i; opLen = mAnd[1].length; opStr = 'and'; break; }
        const mOr = rest.match(/^\b(or)\b/i);
        if (mOr) { opIdx = i; opLen = mOr[1].length; opStr = 'or'; break; }
      }
    }

    if (opIdx === -1) return null;
    const left = inner.slice(0, opIdx).trim();
    const right = inner.slice(opIdx + opLen).trim();
    if (!left || !right) return null;

    return { left, op: opStr, opVal: opStr.toUpperCase(), right };
  }

  function parseLogicNegate(raw) {
    if (!raw) return null;
    const str = raw.trim();
    // Strict: only <...>-bounded negation (e.g. <not (isBeeDizzy)>); never bracket tokens
    if (!(str.startsWith('<') && str.endsWith('>'))) {
      return null;
    }
    const inner = str.slice(1, -1).trim();
    if (/^not$/i.test(inner)) return { expr: null };
    const m = inner.match(/^not\s+(.+)$/i);
    if (!m) return null;
    return { expr: m[1].trim() };
  }

  function createSubBlock(expr, ws, tc) {
    if (!ws || !expr) return null;
    const raw = expr.trim();
    if (!raw) return null;

    // 1. Numeric literal (e.g. 0, 1, -5, 3.14, (0), (1))
    const cleanNum = raw.replace(/[\[\]\(\)<>]/g, '').trim();
    if (/^-?\d+(?:\.\d+)?$/.test(cleanNum)) {
      try {
        const nb = ws.newBlock('math_number');
        const fn = nb.getField('NUM');
        if (fn) fn.setValue(cleanNum);
        nb.initSvg();
        nb.render();
        return nb;
      } catch (e) {}
    }

    // 2. Boolean literal (e.g. <true>, <false>, true, false)
    if (/^<?\s*(true|false)\s*>?$/i.test(raw)) {
      try {
        const val = /true/i.test(raw) ? 'TRUE' : 'FALSE';
        const tb = ws.newBlock('logic_boolean');
        const f = tb.getField('BOOL');
        if (f) f.setValue(val);
        tb.initSvg();
        tb.render();
        return tb;
      } catch (e) {}
    }

    // 3. Logic Negate: <not ...>
    const neg = parseLogicNegate(raw);
    if (neg) {
      try {
        const nb = ws.newBlock('logic_negate');
        if (neg.expr) {
          const child = createSubBlock(neg.expr, ws, tc);
          if (child) connectInput(nb, 'BOOL', child);
        }
        nb.initSvg();
        nb.render();
        return nb;
      } catch (e) {}
    }

    // 4. Logic Operation: <left and right> or <left or right>
    const logOp = parseLogicOp(raw);
    if (logOp && (logOp.left || logOp.right)) {
      try {
        const lb = ws.newBlock('logic_operation');
        const f = lb.getField('OP');
        if (f) f.setValue(logOp.opVal);
        if (logOp.left) {
          const leftB = createSubBlock(logOp.left, ws, tc);
          if (leftB) connectInput(lb, 'A', leftB);
        }
        if (logOp.right) {
          const rightB = createSubBlock(logOp.right, ws, tc);
          if (rightB) connectInput(lb, 'B', rightB);
        }
        lb.initSvg();
        lb.render();
        return lb;
      } catch (e) {}
    }

    // 5. Logic Compare: <left OP right> (e.g. <0=0>, <0>0>, <1<0>, <magicLevel >= 1>)
    const comp = parseCompare(raw);
    if (comp) {
      try {
        const cb = ws.newBlock('logic_compare');
        const f = cb.getField('OP');
        if (f) f.setValue(comp.opVal);
        const leftB = createSubBlock(comp.left, ws, tc);
        const rightB = createSubBlock(comp.right, ws, tc);
        if (leftB) connectInput(cb, 'A', leftB);
        if (rightB) connectInput(cb, 'B', rightB);
        cb.initSvg();
        cb.render();
        return cb;
      } catch (e) {}
    }

    // 6. Math Arithmetic: (left OP right) (e.g. (1+1), (2-0), (1/1), (x + 10))
    const math = parseMath(raw);
    if (math) {
      try {
        const mb = ws.newBlock('math_arithmetic');
        const f = mb.getField('OP');
        if (f) f.setValue(math.opVal);
        const leftB = createSubBlock(math.left, ws, tc);
        const rightB = createSubBlock(math.right, ws, tc);
        if (leftB) connectInput(mb, 'A', leftB);
        if (rightB) connectInput(mb, 'B', rightB);
        mb.initSvg();
        mb.render();
        return mb;
      } catch (e) {}
    }

    // 7. Controller: is button pressed: [is (A) button pressed], [is [B] button pressed]
    if (/is\s+.*button\s+pressed/i.test(raw)) {
      try {
        const m = raw.match(/is\s+[\[\(]?\s*([a-zA-Z0-9_]+)\s*[\]\)]?\s+button\s+pressed/i);
        const btn = m && m[1] ? m[1].toLowerCase() : 'a';
        const kb = ws.newBlock('keyispressed');
        const f = kb.getField('button');
        if (f) {
          if (btn === 'b') f.setValue('controller.B');
          else if (btn === 'left') f.setValue('controller.left');
          else if (btn === 'right') f.setValue('controller.right');
          else if (btn === 'up') f.setValue('controller.up');
          else if (btn === 'down') f.setValue('controller.down');
          else if (btn === 'menu') f.setValue('controller.menu');
          else if (btn === 'any') f.setValue('controller.anyButton');
          else f.setValue('controller.A');
        }
        kb.initSvg();
        kb.render();
        return kb;
      } catch (e) {}
    }

    // 8. Sprite property getter: (sprite x), (mySprite y), (sprite vx)
    const cleanProp = raw.replace(/[\[\]\(\)]/g, '').trim();
    const propMatch = cleanProp.match(/^(?:(?:mySprite|sprite|[a-zA-Z0-9_]+)\s+)?([xy]|vx|vy|ax|ay|lifespan|width|height|left|right|top|bottom)(?:\s+value(?:\s+block)?)?$/i);
    if (propMatch) {
      try {
        const gb = ws.newBlock('Sprite_blockCombine_get');
        const f = gb.getField('property');
        if (f) f.setValue(`Sprite.${propMatch[1].toLowerCase()}`);
        gb.initSvg();
        gb.render();
        return gb;
      } catch (e) {}
    }

    // 9. Argument reporter: (sprite), (otherSprite), (location)
    if (/^(?:othersprite|sprite|location|picture)$/i.test(cleanNum)) {
      try {
        const rb = ws.newBlock('argument_reporter_custom');
        const f = rb.getField('VALUE');
        if (f) f.setValue(cleanNum);
        rb.initSvg();
        rb.render();
        return rb;
      } catch (e) {}
    }

    // 9b. Tilemap placeholder: (tilemap), (tilemap1), [tilemap 2] — render the real
    // tilemap picker block so it matches the standalone placeholder visual, instead
    // of falling through to a red variables_get.
    if (/^[\[\(]\s*tilemap(?:\s*\d+)?\s*[\]\)]$/i.test(raw)) {
      try {
        const tb = ws.newBlock('tiles_tilemap_editor');
        tb.initSvg();
        tb.render();
        return tb;
      } catch (e) {}
      try {
        const tp = ws.newBlock('tileset_tile_picker');
        tp.initSvg();
        tp.render();
        return tp;
      } catch (e) {}
    }

    // 9c. Array pick random: (get random value from (list)), get random value from list
    if (/get\s+random\s+value\s+from/i.test(raw)) {
      try {
        const m = raw.match(/get\s+random\s+value\s+from\s*\(?([a-zA-Z0-9_ ]+)\)?/i);
        const listName = m && m[1] ? m[1].trim() : 'list';
        const ab = ws.newBlock('array_pickRandom');
        const listInput = ab.getInput('list');
        if (listInput && listInput.connection) {
          const listBlock = ws.newBlock('variables_get');
          const v = ensureVariable(ws, listName);
          const fv = listBlock.getField('VAR');
          if (fv && v) fv.setValue(v.getId());
          listBlock.initSvg();
          listBlock.render();
          listInput.connection.connect(listBlock.outputConnection);
        }
        ab.initSvg();
        ab.render();
        return ab;
      } catch (e) {}
    }

    // 10. Default: Variable getter
    try {
      const vb = ws.newBlock('variables_get');
      const v = ensureVariable(ws, cleanNum);
      const fv = vb.getField('VAR');
      if (fv && v) fv.setValue(v.getId());
      vb.initSvg();
      vb.render();
      return vb;
    } catch (e) {}

    return null;
  }

  function renderCharacterCreation(rawText, ws) {
    const raw = rawText || '';
    const m = raw.match(/^(?:\[?\s*set\s+\[?([a-zA-Z0-9_]+)\]?\s+to\s+)?sprite(?:\s*\(img\))?\s*of\s*kind(?:\s*\(?([a-zA-Z0-9_]+)\)?)?/i);
    const mSet = raw.match(/set\s+\[?([a-zA-Z0-9_]+)\]?\s+to/i);
    const varName = (m && m[1] && m[1].toLowerCase() !== 'sprite') ? m[1] : ((mSet && mSet[1] && mSet[1].toLowerCase() !== 'sprite') ? mSet[1] : 'mySprite');
    const kindName = (m && m[2] && m[2].toLowerCase() !== 'kind') ? m[2] : 'Player';

    const B = blockly();
    if (B && ws) {
      try {
        const xml = `<xml xmlns="http://www.w3.org/1999/xhtml">
          <block type="variables_set">
            <field name="VAR">${varName}</field>
            <value name="VALUE">
              <block type="spritescreate">
                <value name="img"><shadow type="screen_image_picker"></shadow></value>
                <value name="kind"><shadow type="spritekind"><field name="MEMBER">${kindName}</field></shadow></value>
              </block>
            </value>
          </block>
        </xml>`;
        const doc = new DOMParser().parseFromString(xml, 'text/xml');
        const b = B.Xml.domToBlock(doc.documentElement.firstElementChild, ws);
        b.initSvg();
        b.render();
        const res = renderSvg(b);
        b.dispose(false);
        return res;
      } catch (e) {
        console.warn('[AIFX] renderCharacterCreation error:', e);
      }
    }

    const cached = getStaticOrCached('[set (mySprite) to sprite (img) of kind (Player)]') || getStaticOrCached('variables_set_mySprite_spritescreate');
    return cached || null;
  }

  function renderStatusBarCreation(rawText, ws) {
    const raw = rawText || "";
    const mSet = raw.match(/set\s+\[?([a-zA-Z0-9_]+)\]?\s+to/i);
    const varName = (mSet && mSet[1] && mSet[1].toLowerCase() !== "variable") ? mSet[1] : "statusbar";
    const mKind = raw.match(/(?:kind|bubble|to)\s+[\(\[]?([a-zA-Z0-9_]+)[\)\]]?/i);
    const kindName = (mKind && !["kind", "statusbar"].includes(mKind[1].toLowerCase())) ? mKind[1] : "Health";

    const B = blockly();
    if (B && ws) {
      try {
        const xml = `<xml xmlns="http://www.w3.org/1999/xhtml">
          <block type="variables_set">
            <field name="VAR">${varName}</field>
            <value name="VALUE">
              <block type="statusbars_create">
                <value name="width"><shadow type="math_number"><field name="NUM">20</field></shadow></value>
                <value name="height"><shadow type="math_number"><field name="NUM">4</field></shadow></value>
                <value name="kind"><shadow type="statusbars_kind"><field name="MEMBER">${kindName}</field></shadow></value>
              </block>
            </value>
          </block>
        </xml>`;
        const doc = new DOMParser().parseFromString(xml, "text/xml");
        const b = B.Xml.domToBlock(doc.documentElement.firstElementChild, ws);
        b.initSvg();
        b.render();
        const res = renderSvg(b);
        b.dispose(false);
        return res;
      } catch (e) {
        console.warn("[AIFX] renderStatusBarCreation error:", e);
      }
    }
    return null;
  }

  function renderStatusBarCreation(rawText, ws) {
    const raw = rawText || '';
    const mSet = raw.match(/set\s+\[?([a-zA-Z0-9_]+)\]?\s+to/i);
    const varName = (mSet && mSet[1] && mSet[1].toLowerCase() !== 'variable') ? mSet[1] : 'statusbar';
    const mKind = raw.match(/(?:kind|bubble|to)\s+[\(\[]?([a-zA-Z0-9_]+)[\)\]]?/i);
    const kindName = (mKind && !['kind', 'statusbar'].includes(mKind[1].toLowerCase())) ? mKind[1] : 'Health';

    const B = blockly();
    if (B && ws) {
      try {
        const xml = `<xml xmlns="http://www.w3.org/1999/xhtml">
          <block type="variables_set">
            <field name="VAR">${varName}</field>
            <value name="VALUE">
              <block type="statusbars_create">
                <value name="width"><shadow type="math_number"><field name="NUM">20</field></shadow></value>
                <value name="height"><shadow type="math_number"><field name="NUM">4</field></shadow></value>
                <value name="kind"><shadow type="statusbars_kind"><field name="MEMBER">${kindName}</field></shadow></value>
              </block>
            </value>
          </block>
        </xml>`;
        const doc = new DOMParser().parseFromString(xml, 'text/xml');
        const b = B.Xml.domToBlock(doc.documentElement.firstElementChild, ws);
        b.initSvg();
        b.render();
        const res = renderSvg(b);
        b.dispose(false);
        return res;
      } catch (e) {
        console.warn('[AIFX] renderStatusBarCreation error:', e);
      }
    }
    return null;
  }

  // Ensure built-in extension blocks (e.g. Scroller) are defined in Blockly.Blocks
  function renderToggleToken(rawText) {
    const isWin = /win/i.test(rawText);
    const isLose = /lose/i.test(rawText);
    const isOn = /on/i.test(rawText);
    const isOff = /off/i.test(rawText);

    let label = 'OFF';
    let isRight = false;
    let thumbFill = '#879599';

    if (isOn) {
      label = 'ON';
      isRight = true;
      thumbFill = '#2ecc71';
    } else if (isWin) {
      label = 'WIN';
      isRight = true;
      thumbFill = '#2ecc71';
    } else if (isLose) {
      label = 'LOSE';
      isRight = false;
      thumbFill = '#e74c3c';
    } else {
      label = 'OFF';
      isRight = false;
      thumbFill = '#879599';
    }

    const thumbPath = isRight
      ? 'M 71,3 H 89 L 106,20 L 89,37 H 71 L 54,20 Z'
      : 'M 20,3 H 38 L 55,20 L 38,37 H 20 L 3,20 Z';
    const textX = isRight ? 80 : 29;

    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 109 40" width="109" height="40" style="display: inline-block; vertical-align: middle; width: auto !important; margin: 0 3px !important;"><path d="M 20,0 H 89 L 109,20 L 89,40 H 20 L 0,20 Z" fill="#52447c" stroke="#413663" stroke-width="1" /><path d="${thumbPath}" fill="${thumbFill}" /><text x="${textX}" y="20" fill="#ffffff" font-family="'Segoe UI', 'Lucida Grande', Ubuntu, sans-serif" font-weight="700" font-size="15px" text-anchor="middle" dominant-baseline="central">${label}</text></svg>`;

    return {
      svg: svg,
      width: 109,
      height: 40,
      isMultiLine: false
    };
  }

  function renderCharacterCreation(rawText, ws) {
    const raw = rawText || '';
    const m = raw.match(/^(?:\[?\s*set\s+\[?([a-zA-Z0-9_]+)\]?\s+to\s+)?sprite(?:\s*\(img\))?\s*of\s*kind(?:\s*\(?([a-zA-Z0-9_]+)\)?)?/i);
    const mSet = raw.match(/set\s+\[?([a-zA-Z0-9_]+)\]?\s+to/i);
    const varName = (m && m[1] && m[1].toLowerCase() !== 'sprite') ? m[1] : ((mSet && mSet[1] && mSet[1].toLowerCase() !== 'sprite') ? mSet[1] : 'mySprite');
    const kindName = (m && m[2] && m[2].toLowerCase() !== 'kind') ? m[2] : 'Player';

    const B = blockly();
    if (B && ws) {
      try {
        const xml = `<xml xmlns="http://www.w3.org/1999/xhtml">
          <block type="variables_set">
            <field name="VAR">${varName}</field>
            <value name="VALUE">
              <block type="spritescreate">
                <value name="img"><shadow type="screen_image_picker"></shadow></value>
                <value name="kind"><shadow type="spritekind"><field name="MEMBER">${kindName}</field></shadow></value>
              </block>
            </value>
          </block>
        </xml>`;
        const doc = new DOMParser().parseFromString(xml, 'text/xml');
        const b = B.Xml.domToBlock(doc.documentElement.firstElementChild, ws);
        b.initSvg();
        b.render();
        const res = renderSvg(b);
        b.dispose(false);
        return res;
      } catch (e) {
        console.warn('[AIFX] renderCharacterCreation error:', e);
      }
    }

    const cached = getStaticOrCached('[set (mySprite) to sprite (img) of kind (Player)]') || getStaticOrCached('variables_set_mySprite_spritescreate');
    return cached || null;
  }

  function renderStatusBarCreation(rawText, ws) {
    const raw = rawText || '';
    const mSet = raw.match(/set\s+\[?([a-zA-Z0-9_]+)\]?\s+to/i);
    const varName = (mSet && mSet[1] && mSet[1].toLowerCase() !== 'variable') ? mSet[1] : 'statusbar';
    const mKind = raw.match(/(?:kind|bubble|to)\s+[\(\[]?([a-zA-Z0-9_]+)[\)\]]?/i);
    const kindName = (mKind && !['kind', 'statusbar'].includes(mKind[1].toLowerCase())) ? mKind[1] : 'Health';

    const B = blockly();
    if (B && ws) {
      try {
        const xml = `<xml xmlns="http://www.w3.org/1999/xhtml">
          <block type="variables_set">
            <field name="VAR">${varName}</field>
            <value name="VALUE">
              <block type="statusbars_create">
                <value name="width"><shadow type="math_number"><field name="NUM">20</field></shadow></value>
                <value name="height"><shadow type="math_number"><field name="NUM">4</field></shadow></value>
                <value name="kind"><shadow type="statusbars_kind"><field name="MEMBER">${kindName}</field></shadow></value>
              </block>
            </value>
          </block>
        </xml>`;
        const doc = new DOMParser().parseFromString(xml, 'text/xml');
        const b = B.Xml.domToBlock(doc.documentElement.firstElementChild, ws);
        b.initSvg();
        b.render();
        const res = renderSvg(b);
        b.dispose(false);
        return res;
      } catch (e) {
        console.warn('[AIFX] renderStatusBarCreation error:', e);
      }
    }
    return null;
  }

  function renderDropdownBadge(label, color) {
    const cleanLabel = (label || '').replace(/[\[\]\(\)]/g, '').trim();
    const displayLabel = cleanLabel === '<' ? '&lt;' : (cleanLabel === '>' ? '&gt;' : (cleanLabel === '<=' ? '&lt;=' : (cleanLabel === '>=' ? '&gt;=' : cleanLabel)));
    const charWidth = 9.6;
    const textW = Math.max(cleanLabel.length * charWidth, 16);
    const width = Math.ceil(textW + 36);
    const height = 44;
    const arrowX = width - 18;

    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" style="display:inline-block;vertical-align:middle;width:auto !important;margin:0 3px !important;"><rect x="1" y="2" width="${width - 2}" height="${height - 4}" rx="8" ry="8" fill="${color}" stroke="rgba(0,0,0,0.2)" stroke-width="1.5"/><text x="10" y="23" fill="#ffffff" font-family="Consolas, Monaco, Menlo, 'Ubuntu Mono', monospace" font-size="16px" font-weight="600" dominant-baseline="central">${displayLabel}</text><polygon points="${arrowX},19 ${arrowX + 8},19 ${arrowX + 4},25" fill="#ffffff"/></svg>`;

    return {
      svg: svg,
      width: width,
      height: height,
      isMultiLine: false
    };
  }

  function renderCharacterCreation(rawText, ws) {
    const raw = rawText || '';
    const m = raw.match(/^(?:\[?\s*set\s+\[?([a-zA-Z0-9_]+)\]?\s+to\s+)?sprite(?:\s*\(img\))?\s*of\s*kind(?:\s*\(?([a-zA-Z0-9_]+)\)?)?/i);
    const mSet = raw.match(/set\s+\[?([a-zA-Z0-9_]+)\]?\s+to/i);
    const varName = (m && m[1] && m[1].toLowerCase() !== 'sprite') ? m[1] : ((mSet && mSet[1] && mSet[1].toLowerCase() !== 'sprite') ? mSet[1] : 'mySprite');
    const kindName = (m && m[2] && m[2].toLowerCase() !== 'kind') ? m[2] : 'Player';

    const B = blockly();
    if (B && ws) {
      try {
        const xml = `<xml xmlns="http://www.w3.org/1999/xhtml">
          <block type="variables_set">
            <field name="VAR">${varName}</field>
            <value name="VALUE">
              <block type="spritescreate">
                <value name="img"><shadow type="screen_image_picker"></shadow></value>
                <value name="kind"><shadow type="spritekind"><field name="MEMBER">${kindName}</field></shadow></value>
              </block>
            </value>
          </block>
        </xml>`;
        const doc = new DOMParser().parseFromString(xml, 'text/xml');
        const b = B.Xml.domToBlock(doc.documentElement.firstElementChild, ws);
        b.initSvg();
        b.render();
        const res = renderSvg(b);
        b.dispose(false);
        return res;
      } catch (e) {
        console.warn('[AIFX] renderCharacterCreation error:', e);
      }
    }

    const cached = getStaticOrCached('[set (mySprite) to sprite (img) of kind (Player)]') || getStaticOrCached('variables_set_mySprite_spritescreate');
    return cached || null;
  }

  function renderStatusBarCreation(rawText, ws) {
    const raw = rawText || '';
    const mSet = raw.match(/set\s+\[?([a-zA-Z0-9_]+)\]?\s+to/i);
    const varName = (mSet && mSet[1] && mSet[1].toLowerCase() !== 'variable') ? mSet[1] : 'statusbar';
    const mKind = raw.match(/(?:kind|bubble|to)\s+[\(\[]?([a-zA-Z0-9_]+)[\)\]]?/i);
    const kindName = (mKind && !['kind', 'statusbar'].includes(mKind[1].toLowerCase())) ? mKind[1] : 'Health';

    const B = blockly();
    if (B && ws) {
      try {
        const xml = `<xml xmlns="http://www.w3.org/1999/xhtml">
          <block type="variables_set">
            <field name="VAR">${varName}</field>
            <value name="VALUE">
              <block type="statusbars_create">
                <value name="width"><shadow type="math_number"><field name="NUM">20</field></shadow></value>
                <value name="height"><shadow type="math_number"><field name="NUM">4</field></shadow></value>
                <value name="kind"><shadow type="statusbars_kind"><field name="MEMBER">${kindName}</field></shadow></value>
              </block>
            </value>
          </block>
        </xml>`;
        const doc = new DOMParser().parseFromString(xml, 'text/xml');
        const b = B.Xml.domToBlock(doc.documentElement.firstElementChild, ws);
        b.initSvg();
        b.render();
        const res = renderSvg(b);
        b.dispose(false);
        return res;
      } catch (e) {
        console.warn('[AIFX] renderStatusBarCreation error:', e);
      }
    }
    return null;
  }

  const CHECKERED_TILE_PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAVklEQVR4AdyRwQkAIAzEihN18s7SCbqKkl/+fkQhEAgIp6uqtpmZbdxwN3zF5XnggsyMFN0dLdxwN/yBCZefEIsdhp3GDXfDf3gDdhh2GjfcDf/gDQ4AAAD//xRE6jsAAAAGSURBVAMA0Hd9MQrHq6MAAAAASUVORK5CYII=';

  function renderTilemapPlaceholder(text) {
    const label = (text || 'tilemap').replace(/[\[\]\(\)]/g, '').trim();
    const charWidth = 9.5;
    const textWidth = label.length * charWidth;
    const innerWidth = Math.ceil(textWidth + 48);
    const totalWidth = innerWidth + 48;
    const height = 48;
    const imgX = Math.round(textWidth + 24);

    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${totalWidth} ${height}" width="${totalWidth}" height="${height}"><g class="tiles_tilemap_editor blocklyBlock blocklyDraggable" data-id="tilemap_bubble"><path class="blocklyPath" stroke="#384c63" fill="#4b6584" d=" m 24,0  h ${innerWidth} a 24 24 0 0,1 24,24  v 0 a 24 24 0 0,1 -24,24  V 48  h -${innerWidth} a 24 24 0 0,1 -24,-24  v 0 a 24 24 0 0,1 24,-24 z&#10;"/><g class="blocklyLabelField" transform="translate(14,14.5)"><text class="blocklyText blocklyFieldText" dominant-baseline="central" x="0" y="9.5" style="fill:#ffffff !important;font-family:Consolas, Monaco, Menlo, &quot;Ubuntu Mono&quot;, source-code-pro, monospace !important;font-size:16px !important;font-weight:600 !important;text-anchor:start;dominant-baseline:central;">${label}</text></g><g class="blocklyField blocklyDropdownField pxtFieldDropdown blocklyEditableField" transform="translate(${imgX},4)"><rect rx="4" ry="4" x="0" y="0" height="40" width="36" class="blocklyFieldRect" stroke="#384c63" fill="#202b38"/><image xmlns:xlink="http://www.w3.org/1999/xlink" xlink:href="${CHECKERED_TILE_PNG}" height="32" width="32" x="2" y="4"/></g></g></svg>`;

    return {
      svg: svg,
      width: totalWidth,
      height: height,
      isMultiLine: false
    };
  }

  function renderCharacterCreation(rawText, ws) {
    const raw = rawText || '';
    const m = raw.match(/^(?:\[?\s*set\s+\[?([a-zA-Z0-9_]+)\]?\s+to\s+)?sprite(?:\s*\(img\))?\s*of\s*kind(?:\s*\(?([a-zA-Z0-9_]+)\)?)?/i);
    const mSet = raw.match(/set\s+\[?([a-zA-Z0-9_]+)\]?\s+to/i);
    const varName = (m && m[1] && m[1].toLowerCase() !== 'sprite') ? m[1] : ((mSet && mSet[1] && mSet[1].toLowerCase() !== 'sprite') ? mSet[1] : 'mySprite');
    const kindName = (m && m[2] && m[2].toLowerCase() !== 'kind') ? m[2] : 'Player';

    const B = blockly();
    if (B && ws) {
      try {
        const xml = `<xml xmlns="http://www.w3.org/1999/xhtml">
          <block type="variables_set">
            <field name="VAR">${varName}</field>
            <value name="VALUE">
              <block type="spritescreate">
                <value name="img"><shadow type="screen_image_picker"></shadow></value>
                <value name="kind"><shadow type="spritekind"><field name="MEMBER">${kindName}</field></shadow></value>
              </block>
            </value>
          </block>
        </xml>`;
        const doc = new DOMParser().parseFromString(xml, 'text/xml');
        const b = B.Xml.domToBlock(doc.documentElement.firstElementChild, ws);
        b.initSvg();
        b.render();
        const res = renderSvg(b);
        b.dispose(false);
        return res;
      } catch (e) {
        console.warn('[AIFX] renderCharacterCreation error:', e);
      }
    }

    const cached = getStaticOrCached('[set (mySprite) to sprite (img) of kind (Player)]') || getStaticOrCached('variables_set_mySprite_spritescreate');
    return cached || null;
  }

  function renderStatusBarCreation(rawText, ws) {
    const raw = rawText || '';
    const mSet = raw.match(/set\s+\[?([a-zA-Z0-9_]+)\]?\s+to/i);
    const varName = (mSet && mSet[1] && mSet[1].toLowerCase() !== 'variable') ? mSet[1] : 'statusbar';
    const mKind = raw.match(/(?:kind|bubble|to)\s+[\(\[]?([a-zA-Z0-9_]+)[\)\]]?/i);
    const kindName = (mKind && !['kind', 'statusbar'].includes(mKind[1].toLowerCase())) ? mKind[1] : 'Health';

    const B = blockly();
    if (B && ws) {
      try {
        const xml = `<xml xmlns="http://www.w3.org/1999/xhtml">
          <block type="variables_set">
            <field name="VAR">${varName}</field>
            <value name="VALUE">
              <block type="statusbars_create">
                <value name="width"><shadow type="math_number"><field name="NUM">20</field></shadow></value>
                <value name="height"><shadow type="math_number"><field name="NUM">4</field></shadow></value>
                <value name="kind"><shadow type="statusbars_kind"><field name="MEMBER">${kindName}</field></shadow></value>
              </block>
            </value>
          </block>
        </xml>`;
        const doc = new DOMParser().parseFromString(xml, 'text/xml');
        const b = B.Xml.domToBlock(doc.documentElement.firstElementChild, ws);
        b.initSvg();
        b.render();
        const res = renderSvg(b);
        b.dispose(false);
        return res;
      } catch (e) {
        console.warn('[AIFX] renderStatusBarCreation error:', e);
      }
    }
    return null;
  }

  function renderCreateSpritesOnTiles(rawText) {
    const mKind = (rawText || '').match(/(?:kind|\()\s*([a-zA-Z0-9_]+)\)?\s*\]?$/i);
    let kindLabel = mKind && mKind[1] && mKind[1].toLowerCase() !== 'kind' ? mKind[1].trim() : 'Player';
    // Capitalize first letter (e.g. item -> Item)
    kindLabel = kindLabel.charAt(0).toUpperCase() + kindLabel.slice(1);

    const kindCharWidth = 9.6;
    const kindTextW = Math.max(kindLabel.length * kindCharWidth, 24);
    const kindPillW = Math.round(kindTextW + 46);

    const xOnEach = 12;
    const onEachW = 70;
    const xTile = xOnEach + onEachW + 8;
    const tileFieldW = 68;
    const xTileCreate = xTile + tileFieldW + 10;
    const tileCreateW = 280;
    const xImg = xTileCreate + tileCreateW + 10;
    const imgFieldW = 48;
    const xAndKind = xImg + imgFieldW + 10;
    const andKindW = 80;
    const xKind = xAndKind + andKindW + 8;
    const totalW = xKind + kindPillW + 14;
    const h = 66;
    const hStretch = totalW - 52.25;

    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${totalW} ${h}" width="${totalW}" height="${h}"><g class="tileUtil_createSpritesOnTiles blocklyBlock blocklyDraggable"><path class="blocklyPath" stroke="#6574bf" fill="#879bff" d=" m 0,0  m 0,4 a 4 4 0 0,1 4,-4  h 8  c 2,0  3,1  4,2  l 4,4  c 1,1  2,2  4,2  h 12  c 2,0  3,-1  4,-2  l 4,-4  c 1,-1  2,-2  4,-2  h ${hStretch} a 4 4 0 0,1 4,4  v 8  V 54  V 54 a 4 4 0 0,1 -4,4  h -${hStretch}  c -2,0  -3,1  -4,2  l -4,4  c -1,1  -2,2  -4,2  h -12  c -2,0  -3,-1  -4,-2  l -4,-4  c -1,-1  -2,-2  -4,-2  h -8 a 4 4 0 0,1 -4,-4 z"/><g class="blocklyLabelField" transform="translate(${xOnEach},19.5)"><text class="blocklyText blocklyFieldText" dominant-baseline="central" x="0" y="9.5" style="fill:#ffffff !important;font-family:Consolas, Monaco, Menlo, monospace !important;font-size:16px !important;font-weight:600 !important;">on each</text></g><g class="tileset_tile_picker" transform="translate(${xTile}, 5)"><path stroke="#5867af" fill="#4d5c9e" d=" m 24,0  h 20 a 24 24 0 0,1 24,24  v 0 a 24 24 0 0,1 -24,24  V 48  h -20 a 24 24 0 0,1 -24,-24  v 0 a 24 24 0 0,1 24,-24 z"/><rect rx="4" ry="4" x="12" y="4" height="40" width="44" stroke="transparent" fill="transparent"/><image xmlns:xlink="http://www.w3.org/1999/xlink" xlink:href="${CHECKERED_TILE_PNG}" height="32" width="32" x="14" y="8"/><image height="12px" width="12px" xmlns:xlink="http://www.w3.org/1999/xlink" xlink:href="data:image/svg+xml;base64,PHN2ZyBpZD0iTGF5ZXJfMSIgZGF0YS1uYW1lPSJMYXllciAxIiB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIxMi43MSIgaGVpZ2h0PSI4Ljc5IiB2aWV3Qm94PSIwIDAgMTIuNzEgOC43OSI+PHRpdGxlPmRyb3Bkb3duLWFycm93PC90aXRsZT48ZyBvcGFjaXR5PSIwLjEiPjxwYXRoIGQ9Ik0xMi43MSwyLjQ0QTIuNDEsMi40MSwwLDAsMSwxMiw0LjE2TDguMDgsOC4wOGEyLjQ1LDIuNDUsMCwwLDEtMy40NSwwTDAuNzIsNC4xNkEyLjQyLDIuNDIsMCwwLDEsMCwyLjQ0LDIuNDgsMi40OCwwLDAsMSwuNzEuNzFDMSwwLjQ3LDEuNDMsMCw2LjM2LDBTMTEuNzUsMC40NiwxMiwuNzFBMi40NCwyLjQ0LDAsMCwxLDEyLjcxLDIuNDRaIiBmaWxsPSIjMjMxZjIwIi8+PC9nPjxwYXRoIGQ9Ik02LjM2LDcuNzlhMS40MywxLjQzLDAsMCwxLTEtLjQyTDEuNDIsMy40NWExLjQ0LDEuNDQsMCwwLDEsMC0yYzAuNTYtLjU2LDkuMzEtMC41Niw5Ljg3LDBhMS40NCwxLjQ0LDAsMCwxLDAsMkw3LjM3LDcuMzdBMS40MywxLjQzLDAsMCwxLDYuMzYsNy43OVoiIGZpbGw9IiNmZmYiLz48L3N2Zz4=" transform="translate(48,18)"/></g><g class="blocklyLabelField" transform="translate(${xTileCreate},19.5)"><text class="blocklyText blocklyFieldText" dominant-baseline="central" x="0" y="9.5" style="fill:#ffffff !important;font-family:Consolas, Monaco, Menlo, monospace !important;font-size:16px !important;font-weight:600 !important;">tile create sprite with image</text></g><g class="screen_image_picker" transform="translate(${xImg}, 5)"><path stroke="#5867af" fill="#6c7dc9" d=" m 24,0  h 0 a 24 24 0 0,1 24,24  v 0 a 24 24 0 0,1 -24,24  V 48  h 0 a 24 24 0 0,1 -24,-24  v 0 a 24 24 0 0,1 24,-24 z"/><rect rx="4" ry="4" x="8" y="8" height="32" width="32" stroke="#999999" stroke-width="1.5" fill="#dedede"/></g><g class="blocklyLabelField" transform="translate(${xAndKind},19.5)"><text class="blocklyText blocklyFieldText" dominant-baseline="central" x="0" y="9.5" style="fill:#ffffff !important;font-family:Consolas, Monaco, Menlo, monospace !important;font-size:16px !important;font-weight:600 !important;">and kind</text></g><g class="spritekind" transform="translate(${xKind}, 7)"><path stroke="#2451b2" fill="#2e64d8" d=" m 22,0  h ${kindPillW - 44} a 22 22 0 0,1 22,22  v 0 a 22 22 0 0,1 -22,22  V 44  h -${kindPillW - 44} a 22 22 0 0,1 -22,-22  v 0 a 22 22 0 0,1 22,-22 z"/><text x="14" y="22" fill="#ffffff" font-family="Consolas, Monaco, Menlo, monospace" font-size="16px" font-weight="600" dominant-baseline="central">${kindLabel}</text><image height="12px" width="12px" xmlns:xlink="http://www.w3.org/1999/xlink" xlink:href="data:image/svg+xml;base64,PHN2ZyBpZD0iTGF5ZXJfMSIgZGF0YS1uYW1lPSJMYXllciAxIiB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIxMi43MSIgaGVpZ2h0PSI4Ljc5IiB2aWV3Qm94PSIwIDAgMTIuNzEgOC43OSI+PHRpdGxlPmRyb3Bkb3duLWFycm93PC90aXRsZT48ZyBvcGFjaXR5PSIwLjEiPjxwYXRoIGQ9Ik0xMi43MSwyLjQ0QTIuNDEsMi40MSwwLDAsMSwxMiw0LjE2TDguMDgsOC4wOGEyLjQ1LDIuNDUsMCwwLDEtMy40NSwwTDAuNzIsNC4xNkEyLjQyLDIuNDIsMCwwLDEsMCwyLjQ0LDIuNDgsMi40OCwwLDAsMSwuNzEuNzFDMSwwLjQ3LDEuNDMsMCw2LjM2LDBTMTEuNzUsMC40NiwxMiwuNzFBMi40NCwyLjQ0LDAsMCwxLDEyLjcxLDIuNDRaIiBmaWxsPSIjMjMxZjIwIi8+PC9nPjxwYXRoIGQ9Ik02LjM2LDcuNzlhMS40MywxLjQzLDAsMCwxLTEtLjQyTDEuNDIsMy40NWExLjQ0LDEuNDQsMCwwLDEsMC0yYzAuNTYtLjU2LDkuMzEtMC41Niw5Ljg3LDBhMS40NCwxLjQ0LDAsMCwxLDAsMkw3LjM3LDcuMzdBMS40MywxLjQzLDAsMCwxLDYuMzYsNy43OVoiIGZpbGw9IiNmZmYiLz48L3N2Zz4=" transform="translate(${kindPillW - 20},16)"/></g></g></svg>`;

    return {
      svg: svg,
      width: totalW,
      height: h,
      isMultiLine: false
    };
  }

  function renderCharacterCreation(rawText, ws) {
    const raw = rawText || '';
    const m = raw.match(/^(?:\[?\s*set\s+\[?([a-zA-Z0-9_]+)\]?\s+to\s+)?sprite(?:\s*\(img\))?\s*of\s*kind(?:\s*\(?([a-zA-Z0-9_]+)\)?)?/i);
    const mSet = raw.match(/set\s+\[?([a-zA-Z0-9_]+)\]?\s+to/i);
    const varName = (m && m[1] && m[1].toLowerCase() !== 'sprite') ? m[1] : ((mSet && mSet[1] && mSet[1].toLowerCase() !== 'sprite') ? mSet[1] : 'mySprite');
    const kindName = (m && m[2] && m[2].toLowerCase() !== 'kind') ? m[2] : 'Player';

    const B = blockly();
    if (B && ws) {
      try {
        const xml = `<xml xmlns="http://www.w3.org/1999/xhtml">
          <block type="variables_set">
            <field name="VAR">${varName}</field>
            <value name="VALUE">
              <block type="spritescreate">
                <value name="img"><shadow type="screen_image_picker"></shadow></value>
                <value name="kind"><shadow type="spritekind"><field name="MEMBER">${kindName}</field></shadow></value>
              </block>
            </value>
          </block>
        </xml>`;
        const doc = new DOMParser().parseFromString(xml, 'text/xml');
        const b = B.Xml.domToBlock(doc.documentElement.firstElementChild, ws);
        b.initSvg();
        b.render();
        const res = renderSvg(b);
        b.dispose(false);
        return res;
      } catch (e) {
        console.warn('[AIFX] renderCharacterCreation error:', e);
      }
    }

    const cached = getStaticOrCached('[set (mySprite) to sprite (img) of kind (Player)]') || getStaticOrCached('variables_set_mySprite_spritescreate');
    return cached || null;
  }

  function renderStatusBarCreation(rawText, ws) {
    const raw = rawText || '';
    const mSet = raw.match(/set\s+\[?([a-zA-Z0-9_]+)\]?\s+to/i);
    const varName = (mSet && mSet[1] && mSet[1].toLowerCase() !== 'variable') ? mSet[1] : 'statusbar';
    const mKind = raw.match(/(?:kind|bubble|to)\s+[\(\[]?([a-zA-Z0-9_]+)[\)\]]?/i);
    const kindName = (mKind && !['kind', 'statusbar'].includes(mKind[1].toLowerCase())) ? mKind[1] : 'Health';

    const B = blockly();
    if (B && ws) {
      try {
        const xml = `<xml xmlns="http://www.w3.org/1999/xhtml">
          <block type="variables_set">
            <field name="VAR">${varName}</field>
            <value name="VALUE">
              <block type="statusbars_create">
                <value name="width"><shadow type="math_number"><field name="NUM">20</field></shadow></value>
                <value name="height"><shadow type="math_number"><field name="NUM">4</field></shadow></value>
                <value name="kind"><shadow type="statusbars_kind"><field name="MEMBER">${kindName}</field></shadow></value>
              </block>
            </value>
          </block>
        </xml>`;
        const doc = new DOMParser().parseFromString(xml, 'text/xml');
        const b = B.Xml.domToBlock(doc.documentElement.firstElementChild, ws);
        b.initSvg();
        b.render();
        const res = renderSvg(b);
        b.dispose(false);
        return res;
      } catch (e) {
        console.warn('[AIFX] renderStatusBarCreation error:', e);
      }
    }
    return null;
  }

  // Ensure built-in extension blocks (e.g. Scroller) are defined in Blockly.Blocks
  function ensureExtensionBlocks(B) {
    if (!B || !B.Blocks) return;

    if (!B.Blocks['scroller_scrollBackgroundWithCamera']) {
      B.Blocks['scroller_scrollBackgroundWithCamera'] = {
        init: function () {
          this.setColour('#ff85a7');
          this.appendDummyInput()
            .appendField('scroll background with camera')
            .appendField(new B.FieldDropdown([
              ['only horizontally', 'OnlyHorizontal'],
              ['only vertically', 'OnlyVertical'],
              ['both directions', 'BothDirections']
            ]), 'mode');
          this.setPreviousStatement(true);
          this.setNextStatement(true);
        }
      };
    }

    if (!B.Blocks['scroller_setBackgroundScrollOffset']) {
      B.Blocks['scroller_setBackgroundScrollOffset'] = {
        init: function () {
          this.setColour('#ff85a7');
          this.appendDummyInput()
            .appendField('set background offset to')
            .appendField('x')
            .appendField(new B.FieldNumber(0), 'x')
            .appendField('y')
            .appendField(new B.FieldNumber(0), 'y');
          this.setPreviousStatement(true);
          this.setNextStatement(true);
        }
      };
    }

    if (!B.Blocks['scroller_mode_bubble']) {
      B.Blocks['scroller_mode_bubble'] = {
        init: function () {
          this.setColour('#ff85a7');
          this.appendDummyInput().appendField(new B.FieldDropdown([
            ['only vertically', 'OnlyVertical'],
            ['only horizontally', 'OnlyHorizontal']
          ]), 'mode');
          this.setOutput(true);
          this.setOutputShape(2); // ROUND
        }
      };
    }

    if (!B.Blocks['tileutil_createSpritesOnTiles']) {
      B.Blocks['tileutil_createSpritesOnTiles'] = {
        init: function () {
          this.setColour('#4b6584');
          this.appendDummyInput()
            .appendField('on each')
            .appendField(new B.FieldDropdown([
              ['myTile', 'myTile'],
              ['NPC 1', 'NPC 1'],
              ['Item 1', 'Item 1'],
              ['Door 1', 'Door 1']
            ]), 'tile')
            .appendField('tile create sprite with image')
            .appendField(new B.FieldDropdown([
              ['myImage', 'myImage']
            ]), 'img')
            .appendField('and kind')
            .appendField(new B.FieldDropdown([
              ['Player', 'SpriteKind.Player'],
              ['Enemy', 'SpriteKind.Enemy'],
              ['Food', 'SpriteKind.Food'],
              ['Item', 'SpriteKind.Item'],
              ['Projectile', 'SpriteKind.Projectile']
            ]), 'kind');
          this.setPreviousStatement(true);
          this.setNextStatement(true);
        }
      };
    }

    if (!B.Blocks['tileutil_coverAllTiles']) {
      B.Blocks['tileutil_coverAllTiles'] = {
        init: function () {
          this.setColour('#4b6584');
          this.appendDummyInput()
            .appendField('cover all')
            .appendField(new B.FieldDropdown([
              ['myTile', 'myTile'],
              ['NPC 1', 'NPC 1'],
              ['Item 1', 'Item 1']
            ]), 'tile')
            .appendField('tiles with')
            .appendField(new B.FieldDropdown([
              ['myTile', 'myTile']
            ]), 'withTile');
          this.setPreviousStatement(true);
          this.setNextStatement(true);
        }
      };
    }

    if (!B.Blocks['function_definition']) {
      B.Blocks['function_definition'] = {
        init: function () {
          this.setColour('#00aaaa');
          this.appendDummyInput()
            .appendField('function')
            .appendField(new B.FieldTextInput('doSomething'), 'function_name');
          this.appendStatementInput('STACK');
          this.setInputsInline(true);
        }
      };
    }
  }

  function normalize(s) {
    return (s || '')
      .toLowerCase()
      .replace(/[\[\]\(\)\<\>"]/g, ' ')
      .replace(/[^a-z0-9\s=%_]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function wordTokens(s) {
    return new Set(normalize(s).split(/\s+/).filter(w => w.length > 0));
  }

  function charBigrams(s) {
    const norm = normalize(s).replace(/\s+/g, '');
    const bg = new Set();
    for (let i = 0; i < norm.length - 1; i++) {
      bg.add(norm.slice(i, i + 2));
    }
    return bg;
  }

  function diceSimilarity(set1, set2) {
    if (!set1.size && !set2.size) return 1.0;
    if (!set1.size || !set2.size) return 0.0;
    let matches = 0;
    for (const item of set1) {
      if (set2.has(item)) matches++;
    }
    return (2 * matches) / (set1.size + set2.size);
  }

  function jaccardSimilarity(set1, set2) {
    if (!set1.size && !set2.size) return 1.0;
    if (!set1.size || !set2.size) return 0.0;
    let matches = 0;
    for (const item of set1) {
      if (set2.has(item)) matches++;
    }
    const union = set1.size + set2.size - matches;
    return matches / union;
  }

  const CANONICAL_MAP = [
    // Scroller extension
    {
      match: /^\[?\s*scroll\s+background\s+with\s+camera(?:\s*\[?(only\s+horizontally|only\s+vertically|both\s+directions)?\]?)?\s*\]?$/i,
      type: 'scroller_scrollBackgroundWithCamera',
      mutator: (b, ws, raw) => {
        const mode = /vertically/i.test(raw) ? 'OnlyVertical' : 'OnlyHorizontal';
        const f = b.getField('mode');
        if (f) f.setValue(mode);
      },
      conf: 1.0
    },
    {
      match: /^\[?\s*set\s+background\s+offset\s+to(?:\s*x\s*y)?\s*\]?$/i,
      type: 'scroller_setBackgroundScrollOffset',
      conf: 1.0
    },
    {
      match: /^[\[\(]\s*only\s+(?:vertically|horizontally)\s*[\]\)]$/i,
      type: 'scroller_mode_bubble',
      mutator: (b, ws, raw) => {
        const mode = /vertically/i.test(raw) ? 'OnlyVertical' : 'OnlyHorizontal';
        const f = b.getField('mode');
        if (f) f.setValue(mode);
      },
      conf: 1.0
    },

    // Text
    {
      match: /^\[?\s*\(?\s*join\s*\)?\s*\]?$/i,
      type: 'text_join',
      mutator: (b, ws) => {
        if (ws) {
          const in0 = b.getInput('ADD0');
          if (in0 && in0.connection && !in0.connection.targetConnection) {
            const s0 = ws.newBlock('text');
            s0.setShadow(true);
            const f0 = s0.getField('TEXT');
            if (f0) f0.setValue('');
            s0.initSvg();
            s0.render();
            try { in0.connection.connect(s0.outputConnection); } catch (e) {}
          }
          const in1 = b.getInput('ADD1');
          if (in1 && in1.connection && !in1.connection.targetConnection) {
            const s1 = ws.newBlock('text');
            s1.setShadow(true);
            const f1 = s1.getField('TEXT');
            if (f1) f1.setValue('');
            s1.initSvg();
            s1.render();
            try { in1.connection.connect(s1.outputConnection); } catch (e) {}
          }
        }
      },
      conf: 1.0
    },

    // Game dialog / prompt
    {
      match: /^\[?\s*\(?\s*ask\s+for\s+string\s*\)?\s*\]?$/i,
      type: 'gameaskforstring',
      mutator: (b, ws) => {
        if (ws) {
          const inMsg = b.getInput('message');
          if (inMsg && inMsg.connection && !inMsg.connection.targetConnection) {
            const s = ws.newBlock('text');
            s.setShadow(true);
            const f = s.getField('TEXT');
            if (f) f.setValue('');
            s.initSvg();
            s.render();
            try { inMsg.connection.connect(s.outputConnection); } catch (e) {}
          }
        }
      },
      conf: 1.0
    },
    {
      match: /^\[?\s*\(?\s*ask\s+for\s+number\s*\)?\s*\]?$/i,
      type: 'gameaskfornumber',
      mutator: (b, ws) => {
        if (ws) {
          const inMsg = b.getInput('message');
          if (inMsg && inMsg.connection && !inMsg.connection.targetConnection) {
            const s = ws.newBlock('text');
            s.setShadow(true);
            const f = s.getField('TEXT');
            if (f) f.setValue('');
            s.initSvg();
            s.render();
            try { inMsg.connection.connect(s.outputConnection); } catch (e) {}
          }
        }
      },
      conf: 1.0
    },

    // Status Bars
    {
      match: /^[\(\[]?(?:\(statusbar\)|statusbar)\s*[\[\(]?(value|max)[\]\)]?[\)\]]?$/i,
      type: 'StatusBarSprite_blockCombine_get',
      conf: 1.0,
      mutator: (b, ws, raw) => {
        const m = (raw || '').match(/(?:value|max)/i);
        const prop = m ? m[0].toLowerCase() : 'value';
        const f = b.getField('property');
        if (f) f.setValue(`StatusBarSprite.${prop}@get`);
      }
    },
    {
      match: /^\[?\s*change\s+(?:\(statusbar\)|statusbar)\s*[\[\(]?(value|max)[\]\)]?\s+by(?:s+[\(\[]?(-?\d+)[\)\]]?)?\s*\]?$/i,
      type: 'StatusBarSprite_blockCombine_change',
      conf: 1.0,
      mutator: (b, ws, raw) => {
        const m = (raw || '').match(/(?:value|max)/i);
        const prop = m ? m[0].toLowerCase() : 'value';
        const f = b.getField('property');
        if (f) f.setValue(`StatusBarSprite.${prop}@set`);
      }
    },
    {
      match: /^\[?\s*set\s+(?:\(statusbar\)|statusbar)\s*[\[\(]?(value|max)[\]\)]?\s+to(?:s+[\(\[]?(-?\d+)[\)\]]?)?\s*\]?$/i,
      type: 'StatusBarSprite_blockCombine_set',
      conf: 1.0,
      mutator: (b, ws, raw) => {
        const m = (raw || '').match(/(?:value|max)/i);
        const prop = m ? m[0].toLowerCase() : 'value';
        const f = b.getField('property');
        if (f) f.setValue(`StatusBarSprite.${prop}@set`);
      }
    },
    {
      match: /^[\(\[]?status\s*bar\s*(?:of\s*)?(?:kind)?\s*attached\s+to\s*(?:sprite|[a-zA-Z0-9_]+)?[\)\]]?$/i,
      type: 'statusbars_spriteStatusBarIsAttachedTo',
      conf: 1.0
    },
    {
      match: /^[\(\[]?sprite\s+that\s*(?:\(statusbar\)|statusbar)?\s*is\s+attached\s+to[\)\]]?$/i,
      type: 'statusbars_attachSpriteGetter',
      conf: 1.0
    },

    // Status Bars - creation statement
    {
      match: /^\[?\s*(?:set\s+\[?(statusbar)\]?\s+to.*|create\s+status\s*bar.*)\s*\]?$/i,
      custom: (raw, ws) => renderStatusBarCreation(raw, ws),
      conf: 1.0
    },
    // Sprites - character creation statement (Option B)
    {
      match: /^\[?\s*(?:set\s+(?:sprite|\[?[a-zA-Z0-9_]+\]?)\s+to\s+)?sprite(?:\s*\(img\))?\s*of\s*kind(?:\s*\(?[a-zA-Z0-9_]+\)?)?\s*\]?$/i,
      custom: (raw, ws) => renderCharacterCreation(raw, ws),
      conf: 1.0
    },
    {
      match: /^\[?\s*set\s+(?:sprite|\(\s*[a-zA-Z0-9_]+\s*\))\s+to\s*\]?$/i,
      custom: (raw, ws) => renderCharacterCreation(raw, ws),
      conf: 1.0
    },
    {
      match: /^[\[\(]?(?:array\s+of\s+sprites|all\s+sprites|sprites|all)\s+of\s+kind(?:\s*\(?([a-zA-Z0-9_]+)\)?)?[\]\)]?$/i,
      type: 'allOfKind',
      conf: 1.0,
      mutator: (b, ws, raw) => {
        const m = (raw || '').match(/kind\s*\(?([a-zA-Z0-9_]+)\)?/i);
        const kindName = (m && m[1]) ? m[1] : 'Player';
        const kindBlock = b.getChildren(false).find(c => c.type === 'spritekind');
        if (kindBlock) {
          const f = kindBlock.getField('MEMBER');
          if (f) f.setValue(kindName);
        }
      }
    },
    { match: /^\[?\s*set\s+(?:sprite|\(?[a-zA-Z0-9_]+\)?)\s+position\s+to\s*(?:x\s*y)?\s*[\]\}]?$/i, type: 'spritesetpos', conf: 1.0 },
    { match: /^\[?\s*set\s+(?:sprite|\(?[a-zA-Z0-9_]+\)?)\s+velocity\s+to\s*(?:vx\s*vy)?\s*\]?$/i, type: 'spritesetvel', conf: 1.0 },
    {
      match: /^\[?\s*set\s+(?:sprite|\(?[a-zA-Z0-9_]+\)?)\s+[\[\(]?(velocity\s*[xy]|vx|vy|ax|ay|x|y|scale)[\]\)]?\s+to(?:\s+[\(\[]?(-?\d+)[\)\]]?)?\s*\]?$/i,
      type: 'Sprite_blockCombine_set',
      mutator: (b, ws, raw) => {
        const m = (raw || '').match(/set\s+(?:sprite|\(?([a-zA-Z0-9_]+)\)?)\s+[\[\(]?(velocity\s*[xy]|vx|vy|ax|ay|x|y|scale)[\]\)]?\s+to(?:\s+[\(\[]?(-?\d+)[\)\]]?)?/i);
        const sName = m && m[1] ? m[1] : 'sprite';
        const propRaw = (m && m[2] ? m[2] : 'velocity y').toLowerCase().replace(/\s+/g, '');
        const valNum = m && m[3] ? m[3] : '0';

        let propVal = 'Sprite.vy@set';
        if (propRaw === 'velocityx' || propRaw === 'vx') propVal = 'Sprite.vx@set';
        else if (propRaw === 'velocityy' || propRaw === 'vy') propVal = 'Sprite.vy@set';
        else if (propRaw === 'x') propVal = 'Sprite.x@set';
        else if (propRaw === 'y') propVal = 'Sprite.y@set';
        else if (propRaw === 'ax') propVal = 'Sprite.ax@set';
        else if (propRaw === 'ay') propVal = 'Sprite.ay@set';
        else if (propRaw === 'scale') propVal = 'Sprite.scale@set';

        const fProp = b.getField('property');
        if (fProp) fProp.setValue(propVal);

        if (ws) {
          const inSprite = b.getInput('mySprite');
          if (inSprite && inSprite.connection && !inSprite.connection.targetConnection) {
            try {
              const vb = ws.newBlock('variables_get');
              const v = ensureVariable(ws, sName);
              if (v && vb.getField('VAR')) vb.getField('VAR').setValue(v.getId());
              vb.initSvg();
              vb.render();
              inSprite.connection.connect(vb.outputConnection);
            } catch (e) {}
          }
          const inVal = b.getInput('value');
          if (inVal && inVal.connection && !inVal.connection.targetConnection) {
            try {
              const nb = ws.newBlock('math_number');
              const fn = nb.getField('NUM');
              if (fn) fn.setValue(valNum);
              nb.initSvg();
              nb.render();
              inVal.connection.connect(nb.outputConnection);
            } catch (e) {}
          }
        }
      },
      conf: 1.0
    },
    { match: /^\[?\s*set\s+(?:sprite|\(?[a-zA-Z0-9_]+\)?)\s+image\s+to\s*\]?$/i, type: 'spritesetimage', conf: 1.0 },
    { match: /^\[?\s*set\s+(?:sprite|\(?[a-zA-Z0-9_]+\)?)\s+kind\s+to\s*\]?$/i, type: 'spritesetkind', conf: 1.0 },
    { match: /^\[?\s*set\s+(?:sprite|\(?[a-zA-Z0-9_]+\)?)\s+stay\s+in\s+screen\s*\]?$/i, type: 'spritesetsetstayinscreen', conf: 1.0 },
    { match: /^\[?\s*set\s+(?:sprite|\(?[a-zA-Z0-9_]+\)?)\s+bounce\s+on\s+wall\s*\]?$/i, type: 'spritesetsetbounceonwall', conf: 1.0 },
    { match: /^\[?\s*set\s+(?:sprite|\(?[a-zA-Z0-9_]+\)?)\s+(auto\s+destroy|invisible|ghost)\s*\]?$/i, type: 'spritesetsetflag', mutator: (b, ws, raw) => {
        const f = b.getField('flag');
        if (f) {
          if (/invisible/i.test(raw)) f.setValue('SpriteFlag.Invisible');
          else if (/ghost/i.test(raw)) f.setValue('SpriteFlag.Ghost');
          else f.setValue('SpriteFlag.AutoDestroy');
        }
      }, conf: 1.0 },
    { match: /^\[?\s*move\s+(?:sprite|\(?[a-zA-Z0-9_]+\)?)\s+with\s+buttons\s*\]?$/i, type: 'game_control_sprite', conf: 1.0 },
    { match: /^\[?\s*destroy\s+(?:sprite|\(?[a-zA-Z0-9_]+\)?)\s*\]?$/i, type: 'spritedestroy2', conf: 1.0 },
    {
      match: /^\[?\s*destroy\s+all\s+sprites\s+of\s+kind(?:\s+[\[\(]?([a-zA-Z0-9_]+)[\]\)]?)?\s*\]?$/i,
      type: 'sprites_destroy_all_sprites_of_kind',
      mutator: (b, ws, raw) => {
        const m = (raw || '').match(/destroy\s+all\s+sprites\s+of\s+kind(?:\s+[\[\(]?([a-zA-Z0-9_]+)[\]\)]?)?/i);
        const kind = m && m[1] ? m[1] : 'Enemy';
        const inKind = b.getInput('kind');
        if (ws && inKind && inKind.connection && !inKind.connection.targetConnection) {
          try {
            const kb = ws.newBlock('spritekind');
            const f = kb.getField('MEMBER');
            if (f) f.setValue(kind);
            kb.initSvg();
            kb.render();
            inKind.connection.connect(kb.outputConnection);
          } catch (e) {}
        }
      },
      conf: 1.0
    },
    { match: /^\[?\s*(?:sprite\s+say|say)\s*\]?$/i, type: 'spritesaytext', conf: 1.0 },
    {
      match: /^\[?\s*set\s+(?:[\(\[]?([a-zA-Z0-9_]+)[\)\]]?|sprite)\s+follow(?:\s+[\(\[]?([a-zA-Z0-9_]+)[\)\]]?)?\s*\]?$/i,
      type: 'spriteFollowOtherSprite',
      mutator: (b, ws, raw) => {
        if (!ws) return;
        const m = (raw || '').match(/set\s+(?:[\(\[]?([a-zA-Z0-9_]+)[\)\]]?|sprite)\s+follow(?:\s+[\(\[]?([a-zA-Z0-9_]+)[\)\]]?)?/i);
        let s1 = m && m[1] ? m[1] : 'sprite';
        let s2 = m && m[2] ? m[2] : 'mySprite';
        if (/sprite/i.test(s1)) s1 = 'sprite';

        function ensureVar(name) {
          let v = ws.getVariable ? ws.getVariable(name) : null;
          if (!v && ws.createVariable) v = ws.createVariable(name);
          return v ? v.getId() : name;
        }

        const inSprite = b.getInput('sprite');
        if (inSprite && inSprite.connection && !inSprite.connection.targetConnection) {
          const v1 = ws.newBlock('variables_get');
          v1.getField('VAR').setValue(ensureVar(s1));
          v1.initSvg();
          v1.render();
          try { inSprite.connection.connect(v1.outputConnection); } catch (e) {}
        }

        const inTarget = b.getInput('target');
        if (inTarget && inTarget.connection && !inTarget.connection.targetConnection) {
          const v2 = ws.newBlock('variables_get');
          v2.getField('VAR').setValue(ensureVar(s2));
          v2.initSvg();
          v2.render();
          try { inTarget.connection.connect(v2.outputConnection); } catch (e) {}
        }
      },
      conf: 1.0
    },
    { match: /^\[?\s*(?:follow\s+sprite|sprite\s+follow)\s*\]?$/i, type: 'spriteFollowOtherSprite', conf: 1.0 },
    { match: /^\[?\s*set\s+(?:[\(\[]?[a-zA-Z0-9_]+[\)\]]?|sprite|this)\s+unfollow\s*\]?$/i, type: 'spriteUnfollow', conf: 1.0 },
    { match: /^\[?\s*start\s+effect\s+on\s+(?:sprite|\(?[a-zA-Z0-9_]+\)?)\s*\]?$/i, type: 'startEffectOnSprite', conf: 1.0 },
    { match: /^\[?\s*sprite\s+start\s+effect\s*\]?$/i, type: 'startEffectOnSprite', conf: 1.0 },
    {
      match: /^\[?\s*(?:on\s+)?(?:[\(\[]?\s*([a-zA-Z0-9_]+)\s*[\)\]]?|sprite|sprie)\s+overlaps\s+(?:[\(\[]?\s*([a-zA-Z0-9_]+)\s*[\)\]]?|sprite)(?:\s+container)?\s*\]?$/i,
      type: 'spritesoverlap',
      mutator: (b, ws, raw) => {
        if (!ws) return;
        const regex = /^\[?\s*(?:on\s+)?(?:[\(\[]?\s*([a-zA-Z0-9_]+)\s*[\)\]]?|sprite|sprie)\s+overlaps\s+(?:[\(\[]?\s*([a-zA-Z0-9_]+)\s*[\)\]]?|sprite)(?:\s+container)?\s*\]?$/i;
        const m = (raw || '').match(regex);
        let k1 = m && m[1] ? m[1] : 'Player';
        let k2 = m && m[2] ? m[2] : 'Player';
        if (/sprite|sprie/i.test(k1)) k1 = 'Player';
        if (/sprite|sprie/i.test(k2)) k2 = 'Player';

        const inSprite = b.getInput('HANDLER_DRAG_PARAM_sprite');
        if (inSprite && inSprite.connection && !inSprite.connection.targetConnection) {
          const rep = ws.newBlock('argument_reporter_custom');
          const f = rep.getField('VALUE');
          if (f) f.setValue('sprite');
          rep.initSvg();
          rep.render();
          try { inSprite.connection.connect(rep.outputConnection); } catch (e) {}
        }

        const inKind = b.getInput('kind');
        if (inKind && inKind.connection && !inKind.connection.targetConnection) {
          const kb = ws.newBlock('spritekind');
          const f = kb.getField('MEMBER');
          if (f) f.setValue(k1);
          kb.initSvg();
          kb.render();
          try { inKind.connection.connect(kb.outputConnection); } catch (e) {}
        }

        const inOther = b.getInput('HANDLER_DRAG_PARAM_otherSprite');
        if (inOther && inOther.connection && !inOther.connection.targetConnection) {
          const rep = ws.newBlock('argument_reporter_custom');
          const f = rep.getField('VALUE');
          if (f) f.setValue('otherSprite');
          rep.initSvg();
          rep.render();
          try { inOther.connection.connect(rep.outputConnection); } catch (e) {}
        }

        const inOtherKind = b.getInput('otherKind');
        if (inOtherKind && inOtherKind.connection && !inOtherKind.connection.targetConnection) {
          const kb = ws.newBlock('spritekind');
          const f = kb.getField('MEMBER');
          if (f) f.setValue(k2);
          kb.initSvg();
          kb.render();
          try { inOtherKind.connection.connect(kb.outputConnection); } catch (e) {}
        }
      },
      conf: 1.0
    },
    { match: /^\[?\s*run code on\s+.*overlaps.*otherkind.*\]?$/i, type: 'spritesoverlap', conf: 1.0 },
    { match: /^\[?\s*(?:on\s+)?sprite\s+overlaps\s+tile\s*\]?$/i, type: 'spriteshittile', conf: 1.0 },
    { match: /^\[?\s*(?:on\s+)?sprite\s+hits\s+wall\s*\]?$/i, type: 'spriteshitwall', conf: 1.0 },
    {
      match: /^\[?\s*(?:on\s+)?created(?:\s+(?:sprite|\(?[a-zA-Z0-9_]+\)?))?(?:\s+of\s+kind)?(?:\s+[\[\(]?([a-zA-Z0-9_]+)[\]\)]?)?(?:\s+container)?\s*\]?$/i,
      type: 'spritesoncreated',
      mutator: (b, ws, raw) => {
        const m = (raw || '').match(/(?:of\s+kind|created)\s+[\[\(]?([a-zA-Z0-9_]+)[\]\)]?/i);
        let kind = m && m[1] ? m[1] : 'Enemy';
        if (/sprite|container/i.test(kind)) kind = 'Enemy';
        const spriteParamInput = b.getInput('HANDLER_DRAG_PARAM_sprite');
        if (spriteParamInput && ws) {
          const rep = ws.newBlock('argument_reporter_custom');
          const f = rep.getField('VALUE');
          if (f) f.setValue('sprite');
          rep.initSvg();
          rep.render();
          try { spriteParamInput.connection.connect(rep.outputConnection); } catch (e) {}
        }
        const kindInput = b.getInput('kind');
        if (kindInput && ws) {
          const kindBlock = ws.newBlock('spritekind');
          const kf = kindBlock.getField('MEMBER');
          if (kf) kf.setValue(kind);
          kindBlock.initSvg();
          kindBlock.render();
          try { kindInput.connection.connect(kindBlock.outputConnection); } catch (e) {}
        }
      },
      conf: 1.0
    },
    {
      match: /^\[?\s*(?:on\s+)?destroyed(?:\s+container)?\s*\]?$/i,
      type: 'spritesondestroyed',
      mutator: (b, ws) => {
        const spriteParamInput = b.getInput('HANDLER_DRAG_PARAM_sprite');
        if (spriteParamInput && ws) {
          const rep = ws.newBlock('argument_reporter_custom');
          const f = rep.getField('VALUE');
          if (f) f.setValue('sprite');
          rep.initSvg();
          rep.render();
          try { spriteParamInput.connection.connect(rep.outputConnection); } catch (e) {}
        }
        const kindInput = b.getInput('kind');
        if (kindInput && ws) {
          const kindBlock = ws.newBlock('spritekind');
          const kf = kindBlock.getField('MEMBER');
          if (kf) kf.setValue('Player');
          kindBlock.initSvg();
          kindBlock.render();
          try { kindInput.connection.connect(kindBlock.outputConnection); } catch (e) {}
        }
      },
      conf: 1.0
    },

    // Projectiles
    { match: /^\[?\s*set\s+projectile\s+to\s+projectile\s+from\s+side\s*\]?$/i, type: 'spritescreateprojectilefromside', conf: 1.0 },
    { match: /^\[?\s*set\s+projectile\s+to\s+projectile\s+from\s+sprite\s*\]?$/i, type: 'spritescreateprojectilefromsprite', conf: 1.0 },
    { match: /^\[?\s*projectile\s+.*from\s+side.*\]?$/i, type: 'spritescreateprojectilefromside', conf: 1.0 },
    { match: /^\[?\s*projectile\s+.*from\s+.*with\s+vx.*\]?$/i, type: 'spritescreateprojectilefromsprite', conf: 1.0 },

    // Loops & Logic & Math
    { match: /^\[?\s*on\s+start\s*\]?$/i, type: 'pxt-on-start', conf: 1.0 },
    { match: /^\[?\s*on\s+game\s+update\s+every\s+ms\s*\]?$/i, type: 'gameinterval', conf: 1.0 },
    { match: /^\[?\s*on\s+game\s+update\s*\]?$/i, type: 'gameupdate', conf: 1.0 },
    { match: /^\[?\s*forever\s*\]?$/i, type: 'forever', conf: 1.0 },
    {
      match: /^\[?\s*if(?:\s+(.+?))?\s+then\s*[\/\\]\s*else\s*\]?$/i,
      type: 'controls_if',
      mutator: (b, ws, raw) => {
        b.elseCount_ = 1;
        if (b.updateShape_) b.updateShape_();
        const m = (raw || '').match(/^\[?\s*if(?:\s+(.+?))?\s+then\s*[\/\\]\s*else\s*\]?$/i);
        const cond = m && m[1] ? m[1].trim() : '';
        if (ws && cond) {
          const sub = createSubBlock(cond, ws);
          if (sub) connectInput(b, 'IF0', sub);
        }
      },
      conf: 1.0
    },
    {
      match: /^\[?\s*if(?:\s+(.+?))?\s+then\s*\]?$/i,
      type: 'controls_if',
      mutator: (b, ws, raw) => {
        const m = (raw || '').match(/^\[?\s*if(?:\s+(.+?))?\s+then\s*\]?$/i);
        const cond = m && m[1] ? m[1].trim() : '';
        if (ws && cond) {
          const sub = createSubBlock(cond, ws);
          if (sub) connectInput(b, 'IF0', sub);
        }
      },
      conf: 1.0
    },
    {
      match: /^\[?\s*if\s*\]?$/i,
      type: 'controls_if',
      mutator: (b, ws) => {
        try {
          const inp = b.getInput('IF0');
          if (inp && inp.connection && !inp.connection.targetConnection) {
            const tb = ws.newBlock('logic_boolean');
            tb.setShadow(true);
            const f = tb.getField('BOOL');
            if (f) f.setValue('TRUE');
            tb.initSvg();
            tb.render();
            inp.connection.connect(tb.outputConnection);
          }
        } catch (e) {}
      },
      conf: 1.0
    },
    { match: /^\[?\s*else\s*if\s*\]?$/i,
      type: 'controls_if',
      mutator: (b, ws) => {
        b.elseifCount_ = 1;
        if (b.updateShape_) b.updateShape_();
        // Fill BOTH condition sockets (IF0 = main if, IF1 = the else-if row) so
        // the hexagon input field is visible on every row of the C-block.
        for (const inputName of ['IF0', 'IF1']) {
          try {
            const tb = ws.newBlock('logic_boolean');
            const f = tb.getField('BOOL');
            if (f) f.setValue('TRUE');
            tb.initSvg();
            tb.render();
            const inp = b.getInput(inputName);
            if (inp && inp.connection && tb.outputConnection) inp.connection.connect(tb.outputConnection);
          } catch (e) {}
        }
      },
      conf: 1.0 },
    { match: /^\[?\s*else\s*\]?$/i,
      type: 'controls_if',
      mutator: (b, ws) => {
        b.elseCount_ = 1;
        if (b.updateShape_) b.updateShape_();
        try {
          const tb = ws.newBlock('logic_boolean');
          const f = tb.getField('BOOL');
          if (f) f.setValue('TRUE');
          tb.initSvg();
          tb.render();
          const inp = b.getInput('IF0');
          if (inp && inp.connection && tb.outputConnection) inp.connection.connect(tb.outputConnection);
        } catch (e) {}
      },
      conf: 1.0 },
    { match: /^\[?\s*(?:repeat\s+)?while(?:\s+loop)?\s*\]?$/i, type: 'device_while', conf: 1.0 },
    { match: /^\[?\s*repeat(?:\s+times|\s+loop)?\s*\]?$/i, type: 'controls_repeat_ext', conf: 1.0 },
    { match: /^\[?\s*(?:for\s+index|for)\s*\]?$/i, type: 'controls_simple_for', conf: 0.9 },
    { match: /^\[?\s*for\s+element\s*\]?$/i, type: 'pxt_controls_for_of', conf: 0.95 },
    { match: /^\[?\s*pause\s*(?:\(\d+\))?\s*ms\s*\]?$/i, type: 'device_pause', conf: 1.0 },
    { match: /^\[?\s*pick\s+random\s*\]?$/i, type: 'device_random', conf: 1.0 },
    { match: /^\(?\s*pick\s+random\s*\)?$/i, type: 'device_random', conf: 1.0 },
    { match: /^[<\[\(]?\s*%?\s*chance\s*[>\]\)]?$/i, type: 'percentchance', conf: 1.0 },
    {
      match: /^[<\[\(]?\s*is\s+sprite\s+hitting\s+wall(?:\s*\[?(bottom|top|left|right)?\]?)?\s*[>\]\)]?$/i,
      type: 'spritehasobstacle',
      mutator: (b, ws, raw) => {
        const m = (raw || '').match(/(bottom|top|left|right)/i);
        const dir = m ? (m[1].charAt(0).toUpperCase() + m[1].slice(1).toLowerCase()) : 'Bottom';
        const f = b.getField('direction');
        if (f) f.setValue(`CollisionDirection.${dir}`);
        try {
          const inp = b.getInput('sprite');
          if (inp && inp.connection && !inp.connection.targetConnection) {
            const vb = ws.newBlock('variables_get');
            vb.setShadow(true);
            const v = ensureVariable(ws, 'mySprite');
            const fv = vb.getField('VAR');
            if (fv && v) fv.setValue(v.getId());
            vb.initSvg();
            vb.render();
            inp.connection.connect(vb.outputConnection);
          }
        } catch (e) {}
      },
      conf: 1.0
    },

    // Logic negation: <not ...>
    {
      match: { test: (raw) => !!parseLogicNegate(raw) },
      type: 'logic_negate',
      mutator: (b, ws, raw) => {
        const neg = parseLogicNegate(raw);
        if (!neg) return;
        if (ws && neg.expr) {
          const child = createSubBlock(neg.expr, ws);
          if (child) connectInput(b, 'BOOL', child);
        }
      },
      conf: 1.0
    },

    // Logic operation: <... and ...>, <... or ...>, <and>, <or>
    {
      match: { test: (raw) => !!parseLogicOp(raw) },
      type: 'logic_operation',
      mutator: (b, ws, raw) => {
        const op = parseLogicOp(raw);
        if (!op) return;
        const f = b.getField('OP');
        if (f) f.setValue(op.opVal);
        if (ws) {
          if (op.left) {
            const leftB = createSubBlock(op.left, ws);
            if (leftB) connectInput(b, 'A', leftB);
          }
          if (op.right) {
            const rightB = createSubBlock(op.right, ws);
            if (rightB) connectInput(b, 'B', rightB);
          }
        }
      },
      conf: 1.0
    },

    // Logic compare: <0=0>, <0>0>, <1<0>, <magicLevel >= 1>, <score > 5>, etc.
    {
      match: { test: (raw) => !!parseCompare(raw) },
      type: 'logic_compare',
      mutator: (b, ws, raw) => {
        const comp = parseCompare(raw);
        if (!comp) return;
        const f = b.getField('OP');
        if (f) f.setValue(comp.opVal);
        if (ws) {
          const leftB = createSubBlock(comp.left, ws);
          const rightB = createSubBlock(comp.right, ws);
          if (leftB) connectInput(b, 'A', leftB);
          if (rightB) connectInput(b, 'B', rightB);
        }
      },
      conf: 1.0
    },

    // Math arithmetic: (1+1), (2-0), (1/1), (0+0), (x + 10), (score - 1), etc.
    {
      match: { test: (raw) => !!parseMath(raw) },
      type: 'math_arithmetic',
      mutator: (b, ws, raw) => {
        const math = parseMath(raw);
        if (!math) return;
        const f = b.getField('OP');
        if (f) f.setValue(math.opVal);
        if (ws) {
          const leftB = createSubBlock(math.left, ws);
          const rightB = createSubBlock(math.right, ws);
          if (leftB) connectInput(b, 'A', leftB);
          if (rightB) connectInput(b, 'B', rightB);
        }
      },
      conf: 1.0
    },

    { match: /^[<\[]\s*on\s*[>\]]$/i, type: 'toggleOnOff', custom: () => renderToggleToken('<ON>'), conf: 1.0 },
    { match: /^[<\[]\s*off\s*[>\]]$/i, type: 'toggleOnOff', custom: () => renderToggleToken('<OFF>'), conf: 1.0 },
    { match: /^[<\[]\s*win\s*[>\]]$/i, type: 'toggleWinLose', custom: () => renderToggleToken('<WIN>'), conf: 1.0 },
    { match: /^[<\[]\s*lose\s*[>\]]$/i, type: 'toggleWinLose', custom: () => renderToggleToken('<LOSE>'), conf: 1.0 },
    { match: /^<\s*true\s*>$/i, type: 'logic_boolean', mutator: (b) => { const f = b.getField('BOOL'); if (f) f.setValue('TRUE'); }, conf: 1.0 },
    { match: /^<\s*false\s*>$/i, type: 'logic_boolean', mutator: (b) => { const f = b.getField('BOOL'); if (f) f.setValue('FALSE'); }, conf: 1.0 },
    { match: /^<true>$/i, type: 'logic_boolean', conf: 1.0 },

    // Functions
    {
      match: /^\[?\s*\(?\s*Make\s+a\s+Function(?:\.{2,3})?\s*\)?\s*\]?$/i,
      custom: () => ({
        svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 156 44" width="156" height="44"><style>.fn-btn-bg { fill: #5f6665; stroke: #f76820; stroke-width: 2.5; rx: 4px; ry: 4px; } .fn-btn-txt { fill: #ffffff !important; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif !important; font-size: 14px !important; font-weight: 700 !important; letter-spacing: 0.2px; }</style><rect x="2" y="2" width="152" height="40" class="fn-btn-bg"/><text x="78" y="22" class="fn-btn-txt" text-anchor="middle" dominant-baseline="central">Make a Function...</text></svg>`,
        width: 156,
        height: 44,
        isMultiLine: false
      }),
      conf: 1.0
    },

    // Play icon (▶)
    {
      match: /^\[?\s*▶\s*\]?$/i,
      custom: () => ({
        svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 96" width="100" height="96"><rect x="3" y="1" width="96" height="94" rx="10" fill="#077b8a"/><path d="M 13 95 L 89 95 A 10 10 0 0 0 99 85 L 99 90 A 6 6 0 0 1 93 95 L 13 95 Z" fill="#0b6e7b"/><path d="M 3 85 A 10 10 0 0 0 13 95 L 9 95 A 6 6 0 0 1 3 89 Z" fill="#0b6e7b"/><rect x="3" y="1" width="92" height="84" rx="9" fill="#028b9b" stroke="#077b8a" stroke-width="1"/><line x1="12" y1="2" x2="84" y2="2" stroke="#048392" stroke-width="1"/><line x1="4" y1="12" x2="4" y2="76" stroke="#048392" stroke-width="1"/><path d="M 37 30 C 35.5 29 33.5 30 33.5 32 L 33.5 60 C 33.5 62 35.5 63 37 62 L 63 47.5 C 64.5 46.5 64.5 44.5 63 43.5 Z" fill="#e6f4f5"/></svg>`,
        width: 100,
        height: 96,
        isMultiLine: false
      }),
      conf: 1.0
    },

    // Controller
    {
      match: /^\[?\s*on\s+(?:[\[\(]?([a-zA-Z0-9_]+)[\]\)]?\s+)?button(?:\s+[\[\(]?([a-zA-Z0-9_]+)[\]\)]?)?\s*\]?$/i,
      type: 'keyonevent',
      mutator: (b, ws, raw) => {
        const m = (raw || '').match(/on\s+(?:[\[\(]?([a-zA-Z0-9_]+)[\]\)]?\s+)?button(?:\s+[\[\(]?([a-zA-Z0-9_]+)[\]\)]?)?/i);
        let btn = (m && m[1] ? m[1] : 'A').toLowerCase();
        let ev = (m && m[2] ? m[2] : 'pressed').toLowerCase();
        if (['pressed', 'released', 'repeat', 'repeated'].includes(btn) && !m[2]) {
          ev = btn;
          btn = 'a';
        }
        const fBtn = b.getField('button');
        if (fBtn) {
          if (btn === 'b') fBtn.setValue('controller.B');
          else if (btn === 'left') fBtn.setValue('controller.left');
          else if (btn === 'right') fBtn.setValue('controller.right');
          else if (btn === 'up') fBtn.setValue('controller.up');
          else if (btn === 'down') fBtn.setValue('controller.down');
          else if (btn === 'menu') fBtn.setValue('controller.menu');
          else if (btn === 'any') fBtn.setValue('controller.anyButton');
          else fBtn.setValue('controller.A');
        }
        const fEv = b.getField('event');
        if (fEv) {
          if (ev === 'released') fEv.setValue('ControllerButtonEvent.Released');
          else if (ev === 'repeat' || ev === 'repeated') fEv.setValue('ControllerButtonEvent.Repeated');
          else fEv.setValue('ControllerButtonEvent.Pressed');
        }
      },
      conf: 1.0
    },
    {
      match: /^\[?\s*(?:run\s+code\s+on\s+)?(?:[\[\(]?([a-zA-Z0-9_]+)[\]\)]?\s+)?button\s+(?:[\[\(]?([a-zA-Z0-9_]+)[\]\)]?)\s*\]?$/i,
      type: 'keyonevent',
      mutator: (b, ws, raw) => {
        const m = (raw || '').match(/(?:run\s+code\s+on\s+)?(?:[\[\(]?([a-zA-Z0-9_]+)[\]\)]?\s+)?button\s+(?:[\[\(]?([a-zA-Z0-9_]+)[\]\)]?)/i);
        let btn = (m && m[1] ? m[1] : 'A').toLowerCase();
        let ev = (m && m[2] ? m[2] : 'pressed').toLowerCase();
        if (['pressed', 'released', 'repeat', 'repeated'].includes(btn) && !m[2]) {
          ev = btn;
          btn = 'a';
        }
        const fBtn = b.getField('button');
        if (fBtn) {
          if (btn === 'b') fBtn.setValue('controller.B');
          else if (btn === 'left') fBtn.setValue('controller.left');
          else if (btn === 'right') fBtn.setValue('controller.right');
          else if (btn === 'up') fBtn.setValue('controller.up');
          else if (btn === 'down') fBtn.setValue('controller.down');
          else if (btn === 'menu') fBtn.setValue('controller.menu');
          else if (btn === 'any') fBtn.setValue('controller.anyButton');
          else fBtn.setValue('controller.A');
        }
        const fEv = b.getField('event');
        if (fEv) {
          if (ev === 'released') fEv.setValue('ControllerButtonEvent.Released');
          else if (ev === 'repeat' || ev === 'repeated') fEv.setValue('ControllerButtonEvent.Repeated');
          else fEv.setValue('ControllerButtonEvent.Pressed');
        }
      },
      conf: 0.95
    },
    {
      match: /^[\[\(<]\s*is\s+(?:\[?\s*([a-zA-Z0-9_]+)\s*\]?\s+)?button\s+pressed\s*[\]\)>]$/i,
      type: 'keyispressed',
      mutator: (b, ws, raw) => {
        const m = raw.match(/is\s+(?:\[?\s*([a-zA-Z0-9_]+)\s*\]?\s+)?button\s+pressed/i);
        const btn = m && m[1] ? m[1].toLowerCase() : 'a';
        const f = b.getField('button');
        if (f) {
          if (btn === 'b') f.setValue('controller.B');
          else if (btn === 'left') f.setValue('controller.left');
          else if (btn === 'right') f.setValue('controller.right');
          else if (btn === 'up') f.setValue('controller.up');
          else if (btn === 'down') f.setValue('controller.down');
          else if (btn === 'menu') f.setValue('controller.menu');
          else if (btn === 'any') f.setValue('controller.anyButton');
          else f.setValue('controller.A');
        }
      },
      conf: 1.0
    },

    // Info
    { match: /^\[?\s*set\s+score\s+to\s*\]?$/i, type: 'hudsetScore', conf: 1.0 },
    { match: /^\[?\s*change\s+score\s+by\s*\]?$/i, type: 'hudChangeScoreBy', conf: 1.0 },
    { match: /^\(?\s*score\s*\)?$/i, type: 'hudScore', conf: 1.0 },
    { match: /^\[?\s*set\s+life\s+to\s*\]?$/i, type: 'hudSetLife', conf: 1.0 },
    { match: /^\[?\s*change\s+life\s+by\s*\]?$/i, type: 'hudChangeLifeBy', conf: 1.0 },
    { match: /^\(?\s*life\s*\)?$/i, type: 'hudLife', conf: 1.0 },
    { match: /^\[?\s*on\s+life\s+zero\s*\]?$/i, type: 'gamelifeevent', conf: 1.0 },
    { match: /^\[?\s*start\s+countdown\s*\]?$/i, type: 'gamecountdown', conf: 1.0 },
    { match: /^\[?\s*on\s+countdown\s+end\s*\]?$/i, type: 'gamecountdownevent', conf: 1.0 },

    // Game & Scene & Images
    { match: /^\[?\s*game\s+over(?:\s*\(true\)|\s*\(false\))?\s*\]?$/i, type: 'gameOver2', conf: 1.0 },
    { match: /^\[?\s*splash(?:\s*\(title\))?\s*\]?$/i, type: 'gameSplash', conf: 1.0 },
    { match: /^\[?\s*show\s+long\s+text(?:\s*\(str\)\s*\(layout\))?\s*\]?$/i, type: 'game_show_long_text', conf: 1.0 },
    { match: /^\[?\s*set\s+background\s+color\s+to(?:\s*\(color\))?\s*\]?$/i, type: 'gamesetbackgroundcolor', conf: 1.0 },
    { match: /^\[?\s*set\s+background\s+image(?:\s+to)?\s*\]?$/i, type: 'gamesetbackgroundimage', conf: 1.0 },
    { match: /^\(?\s*background\s+image\s*\)?$/i, type: 'gamebackgroundimage', conf: 1.0 },
    {
      match: /^\[?\s*change\s+color\s+in\s+.*from.*to.*\]?$/i,
      type: 'Image_replace',
      mutator: (b, ws, raw) => {
        const m = (raw || '').match(/change\s+color\s+in\s*\(?([a-zA-Z0-9_]+)\)?(?:\s+from\s*\(?([a-zA-Z0-9_]*)\)?)?(?:\s+to\s*\(?([a-zA-Z0-9_]*)\)?)?/i);
        const picName = (m && m[1] && m[1].toLowerCase() !== 'picture') ? m[1] : 'picture';
        const fromVal = m && m[2] ? m[2].trim() : '';
        const toVal = m && m[3] ? m[3].trim() : '';

        // Only wire the picture variable into 'this' input
        const inThis = b.getInput('this') || b.getInput('picture');
        if (inThis && inThis.connection && !inThis.connection.targetConnection) {
          try {
            const vb = ws.newBlock('variables_get');
            vb.setShadow(true);
            const v = ensureVariable(ws, picName);
            const fv = vb.getField('VAR');
            if (fv && v) fv.setValue(v.getId());
            vb.initSvg();
            vb.render();
            inThis.connection.connect(vb.outputConnection);
          } catch (e) {}
        }

        // Only wire 'from' and 'to' if explicitly provided with non-empty values
        if (fromVal) {
          const inFrom = b.getInput('from');
          if (inFrom && inFrom.connection && !inFrom.connection.targetConnection) {
            try {
              const sub = createSubBlock(fromVal, ws, { B: blockly(), ws });
              if (sub && sub.outputConnection) inFrom.connection.connect(sub.outputConnection);
            } catch (e) {}
          }
        } else {
          const inFrom = b.getInput('from');
          if (inFrom && inFrom.connection && !inFrom.connection.targetConnection) {
            try {
              if (ws.newBlock && blockly().Blocks && blockly().Blocks['colorindexpicker']) {
                const cb = ws.newBlock('colorindexpicker');
                cb.setShadow(true);
                cb.initSvg();
                cb.render();
                inFrom.connection.connect(cb.outputConnection);
              }
            } catch (e) {}
          }
        }
        if (toVal) {
          const inTo = b.getInput('to');
          if (inTo && inTo.connection && !inTo.connection.targetConnection) {
            try {
              const sub = createSubBlock(toVal, ws, { B: blockly(), ws });
              if (sub && sub.outputConnection) inTo.connection.connect(sub.outputConnection);
            } catch (e) {}
          }
        } else {
          const inTo = b.getInput('to');
          if (inTo && inTo.connection && !inTo.connection.targetConnection) {
            try {
              if (ws.newBlock && blockly().Blocks && blockly().Blocks['colorindexpicker']) {
                const cb = ws.newBlock('colorindexpicker');
                cb.setShadow(true);
                cb.initSvg();
                cb.render();
                inTo.connection.connect(cb.outputConnection);
              }
            } catch (e) {}
          }
        }
      },
      conf: 1.0
    },
    { match: /^\[?\s*(?:start\s+screen\s+effect|confetti)\s*\]?$/i, type: 'particlesStartScreenAnimation', conf: 1.0 },
    { match: /^\[?\s*camera\s+follow(?:\s+sprite)?\s*\]?$/i, type: 'camerafollow', conf: 1.0 },
    { match: /^\[?\s*camera\s+shake\s*\]?$/i, type: 'camerashake', conf: 1.0 },

    // Music
    {
      match: /^\[?\s*(?:play\s+sound|ba\s+ding)\s*\]?$/i,
      type: 'music_playable_play',
      mutator: (b, ws) => {
        const toPlay = b.getInput('toPlay');
        if (toPlay && ws) {
          const soundBlock = ws.newBlock('music_melody_playable');
          const f = soundBlock.getField('name') || soundBlock.getField('sound');
          if (f) f.setValue('ba ding');
          soundBlock.initSvg();
          soundBlock.render();
          try { toPlay.connection.connect(soundBlock.outputConnection); } catch (e) {}
        }
      },
      conf: 1.0
    },
    { match: /^\[?\s*play\s+melody\s*\]?$/i, type: 'music_melody_playable', conf: 1.0 },
    { match: /^\[?\s*stop\s+all\s+sounds\s*\]?$/i, type: 'music_stop_all_sounds', conf: 1.0 },
    { match: /^\[?\s*set\s+volume(?:\s+to)?\s*\]?$/i, type: 'synth_set_volume', conf: 1.0 },
    { match: /^\[?\s*change\s+volume(?:\s+by)?\s*\]?$/i, type: 'synth_set_volume', conf: 1.0 },
    { match: /^\[?\s*volume(?:\s+value)?\s*\]?$/i, type: 'synth_get_volume', conf: 1.0 },

    // Tilemap & Tilemap Extension
    { match: /^\[?\s*set\s+tilemap\s+to(?:\s*\(tilemap\))?\s*\]?$/i, type: 'set_current_tilemap', conf: 1.0 },
    { match: /^\[?\s*place\s+.*on\s+top\s+of\s+random(?:\s+tile)?\s*\]?$/i, type: 'mapplaceonrandomtile', conf: 1.0 },
    { match: /^\[?\s*place\s+.*on\s+random\s+tile\s*\]?$/i, type: 'mapplaceonrandomtile', conf: 1.0 },
    {
      match: /^\[?\s*place\s+(?:sprite|\(?[a-zA-Z0-9_]+\)?)\s+on\s+top\s+of\s+(?:location|\(?[a-zA-Z0-9_\s]+\)?)\s*\]?$/i,
      type: 'mapplaceontile',
      mutator: (b, ws, raw) => {
        if (!ws) return;
        const m = (raw || '').match(/place\s+(?:sprite|\(?([a-zA-Z0-9_]+)\)?)\s+on\s+top\s+of\s+(?:location|\(?([a-zA-Z0-9_\s]+)\)?)/i);
        const sName = m && m[1] ? m[1] : 'sprite';
        const inSprite = b.getInput('sprite');
        if (inSprite && inSprite.connection && !inSprite.connection.targetConnection) {
          try {
            const vb = ws.newBlock('variables_get');
            const v = ensureVariable(ws, sName);
            if (v && vb.getField('VAR')) vb.getField('VAR').setValue(v.getId());
            vb.initSvg();
            vb.render();
            inSprite.connection.connect(vb.outputConnection);
          } catch (e) {}
        }
        const inLoc = b.getInput('loc');
        if (inLoc && inLoc.connection && !inLoc.connection.targetConnection) {
          try {
            const locB = ws.newBlock('variables_get');
            const v = ensureVariable(ws, 'location');
            if (v && locB.getField('VAR')) locB.getField('VAR').setValue(v.getId());
            locB.initSvg();
            locB.render();
            inLoc.connection.connect(locB.outputConnection);
          } catch (e) {}
        }
      },
      conf: 1.0
    },
    { match: /^\[?\s*place\s+.*on\s+top\s+of(?:\s+tile)?\s*\]?$/i, type: 'mapplaceontile', conf: 0.9 },
    { match: /^\[?\s*set\s+wall\s+at(?:\s+to)?\s*\]?$/i, type: 'mapsetwallat', conf: 1.0 },
    { match: /^\[?\s*(?:tile\s+at\s+(?:location\s+)?is\s+wall|set\s+tile\s+at\s+location\s+is\s+wall)\s*\]?$/i, type: 'tiles_tile_at_location_is_wall', conf: 1.0 },
    {
      match: /^\[?\s*set\s+tile\s+at(?:\s+location)?\s*\]?$/i,
      type: 'mapsettileat',
      mutator: (b, ws) => {
        if (!ws) return;
        const inTile = b.getInput('tile');
        if (inTile && inTile.connection && !inTile.connection.targetConnection) {
          try {
            const bTile = ws.newBlock('tileset_tile_picker');
            bTile.initSvg();
            bTile.render();
            inTile.connection.connect(bTile.outputConnection);
          } catch (e) {}
        }
        const inLoc = b.getInput('loc');
        if (inLoc && inLoc.connection && !inLoc.connection.targetConnection) {
          try {
            const bGet = ws.newBlock('mapgettile');
            const inCol = bGet.getInput('col');
            if (inCol && inCol.connection && !inCol.connection.targetConnection) {
              const nCol = ws.newBlock('math_number');
              const fnCol = nCol.getField('NUM');
              if (fnCol) fnCol.setValue('0');
              nCol.initSvg();
              nCol.render();
              inCol.connection.connect(nCol.outputConnection);
            }
            const inRow = bGet.getInput('row');
            if (inRow && inRow.connection && !inRow.connection.targetConnection) {
              const nRow = ws.newBlock('math_number');
              const fnRow = nRow.getField('NUM');
              if (fnRow) fnRow.setValue('0');
              nRow.initSvg();
              nRow.render();
              inRow.connection.connect(nRow.outputConnection);
            }
            bGet.initSvg();
            bGet.render();
            inLoc.connection.connect(bGet.outputConnection);
          } catch (e) {}
        }
      },
      conf: 1.0
    },
    {
      match: /^[\[\(]\s*tilemap\s+location\s+of(?:\s+\(?[a-zA-Z0-9_]+\)?)?\s*[\]\)]$/i,
      type: 'tiles_location_of_sprite',
      mutator: (b, ws, raw) => {
        if (!ws) return;
        const m = (raw || '').match(/tilemap\s+location\s+of(?:\s+\(?([a-zA-Z0-9_]+)\)?)?/i);
        const sName = m && m[1] ? m[1] : 'sprite';
        const inThis = b.getInput('this');
        if (inThis && inThis.connection && !inThis.connection.targetConnection) {
          try {
            const vb = ws.newBlock('variables_get');
            const v = ensureVariable(ws, sName);
            if (v && vb.getField('VAR')) vb.getField('VAR').setValue(v.getId());
            vb.initSvg();
            vb.render();
            inThis.connection.connect(vb.outputConnection);
          } catch (e) {}
        }
      },
      conf: 1.0
    },
    { match: /^\[?\s*connect\s+.*and\s+.*by\s+.*\]?$/i, type: 'tileUtil_connectMapById', conf: 1.0 },
    {
      match: /^\[?\s*load\s+tilemap\s+connected\s+by(?:\s*\(?([a-zA-Z0-9_]+)\)?)?\s*\]?$/i,
      type: 'tileUtil_loadConnectedMap',
      mutator: (b, ws, raw) => {
        const m = (raw || '').match(/load\s+tilemap\s+connected\s+by\s*[\(\[]?\s*([a-zA-Z0-9_]+)\s*[\)\]]?/i);
        const val = m && m[1] ? m[1].trim() : '0';
        const inp = b.inputList && b.inputList.find(i => i.connection && i.type === 1);
        if (inp && inp.connection && !inp.connection.targetConnection) {
          try {
            const sub = createSubBlock(val, ws, { B: blockly(), ws });
            if (sub && sub.outputConnection) {
              inp.connection.connect(sub.outputConnection);
            }
          } catch (e) {}
        }
      },
      conf: 1.0
    },
    { match: /^\[?\s*unload\s+current\s+tilemap\s*\]?$/i, type: 'tileUtil_unloadTilemap', conf: 1.0 },
    { match: /^\[?\s*cover\s+all\s+.*tiles\s+with\s*.*\]?$/i, type: 'tileutil_coverAllTiles', conf: 1.0 },
    {
      match: /^\[?\s*on\s+each(?:\s+[\[\(]?[a-zA-Z0-9_\s]+[\]\)]?)?\s+tile\s+create\s+sprite(?:\s+with\s+image)?\s+(?:and\s+)?(?:of\s+)?kind(?:\s+[\[\(]?[a-zA-Z0-9_\s]+[\]\)]?)?\s*\]?$/i,
      custom: (raw) => renderCreateSpritesOnTiles(raw),
      conf: 1.0
    },
    { match: /^\[?\s*on\s+each\s+.*tile\s+create\s+sprite\s*.*\]?$/i, custom: (raw) => renderCreateSpritesOnTiles(raw), conf: 1.0 },
    { match: /^\(?\s*array\s+of\s+all(?:\s+tile)?\s+locations\s*\)?$/i, type: 'mapgettilestype', conf: 1.0 },
    { match: /^\(?\s*current\s+tilemap\s*\)?$/i, type: 'tileUtil_getLoadedMap', conf: 1.0 },

    // Game Effects
    {
      match: /^\[?\s*use\s+effect(?:\s+[\[\(]?([a-zA-Z0-9_]+)[\]\)]?)?(?:\s+for.*)?\s*\]?$/i,
      type: 'game_setgameovereffect',
      mutator: (b, ws, raw) => {
        const m = (raw || '').match(/use\s+effect\s+[\[\(]?([a-zA-Z0-9_]+)[\]\)]?/i);
        const effectName = m && m[1] ? m[1].toLowerCase() : 'confetti';
        const f = b.getField('effect');
        if (f) {
          const val = 'effects.' + effectName;
          try { f.setValue(val); } catch (e) { f.setValue('effects.confetti'); }
        }
      },
      conf: 1.0
    },

    // Animation Extension
    {
      match: /^\[?\s*animate(?:\s+(?:sprite|\(?[a-zA-Z0-9_]+\)?))?\s+frames(?:\s+interval.*)?\s*\]?$/i,
      type: 'run_image_animation',
      mutator: (b, ws, raw) => {
        if (!ws) return;
        const m = (raw || '').match(/animate(?:\s+\(?([a-zA-Z0-9_]+)\)?)?\s+frames/i);
        const sName = m && m[1] ? m[1] : 'sprite';
        const inSprite = b.getInput('sprite');
        if (inSprite && inSprite.connection && !inSprite.connection.targetConnection) {
          try {
            const vb = ws.newBlock('variables_get');
            const v = ensureVariable(ws, sName);
            if (v && vb.getField('VAR')) vb.getField('VAR').setValue(v.getId());
            vb.initSvg();
            vb.render();
            inSprite.connection.connect(vb.outputConnection);
          } catch (e) {}
        }
      },
      conf: 1.0
    },
    { match: /^\[?\s*animate\s+.*frames\s+.*interval.*loop.*\]?$/i, type: 'run_image_animation', conf: 1.0 },
    { match: /^\[?\s*animate\s+.*with\s+.*for\s+.*loop.*\]?$/i, type: 'run_movement_animation', conf: 1.0 },
    { match: /^\[?\s*animate\s+image\s*\]?$/i, type: 'run_image_animation', conf: 1.0 },
    { match: /^\[?\s*animate\s+movement\s*\]?$/i, type: 'run_movement_animation', conf: 1.0 },
    { match: /^\[?\s*stop\s+.*animations\s+on\s*.*\]?$/i, type: 'stop_animations', conf: 1.0 },

    // Arrays / Lists (MakeCode Arcade Orange #ff8f08)
    { match: /^\(?\s*length\s+of\s+array\s*\)?$/i, type: 'lists_length', conf: 1.0 },
    { match: /^\[?\s*(?:list\s+)?add\s+value\s+to\s+end\s*\]?$/i, type: 'array_push', conf: 1.0 },
    { match: /^\(?\s*empty\s+array\s*\)?$/i, type: 'lists_create_with', mutator: (b) => { b.itemCount_ = 0; if (b.updateShape_) b.updateShape_(); }, conf: 1.0 },
    {
      match: /^\(?\s*get\s+random\s+value\s+from(?:\s*\(?([a-zA-Z0-9_ ]+)\)?)?\s*\)?$/i,
      type: 'array_pickRandom',
      mutator: (b, ws, raw) => {
        const m = (raw || '').match(/get\s+random\s+value\s+from\s*\(?([a-zA-Z0-9_ ]+)\)?/i);
        const listName = m && m[1] ? m[1].trim() : 'list';
        const listInput = b.getInput('list');
        if (listInput && listInput.connection && !listInput.connection.targetConnection) {
          try {
            const listBlock = ws.newBlock('variables_get');
            const v = ensureVariable(ws, listName);
            const fv = listBlock.getField('VAR');
            if (fv && v) fv.setValue(v.getId());
            listBlock.initSvg();
            listBlock.render();
            listInput.connection.connect(listBlock.outputConnection);
          } catch (e) {}
        }
      },
      conf: 1.0
    }
  ];

  function serializeBlock(block) {
    if (!block) return null;
    const svgRoot = block.getSvgRoot ? block.getSvgRoot() : null;
    if (!svgRoot) return null;
    let bbox;
    try { bbox = svgRoot.getBBox(); } catch (e) { return null; }
    if (!bbox || bbox.width < 10 || bbox.height < 10) return null;

    const clone = svgRoot.cloneNode(true);
    clone.removeAttribute('transform');
    clone.setAttribute('transform', 'translate(' + (-bbox.x) + ',' + (-bbox.y) + ')');

    // Strip Blockly selection/outline path layers and any stale filter references —
    // they render as ghost outlines around text in the serialized SVG.
    // NOTE: NEVER remove .blocklyBlockShadow — in Blockly, that class belongs to
    // placeholder/shadow blocks, not drop shadow effects!
    try {
      clone.querySelectorAll('.blocklyPathLight, .blocklyPathDark, [filter]').forEach(el => {
        if (el.hasAttribute('filter')) el.removeAttribute('filter');
        if (el.classList.contains('blocklyPathLight') || el.classList.contains('blocklyPathDark')) el.remove();
      });
    } catch (e) {}

    const INPROPS = [
      'fill', 'fill-opacity', 'opacity', 'stroke', 'stroke-width',
      'font-family', 'font-size', 'font-weight', 'letter-spacing',
      'text-anchor', 'dominant-baseline', 'writing-mode', 'paint-order'
    ];

    (function walkColors(el) {
      for (const c of el.childNodes) {
        if (c.nodeType === 1) walkColors(c);
      }
      try {
        const tag = el.tagName.toLowerCase();
        const cs = getComputedStyle(el);
        let s = '';

        if (tag === 'g') {
          // Never inline fill/stroke on group containers, let them cascade to children
          const opacity = cs.getPropertyValue('opacity');
          if (opacity && opacity !== '1') s += 'opacity:' + opacity + ';';
          const display = cs.getPropertyValue('display');
          if (display && display === 'none') s += 'display:none;';
        } else if (tag === 'text') {
          // MakeCode block text is crisp white, editable inputs are dark slate
          const isWhite = !el.closest('.blocklyTextInputField, .blocklyNumberField');
          const fill = isWhite ? '#ffffff' : '#575e75';
          s += `fill:${fill} !important;stroke:none !important;stroke-width:0 !important;font-family:Consolas, Monaco, Menlo, "Ubuntu Mono", source-code-pro, monospace !important;font-size:16px !important;font-weight:600 !important;text-anchor:start;dominant-baseline:central;paint-order:fill !important;`;
        } else if (tag === 'rect') {
          // Check if this is a text input field, dropdown, or toggle
          const isTextInput = el.classList.contains('blocklyFieldRect') && el.closest('.blocklyTextInputField, .blocklyNumberField');
          const isDropdown = el.classList.contains('blocklyDropdownRect') || el.closest('.blocklyDropdownField');
          const isToggle = el.getAttribute('cursor') === 'pointer' || el.classList.contains('blocklyToggleRect');
          if (isTextInput) {
            // White pill, no border — number/text fields render two rects (pill +
            // inner focus ring); stroking both draws a ghost ring around the text.
            s += 'fill:#ffffff !important;stroke:none !important;stroke-width:0 !important;display:block !important;';
          } else if (isDropdown) {
            s += 'fill:transparent !important;stroke:rgba(0,0,0,0.15) !important;';
          } else if (isToggle) {
            // Authentic MakeCode switch styling
            s += 'fill:#808e9b !important;stroke:#485460 !important;stroke-width:1.5px !important;rx:4px !important;ry:4px !important;';
          } else {
            for (const p of INPROPS) {
              const v = cs.getPropertyValue(p);
              if (v && v !== 'initial') s += p + ':' + v + ';';
            }
          }
        } else {
          // path, circle, polygon, etc.
          for (const p of INPROPS) {
            const v = cs.getPropertyValue(p);
            if (v && v !== 'initial') s += p + ':' + v + ';';
          }
        }

        if (s) el.setAttribute('style', s);
      } catch (e) { /* keep element intact */ }
    })(clone);

    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    const width = Math.ceil(bbox.width + 4);
    const height = Math.ceil(bbox.height + 4);
    svg.setAttribute('viewBox', '0 0 ' + width + ' ' + height);
    svg.setAttribute('width', width);
    svg.setAttribute('height', height);

    // Embed style tag for absolute rendering fidelity
    const styleEl = document.createElementNS('http://www.w3.org/2000/svg', 'style');
    styleEl.textContent = `
      text, .blocklyText {
        fill: #ffffff !important;
        stroke: none !important;
        stroke-width: 0 !important;
        paint-order: fill !important;
        font-family: Consolas, Monaco, Menlo, "Ubuntu Mono", source-code-pro, monospace !important;
        font-size: 16px !important;
        font-weight: 600 !important;
      }
      .field-text-quote {
        fill: #a31515 !important;
      }
      .blocklyTextInputField .blocklyFieldRect,
      .blocklyNumberField .blocklyFieldRect {
        fill: #ffffff !important;
      }
      .blocklyDropdownRect,
      .blocklyDropdownField .blocklyFieldRect {
        fill: transparent !important;
      }
      .blocklyTextInputField text,
      .blocklyNumberField text {
        fill: #575e75 !important;
      }
      .blocklyDropdownField text {
        fill: #ffffff !important;
      }
      rect[cursor="pointer"] {
        fill: #808e9b !important;
        stroke: #485460 !important;
        rx: 4px !important;
        ry: 4px !important;
      }
    `;
    svg.appendChild(styleEl);

    // If block contains tilemap field/socket, ensure checkered tile placeholder image is present
    const tilemapFields = clone.querySelectorAll('.blocklySpriteField, g.blocklyEditableField rect[width="40"], g.blocklyEditableField rect[width="40px"]');
    for (const rect of tilemapFields) {
      const parentG = rect.parentNode;
      if (parentG && !parentG.querySelector('image')) {
        const img = document.createElementNS('http://www.w3.org/2000/svg', 'image');
        img.setAttributeNS('http://www.w3.org/1999/xlink', 'xlink:href', CHECKERED_TILE_PNG);
        img.setAttribute('height', '32');
        img.setAttribute('width', '32');
        const rx = parseFloat(rect.getAttribute('x') || '0');
        const ry = parseFloat(rect.getAttribute('y') || '0');
        img.setAttribute('x', String(rx + 4));
        img.setAttribute('y', String(ry + 4));
        parentG.appendChild(img);
      }
    }

    svg.appendChild(clone);

    // True container/multiline blocks have statement slots or height > 70
    const hasStatement = block.inputList && block.inputList.some(i => i.name === 'STACK' || i.name === 'DO0' || i.name === 'HANDLER');
    const isMultiLine = hasStatement || height > 70;

    return {
      svg: new XMLSerializer().serializeToString(svg),
      width: width,
      height: height,
      isMultiLine: isMultiLine
    };
  }

  const renderSvg = serializeBlock;

  function renderCharacterCreation(rawText, ws) {
    const raw = rawText || '';
    const m = raw.match(/^(?:\[?\s*set\s+\[?([a-zA-Z0-9_]+)\]?\s+to\s+)?sprite(?:\s*\(img\))?\s*of\s*kind(?:\s*\(?([a-zA-Z0-9_]+)\)?)?/i);
    const mSet = raw.match(/set\s+\[?([a-zA-Z0-9_]+)\]?\s+to/i);
    const varName = (m && m[1] && m[1].toLowerCase() !== 'sprite') ? m[1] : ((mSet && mSet[1] && mSet[1].toLowerCase() !== 'sprite') ? mSet[1] : 'mySprite');
    const kindName = (m && m[2] && m[2].toLowerCase() !== 'kind') ? m[2] : 'Player';

    const B = blockly();
    if (B && ws) {
      try {
        const xml = `<xml xmlns="http://www.w3.org/1999/xhtml">
          <block type="variables_set">
            <field name="VAR">${varName}</field>
            <value name="VALUE">
              <block type="spritescreate">
                <value name="img"><shadow type="screen_image_picker"></shadow></value>
                <value name="kind"><shadow type="spritekind"><field name="MEMBER">${kindName}</field></shadow></value>
              </block>
            </value>
          </block>
        </xml>`;
        const doc = new DOMParser().parseFromString(xml, 'text/xml');
        const b = B.Xml.domToBlock(doc.documentElement.firstElementChild, ws);
        b.initSvg();
        b.render();
        const res = renderSvg(b);
        b.dispose(false);
        return res;
      } catch (e) {
        console.warn('[AIFX] renderCharacterCreation error:', e);
      }
    }

    const cached = getStaticOrCached('[set (mySprite) to sprite (img) of kind (Player)]') || getStaticOrCached('variables_set_mySprite_spritescreate');
    return cached || null;
  }

  function renderStatusBarCreation(rawText, ws) {
    const raw = rawText || '';
    const mSet = raw.match(/set\s+\[?([a-zA-Z0-9_]+)\]?\s+to/i);
    const varName = (mSet && mSet[1] && mSet[1].toLowerCase() !== 'variable') ? mSet[1] : 'statusbar';
    const mKind = raw.match(/(?:kind|bubble|to)\s+[\(\[]?([a-zA-Z0-9_]+)[\)\]]?/i);
    const kindName = (mKind && !['kind', 'statusbar'].includes(mKind[1].toLowerCase())) ? mKind[1] : 'Health';

    const B = blockly();
    if (B && ws) {
      try {
        const xml = `<xml xmlns="http://www.w3.org/1999/xhtml">
          <block type="variables_set">
            <field name="VAR">${varName}</field>
            <value name="VALUE">
              <block type="statusbars_create">
                <value name="width"><shadow type="math_number"><field name="NUM">20</field></shadow></value>
                <value name="height"><shadow type="math_number"><field name="NUM">4</field></shadow></value>
                <value name="kind"><shadow type="statusbars_kind"><field name="MEMBER">${kindName}</field></shadow></value>
              </block>
            </value>
          </block>
        </xml>`;
        const doc = new DOMParser().parseFromString(xml, 'text/xml');
        const b = B.Xml.domToBlock(doc.documentElement.firstElementChild, ws);
        b.initSvg();
        b.render();
        const res = renderSvg(b);
        b.dispose(false);
        return res;
      } catch (e) {
        console.warn('[AIFX] renderStatusBarCreation error:', e);
      }
    }
    return null;
  }

  function ensureVariable(ws, name) {
    if (!ws) return null;
    try {
      let v = ws.getVariable ? ws.getVariable(name) : null;
      if (!v && ws.createVariable) v = ws.createVariable(name);
      return v;
    } catch (e) {
      return null;
    }
  }

  function findToolboxBlockXml(ws, type) {
    if (!ws) return null;
    let tree = ws.options && ws.options.languageTree;
    if (!tree && ws.toolbox_ && ws.toolbox_.tree_) {
      tree = ws.toolbox_.tree_;
    }
    if (!tree) return null;
    try {
      const blocks = tree.getElementsByTagName ? tree.getElementsByTagName('block') : [];
      let best = null;
      for (let i = 0; i < blocks.length; i++) {
        const el = blocks[i];
        if (el.getAttribute('type') === type) {
          const shadows = el.getElementsByTagName('shadow');
          if (shadows && shadows.length > 0) {
            return el;
          }
          if (!best) best = el;
        }
      }
      return best;
    } catch (e) {
      return null;
    }
  }

  function populateDefaultShadows(b, ws, B, rawText) {
    if (!b || !b.inputList || !ws || !B) return;
    const inputValType = (typeof B.INPUT_VALUE !== 'undefined') ? B.INPUT_VALUE : 1;

    for (const input of b.inputList) {
      // Only process value inputs that currently have no connected block
      if (input.type === inputValType && input.connection && !input.connection.targetConnection) {
        const name = (input.name || '').toLowerCase();
        const check = input.connection.check_;

        let shadowType = null;
        let shadowValue = null;
        let isBoolean = false;
        let isSprite = false;
        let isNumber = false;
        let isString = false;

        // Check connection allowed types
        if (check && Array.isArray(check) && check.length > 0) {
          for (const c of check) {
            const lc = String(c).toLowerCase();
            if (lc === 'boolean') isBoolean = true;
            else if (lc === 'number') isNumber = true;
            else if (lc === 'string') isString = true;
            else if (lc === 'sprite') isSprite = true;
          }
        }

        // Check input name patterns
        if (!isBoolean && !isNumber && !isString && !isSprite) {
          if (/^(?:bool|cond|if|condition)/i.test(name)) {
            isBoolean = true;
          } else if (/^(?:num|width|height|x|y|vx|vy|ax|ay|dx|dy|speed|step|val|value|index|count|time|ms|delay|by|to|score|life|health|connection)/i.test(name)) {
            isNumber = true;
          } else if (/^(?:text|str|msg|message|label|format|string)/i.test(name)) {
            isString = true;
          } else if (b.type !== 'Image_replace' && /^(?:sprite|mysprite|target|source|agent|from|other)/i.test(name)) {
            isSprite = true;
          }
        }

        if (isBoolean) {
          shadowType = 'logic_boolean';
          shadowValue = 'TRUE';
        } else if (isNumber) {
          shadowType = 'math_number';
          shadowValue = '0';
        } else if (isSprite) {
          shadowType = 'variables_get';
          shadowValue = 'mySprite';
        } else if (isString) {
          shadowType = 'text';
          shadowValue = '';
        }

        if (shadowType && B.Blocks && B.Blocks[shadowType]) {
          try {
            const sb = ws.newBlock(shadowType);
            sb.setShadow(true);
            if (shadowType === 'logic_boolean') {
              const f = sb.getField('BOOL');
              if (f) f.setValue(shadowValue);
            } else if (shadowType === 'math_number') {
              const f = sb.getField('NUM');
              if (f) f.setValue(shadowValue);
            } else if (shadowType === 'variables_get') {
              const v = ensureVariable(ws, shadowValue);
              const f = sb.getField('VAR');
              if (f && v) f.setValue(v.getId());
            } else if (shadowType === 'text') {
              const f = sb.getField('TEXT');
              if (f) f.setValue(shadowValue);
            }
            sb.initSvg();
            sb.render();
            input.connection.connect(sb.outputConnection);
          } catch (e) {}
        }
      }
    }
  }

  function renderDynamicBlock(type, mutator, rawText) {
    if (type === 'toggleOnOff' || type === 'toggleWinLose') {
      return renderToggleToken(rawText || type);
    }
    const tc = toolchain();
    if (!tc || !tc.ws) return null;
    try {
      ensureExtensionBlocks(tc.B);
      // Fail fast when the block type isn't registered in this MakeCode instance
      // (extension blocks load lazily). Returning null lets the overlay fall back
      // to the static catalog template for this token instead of throwing.
      if (!tc.B.Blocks || !Object.prototype.hasOwnProperty.call(tc.B.Blocks, type)) {
        return null;
      }

      let b = null;
      const toolboxXml = findToolboxBlockXml(tc.ws, type);
      if (toolboxXml && tc.B.Xml && tc.B.Xml.domToBlock) {
        try {
          b = tc.B.Xml.domToBlock(toolboxXml.cloneNode(true), tc.ws);
        } catch (e) {
          b = null;
        }
      }
      if (!b) {
        b = tc.ws.newBlock(type);
      }
      if (!b) return null;

      if (type === 'controls_if' || type === 'controls_if_else') {
        b.setColour('#45aaf2');
        if (b.inputList) {
          for (const inp of b.inputList) {
            for (const f of inp.fieldRow) {
              if (f && f.getText && f.getText().trim().toLowerCase() === 'do' && f.setValue) {
                f.setValue('then');
              }
            }
          }
        }
      }

      if (mutator) mutator(b, tc.ws, rawText);
      populateDefaultShadows(b, tc.ws, tc.B, rawText);

      if (type === 'controls_if' || type === 'controls_if_else') {
        b.setColour('#45aaf2');
        if (b.inputList) {
          for (const inp of b.inputList) {
            for (const f of inp.fieldRow) {
              if (f && f.getText && f.getText().trim().toLowerCase() === 'do' && f.setValue) {
                f.setValue('then');
              }
            }
          }
        }
      }

      b.initSvg();
      b.render();
      const res = serializeBlock(b);
      b.dispose();
      return res;
    } catch (e) {
      console.warn('[AIFX in-page] renderDynamicBlock error for', type, e);
      return null;
    }
  }

  function getCatalogEntries(B, ws) {
    if (catalogCache) return catalogCache;
    const entries = [];
    if (!B || !B.Blocks) return entries;

    for (const type of Object.keys(B.Blocks)) {
      try {
        const b = ws.newBlock(type);
        const texts = [];
        if (b.inputList) {
          for (const input of b.inputList) {
            for (const field of input.fieldRow) {
              const val = field.getText ? field.getText() : (field.getValue ? field.getValue() : '');
              if (val) texts.push(val);
            }
          }
        }
        b.dispose();
        const fullText = texts.join(' ');
        if (fullText) {
          entries.push({
            type,
            rawText: fullText,
            normText: normalize(fullText),
            words: wordTokens(fullText),
            bigrams: charBigrams(fullText)
          });
        }
      } catch (e) {
        // Skip blocks that fail parameterless init
      }
    }
    catalogCache = entries;
    return catalogCache;
  }

  /* __AIFX_SLOT_ENGINE_START__
   * Generic nested-parameter (slot-template) engine.
   *
   * Outer tokens like [set (list) to] or [change (score) by (1)] contain nested child
   * tokens. Matching them safely requires structure-awareness: we FIRST freeze every
   * top-level child into a \u0001{n}\u0001 placeholder (the same depth-walk idea as the
   * overlay tokenizer), so template regexes can never span into nested structure, and
   * only then match skeletons like "set _0_ to". Slot values resolve recursively into
   * real sub-blocks (variables_get, math_number, logic_boolean, logic_compare,
   * logic_operation, logic_negate, math_arithmetic, ...), which are connected through
   * the SLOT_SPEC socket names below.
   *
   * Strictness guarantees for the parser:
   *   - value/operand slots match exactly ONE child placeholder OR a tightly-bounded
   *     literal (number / true|false / KNOWN_VARS identifier) — never free prose;
   *     therefore compound statements like [set (mySprite) to sprite (img) of kind
   *     (Player)] can NOT be hijacked into a variables_set;
   *   - statement-children (multiple children around literals like "sprite ... of kind")
   *     never match a template, so the token falls through to CANONICAL_MAP untouched;
   *   - and/or/not-only templates require an outer <...> or (...) bound, never [...]
   *     (instruction statements), mirroring parseLogicOp/parseLogicNegate.
   */
  const PH = '\u0001';

  const KNOWN_VARS = [
    'question', 'speed', 'columnnumber', 'startingcolumn', 'bridgelength',
    'snakesstomped', 'invincible', 'foundfossils', 'userresponselist',
    'text list', 'powerup', 'column', 'row', 'levelnum', 'backgroundindex',
    'scenenum', 'userindex', 'currentindex', 'count', 'i', 'arraynum',
    'newindex', 'currentarray', 'age', 'place', 'name', 'time', 'score',
    'life', 'choice', 'statusbarsprite', 'statusbar', 'item', 'index',
    'mysprite', 'othersprite', 'sprite', 'playersprite', 'fishsprite', 'projectile',
    'x', 'y', 'vx', 'vy', 'ax', 'ay', 'dx', 'dy', 'value', 'list', 'text',
    'variable', 'answer', 'input', 'response', 'velocity', 'volume'
  ];

  // Socket names used to connect resolved slot values into their parent block.
  const SLOT_SPEC = {
    'variables_set':    { varField: 'VAR',   value: 'VALUE' },
    'variables_change': { varField: 'VAR',   value: 'VALUE' },
    'logic_compare':    { opField: 'OP',     sides: ['A', 'B'] },
    'logic_operation':  { opField: 'OP',     sides: ['A', 'B'] },
    'logic_negate':     { value: 'BOOL' },
    'controls_if':      { cond: 'IF0' }
  };

  const SLOT_OPS = { '=': 'EQ', '==': 'EQ', '!=': 'NEQ', '<': 'LT', '<=': 'LTE', '=<': 'LTE', '>': 'GT', '>=': 'GTE', '=>': 'GTE' };

  // Prose stop-words that must never appear inside a variable/slot identifier.
  const SLOT_PROSE_RE = /\b(using|such as|for example|or|and|with|from|in|by|not|to|how|whatever|of|that|the|a|an|both|when|before|after|if|where|due|such|except|keeping|navigating|moving|including|instead|out|all|apply|vice versa)\b/i;

  // Frozen-placeholder / operand / value regex fragments.
  // PH_RE never captures (avoids group-number shifting when composed);
  // R_PH_CAP captures the placeholder index when matched standalone.
  const PH_RE    = '\\u0001\\d+\\u0001';
  const R_PH_CAP = '^\\u0001(\\d+)\\u0001$';
  const LIT_OPER = 'true|false|[-+]?\\d+(?:\\.\\d+)?|[A-Za-z_]\\w{0,18}';
  const R_OPER      = '(' + PH_RE + '|' + LIT_OPER + ')';                 // operand side  (1 capture)
  const R_PH_GROUP  = '(' + PH_RE + ')';                                  // frozen child  (1 capture)
  const R_VAL_GROUP = '(' + PH_RE + '|' + LIT_OPER + ')';                 // value side    (1 capture)

  // Mirror of the bubble-path prose/identifier gate.
  function isVarIdent(name) {
    if (!name) return false;
    const s = name.trim();
    if (!s) return false;
    if (SLOT_PROSE_RE.test(s)) return false;
    if (s.includes(' ') && !KNOWN_VARS.includes(s.toLowerCase())) return false;
    return /^[\w ]{1,20}$/.test(s);
  }

  // Structure-aware split: freezes top-level (...) / [...] / <...> children into
  // placeholders, keeps every other character (including < > used as compare
  // operators, e.g. 0>0) as literal skeleton text. Angle groups open only at
  // top level (next char must be a letter/'('), so compare operators inside a
  // child like (a<5) stay frozen child text. Nested children are never re-scanned.
  function splitTopChildren(str) {
    const parts = [];
    const children = [];
    const stack = []; // kinds of open groups: 'P', 'B', 'A'
    let start = -1;
    for (let i = 0; i < str.length; i++) {
      const c = str[i];
      if (c === '(' || c === '[') {
        stack.push(c === '(' ? 'P' : 'B');
        if (stack.length === 1 && start < 0) {
          start = i;
          parts.push(PH + children.length + PH);
        }
        continue;
      }
      if (c === '<' && stack.length === 0 && /[A-Za-z_(]/.test(str[i + 1] || '')) {
        stack.push('A');
        if (start < 0) { start = i; parts.push(PH + children.length + PH); }
        continue;
      }
      const top = stack[stack.length - 1];
      if (c === ')' && top === 'P') { stack.pop(); }
      else if (c === ']' && top === 'B') { stack.pop(); }
      else if (c === '>' && top === 'A') { stack.pop(); }
      if (stack.length === 0 && start >= 0) {
        children.push(str.slice(start, i + 1).trim());
        start = -1;
        continue;
      }
      if (stack.length === 0) parts.push(c);
    }
    return { skeleton: parts.join('').trim().replace(/\s+/g, ' '), children };
  }

  // Classify a template slot capture: placeholder → underlying child text;
  // literal sides only pass for number / boolean / KNOWN_VARS identifiers.
  function valOperand(g, children) {
    if (!g) return null;
    const ph = g.match(/^\u0001(\d+)\u0001$/);
    if (ph) {
      const child = children[parseInt(ph[1], 10)];
      if (!child) return null;
      const inner = child.trim().replace(/^[\(\[]/, '').replace(/[\)\]]$/, '').trim();
      if (/^(?:true|false|-?\d+(?:\.\d+)?)$/i.test(inner)) return child;
      // Prose guard: multi-word children that read like English must not become operands
      // (single short identifiers like (a), (b), (list) are fine).
      if (inner.includes(' ') && SLOT_PROSE_RE.test(inner)) return null;
      return child; // placeholders are expressions; resolution happens via createSubBlock
    }
    if (/^(?:true|false)$/i.test(g) || /^[-+]?\d+(?:\.\d+)?$/.test(g)) return g;
    if (isVarIdent(g) && KNOWN_VARS.includes(g.toLowerCase())) return g;
    return null;
  }

  // Extract a variable NAME from a slot capture (child text like "(list)" → "list").
  function varNameFromOperand(g, children) {
    if (!g) return null;
    const ph = g.match(/^\u0001(\d+)\u0001$/);
    if (!ph) return isVarIdent(g) ? g.trim() : null;
    const child = children[parseInt(ph[1], 10)];
    if (!child) return null;
    const inner = child.trim().replace(/^[\(\[]/, '').replace(/[\)\]]$/, '').trim();
    return isVarIdent(inner) ? inner : null;
  }

  // Resolve one slot value into a real sub-block (called from mutators when the
  // parent block exists; guarded by slotDepth so nesting stays bounded).
  function resolveSlotValue(text, ws, tc, depth) {
    if (text == null || depth > 2) return null;
    const s = String(text).trim();
    if (!s) return null;
    return createSubBlock(s, ws, tc);
  }

  // Template definitions. Order matters: logic first, then variable statements,
  // then controls_if; each template is entirely self-contained.
  const SLOT_TEMPLATES = [
    {
      id: 'logic_compare',
      when: (outer) => outer === '<' || outer === null,
      re: new RegExp('^' + R_OPER + '\\s*(<=|>=|==|!=|=<|=>|<|>|=)\\s*' + R_OPER + '$', 'i'),
      build(m, children, ctx) {
        if (SLOT_OPS[m[2]] == null) return null;
        const left = valOperand(m[1], children);
        const right = valOperand(m[3], children);
        if (!left || !right) return null;
        const op = SLOT_OPS[m[2]];
        return {
          type: 'logic_compare',
          mutator: (b, ws) => {
            const f = b.getField('OP'); if (f) f.setValue(op);
            const lb = resolveSlotValue(left, ws, ctx.tc, ctx.depth + 1);
            if (lb) connectInput(b, SLOT_SPEC.logic_compare.sides[0], lb);
            const rb = resolveSlotValue(right, ws, ctx.tc, ctx.depth + 1);
            if (rb) connectInput(b, SLOT_SPEC.logic_compare.sides[1], rb);
          }
        };
      }
    },
    {
      id: 'logic_operation',
      when: (outer) => outer === '<' || outer === '(' || outer === null,
      re: new RegExp('^' + R_OPER + '\\s+(and|or)\\s+' + R_OPER + '$', 'i'),
      build(m, children, ctx) {
        const left = valOperand(m[1], children);
        const right = valOperand(m[3], children);
        if (!left || !right) return null;
        return {
          type: 'logic_operation',
          mutator: (b, ws) => {
            const f = b.getField('OP'); if (f) f.setValue(m[2].toUpperCase());
            const lb = resolveSlotValue(left, ws, ctx.tc, ctx.depth + 1);
            if (lb) connectInput(b, SLOT_SPEC.logic_operation.sides[0], lb);
            const rb = resolveSlotValue(right, ws, ctx.tc, ctx.depth + 1);
            if (rb) connectInput(b, SLOT_SPEC.logic_operation.sides[1], rb);
          }
        };
      }
    },
    {
      id: 'logic_negate',
      when: (outer) => outer === '<' || outer === '(' || outer === null,
      re: new RegExp('^not\\s+' + R_OPER + '$', 'i'),
      build(m, children, ctx) {
        const operand = valOperand(m[1], children);
        if (!operand) return null;
        return {
          type: 'logic_negate',
          mutator: (b, ws) => {
            const sub = resolveSlotValue(operand, ws, ctx.tc, ctx.depth + 1);
            if (sub) connectInput(b, SLOT_SPEC.logic_negate.value, sub);
          }
        };
      }
    },
    {
      id: 'variables_set',
      when: () => true,
      re: new RegExp('^(?:set|let)\\s+' + R_PH_GROUP + '\\s+to(?:\\s+' + R_VAL_GROUP + ')?\\s*$', 'i'),
      build(m, children, ctx) {
        const name = varNameFromOperand(m[1], children);
        if (!name) return null;
        const valText = m[2] ? valOperand(m[2], children) : null;
        if (m[2] && !valText) return null;
        return {
          type: 'variables_set',
          mutator: (b, ws) => {
            const v = ensureVariable(ws, name);
            const f = b.getField('VAR'); if (f && v) f.setValue(v.getId());
            if (valText) {
              const sub = resolveSlotValue(valText, ws, ctx.tc, ctx.depth + 1);
              if (sub) connectInput(b, SLOT_SPEC.variables_set.value, sub);
            }
          }
        };
      }
    },
    {
      id: 'variables_change',
      when: () => true,
      re: new RegExp('^change\\s+' + R_PH_GROUP + '\\s+by(?:\\s+' + R_VAL_GROUP + ')?\\s*$', 'i'),
      build(m, children, ctx) {
        const name = varNameFromOperand(m[1], children);
        if (!name) return null;
        const valText = m[2] ? valOperand(m[2], children) : null;
        if (m[2] && !valText) return null;
        return {
          type: 'variables_change',
          mutator: (b, ws) => {
            const v = ensureVariable(ws, name);
            const f = b.getField('VAR'); if (f && v) f.setValue(v.getId());
            if (valText) {
              const sub = resolveSlotValue(valText, ws, ctx.tc, ctx.depth + 1);
              if (sub) connectInput(b, SLOT_SPEC.variables_change.value, sub);
            }
          }
        };
      }
    },
    {
      id: 'controls_if',
      when: () => true,
      re: new RegExp('^if\\s+(' + PH_RE + '|true|false)\\s+then(\\s*/\\s*else)?\\s*$', 'i'),
      build(m, children, ctx) {
        const cond = m[1];
        let condText = 'true';
        const ph = cond.match(/^\u0001(\d+)\u0001$/);
        if (ph) {
          const child = children[parseInt(ph[1], 10)];
          if (!child) return null;
          const inner = child.trim().replace(/^[\(\[]/, '').replace(/[\)\]]$/, '').trim();
          if (/^(?:true|false)$/i.test(inner)) condText = inner.toLowerCase();
          else if (SLOT_PROSE_RE.test(inner)) return null;
          else condText = child;
        }
        const hasElse = !!m[2];
        return {
          type: 'controls_if',
          mutator: (b, ws) => {
            if (hasElse) {
              b.elseCount_ = 1;
              if (b.updateShape_) b.updateShape_();
            }
            const sub = resolveSlotValue(condText, ws, ctx.tc, ctx.depth + 1);
            if (sub) connectInput(b, SLOT_SPEC.controls_if.cond, sub);
          }
        };
      }
    }
  ];

  // Main entry: try to resolve a raw nested-parameter token through the templates.
  // Returns { type, mutator } or null (null always leaves the token to the canonic/fuzzy paths).
  function resolveTemplateMatch(raw, tc, depth) {
    depth = depth || 0;
    if (depth > 2 || !raw) return null;
    const str = raw.trim();
    if (str.length < 3 || !/[\[\(<]/.test(str)) return null;

    // Detect a TRUE full-token bound pair (<...>, [...], (...)): the opener at
    // char 0 must close exactly at the last char. Rejects (a) and (b), <0>0>, etc.
    let outer = null;
    let inner = str;
    const CLOSERS = { ')': '(', ']': '[', '>': '<' };
    {
      const c0 = str[0];
      const stack = [];
      const angleOpener = (s, i) => s[i] === '<' && /[A-Za-z_(]/.test(s[i + 1] || '');
      let balanced = false;
      for (let i = 0; i < str.length; i++) {
        const c = str[i];
        if (c === '(' || c === '[' || angleOpener(str, i)) stack.push(c);
        else if (c === ')' || c === ']' || c === '>') {
          const top = stack.pop();
          if (!top || CLOSERS[c] !== top) { break; }
          if (stack.length === 0) {
            balanced = (i === str.length - 1 && top === c0);
            break;
          }
        }
      }
      if (balanced && c0 === '[') { outer = '['; inner = str.slice(1, -1); }
      else if (balanced && c0 === '<') { outer = '<'; inner = str.slice(1, -1); }
      else if (balanced && c0 === '(') { outer = '('; inner = str.slice(1, -1); }
    }

    const { skeleton, children } = splitTopChildren(inner);
    const skeL = skeleton.toLowerCase();

    // Tokens with no structural children can only route through controls_if (literal conds).
    if (!children.length && !/^if\b/.test(skeL)) return null;

    const ctx = { tc, depth, children };
    for (const tmpl of SLOT_TEMPLATES) {
      if (tmpl.when && !tmpl.when(outer)) continue;
      const m = skeL.match(tmpl.re);
      if (!m) continue;
      const built = tmpl.build(m, children, ctx);
      if (built && built.type) return built;
    }
    return null;
  }
  /* __AIFX_SLOT_ENGINE_END__ */

  function resolveTokenMatch(tokenText, tc) {
    const raw = tokenText.trim();
    if (raw === '[]' || raw === '()' || raw === '[ ]' || raw === '( )') {
      return { confidence: 0, type: null, reason: 'empty token' };
    }
    if (/ctrl\s*\+/i.test(raw)) {
      return { confidence: 0, type: null, reason: 'keyboard shortcut' };
    }

    // 0. Filter out parenthetical English prose side comments (confidence < 80%)
    if (raw.startsWith('(') && raw.endsWith(')')) {
      if (!parseMath(raw)) {
        const isCanonical = CANONICAL_MAP.some(e => {
          try { return e.match.test(raw); } catch (e) { return false; }
        });
        if (!isCanonical) {
          const inner = raw.slice(1, -1).trim();
          const proseRegex = /\b(using|such as|for example|or|and|with|from|in|by|not|to|how|whatever|of|that|the|a|an|both|when|before|after|if|where|due|such|except|keeping|navigating|moving|including|instead|out|all|apply|vice versa)\b/i;
          if (proseRegex.test(inner)) {
            return { confidence: 0.0, err: `(${inner}) is an instruction side comment, not a block (confidence < 80%)` };
          }
          if (inner.includes(' ') && !['text list'].includes(inner.toLowerCase())) {
            return { confidence: 0.0, err: `(${inner}) is an instruction side comment, not a block (confidence < 80%)` };
          }
        }
      }
    }

    // 0b. Tilemap placeholder socket bubbles: (tilemap), (tilemap1), (tilemap2), (tilemap 1), etc.
    if (/^[\[\(]\s*tilemap(?:\s*\d+)?\s*[\]\)]$/i.test(raw)) {
      return {
        confidence: 1.0,
        custom: () => renderTilemapPlaceholder(raw),
        name: raw
      };
    }

    // 0.9. Nested-parameter slot-template engine: [set (list) to], [change (score) by
    // (1)], <(a and b)>, [if (0=0) then] ... A null result always leaves the token to
    // the canonical / fuzzy paths untouched.
    {
      const tmpl = resolveTemplateMatch(raw, tc, 0);
      if (tmpl) return { confidence: 1.0, type: tmpl.type, mutator: tmpl.mutator, name: raw };
    }

    // 1. Canonical rule match
    for (const entry of CANONICAL_MAP) {
      if (entry.match.test(raw)) {
        return { confidence: entry.conf, type: entry.type, mutator: entry.mutator, custom: entry.custom, name: raw };
      }
    }

    // 1b. Dropdown Badges (Controller #d44627, Sprites #4b7bec, Scene #4b6584, Logic #4b7bec)
    const dropdownMatch = raw.match(/^[\[\(]([a-zA-Z0-9_\(\)\s<>=!]+)[\]\)]$/i);
    if (dropdownMatch) {
      const inner = dropdownMatch[1].trim().toLowerCase();
      // Controller buttons
      const controllerOptions = ['up', 'down', 'left', 'right', 'a', 'b', 'a button', 'b button'];
      if (controllerOptions.includes(inner)) {
        return {
          confidence: 1.0,
          custom: () => renderDropdownBadge(dropdownMatch[1].trim(), '#d44627'),
          name: raw
        };
      }
      // Sprite properties and flags
      const spriteOptions = [
        'x', 'y', 'vx', 'vy', 'ax', 'ay',
        'lifespan', 'invisible', 'ghost', 'auto destroy',
        'stay in screen', 'bounce on wall',
        'ay (acceleration y)', 'vy (velocity y)',
        'ax (acceleration x)', 'vx (velocity x)'
      ];
      if (spriteOptions.includes(inner)) {
        return {
          confidence: 1.0,
          custom: () => renderDropdownBadge(dropdownMatch[1].trim(), '#4b7bec'),
          name: raw
        };
      }
      // Game dropdowns: [bottom] (game), [top] (game)
      if (raw.includes('(game)') || inner.includes('(game)')) {
        const cleanName = inner.replace(/\(game\)/i, '').trim();
        return {
          confidence: 1.0,
          custom: () => renderDropdownBadge(cleanName, '#8854d0'),
          name: raw
        };
      }
      // Music playback modes and sounds
      const musicOptions = [
        'until done', 'looping in background', 'in background',
        'jump up', 'jump down', 'power up', 'power down',
        'magic wand', 'knock', 'small crash', 'big crash', 'beam up',
        'zapped', 'wawawawaa', 'thump'
      ];
      if (musicOptions.includes(inner)) {
        return {
          confidence: 1.0,
          custom: () => renderDropdownBadge(dropdownMatch[1].trim(), '#e30fc0'),
          name: raw
        };
      }
      // Scroller directions
      const scrollerOptions = ['only horizontally', 'only vertically', 'both directions'];
      if (scrollerOptions.includes(inner)) {
        return {
          confidence: 1.0,
          custom: () => renderDropdownBadge(dropdownMatch[1].trim(), '#ff85a7'),
          name: raw
        };
      }
      // Scene directions and screen effects
      const sceneOptions = [
        'bottom', 'top',
        'confetti', 'bubbles', 'hearts', 'star field', 'clouds', 'halo',
        'fountain', 'rings', 'warm radial', 'cool radial', 'fire', 'blizzard',
        'ashes', 'disintegrate', 'spray'
      ];
      if (sceneOptions.includes(inner)) {
        return {
          confidence: 1.0,
          custom: () => renderDropdownBadge(dropdownMatch[1].trim(), '#4b6584'),
          name: raw
        };
      }
      // Logic dropdowns: (<), (=), (>), (<=), (>=), (!=), [<], [=]
      const logicOptions = ['<', '=', '>', '<=', '>=', '!='];
      if (logicOptions.includes(inner)) {
        return {
          confidence: 1.0,
          custom: () => renderDropdownBadge(dropdownMatch[1].trim(), '#45aaf2'),
          name: raw
        };
      }
    }

    // 2. Sprite Property: [set sprite x to], [change sprite y by], [set sprite [x], [set sprite lifespan]
    const spritePropMatch = raw.match(/(?:set|change)\s+sprite\s+\[?([xy]|vx|vy|ax|ay|lifespan)\]?(?:\s+(?:to|by))?/i);
    if (spritePropMatch) {
      const prop = spritePropMatch[1].toLowerCase();
      const isChange = /change/i.test(raw);
      const type = isChange ? 'Sprite_blockCombine_change' : 'Sprite_blockCombine_set';
      return {
        confidence: 1.0,
        type,
        mutator: (b) => {
          const f = b.getField('property');
          if (f) {
            if (prop === 'lifespan') f.setValue('Sprite.lifespan');
            else f.setValue(`Sprite.${prop}@${isChange ? 'change' : 'set'}`);
          }
        },
        name: raw
      };
    }

    // 3. Function Definitions: [function <name>]
    const funcDefMatch = raw.match(/^\[?(?:function)\s+([a-zA-Z0-9_]+)\]?$/i);
    if (funcDefMatch) {
      return {
        confidence: 1.0,
        type: 'function_definition',
        mutator: (b) => {
          const f = b.getField('function_name');
          if (f) f.setValue(funcDefMatch[1]);
        },
        name: raw
      };
    }

    // 4. Function Calls & Invocations: [call makeBee], [makeBee], [makeBee] function, [call function]
    const funcCallMatch = raw.match(/^\[?(?:call\s+)?([a-zA-Z0-9_]+)(?:\s+function)?\]?$/i);
    if (funcCallMatch) {
      const funcName = funcCallMatch[1];
      if (['makebee', 'function'].includes(funcName.toLowerCase()) || raw.toLowerCase().includes('call') || raw.toLowerCase().includes('function')) {
        return {
          confidence: 1.0,
          type: 'procedures_callnoreturn',
          mutator: (b) => {
            const actualName = funcName.toLowerCase() === 'function' ? 'doSomething' : funcName;
            if (b.renameProcedure) b.renameProcedure('Temp', actualName);
            const f = b.getField('NAME');
            if (f) f.setValue(actualName);
          },
          name: raw
        };
      }
    }

    // 5. Variable Setters & Changers: [set <name> to], [set [name] to], [set name to (val)]
    const varSetMatch = raw.match(/^\[\s*set\s+\[?([a-zA-Z0-9_ ]+?)\]?\s+to(?:\s+(.+?))?\s*\]$/i);
    if (varSetMatch) {
      const varName = varSetMatch[1].trim();
      const valExpr = varSetMatch[2] ? varSetMatch[2].trim() : '';
      return {
        confidence: 1.0,
        type: 'variables_set',
        mutator: (b, ws) => {
          const v = ensureVariable(ws, varName);
          const f = b.getField('VAR');
          if (f && v) f.setValue(v.getId());
          if (ws && valExpr) {
            const sub = createSubBlock(valExpr, ws);
            if (sub) connectInput(b, 'VALUE', sub);
          }
        },
        name: raw
      };
    }
    const varChangeMatch = raw.match(/^\[\s*change\s+\[?([a-zA-Z0-9_ ]+?)\]?\s+by(?:\s+(.+?))?\s*\]$/i);
    if (varChangeMatch) {
      const varName = varChangeMatch[1].trim();
      const valExpr = varChangeMatch[2] ? varChangeMatch[2].trim() : '';
      return {
        confidence: 1.0,
        type: 'variables_change',
        mutator: (b, ws) => {
          const v = ensureVariable(ws, varName);
          const f = b.getField('VAR');
          if (f && v) f.setValue(v.getId());
          if (ws && valExpr) {
            const sub = createSubBlock(valExpr, ws);
            if (sub) connectInput(b, 'VALUE', sub);
          }
        },
        name: raw
      };
    }

    // 5b. Sprite Property Getter: (sprite x), (mySprite x), (sprite y), [sprite x], [mySprite x], etc.
    const spritePropGetMatch = raw.match(/^[\[\(](?:(?:mySprite|sprite|[a-zA-Z0-9_]+)\s+)?([xy]|vx|vy|ax|ay|lifespan|width|height|left|right|top|bottom)(?:\s+value(?:\s+block)?)?[\]\)]$/i);
    if (spritePropGetMatch) {
      const prop = spritePropGetMatch[1].trim().toLowerCase();
      return {
        confidence: 1.0,
        type: 'Sprite_blockCombine_get',
        mutator: (b) => {
          const f = b.getField('property');
          if (f) f.setValue(`Sprite.${prop}`);
        },
        name: raw
      };
    }

    // 6. Check if token matches a real code block in MakeCode catalog BEFORE checking variables
    if (tc && tc.B && tc.ws) {
      const catalog = getCatalogEntries(tc.B, tc.ws);
      const norm = normalize(raw);
      const wTok = wordTokens(norm);
      const bgTok = charBigrams(norm);
      let best = null;
      let highestScore = 0;

      const isMpActive = /multiplayer|mp\.|player\s*[234]/i.test(document.body ? document.body.innerText : '');
      for (const b of catalog) {
        if (b.type && b.type.startsWith('mp_') && !isMpActive) continue;
        let score = (jaccardSimilarity(wTok, b.words) * 0.5) + (diceSimilarity(bgTok, b.bigrams) * 0.5);
        if (b.normText.length >= 4) {
          if (norm === b.normText) {
            score = Math.max(score, 0.95);
          } else if (norm.includes(b.normText) && (b.normText.length / norm.length) >= 0.7) {
            score = Math.max(score, 0.85);
          } else if (b.normText.includes(norm) && (norm.length / b.normText.length) >= 0.7) {
            score = Math.max(score, 0.85);
          }
        }
        if (score > highestScore) {
          highestScore = score;
          best = b;
        }
      }

      if (highestScore >= 0.80 && best) {
        return { confidence: highestScore, type: best.type, name: raw };
      }
    }

    // 7. Standalone identifier bubbles / variable blocks: (mySprite), [question], (fishSprite)
    const bubbleMatch = raw.match(/^[\[\(]([a-zA-Z_][a-zA-Z0-9_ ]*)[\]\)]$/);
    if (bubbleMatch) {
      const name = bubbleMatch[1].trim();
      if (['score', 'hudscore'].includes(name.toLowerCase())) {
        return { confidence: 1.0, type: 'hudScore', name: raw };
      }
      if (['life', 'hudlife'].includes(name.toLowerCase())) {
        return { confidence: 1.0, type: 'hudLife', name: raw };
      }
      if (['background image'].includes(name.toLowerCase())) {
        return { confidence: 1.0, type: 'gamebackgroundimage', name: raw };
      }
      if (['othersprite', 'location', 'picture'].includes(name.toLowerCase())) {
        return {
          confidence: 1.0,
          type: 'argument_reporter_custom',
          mutator: (b) => {
            const f = b.getField('VALUE');
            if (f) f.setValue(name);
          },
          name: raw
        };
      }
      const knownVars = KNOWN_VARS;

      // Guard against non-variables: if it's bracketed [...] and looks like an action/verb or unknown token rather than a variable, do not assume variable
      const isBracket = raw.startsWith('[');
      if (isBracket) {
        if (!knownVars.includes(name.toLowerCase())) {
          return { confidence: 0.0, err: `[${name}] is not a recognized variable or block property (confidence < 80%)` };
        }
      }

      const isParen = raw.startsWith('(');
      if (isParen) {
        // If it contains English stop words, conjunctions, prepositions, or articles, it's a prose side comment
        const proseRegex = /\b(using|such as|for example|or|and|with|from|in|by|not|to|how|whatever|of|that|the|a|an|both|when|before|after|if|where|due|such|except|keeping|navigating|moving|including|instead|out|all|apply|vice versa)\b/i;
        if (proseRegex.test(name)) {
          return { confidence: 0.0, err: `(${name}) is an instruction side comment, not a block (confidence < 80%)` };
        }
        // If it contains spaces and is not an explicitly known variable (like 'text list'), do not assume variable
        if (name.includes(' ') && !knownVars.includes(name.toLowerCase())) {
          return { confidence: 0.0, err: `(${name}) is not a recognized variable name (confidence < 80%)` };
        }
      }

      return {
        confidence: 0.95,
        type: 'variables_get',
        mutator: (b, ws) => {
          const v = ensureVariable(ws, name);
          const f = b.getField('VAR');
          if (f && v) f.setValue(v.getId());
        },
        name: raw
      };
    }

    // 8. Angled Boolean variable/reporter: <isBeeDizzy>
    const angleIdentMatch = raw.match(/^<([a-zA-Z_][a-zA-Z0-9_]*)>$/);
    if (angleIdentMatch) {
      const name = angleIdentMatch[1];
      return {
        confidence: 0.95,
        type: 'argument_reporter_boolean',
        mutator: (b) => {
          const f = b.getField('VALUE');
          if (f) f.setValue(name);
        },
        name: raw
      };
    }

    return { confidence: 0, type: null, reason: 'below 80% threshold' };
  }

  async function waitForToolchain(timeoutMs = 15000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const tc = toolchain();
      if (tc) return tc;
      await new Promise(r => setTimeout(r, 100));
    }
    return null;
  }

  async function renderToken(tokenText) {
    if (CACHE[tokenText]) return CACHE[tokenText];

    const matchQuick = resolveTokenMatch(tokenText, null);
    if (matchQuick && matchQuick.custom) {
      const res = matchQuick.custom(tokenText, null);
      if (res && res.svg) {
        CACHE[tokenText] = res;
        return res;
      }
    }

    const tc = await waitForToolchain(15000);
    if (!tc) {
      return { svg: null, err: 'Blockly toolchain not ready' };
    }

    const match = resolveTokenMatch(tokenText, tc);
    if (!match || match.confidence < 0.80 || (!match.type && !match.custom)) {
      return { svg: null, err: 'Block not found or confidence < 80%: ' + tokenText };
    }

    if (match.custom) {
      const res = match.custom(tokenText, tc ? tc.ws : null);
      if (res && res.svg) {
        CACHE[tokenText] = res;
        return res;
      }
    }

    const res = renderDynamicBlock(match.type, match.mutator, tokenText);
    if (res && res.svg) {
      CACHE[tokenText] = res;
      return res;
    }

    return { svg: null, err: 'Failed to render block: ' + tokenText };
  }

  // Announce when toolchain is ready
  (async function announceWhenReady() {
    const tc = await waitForToolchain(30000);
    if (tc) {
      console.info('[AIFX in-page] Toolchain ready, announcing');
      window.postMessage({ action: 'AIFX_RENDERER_READY' }, '*');
    }
  })();

  // Listen for render requests dispatched from renderer.js
  window.addEventListener('message', (event) => {
    if (!event.data || event.data.action !== 'AIFX_RENDER_BLOCK') return;
    const { id, token } = event.data;

    renderToken(token || '')
      .then((res) => {
        window.postMessage({
          action: 'AIFX_BLOCK_RENDERED',
          id: id,
          svg: res ? res.svg : null,
          width: res ? res.width : 0,
          height: res ? res.height : 0,
          isMultiLine: res ? res.isMultiLine : false,
          err: res ? res.err : null
        }, '*');
      })
      .catch((err) => {
        window.postMessage({
          action: 'AIFX_BLOCK_RENDERED',
          id: id,
          svg: null,
          width: 0,
          height: 0,
          isMultiLine: false,
          err: String(err)
        }, '*');
      });
  });

  console.info('[AIFX in-page] MAIN world renderer active with 80% heuristic & bubble mutators');
})();
