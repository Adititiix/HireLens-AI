/**
 * Safe href for a user-entered or parsed link, or null when it must not be rendered as a link.
 * - http(s) and mailto are allowed as-is.
 * - A scheme-less web address as written on a resume ("github.com/user",
 *   "www.site.dev") gets https:// for the href only — the stored value is untouched.
 * - A bare email becomes mailto:.
 * - Anything else (javascript:, data:, relative paths, plain words) → null.
 */
const HOST_LIKE = /^(?:www\.)?[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,}(?:[/:?#]\S*)?$/i;
const EMAIL = /^[\w.+-]+@[\w-]+(?:\.[\w-]+)+$/;

export function safeHref(value) {
  const s = String(value ?? "").trim();
  if (!s || /\s/.test(s)) return null;
  if (EMAIL.test(s)) return `mailto:${s}`;
  if (/^[a-z][a-z0-9+.-]*:/i.test(s)) {
    try {
      const u = new URL(s);
      return ["http:", "https:", "mailto:"].includes(u.protocol) ? s : null;
    } catch { return null; }
  }
  return HOST_LIKE.test(s) ? `https://${s}` : null;
}

/** Text shown for a link: the URL without its scheme (or the email for mailto:). */
export function displayUrl(value) {
  return String(value ?? "").trim().replace(/^mailto:/i, "").replace(/^https?:\/\/(www\.)?/i, "").replace(/\/$/, "");
}
