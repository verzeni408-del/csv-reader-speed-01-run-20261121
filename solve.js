// Fast drop-in for csv-reader 1.0.0 (make.fun's own CSV reader).
// Same answers as csv-reader's readCsv on every input, single left-to-right
// pass, but fields are taken with slice() instead of built one character at
// a time, and quoted fields jump to their closing quote with indexOf().
// Semantics (mirrors csv-reader 1.0.0 exactly):
// - U+FEFF at the very start is dropped.
// - A record ends at LF or CRLF; a line left with no characters is no record.
// - Outside quotes a CR not followed by LF is dropped (stray_cr).
// - A field opening with a quote runs to the next quote that is not doubled;
//   "" inside is one quote; each CRLF or lone CR inside is read as LF; what
//   follows its closing quote, up to the next comma or line break, is appended
//   as it stands (quote_junk, when the field ends); a quote that never closes
//   is a literal character and the text after it is read again as unquoted
//   (unterminated_quote). A quote inside an unquoted field is literal.
// - Fields stay strings, never trimmed or converted.
// - columns is the first record when header is true, else null; rows holds the
//   records after it, each padded with "" (short_row, with fields: its count)
//   or cut (long_row, with extra: the cut fields) to the first record's width.
// - Each error is {code, line, row}, in the order met; line is the 1-based
//   line its record starts on, row its record's index in rows (null for the
//   header).
// Pure: no clock, no randomness, no locale, nothing kept from one call to the
// next.

const COMMA = 0;
const LINE_BREAK = 1;
const END = 2;

/** Join the kept segments of an unquoted field: prefix + text[start..end) plus any earlier parts (split only by dropped stray CRs). */
function joinField(prefix, parts, start, end, text) {
  if (parts === null) {
    if (prefix === '') return text.slice(start, end);
    return prefix + text.slice(start, end);
  }
  parts.push(text.slice(start, end));
  return prefix + parts.join('');
}

export function run(input) {
  const text = String(input.text);
  const header = input.header === true;
  const errors = [];
  const rows = [];
  let columns = null;
  let width = -1;

  const len = text.length;
  let pos = 0;
  let line = 1;
  if (len > 0 && text.charCodeAt(0) === 0xfeff) pos = 1;

  // The record being read: the line it starts on and the index in rows it takes (null: the header).
  let recordLine = 1;
  let recordRow = null;
  // How the last field read ended.
  let ended = END;

  function error(code) {
    errors.push({ code, line: recordLine, row: recordRow });
  }

  // Reads an unquoted field starting at pos, with `prefix` already in the value.
  // Returns the field value; sets `ended`.
  function readUnquoted(prefix) {
    let parts = null; // kept segments before a dropped stray CR, if any
    let start = pos;
    while (pos < len) {
      const c = text.charCodeAt(pos);
      if (c === 44) { // ,
        const end = pos;
        pos += 1;
        ended = COMMA;
        return joinField(prefix, parts, start, end, text);
      }
      if (c === 10) { // \n
        const end = pos;
        pos += 1;
        line += 1;
        ended = LINE_BREAK;
        return joinField(prefix, parts, start, end, text);
      }
      if (c === 13) { // \r
        if (text.charCodeAt(pos + 1) === 10) {
          const end = pos;
          pos += 2;
          line += 1;
          ended = LINE_BREAK;
          return joinField(prefix, parts, start, end, text);
        }
        error('stray_cr');
        if (parts === null) parts = [text.slice(start, pos)];
        else parts.push(text.slice(start, pos));
        pos += 1;
        start = pos;
        continue;
      }
      pos += 1;
    }
    ended = END;
    return joinField(prefix, parts, start, len, text);
  }

  // Reads a quoted field whose opening quote is at pos.
  // Returns the field value; sets `ended`.
  function readQuoted() {
    const open = pos;
    const openLine = line;
    pos += 1; // opening quote
    const contentStart = pos;
    let hasDoubled = false;
    let q;
    while (true) {
      q = text.indexOf('"', pos);
      if (q === -1) {
        // The quote never closes: it is a literal character, and the text
        // after it is read again as unquoted.
        pos = open + 1;
        line = openLine;
        error('unterminated_quote');
        return readUnquoted('"');
      }
      if (text.charCodeAt(q + 1) === 34) {
        hasDoubled = true;
        pos = q + 2;
        continue;
      }
      break;
    }
    // Closing quote at q; content span is [contentStart, q).
    let value;
    const nl = text.indexOf('\n', contentStart);
    const cr = text.indexOf('\r', contentStart);
    const hasBreak = (nl !== -1 && nl < q) || (cr !== -1 && cr < q);
    if (!hasDoubled && !hasBreak) {
      value = text.slice(contentStart, q);
    } else {
      const span = text.slice(contentStart, q);
      const breaks = span.match(/\r\n?|\n/g);
      if (breaks !== null) line += breaks.length;
      value = hasDoubled ? span.replace(/""/g, '"') : span;
      if (hasBreak) value = value.replace(/\r\n?/g, '\n');
    }
    pos = q + 1;
    if (pos >= len) {
      ended = END;
      return value;
    }
    const c = text.charCodeAt(pos);
    if (c === 44) { // ,
      pos += 1;
      ended = COMMA;
      return value;
    }
    if (c === 10) { // \n
      pos += 1;
      line += 1;
      ended = LINE_BREAK;
      return value;
    }
    if (c === 13 && text.charCodeAt(pos + 1) === 10) { // CRLF
      pos += 2;
      line += 1;
      ended = LINE_BREAK;
      return value;
    }
    // What follows the closing quote is appended as it stands, up to the next
    // comma or line break.
    const before = value.length;
    const junk = readUnquoted(value);
    if (junk.length - before > 0) error('quote_junk');
    return junk;
  }

  while (true) {
    // Lines with no characters are no records.
    while (pos < len) {
      const c = text.charCodeAt(pos);
      if (c === 10) {
        pos += 1;
        line += 1;
      } else if (c === 13 && text.charCodeAt(pos + 1) === 10) {
        pos += 2;
        line += 1;
      } else {
        break;
      }
    }
    if (pos >= len) break;

    recordLine = line;
    recordRow = header && columns === null ? null : rows.length;
    const fields = [];
    let quoted;
    do {
      quoted = text.charCodeAt(pos) === 34;
      fields.push(quoted ? readQuoted() : readUnquoted(''));
    } while (ended === COMMA);

    // A line that held only stray CRs is left with no characters: no record (its stray_cr errors stay).
    if (fields.length === 1 && fields[0] === '' && !quoted) continue;

    if (width < 0) width = fields.length;
    if (header && columns === null) {
      columns = fields;
      continue;
    }
    if (fields.length < width) {
      errors.push({ code: 'short_row', line: recordLine, row: recordRow, fields: fields.length });
      while (fields.length < width) fields.push('');
    } else if (fields.length > width) {
      errors.push({ code: 'long_row', line: recordLine, row: recordRow, extra: fields.splice(width) });
    }
    rows.push(fields);
  }
  return { columns: header ? (columns ?? []) : null, rows, errors };
}
