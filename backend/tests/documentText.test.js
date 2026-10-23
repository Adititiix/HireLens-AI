// Regression tests for PDF/DOCX text extraction: label/value spacing and hyperlink preservation.
const test = require("node:test");
const assert = require("node:assert/strict");
const { extractPdf, htmlToStructuredText, buildPdfLines, safeUrl } = require("../utils/documentText");

// ── Minimal PDF builder: Helvetica text at given positions + URI link annotations ──
function makePdf({ texts, links = [] }) {
  const esc = s => s.replace(/[()\\]/g, "\\$&");
  const content = texts.map(t => `BT /F1 ${t.size || 11} Tf ${t.x} ${t.y} Td (${esc(t.str)}) Tj ET`).join("\n");
  const objs = [];
  objs[1] = "<< /Type /Catalog /Pages 2 0 R >>";
  objs[2] = "<< /Type /Pages /Kids [3 0 R] /Count 1 >>";
  const annotRefs = links.map((_, i) => `${6 + i} 0 R`).join(" ");
  objs[3] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> /Annots [${annotRefs}] >>`;
  objs[4] = `<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`;
  objs[5] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>";
  links.forEach((l, i) => { objs[6 + i] = `<< /Type /Annot /Subtype /Link /Rect [${l.rect.join(" ")}] /Border [0 0 0] /A << /S /URI /URI (${esc(l.uri)}) >> >>`; });
  let out = "%PDF-1.4\n";
  const offsets = [];
  for (let i = 1; i < objs.length; i++) { offsets[i] = Buffer.byteLength(out); out += `${i} 0 obj\n${objs[i]}\nendobj\n`; }
  const xref = Buffer.byteLength(out);
  out += `xref\n0 ${objs.length}\n0000000000 65535 f \n` + offsets.slice(1).map(o => `${String(o).padStart(10, "0")} 00000 n \n`).join("");
  out += `trailer\n<< /Size ${objs.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(out, "latin1");
}

test("PDF: label and value in separate columns are separated, not glued", async () => {
  const pdf = makePdf({ texts: [
    { x: 50, y: 700, str: "Databases" },        { x: 160, y: 700, str: "PostgreSQL, MongoDB" },
    { x: 50, y: 680, str: "Methodologies" },    { x: 160, y: 680, str: "Agile, Scrum" },
    { x: 50, y: 660, str: "Software Engineer Intern" }, { x: 480, y: 660, str: "Jun 2025 - Dec 2025" },
  ] });
  const { text } = await extractPdf(pdf);
  const lines = text.split("\n").filter(Boolean);
  assert.deepEqual(lines, ["Databases\tPostgreSQL, MongoDB", "Methodologies\tAgile, Scrum", "Software Engineer Intern\tJun 2025 - Dec 2025"]);
  assert.ok(!/DatabasesPostgreSQL|MethodologiesAgile|InternJun/.test(text));
});

test("PDF: link annotations are preserved with their real URL, anchor text and line", async () => {
  // "LinkedIn" / "GitHub" are visible text; the URLs exist only in the annotations.
  const pdf = makePdf({
    texts: [{ x: 50, y: 700, str: "Jane Doe" }, { x: 50, y: 680, str: "LinkedIn" }, { x: 150, y: 680, str: "GitHub" }],
    links: [
      { rect: [48, 676, 95, 692], uri: "https://www.linkedin.com/in/jane-doe-123" },
      { rect: [148, 676, 190, 692], uri: "https://github.com/janedoe" },
      { rect: [48, 696, 100, 712], uri: "javascript:alert(1)" }, // unsafe — must be dropped
    ],
  });
  const { links } = await extractPdf(pdf);
  assert.deepEqual(links, [
    { url: "https://www.linkedin.com/in/jane-doe-123", text: "LinkedIn", line: "LinkedIn\tGitHub" },
    { url: "https://github.com/janedoe", text: "GitHub", line: "LinkedIn\tGitHub" },
  ]);
});

test("PDF line builder: word gaps become spaces, touching runs stay joined, wide gaps become a column break", () => {
  const item = (str, x, w, y = 700) => ({ str, width: w, transform: [10, 0, 0, 10, x, y] });
  const lines = buildPdfLines([
    item("Engin", 50, 25), item("eering", 75, 30),        // touching → "Engineering"
    item("Data", 50, 20, 680), item("Science", 73, 35, 680), // 3pt gap (0.3em) → space
    item("Tools", 50, 25, 660), item("Git, Linux", 120, 45, 660), // 45pt gap → column break
  ]);
  assert.deepEqual(lines.map(l => l.text), ["Engineering", "Data Science", "Tools\tGit, Linux"]);
});

test("DOCX (mammoth HTML): <a href> targets kept even when link text differs; table cells separated", () => {
  const html = [
    "<p><strong>Jane Doe</strong></p>",
    '<p><a href="mailto:jane@example.com">jane@example.com</a> | <a href="https://linkedin.com/in/jane-doe">LinkedIn</a> | <a href="javascript:void(0)">bad</a></p>',
    "<table><tr><td><p>Databases</p></td><td><p>PostgreSQL, MongoDB</p></td></tr></table>",
    "<ul><li>Built <a href=\"https://demo.example.app/?a=1&amp;b=2\">the live demo</a> for 500 users</li></ul>",
  ].join("");
  const { text, links } = htmlToStructuredText(html);
  assert.match(text, /Databases\tPostgreSQL, MongoDB/);
  assert.ok(!/DatabasesPostgreSQL/.test(text));
  assert.match(text, /• Built the live demo for 500 users/);
  assert.deepEqual(links, [
    { url: "mailto:jane@example.com", text: "jane@example.com", line: "jane@example.com | LinkedIn | bad" },
    { url: "https://linkedin.com/in/jane-doe", text: "LinkedIn", line: "jane@example.com | LinkedIn | bad" },
    { url: "https://demo.example.app/?a=1&b=2", text: "the live demo", line: "• Built the live demo for 500 users" },
  ]);
});

test("safeUrl only accepts absolute http(s)/mailto URLs and returns them unchanged", () => {
  assert.equal(safeUrl("https://github.com/a/b"), "https://github.com/a/b");
  assert.equal(safeUrl("mailto:x@y.com"), "mailto:x@y.com");
  assert.equal(safeUrl("javascript:alert(1)"), null);
  assert.equal(safeUrl("data:text/html,hi"), null);
  assert.equal(safeUrl("github.com/a"), null);
  assert.equal(safeUrl(""), null);
});
