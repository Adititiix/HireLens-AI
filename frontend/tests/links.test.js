// Regression tests for safe, clickable links in the editor and preview. Run: npm test
import test from "node:test";
import assert from "node:assert/strict";
import { safeHref, displayUrl } from "../src/utils/links.js";

test("real http(s)/mailto URLs are used unchanged", () => {
  assert.equal(safeHref("https://linkedin.com/in/jane-doe-123"), "https://linkedin.com/in/jane-doe-123");
  assert.equal(safeHref("http://example.com/a?b=1"), "http://example.com/a?b=1");
  assert.equal(safeHref("mailto:jane@example.com"), "mailto:jane@example.com");
});

test("scheme-less addresses as written on a resume become openable https links", () => {
  assert.equal(safeHref("github.com/janedoe/repo"), "https://github.com/janedoe/repo");
  assert.equal(safeHref("www.portfolio.dev"), "https://www.portfolio.dev");
  assert.equal(safeHref("jane@example.com"), "mailto:jane@example.com");
});

test("dangerous or non-URL values are never rendered as links", () => {
  for (const v of ["javascript:alert(1)", "JaVaScRiPt:alert(1)", "data:text/html,<b>x</b>", "vbscript:x", "file:///etc/passwd",
    "/relative/path", "just words", "LinkedIn", "", null, undefined, "https://exa mple.com"]) {
    assert.equal(safeHref(v), null, String(v));
  }
});

test("displayUrl strips the scheme for display only", () => {
  assert.equal(displayUrl("https://www.linkedin.com/in/jane/"), "linkedin.com/in/jane");
  assert.equal(displayUrl("mailto:jane@example.com"), "jane@example.com");
  assert.equal(displayUrl("github.com/jane"), "github.com/jane");
});
