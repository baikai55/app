'use strict';

const TAG = /^[a-zA-Z][a-zA-Z0-9:-]*(?=[\s/>])/;
const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr']);

function decodeEntities(text) {
  if (!text) return '';
  return text
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&');
}

function parseAttr(raw) {
  const attrs = {};
  const re = /([a-zA-Z_:][a-zA-Z0-9_:.-]*)(?:\s*=\s*("[^"]*"|'[^']*'|[^\s"'=<>`]+))?/g;
  let m;
  while ((m = re.exec(raw))) {
    let value = m[2] || '';
    if (value.length >= 2 && (value[0] === '"' || value[0] === "'")) value = value.slice(1, -1);
    attrs[m[1].toLowerCase()] = decodeEntities(value);
  }
  return attrs;
}

function tokenize(html) {
  const tokens = [];
  const re = /<!--[\s\S]*?-->|<![^>]*>|<\/?[a-zA-Z][^>]*>|<!\[CDATA\[[\s\S]*?\]\]>/g;
  let last = 0;
  let m;
  while ((m = re.exec(html))) {
    if (m.index > last) tokens.push({ type: 'text', text: html.slice(last, m.index) });
    const raw = m[0];
    if (raw.startsWith('<!--') || raw.startsWith('<!')) {
      tokens.push({ type: 'comment', text: raw });
    } else if (raw.startsWith('</')) {
      tokens.push({ type: 'end', name: raw.slice(2, -1).trim().toLowerCase() });
    } else {
      const inner = raw.slice(1, -1);
      const nameMatch = inner.match(TAG);
      if (!nameMatch) continue;
      const name = nameMatch[0].toLowerCase();
      tokens.push({ type: 'start', name, attrs: parseAttr(inner.slice(name.length)), selfClosing: /\/\s*>$/.test(raw) });
    }
    last = m.index + raw.length;
  }
  if (last < html.length) tokens.push({ type: 'text', text: html.slice(last) });
  return tokens;
}

function buildTree(tokens) {
  const root = { type: 'root', children: [] };
  const stack = [root];
  for (const token of tokens) {
    if (token.type === 'text') {
      stack[stack.length - 1].children.push({ type: 'text', text: token.text, parent: stack[stack.length - 1] });
    } else if (token.type === 'start') {
      const node = { type: 'element', name: token.name, attrs: token.attrs, parent: stack[stack.length - 1], children: [] };
      stack[stack.length - 1].children.push(node);
      if (!token.selfClosing && !VOID.has(token.name)) stack.push(node);
    } else if (token.type === 'end') {
      for (let i = stack.length - 1; i > 0; i--) {
        if (stack[i].name === token.name) {
          stack.length = i;
          break;
        }
      }
    }
  }
  return root;
}

function matchesSelector(node, selector) {
  const parts = selector.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return false;
  let cursor = node;
  for (let i = parts.length - 1; i >= 0; i--) {
    const part = parts[i];
    let found = null;
    if (i === parts.length - 1) {
      found = matchSingle(cursor, part) ? cursor : null;
      if (!found) return false;
    } else {
      found = climb(cursor, part);
      if (!found) return false;
    }
    cursor = found;
  }
  return true;
}

function climb(node, part) {
  let p = node.parent;
  while (p) {
    if (matchSingle(p, part)) return p;
    p = p.parent;
  }
  return null;
}

function matchSingle(node, part) {
  if (node.type !== 'element') return false;
  const re = /([a-zA-Z*][a-zA-Z0-9-]*)?((?:[.#][a-zA-Z0-9_-]+)+)?(\[[^\]]+\])?/;
  const m = part.match(re);
  if (!m || !m[0]) return false;
  const tag = m[1] || '*';
  const idsClasses = m[2] || '';
  const attrSel = m[3] || '';
  if (tag !== '*' && node.name !== tag.toLowerCase()) return false;
  if (idsClasses) {
    const pieces = idsClasses.match(/[.#][a-zA-Z0-9_-]+/g) || [];
    for (const piece of pieces) {
      if (piece[0] === '#') {
        if (node.attrs.id !== piece.slice(1)) return false;
      } else {
        const classes = (node.attrs.class || '').split(/\s+/);
        if (!classes.includes(piece.slice(1))) return false;
      }
    }
  }
  if (attrSel) {
    const attrRe = /\[([a-zA-Z_:][a-zA-Z0-9_:.-]*)(\^=|\$=|\*=|~=|\|=|=)?("?[^\]]*"?)+\]/;
    const am = attrSel.match(attrRe);
    if (!am || !am[1]) return false;
    const name = am[1];
    const op = am[2] || '=';
    const rawValue = am[3] || '';
    const value = rawValue.replace(/^["']|["']$/g, '');
    const actual = node.attrs[name];
    if (actual === undefined) return false;
    if (op === '=' && rawValue === '') return true;
    if (op === '^=') { if (!actual.startsWith(value)) return false; }
    else if (op === '$=') { if (!actual.endsWith(value)) return false; }
    else if (op === '*=') { if (!actual.includes(value)) return false; }
    else if (op === '~=') { if (!actual.split(/\s+/).includes(value)) return false; }
    else if (op === '|=') { if (!(actual === value || actual.startsWith(value + '-'))) return false; }
    else if (actual !== value) return false;
  }
  return true;
}

function selectAll(node, selector) {
  const out = [];
  (function walk(el) {
    if (el.type === 'element' && matchesSelector(el, selector)) out.push(el);
    for (const child of el.children || []) walk(child);
  })(node);
  return out;
}

function selectOne(node, selector) {
  if (!node) return null;
  return selectAll(node, selector)[0] || null;
}

function attr(node, name) {
  if (!node || node.type !== 'element') return null;
  const v = node.attrs[name.toLowerCase()];
  return v === undefined ? null : v;
}

function textContent(node) {
  if (!node) return '';
  if (node.type === 'text') return node.text;
  if (node.type !== 'element') return '';
  let out = '';
  for (const child of node.children) out += textContent(child);
  return out;
}

function ownText(node) {
  if (!node || node.type !== 'element') return '';
  let out = '';
  for (const child of node.children) {
    if (child.type === 'text') out += child.text;
  }
  return out;
}

function removeAll(node, selector) {
  for (const el of selectAll(node, selector)) {
    const parent = el.parent;
    if (!parent) continue;
    const idx = parent.children.indexOf(el);
    if (idx >= 0) parent.children.splice(idx, 1);
    el.parent = null;
  }
  return node;
}

function tagName(node) {
  return node && node.type === 'element' ? node.name : null;
}

function parse(html) {
  return buildTree(tokenize(html));
}

function resolveUrl(value, baseUrl) {
  if (!value) return null;
  const cleaned = String(value).trim().replace(/\\\//g, '/');
  if (/^blob:|^data:/i.test(cleaned)) return null;
  let resolved;
  if (/^https:\/\//i.test(cleaned)) resolved = cleaned;
  else if (cleaned.startsWith('//')) resolved = 'https:' + cleaned;
  else {
    try {
      resolved = new URL(cleaned, baseUrl).toString();
    } catch {
      return null;
    }
  }
  try {
    const u = new URL(resolved);
    if (u.protocol !== 'https:') return null;
    return u.toString();
  } catch {
    return null;
  }
}

function href(node) {
  const value = attr(node, 'href');
  if (value == null) return null;
  return value;
}

export { parse, selectAll, selectOne, attr, textContent, ownText, removeAll, tagName, resolveUrl, href, decodeEntities };

