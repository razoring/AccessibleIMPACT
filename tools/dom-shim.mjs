// Minimal SVG DOM shim — just enough surface for applySvgFields:
//   querySelector/querySelectorAll with simple selectors (tag, tag.class,
//   tag[attr], [attr], comma groups), classList.contains, attributes,
//   textContent, parentNode, compareDocumentPosition, XMLSerializer.
// Not a general XML parser; built for testing overlay.js's applySvgFields.

const ENT = { '&lt;': '<', '&gt;': '>', '&quot;': '"', '&apos;': "'", '&amp;': '&' };
const decode = s => s.replace(/&(lt|gt|quot|apos|amp);/g, (_, e) => ENT['&' + e + ';']);
const encodeText = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const encodeAttr = s => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

class ClassList {
  constructor(el) { this.el = el; }
  contains(c) { return (this.el.getAttribute('class') || '').split(/\s+/).includes(c); }
}

class Node {
  constructor(tag) {
    this.tagName = tag || null;   // null => text node
    this.attrs = {};
    this.childNodes = [];
    this.parentNode = null;
    this._text = null;
  }
  get classList() { return new ClassList(this); }
  get children() { return this.childNodes.filter(n => n.tagName); }
  get textContent() {
    if (this.tagName === null) return this._text || '';
    return this.childNodes.map(n => n.textContent).join('');
  }
  set textContent(v) {
    this.childNodes = [];
    if (v !== null && v !== undefined && v !== '') {
      const t = new Node(null); t._text = v; t.parentNode = this;
      this.childNodes.push(t);
    }
  }
  getAttribute(name) {
    const v = this.attrs[name];
    return v === undefined ? null : v;
  }
  setAttribute(name, v) { this.attrs[name] = String(v); }
  hasAttribute(name) { return name in this.attrs; }
  appendChild(n) { n.parentNode = this; this.childNodes.push(n); return n; }

  matches(sel) {
    // simple selector: tag.class[attr] / tag[attr="value"] pieces
    const m = sel.match(/^([a-zA-Z][\w-]*|\*)?(?:\.([\w-]+))?(?:\[([^\]=]+)(?:="([^"]*)")?\])?$/);
    if (!m) return false;
    const [, tag, cls, attr, attrVal] = m;
    if (!this.tagName) return false;
    if (tag && tag !== '*' && this.tagName !== tag) return false;
    if (cls && !this.classList.contains(cls)) return false;
    if (attr && !this.hasAttribute(attr)) return false;
    if (attr && attrVal !== undefined && this.getAttribute(attr) !== attrVal) return false;
    return true;
  }
  _walk(cb) {
    for (const c of this.childNodes) {
      if (c.tagName) { cb(c); c._walk(cb); }
    }
  }
  querySelectorAll(sel) {
    const parts = sel.split(',').map(s => s.trim());
    const out = [];
    this._walk(el => { if (parts.some(p => el.matches(p))) out.push(el); });
    return out;
  }
  querySelector(sel) { return this.querySelectorAll(sel)[0] || null; }

  static CONTAINED_BY = 16;
  static FOLLOWING = 4;
  static CONTAINS = 8;
  compareDocumentPosition(other) {
    // containment
    let a = this;
    while (a) { if (a === other) return Node.CONTAINED_BY; a = a.parentNode; }
    a = other;
    while (a) { if (a === this) return Node.CONTAINS; a = a.parentNode; }
    // document order: preorder index
    let r = this;
    while (r.parentNode) r = r.parentNode;
    const idx = new Map();
    let i = 0;
    (function walk(n) { idx.set(n, i++); n.childNodes.forEach(walk); })(r);
    return idx.get(this) < idx.get(other) ? Node.FOLLOWING : 2; // 2 = PRECEDING
  }
}

class XMLDoc extends Node {
  constructor() { super('#document'); }
  get documentElement() { return this.children[0]; }
}

export function parseXml(str) {
  const doc = new XMLDoc();
  const re = /<!--[\s\S]*?-->|<\/([a-zA-Z][\w:-]*)>|<([a-zA-Z][\w:-]*)((?:\s+[\w:-]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>|([^<]+)/g;
  let cur = doc, m;
  while ((m = re.exec(str))) {
    if (m[0].startsWith('<!--')) continue;
    if (m[1]) { // close tag
      let p = cur;
      while (p && p.tagName !== m[1]) p = p.parentNode;
      if (p) cur = p.parentNode;
    } else if (m[2]) { // open tag
      const el = new Node(m[2]);
      const are = /([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
      let am;
      while ((am = are.exec(m[3]))) el.attrs[am[1]] = decode(am[2] !== undefined ? am[2] : am[3]);
      cur.appendChild(el);
      if (!m[4]) cur = el;
    } else if (m[5]) { // text
      const t = new Node(null);
      t._text = decode(m[5]);
      cur.appendChild(t);
    }
  }
  return doc;
}

export class XMLSerializer {
  serializeToString(node) {
    const out = [];
    (function ser(n) {
      if (n.tagName === null) { out.push(encodeText(n._text || '')); return; }
      const attrs = Object.entries(n.attrs)
        .map(([k, v]) => ` ${k}="${encodeAttr(v)}"`).join('');
      if (!n.childNodes.length) out.push(`<${n.tagName}${attrs}/>`);
      else {
        out.push(`<${n.tagName}${attrs}>`);
        n.childNodes.forEach(ser);
        out.push(`</${n.tagName}>`);
      }
    })(node);
    return out.join('');
  }
}
