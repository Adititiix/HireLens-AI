// Grounding guard for /analyze "improvements" (stored on Analysis documents).
// Analyses saved before the summary fix contain template text such as "Results-driven … with 3+ years of
// experience …", and a stale NLP process can still produce it. A suggestion that states an experience
// duration the resume itself does not contain is never served — on new analyses or when reading old ones.
// Stored documents are not modified; the filter is applied to what the API returns.

const NUM = "(?:\\d+(?:\\.\\d+)?|one|two|three|four|five|six|seven|eight|nine|ten|several|many|multiple)";
const DURATION = new RegExp(`\\b${NUM}\\s*\\+?\\s*(?:years?|yrs?)\\b`, "gi");
const squash = s => String(s || "").toLowerCase().replace(/\s+/g, " ");

/** Experience-duration phrases in `text` ("3+ years") that `resumeText` does not literally contain. */
function unsupportedDurationClaims(text, resumeText) {
  const resume = squash(resumeText);
  return (String(text || "").match(DURATION) || []).filter(m => !resume.includes(squash(m)));
}

/** Drops improvements whose suggested text makes an unsupported duration claim. */
function groundImprovements(improvements, resumeText) {
  return (improvements || []).filter(i => !unsupportedDurationClaims(i?.suggestion, resumeText).length);
}

/** Copy of an Analysis (document or plain object) with ungrounded improvements removed. */
function groundAnalysis(analysis, resumeText) {
  if (!analysis) return analysis;
  const plain = typeof analysis.toObject === "function" ? analysis.toObject() : { ...analysis };
  plain.improvements = groundImprovements(plain.improvements, resumeText);
  return plain;
}

module.exports = { unsupportedDurationClaims, groundImprovements, groundAnalysis };
