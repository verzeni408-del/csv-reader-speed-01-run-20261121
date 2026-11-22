// Single-pass byte-level CSV->JSON transformer for csv-reader-speed-01.
//
// It works on the raw cases.json bytes as a latin1 string (byte-preserving:
// every byte is one code unit, so UTF-8 sequences pass through untouched
// and no UTF-8 decode ever runs). The JSON escapes in the input are only
// \r, \n and \" (the generator never emits other escapes), so the CSV
// structure is readable straight off the escaped bytes, and the output JSON
// reuses the input's escaping: \" stays \", \n stays \n, \\ would stay \\
// (it never occurs), while \r inside quotes is normalised to \n and a
// doubled "" is collapsed to a single ".
//
// That fuses three passes into one: no JSON.parse of the input, no
// csv-reader object graph, no JSON.stringify of the answers. The output is
// assembled in one chunk array with a single join at the end, so no
// intermediate row/field strings are built. The parser mirrors csv-reader
// 1.0.0's semantics exactly (same broken-row policy, same error order and
// attribution); anything it does not recognise throws and the driver falls
// back to the plain JSON.parse + run() path.

const COMMA = 0;
const LINE_BREAK = 1;
const END = 2;

/** answers.json for the whole cases.json file (latin1 string). Throws on unexpected input. */
export function transformRaw(raw) {
  const out = [];
  let p = 0;
  while (true) {
    const ti = raw.indexOf('"text":"', p);
    if (ti === -1) break;
    const ts0 = ti + 8;
    const he = raw.indexOf('","header":', ts0);
    if (he === -1) throw new Error('transform: no header after text');
    const te = he; // the text string's closing quote
    let header;
    if (raw.startsWith('true', he + 11)) header = true;
    else if (raw.startsWith('false', he + 11)) header = false;
    else throw new Error('transform: bad header');
    let ts = ts0;
    // Drop a BOM (EF BB BF as latin1 chars) at the very start of the text.
    if (raw.charCodeAt(ts) === 0xef && raw.charCodeAt(ts + 1) === 0xbb && raw.charCodeAt(ts + 2) === 0xbf) ts += 3;
    out.push(parseCase(raw, ts, te, header));
    p = he + 11;
  }
  return '[' + out.join(',') + ']';
}

/** One case's answer JSON. s is the raw latin1 file, [start, end) the text span. */
function parseCase(s, start, end, header) {
  const n = end;
  let pos = start;
  let line = 1;
  let width = -1;
  let cols = null;
  const rowsOut = [];
  const errs = [];
  let rowsCount = 0;
  let ended = END;
  let recordLine = 1;
  let recordRow = null;

  function error(code, extra) {
    errs.push('{"code":"' + code + '","line":' + recordLine + ',"row":' + (recordRow === null ? 'null' : recordRow) + (extra || '') + '}');
  }

  // Emit a quoted field's content span [a, b): counts its line breaks and
  // normalises every \r (lone or CRLF) to a single \n. Appends to ch.
  function emitQuotedSpan(ch, a, b) {
    let seg = a;
    let p = a;
    while (true) {
      const bs = s.indexOf('\\', p);
      if (bs === -1 || bs >= b) {
        if (b > seg) ch.push(s.slice(seg, b));
        return;
      }
      const k = s.charCodeAt(bs + 1);
      if (k === 110) { // \n inside quotes: a line break, kept as-is
        line++;
        p = bs + 2;
        continue;
      }
      if (k === 114) { // \r inside quotes: normalise to \n (CRLF counts once)
        if (bs > seg) ch.push(s.slice(seg, bs));
        line++;
        if (s.charCodeAt(bs + 2) === 92 && s.charCodeAt(bs + 3) === 110) {
          ch.push('\\n');
          p = bs + 4;
        } else {
          ch.push('\\n');
          p = bs + 2;
        }
        seg = p;
        continue;
      }
      throw new Error('transform: unexpected escape in quoted span');
    }
  }

  // Reads an unquoted field starting at pos. Appends its JSON content to ch.
  // Returns ended (COMMA/LINE_BREAK/END). Records stray_cr errors.
  function readUnquoted(ch) {
    let start = pos;
    while (pos < n) {
      const comma = s.indexOf(',', pos);
      const bs = s.indexOf('\\', pos);
      let next;
      let isComma = false;
      if (comma !== -1 && (bs === -1 || comma < bs)) { next = comma; isComma = true; }
      else if (bs !== -1) { next = bs; }
      else { next = n; }
      if (next >= n) {
        if (n > start) ch.push(s.slice(start, n));
        pos = n;
        return (ended = END);
      }
      if (isComma) {
        if (next > start) ch.push(s.slice(start, next));
        pos = next + 1;
        return (ended = COMMA);
      }
      const k = s.charCodeAt(next + 1);
      if (k === 110) { // \n: record ends
        if (next > start) ch.push(s.slice(start, next));
        pos = next + 2;
        line++;
        return (ended = LINE_BREAK);
      }
      if (k === 114) { // \r
        if (s.charCodeAt(next + 2) === 92 && s.charCodeAt(next + 3) === 110) {
          if (next > start) ch.push(s.slice(start, next));
          pos = next + 4;
          line++;
          return (ended = LINE_BREAK);
        }
        error('stray_cr', '');
        if (next > start) ch.push(s.slice(start, next));
        pos = next + 2;
        start = pos;
        continue;
      }
      if (k === 34) { // \" : a literal quote inside an unquoted field; keep it in the span
        pos = next + 2;
        continue;
      }
      throw new Error('transform: unexpected escape in unquoted field');
    }
    if (n > start) ch.push(s.slice(start, n));
    pos = n;
    return (ended = END);
  }

  // Reads a quoted field whose opening \" is at pos. Appends JSON content to ch.
  function readQuoted(ch) {
    const open = pos;
    const openLine = line;
    pos += 2; // opening \"
    let contentStart = pos;
    while (true) {
      const q = s.indexOf('\\"', pos);
      if (q === -1 || q >= n) {
        // The quote never closes: it is a literal character, and the text
        // after it is read again as unquoted. The partial quoted content
        // (doubled-quote literals, normalised breaks) is discarded, exactly
        // as csv-reader throws the attempt away and re-reads from the open.
        pos = open + 2;
        line = openLine;
        error('unterminated_quote', '');
        ch.length = 0;
        ch.push('\\"');
        return readUnquoted(ch);
      }
      if (s.charCodeAt(q + 2) === 92 && s.charCodeAt(q + 3) === 34) {
        // Doubled quote: one literal quote in the value.
        emitQuotedSpan(ch, contentStart, q);
        ch.push('\\"');
        contentStart = q + 4;
        pos = q + 4;
        continue;
      }
      // Closing quote at q.
      emitQuotedSpan(ch, contentStart, q);
      pos = q + 2;
      break;
    }
    if (pos >= n) return (ended = END);
    const c = s.charCodeAt(pos);
    if (c === 44) { pos += 1; return (ended = COMMA); }
    if (c === 92) {
      const k = s.charCodeAt(pos + 1);
      if (k === 110) { pos += 2; line++; return (ended = LINE_BREAK); }
      if (k === 114 && s.charCodeAt(pos + 2) === 92 && s.charCodeAt(pos + 3) === 110) {
        pos += 4; line++; return (ended = LINE_BREAK);
      }
    }
    // What follows the closing quote is appended as it stands, up to the
    // next comma or line break (quote_junk, when the field ends).
    let before = 0;
    for (let i = 0; i < ch.length; i++) before += ch[i].length;
    const e = readUnquoted(ch);
    let after = 0;
    for (let i = 0; i < ch.length; i++) after += ch[i].length;
    if (after > before) error('quote_junk', '');
    return e;
  }

  while (true) {
    // Lines with no characters are no records.
    while (pos < n) {
      if (s.charCodeAt(pos) === 92 && s.charCodeAt(pos + 1) === 110) { pos += 2; line++; }
      else if (s.charCodeAt(pos) === 92 && s.charCodeAt(pos + 1) === 114 && s.charCodeAt(pos + 2) === 92 && s.charCodeAt(pos + 3) === 110) { pos += 4; line++; }
      else break;
    }
    if (pos >= n) break;
    recordLine = line;
    recordRow = header && cols === null ? null : rowsCount;
    const fields = [];
    let fieldCount = 0;
    let f0empty = false;
    let f0quoted = false;
    do {
      const isQuoted = s.charCodeAt(pos) === 92 && s.charCodeAt(pos + 1) === 34;
      const ch = [];
      if (isQuoted) readQuoted(ch); else readUnquoted(ch);
      let flen = 0;
      for (let i = 0; i < ch.length; i++) flen += ch[i].length;
      if (fieldCount === 0) { f0empty = flen === 0; f0quoted = isQuoted; }
      fieldCount++;
      fields.push('"' + (ch.length === 1 ? ch[0] : ch.join('')) + '"');
    } while (ended === COMMA);
    // A line that held only stray CRs is left with no characters: no record.
    if (fieldCount === 1 && f0empty && !f0quoted) continue;
    if (width < 0) width = fieldCount;
    if (header && cols === null) { cols = fields; continue; }
    if (fieldCount < width) {
      error('short_row', ',"fields":' + fieldCount);
      while (fields.length < width) fields.push('""');
    } else if (fieldCount > width) {
      const extra = fields.slice(width);
      error('long_row', ',"extra":[' + extra.join(',') + ']');
      fields.length = width;
    }
    rowsOut.push('[' + fields.join(',') + ']');
    rowsCount++;
  }

  const colsJson = header ? '[' + (cols ? cols.join(',') : '') + ']' : 'null';
  return '{"columns":' + colsJson + ',"rows":[' + rowsOut.join(',') + '],"errors":[' + errs.join(',') + ']}';
}
