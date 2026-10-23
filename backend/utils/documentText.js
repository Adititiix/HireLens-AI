/**
 * Resume document → plain text + hyperlinks.
 *
 * PDF:  pdf-parse's default page renderer concatenates text items that sit on
 *       the same line with NO separator, so a bold label followed by a value
 *       ("Databases" … "PostgreSQL") or a title followed by a right-aligned date
 *       became "DatabasesPostgreSQL" / "InternJun 2025". The renderer below uses
 *       each item's x-position: a small gap becomes a space, a wide (column-like)
 *       gap becomes a TAB, which the parser treats as a column separator.
 *       It also reads the page's Link annotations, which pdf-parse ignored, so the
 *       real URL behind visible text like "LinkedIn" / "GitHub" is kept.
 * DOCX: mammoth HTML is flattened line by line; <a href> targets are captured
 *       instead of being stripped with the other tags, and table cells are
 *       separated by TABs instead of being glued together.
 *
 * Every link is { url, text, line }: the target, its visible anchor text and the
 * (normalized) text line it appears on, so the parser can attach it to the
 * right field. Only http(s) and mailto links are kept.
 */
const pdfParse = require("pdf-parse");
const mammoth  = require("mammoth");

const SAFE_PROTOCOLS = new Set(["http:", "https:", "mailto:"]);

/** Returns the URL unchanged if it is an absolute http(s)/mailto URL, otherwise null. */
function safeUrl(raw) {
  const s = String(raw || "").trim();
  if (!s) return null;
  try { return SAFE_PROTOCOLS.has(new URL(s).protocol) ? s : null; }
  catch { return null; }
}

/** Canonical form of one extracted line — shared with the parser so links can be matched to lines. */
function normalizeLine(line) {
  return String(line || "")
    .replace(/ /g, " ")
    .replace(/[ \f\v]{2,}/g, " ")   // justified/LaTeX text often carries double spaces
    .replace(/ *\t[\t ]*/g, "\t")   // collapse runs of column separators
    .trim();
}

// Gap thresholds, as a fraction of the font height. Measured on real resumes:
// glyph runs that belong together have a gap of ~0; word gaps are ~0.25em;
// label→value and title→date gaps are ≥ ~1.7em.
const SPACE_GAP = 0.15;
const COLUMN_GAP = 1.0;

function buildPdfLines(items) {
  const lines = [];
  let cur = null, last = null;
  for (const it of items) {
    if (!it.str) continue; // zero-width positioning items carry no text
    const x = it.transform[4], y = it.transform[5];
    const h = Math.abs(it.transform[3]) || Math.abs(it.transform[0]) || 10;
    const w = it.width || 0;
    if (!cur || Math.abs(y - last.y) > Math.max(1, h * 0.3)) {
      cur = { text: it.str, items: [] };
      lines.push(cur);
    } else {
      const gap = x - (last.x + last.w);
      if (gap > h * COLUMN_GAP) cur.text = cur.text.replace(/\s+$/, "") + "\t" + it.str.replace(/^\s+/, "");
      else if (gap > h * SPACE_GAP && !/\s$/.test(cur.text) && !/^\s/.test(it.str)) cur.text += " " + it.str;
      else cur.text += it.str;
    }
    cur.items.push({ x, y, w, h, str: it.str });
    last = { x, y, w };
  }
  return lines;
}

/** Visible text + line of the text items covered by a link annotation's rectangle. */
function anchorForRect(lines, rect) {
  const [x1, x2] = [Math.min(rect[0], rect[2]), Math.max(rect[0], rect[2])];
  const [y1, y2] = [Math.min(rect[1], rect[3]), Math.max(rect[1], rect[3])];
  for (const ln of lines) {
    const hits = ln.items.filter(i => {
      const cy = i.y + i.h * 0.3; // roughly the middle of the glyphs above the baseline
      const overlap = Math.min(i.x + i.w, x2) - Math.max(i.x, x1);
      // mostly inside the rectangle — a neighbouring separator glyph that merely grazes its edge doesn't count
      return cy >= y1 - 1 && cy <= y2 + 1 && overlap > 0 && overlap >= Math.min(i.w, x2 - x1) * 0.5;
    });
    if (hits.length) return { text: hits.map(i => i.str).join(" ").replace(/\s+/g, " ").trim(), line: normalizeLine(ln.text) };
  }
  return { text: "", line: "" };
}

async function extractPdf(buffer) {
  const links = [];
  const pagerender = async (page) => {
    const tc = await page.getTextContent({ normalizeWhitespace: false, disableCombineTextItems: false });
    const lines = buildPdfLines(tc.items);
    let annotations = [];
    try { annotations = await page.getAnnotations(); } catch { /* page without annotations */ }
    for (const a of annotations) {
      if (a.subtype !== "Link") continue;
      const url = safeUrl(a.url || a.unsafeUrl); // internal (#page) links have no url
      if (!url || !a.rect) continue;
      links.push({ url, ...anchorForRect(lines, a.rect) });
    }
    return lines.map(l => l.text).join("\n");
  };
  // A small Node Buffer is often a view into a shared memory pool (byteOffset ≠ 0);
  // the bundled pdf.js reads the underlying ArrayBuffer and then gets every byte
  // offset wrong ("bad XRef entry"). A standalone Uint8Array copy avoids that.
  const d = await pdfParse(new Uint8Array(buffer), { pagerender });
  return { text: d.text, links };
}

const ENTITIES = { amp: "&", lt: "<", gt: ">", nbsp: " ", quot: '"', apos: "'", "#39": "'" };
function decodeEntities(s) {
  return String(s)
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(+d))
    .replace(/&([a-z#0-9]+);/gi, (m, n) => ENTITIES[n.toLowerCase()] ?? m);
}

// Markers wrapped around a link's index while tags are stripped, then resolved per line.
const LINK_OPEN = "\u0001", LINK_CLOSE = "\u0002";

/** Mammoth HTML → line-based text (bullets kept as "• ", table cells TAB-separated) + links. */
function htmlToStructuredText(html) {
  const links = [];
  const marked = String(html).replace(/<a\b[^>]*?\bhref\s*=\s*"([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, (m, href, inner) => {
    const url = safeUrl(decodeEntities(href));
    if (!url) return inner;
    links.push({ url, text: decodeEntities(inner.replace(/<[^>]+>/g, "")).replace(/\s+/g, " ").trim(), line: "" });
    return `${inner}${LINK_OPEN}${links.length - 1}${LINK_CLOSE}`;
  });
  const flat = marked
    // mammoth wraps each table cell's text in <p>: keep a cell on one line, and
    // separate cells with a column break so "Databases | PostgreSQL" stays two values.
    .replace(/<(td|th)\b[^>]*>([\s\S]*?)<\/\1>/gi, (m, tag, inner) =>
      inner.replace(/<\/p>\s*<p[^>]*>|<br\s*\/?>/gi, " ").replace(/<\/?p[^>]*>/gi, "") + "\t")
    .replace(/<li[^>]*>/gi, "\n• ")
    .replace(/<\/li>/gi, "")
    .replace(/<\/(p|h[1-6]|div|tr|table|ul|ol)>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "");
  const markerRe = new RegExp(`${LINK_OPEN}(\\d+)${LINK_CLOSE}`, "g");
  const lines = [];
  for (const raw of decodeEntities(flat).split("\n")) {
    const ids = [...raw.matchAll(markerRe)].map(m => +m[1]);
    const line = normalizeLine(raw.replace(markerRe, ""));
    if (!line) continue;
    ids.forEach(i => { links[i].line = line; });
    lines.push(line);
  }
  return { text: lines.join("\n"), links };
}

/** Uploaded file (multer memory storage) → { text, links }. */
async function extractDocument(file) {
  const name = String(file.originalname || "").toLowerCase();
  if (name.endsWith(".pdf") || file.mimetype === "application/pdf") {
    const { text, links } = await extractPdf(file.buffer);
    if (!text || text.trim().length < 20) throw new Error("PDF appears image-based. Use a text-based PDF.");
    return { text, links };
  }
  if (name.endsWith(".docx") || file.mimetype === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") {
    const r = await mammoth.convertToHtml({ buffer: file.buffer });
    return htmlToStructuredText(r.value);
  }
  return { text: file.buffer.toString("utf-8"), links: [] };
}

module.exports = { extractDocument, extractPdf, htmlToStructuredText, buildPdfLines, normalizeLine, safeUrl };
