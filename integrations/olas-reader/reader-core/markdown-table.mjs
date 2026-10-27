import { Parser } from 'htmlparser2';
import { performance } from 'node:perf_hooks';
import { randomUUID } from 'node:crypto';

// CommonMark raw HTML is the lossless table representation: pipe tables cannot
// express combined spans, row headers or multiple header rows. Never project a
// guessed grid. htmlparser2 owns tokenization, entities and source offsets.
export const TABLE_LIMITS = Object.freeze({
  tables: 64, rows: 1024, cells: 8192, columns: 128, span: 64,
  slots: 32768, depth: 128, events: 100000, tableChars: 200000,
  outputChars: 400000, processingMs: 250,
});
const VOID = new Set(['area', 'base', 'basefont', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr']);
const STRUCTURE = new Set(['table', 'thead', 'tbody', 'tfoot', 'tr', 'td', 'th', 'caption', 'colgroup', 'col']);
const INLINE = new Set(['a', 'span', 'p', 'div', 'br', 'wbr', 'code', 'pre', 'em', 'strong', 'b', 'i', 's', 'del', 'sup', 'sub', 'small', 'ul', 'ol', 'li', 'blockquote', 'img']);
const GROUP = new Set(['thead', 'tbody', 'tfoot']);
// Keep each raw HTML block on one Markdown line. Character references preserve
// pre/code whitespace without blank lines ending the CommonMark HTML block.
const escape = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
  .replace(/\n/g, '&#10;').replace(/\r/g, '&#13;').replace(/\t/g, '&#9;');
// A legacy list/link wrapper can put the raw table in inline Markdown context.
// Entities keep literal source punctuation from becoming Markdown formatting.
const TEXT_ENTITIES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' };
const escapeText = s => s.replace(/[&<>"\n\r\t\\`*_{}\[\]()#+.!|~\-]/g, c => TEXT_ENTITIES[c] || `&#${c.charCodeAt(0)};`);
const omitted = reason => `[Table omitted: ${reason}; cell mappings unavailable.]`;

function spanValue(attrs, name, zero = false) {
  if (!(name in attrs)) return 1;
  if (!/^\d+$/.test(attrs[name])) throw new Error('invalid span');
  const n = Number(attrs[name]);
  if (!Number.isSafeInteger(n) || n < (zero ? 0 : 1) || n > TABLE_LIMITS.span) throw new Error('span limit or invalid span');
  return n;
}

// Validate occupied positions only; the output still carries the original spans.
// Separate row groups obey HTML's rowspan=0 and clipping rules.
function validateGroups(groups, budget) {
  for (const rows of groups) {
    const occupied = rows.map(() => new Set());
    for (let r = 0; r < rows.length; r++) {
      let col = 0;
      for (const cell of rows[r]) {
        while (occupied[r].has(col)) col++;
        const height = cell.rowspan === 0 ? rows.length - r : Math.min(cell.rowspan, rows.length - r);
        if (col + cell.colspan > TABLE_LIMITS.columns) throw new Error('column limit');
        budget.slots += height * cell.colspan;
        if (budget.slots > TABLE_LIMITS.slots) throw new Error('span expansion limit');
        for (let y = r; y < r + height; y++) {
          for (let x = col; x < col + cell.colspan; x++) {
            if (occupied[y].has(x)) throw new Error('overlapping spans');
            occupied[y].add(x);
          }
        }
        col += cell.colspan;
      }
    }
  }
}

function attributes(name, attrs, baseUrl) {
  let out = '';
  for (const key of ['id', 'title', ...(name === 'td' || name === 'th' ? ['rowspan', 'colspan', 'scope', 'headers', 'abbr'] : []), ...(name === 'col' || name === 'colgroup' ? ['span'] : [])]) {
    if (attrs[key] !== undefined) out += ` ${key}="${escape(attrs[key])}"`;
  }
  if (name === 'a' && attrs.href !== undefined) {
    // Resolve relative links against the observed final URL, including footnotes.
    const url = new URL(attrs.href, baseUrl);
    if (!['http:', 'https:', 'mailto:'].includes(url.protocol)) throw new Error('unsupported link protocol');
    out += ` href="${escape(url.href)}"`;
  }
  return out;
}

/** Preserve bounded tables while running the historical converter on other bytes.
 * Unsupported/malformed tables are explicitly omitted, never flattened. Strict
 * explicit closing tags are required; this deliberately refuses optional-tag
 * recovery rather than trusting a forgiving parser's inferred table hierarchy.
 */
export function markdownWithTables(html, convert, { baseUrl, maxChars, deadline = Infinity } = {}) {
  if (!/<\/?table[\s/>]/i.test(html)) return { markdown: convert(html), omitted: false };
  const expires = Math.min(deadline, performance.now() + TABLE_LIMITS.processingMs);
  const budget = { events: 0, rows: 0, cells: 0, slots: 0, output: 0 };
  const tables = [];
  let current, nesting = 0, depth = 0;
  function check() {
    if (performance.now() >= deadline) throw new DOMException('This operation was aborted', 'AbortError');
    if (++budget.events > TABLE_LIMITS.events || performance.now() >= expires) throw new Error('table processing limit');
    if (current && parser.endIndex - current.start > TABLE_LIMITS.tableChars) throw new Error('table size limit');
  }
  function append(s) {
    budget.output += s.length;
    if (budget.output > TABLE_LIMITS.outputChars) throw new Error('table output limit');
    current.parts.push(s);
  }
  const parser = new Parser({
    onopentag(name, attrs) {
      check();
      if (!VOID.has(name) && ++depth > TABLE_LIMITS.depth) throw new Error('HTML depth limit');
      if (name === 'table') {
        if (current) { current.reason = 'nested table'; nesting++; return; }
        if (tables.length >= TABLE_LIMITS.tables) throw new Error('table count limit');
        current = { start: parser.startIndex, parts: [], text: [], stack: [], groups: [], rows: [], columns: 0, reason: null };
        current.groups.push(current.rows);
        nesting = 1;
      }
      if (!current || nesting > 1) return;
      try {
        const parent = current.stack.at(-1);
        if (!STRUCTURE.has(name) && !INLINE.has(name)) throw new Error('unsupported table markup');
        if (GROUP.has(name) && parent !== 'table'
          || name === 'tr' && parent !== 'table' && !GROUP.has(parent)
          || ['td', 'th'].includes(name) && parent !== 'tr'
          || ['caption', 'colgroup'].includes(name) && parent !== 'table'
          || name === 'col' && parent !== 'colgroup' && parent !== 'table'
          || INLINE.has(name) && ['table', 'thead', 'tbody', 'tfoot', 'tr', 'colgroup'].includes(parent)) throw new Error('invalid table hierarchy');
        if (GROUP.has(name)) { current.rows = []; current.groups.push(current.rows); }
        if (name === 'tr') {
          if (++budget.rows > TABLE_LIMITS.rows) throw new Error('row limit');
          current.row = []; current.rows.push(current.row);
        }
        if (name === 'td' || name === 'th') {
          if (++budget.cells > TABLE_LIMITS.cells) throw new Error('cell limit');
          current.row.push({ rowspan: spanValue(attrs, 'rowspan', true), colspan: spanValue(attrs, 'colspan') });
        }
        if (name === 'colgroup') current.columnGroup = { span: spanValue(attrs, 'span'), children: false };
        if (name === 'col') {
          if (current.columnGroup) current.columnGroup.children = true;
          current.columns += spanValue(attrs, 'span');
        }
        if (current.columns > TABLE_LIMITS.columns) throw new Error('column limit');
        // Images retain their visible alternative, without new network content.
        append(name === 'img' ? escapeText(attrs.alt || '') : `<${name}${attributes(name, attrs, baseUrl)}>`);
        current.text.push(name === 'img' ? (attrs.alt || '') : ' ');
      } catch (err) { current.reason ||= err.message; }
      if (!VOID.has(name)) current.stack.push(name);
    },
    onclosetag(name, implied) {
      check();
      if (!VOID.has(name)) depth--;
      if (!current) return;
      if (name === 'table' && --nesting > 0) return;
      if (nesting > 1) return;
      if (!VOID.has(name)) {
        if (implied || current.stack.pop() !== name) current.reason ||= 'unclosed or malformed table';
        append(`</${name}>`);
        current.text.push(' ');
      }
      if (name === 'table') {
        try { validateGroups(current.groups, budget); } catch (err) { current.reason ||= err.message; }
        if (!current.groups.some(rows => rows.length)) current.reason ||= 'table has no rows';
        current.end = parser.endIndex + 1;
        tables.push(current); current = null;
      } else if (name === 'colgroup') {
        if (current.columnGroup && !current.columnGroup.children) current.columns += current.columnGroup.span;
        current.columnGroup = null;
        if (current.columns > TABLE_LIMITS.columns) current.reason ||= 'column limit';
      } else if (GROUP.has(name)) {
        current.rows = []; current.groups.push(current.rows);
      }
    },
    ontext(text) {
      check();
      if (!current || nesting > 1) return;
      if (text.trim() && ['table', 'thead', 'tbody', 'tfoot', 'tr', 'colgroup'].includes(current.stack.at(-1))) current.reason ||= 'text outside table cells';
      append(escapeText(text));
      current.text.push(text);
    },
    oncomment() { check(); },
    onattribute() { check(); },
  });
  try {
    for (let offset = 0; offset < html.length; offset += 16384) {
      check(); parser.write(html.slice(offset, offset + 16384));
    }
    parser.end();
    check();
  } catch (err) {
    if (err.name === 'AbortError') throw err;
    // A refused scan cannot reliably delimit later tables. Do not feed its tail
    // back into the old flattening converter or claim complete captured content.
    return { markdown: omitted(err.message), omitted: true };
  }
  if (!tables.length) return { markdown: convert(html), omitted: false };
  // Untrusted entity-encoded source text must not impersonate a placeholder
  // after the historical converter decodes it (including removed nav tables).
  const prefix = `TABLE${randomUUID().replaceAll('-', '')}TOKEN`;
  let protectedHtml = '', offset = 0;
  for (const [i, table] of tables.entries()) {
    protectedHtml += html.slice(offset, table.start) + `\n\n${prefix}${i}END\n\n`;
    offset = table.end;
  }
  protectedHtml += html.slice(offset);
  let didOmit = false, delta = 0;
  const ranges = [];
  // A table removed with nav/script/etc. by the reader isn't visible content.
  let markdown = convert(protectedHtml).replace(new RegExp(`${prefix}(\\d+)END`, 'g'), (token, i, offset) => {
    const table = tables[Number(i)];
    const content = table.reason ? omitted(table.reason) : table.parts.join('');
    if (!table.reason) ranges.push({ start: offset + delta, end: offset + delta + content.length, text: table.text.join('') });
    delta += content.length - token.length;
    didOmit ||= Boolean(table.reason);
    return content;
  });
  // A clipped native table can be auto-repaired into wrong mappings by a renderer.
  // Omit that whole table at the existing character ceiling instead of slicing it.
  for (const { start, end } of ranges) {
    if (start < maxChars && end > maxChars) {
      markdown = markdown.slice(0, start) + omitted('character limit');
      didOmit = true; break;
    }
  }
  const visible = markdown.slice(0, maxChars);
  let wordText = '', cursor = 0;
  for (const { start, end, text } of ranges) {
    if (end > visible.length) break;
    wordText += visible.slice(cursor, start) + ' ' + text + ' ';
    cursor = end;
  }
  wordText += visible.slice(cursor);
  if (performance.now() >= deadline) throw new DOMException('This operation was aborted', 'AbortError');
  if (performance.now() >= expires) return { markdown: omitted('table processing limit'), omitted: true };
  return { markdown, omitted: didOmit, wordCount: wordText.split(/\s+/).filter(Boolean).length };
}
