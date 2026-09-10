/**
 * Classify a file buffer as text source vs binary/unknown.
 * This cell does not parse JS/TS; binary or invalid UTF-8 ⇒ unknown.
 */

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const ELF = Buffer.from([0x7f, 0x45, 0x4c, 0x46]);
const ZIP = Buffer.from([0x50, 0x4b, 0x03, 0x04]);
const PDF = Buffer.from("%PDF-");
const GZIP = Buffer.from([0x1f, 0x8b]);
const UTF16LE = Buffer.from([0xff, 0xfe]);
const UTF16BE = Buffer.from([0xfe, 0xff]);

function startsWith(buf, magic) {
  return buf.length >= magic.length && buf.subarray(0, magic.length).equals(magic);
}

export function classifySourceBuffer(buf) {
  if (!Buffer.isBuffer(buf)) {
    return { kind: "unknown", reason: "not_buffer", parseable: false, decision: "unknown" };
  }
  if (buf.length === 0) {
    return { kind: "empty", reason: "empty", parseable: false, decision: "unknown" };
  }
  if (startsWith(buf, PNG)) {
    return { kind: "binary", reason: "png_magic", parseable: false, decision: "unknown" };
  }
  if (startsWith(buf, ELF)) {
    return { kind: "binary", reason: "elf_magic", parseable: false, decision: "unknown" };
  }
  if (startsWith(buf, ZIP) || startsWith(buf, GZIP) || startsWith(buf, PDF)) {
    return { kind: "binary", reason: "archive_or_pdf_magic", parseable: false, decision: "unknown" };
  }
  if (startsWith(buf, UTF16LE) || startsWith(buf, UTF16BE)) {
    return { kind: "binary", reason: "utf16_bom", parseable: false, decision: "unknown" };
  }
  if (buf.includes(0)) {
    return { kind: "binary", reason: "nul_byte", parseable: false, decision: "unknown" };
  }
  const text = buf.toString("utf8");
  const roundTrip = Buffer.from(text, "utf8");
  if (!roundTrip.equals(buf)) {
    return { kind: "binary", reason: "invalid_utf8", parseable: false, decision: "unknown" };
  }
  return {
    kind: "text",
    reason: "utf8_no_nul",
    parseable: "unknown",
    decision: null,
    limitation: "c14 does not parse JS/TS; text classification is encoding-only",
  };
}

export function looksLikeSourceName(name) {
  return /\.(?:js|mjs|cjs|ts|tsx|jsx|mts|cts|json)$/i.test(String(name || ""));
}
