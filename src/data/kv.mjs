// Minimal tolerant Valve KeyValues (KV1) parser -> nested plain objects.
// Duplicate keys holding blocks are merged; duplicate scalar keys keep the last value.

const WS = new Set([' ', '\t', '\r', '\n', '﻿']);

export function decodeText(buf) {
  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) return buf.toString('utf16le', 2);
  if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) return buf.toString('utf8', 3);
  return buf.toString('utf8');
}

function tokenize(text) {
  const toks = [];
  const n = text.length;
  let i = 0;
  while (i < n) {
    const c = text[i];
    if (WS.has(c)) { i++; continue; }
    if (c === '/' && text[i + 1] === '/') {
      const j = text.indexOf('\n', i);
      i = j < 0 ? n : j + 1;
      continue;
    }
    if (c === '{' || c === '}') { toks.push(c); i++; continue; }
    if (c === '"') {
      i++;
      let s = '';
      let start = i;
      while (i < n && text[i] !== '"') {
        if (text[i] === '\\' && i + 1 < n) {
          s += text.slice(start, i);
          const nx = text[i + 1];
          s += nx === 'n' ? '\n' : nx === 't' ? '\t' : nx === '"' ? '"' : nx === '\\' ? '\\' : '\\' + nx;
          i += 2;
          start = i;
        } else i++;
      }
      s += text.slice(start, i);
      i++;
      toks.push([s]);
      continue;
    }
    let j = i;
    while (j < n && !WS.has(text[j]) && text[j] !== '{' && text[j] !== '}' && text[j] !== '"') j++;
    toks.push([text.slice(i, j)]);
    i = j;
  }
  return toks;
}

const isCond = (t) => Array.isArray(t) && t[0].startsWith('[') && t[0].endsWith(']');

export function parseKV(text) {
  const toks = tokenize(text);
  let pos = 0;

  const put = (obj, key, val) => {
    const cur = obj[key];
    if (cur && typeof cur === 'object' && val && typeof val === 'object') Object.assign(cur, val);
    else obj[key] = val;
  };

  const block = (needClose) => {
    const out = {};
    while (pos < toks.length) {
      const t = toks[pos];
      if (t === '}') { pos++; if (needClose) return out; continue; }
      if (t === '{') { pos++; continue; }
      const key = t[0];
      pos++;
      if (key.startsWith('#base') || key.startsWith('#include')) {
        if (pos < toks.length && Array.isArray(toks[pos])) { (out['#base'] ||= []).push(toks[pos][0]); pos++; }
        continue;
      }
      if (pos < toks.length && isCond(toks[pos])) pos++;
      if (pos >= toks.length) break;
      const nx = toks[pos];
      if (nx === '{') { pos++; put(out, key, block(true)); }
      else if (nx === '}') put(out, key, '');
      else { pos++; put(out, key, nx[0]); }
      if (pos < toks.length && isCond(toks[pos])) pos++;
    }
    return out;
  };

  return block(false);
}

export function parseKVBuffer(buf) {
  return parseKV(decodeText(buf));
}
