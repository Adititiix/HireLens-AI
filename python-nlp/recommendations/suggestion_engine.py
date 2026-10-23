"""
SuggestionEngine — resume improvement suggestions (FIXED)

BUG FIXED: `dict | None` return type hint requires Python 3.10+.
           Changed to `Optional[dict]` for Python 3.8+ compatibility.

BUG FIXED: random metric suggestions now filter to only relevant ones
           based on detected tech context (not fully random).

BUG FIXED (contact-info leakage / hallucination — see project spec Part 1):
  1. `_extract_bullets` previously treated ANY 15-250 char line as a
     candidate bullet — including the resume header (name, email, phone,
     LinkedIn, GitHub, portfolio, etc). Added `_looks_like_contact_line()`
     and such lines are now skipped entirely so AI never rewrites contact info.
  2. `_extract_summary`'s fallback used to return `text[:200]` when no
     "Summary" heading existed — which is almost always the header block.
     It now skips past contact/header lines before taking the fallback slice.
  3. `_rewrite_bullet` used to append a random fabricated metric from
     METRICS_POOL and claim usage of an unrelated missing skill. Per spec
     ("never fabricate percentages/users/technologies — only rewrite what
     already exists"), it now only swaps the weak leading verb phrase for a
     stronger synonym and returns None (no suggestion) when there is nothing
     genuine to strengthen, instead of inventing content.
  4. `generate()` now runs a final defensive filter that drops any
     suggestion whose section or original text matches contact/header
     patterns, as a last line of defense.
"""
import re
import random
from typing import Dict, List, Optional

from matching.skill_matcher import SkillMatcher

# Keyword-only skill extraction (no model needed) for grounding the summary in the resume's own skills.
_SKILLS = SkillMatcher(embedder=None)

# Each replacement keeps the original meaning: a stronger verb must not claim more than the bullet says
# (no "Led"/"Drove"/"Oversaw" for "was responsible for", no "Architected" for "made", no "Eliminated" for "fixed").
ACTION_VERB_REPLACEMENTS: Dict[str, List[str]] = {
    "worked on":          ["Developed", "Built", "Implemented"],
    "helped with":        ["Contributed to", "Assisted with"],
    "was responsible for":["Handled", "Maintained"],
    "made":               ["Developed", "Built"],
    "did":                ["Carried out", "Completed"],
    "used":               ["Applied", "Utilized"],
    "fixed":              ["Resolved", "Corrected"],
    "updated":            ["Revised", "Upgraded"],
    "created":            ["Built", "Developed"],
    "wrote":              ["Authored", "Developed"],
    "tested":             ["Validated", "Tested and verified"],
    "worked with":        ["Collaborated with", "Worked alongside"],
    "handled":            ["Managed", "Processed"],
}

# "3+ years", "5 yrs", "two years of experience" — a duration claim is only acceptable when the resume itself states it.
_NUM_WORDS = r"(?:\d+(?:\.\d+)?|one|two|three|four|five|six|seven|eight|nine|ten|several|many|multiple)"
_DURATION_RE = re.compile(r"\b" + _NUM_WORDS + r"\s*\+?\s*(?:years?|yrs?)\b", re.IGNORECASE)


def unsupported_duration_claims(text: str, resume_text: str) -> List[str]:
    """Experience-duration phrases in `text` that the resume does not literally contain."""
    resume_low = re.sub(r"\s+", " ", (resume_text or "").lower())
    return [m.group(0) for m in _DURATION_RE.finditer(text or "")
            if re.sub(r"\s+", " ", m.group(0).lower()) not in resume_low]

WEAK_VERB_PATTERNS: List[str] = list(ACTION_VERB_REPLACEMENTS.keys())

# ── Contact / header detection (Part 1: AI must never touch these) ────────
CONTACT_SECTION_KEYWORDS = {
    "header", "contact", "contact info", "contact information",
    "name", "phone", "email", "address", "location",
    "github", "linkedin", "portfolio", "leetcode", "hackerrank",
    "codeforces", "url", "social", "social profile",
}

_EMAIL_RE = re.compile(r"[\w.\-]+@[\w.\-]+\.\w+")
_PHONE_RE = re.compile(r"(\+?\d[\d\s().\-]{7,}\d)")
_URL_RE   = re.compile(r"(https?://|www\.)", re.IGNORECASE)
_CONTACT_KEYWORD_RE = re.compile(
    r"\b(linkedin|github|portfolio|leetcode|hackerrank|codeforces)\b",
    re.IGNORECASE,
)


class SuggestionEngine:
    def __init__(self, embedder=None):
        """
        Args:
            embedder: shared Embedder instance for semantic similarity checks.
                      Optional — degrades gracefully if None.
        """
        self.embedder = embedder

    def generate(
        self,
        resume_text: str,
        jd_text: str,
        missing_skills: List[str],
    ) -> List[Dict]:
        """Generate section-level improvement suggestions from actual resume content."""
        suggestions: List[Dict] = []

        # Bullet rewrites (from real resume content)
        bullets = self._extract_bullets(resume_text)
        for bullet in bullets[:6]:
            if self._is_weak(bullet):
                suggestion = self._rewrite_bullet(bullet, missing_skills)
                if suggestion:
                    suggestions.append({
                        "type":    "bullet_rewrite",
                        "section": self._infer_section(bullet, resume_text),
                        "original": bullet.strip(),
                        "suggested": suggestion,
                        "reason":  "Added strong action verb, quantified impact, and relevant keywords.",
                    })

        # Summary suggestion (only if low semantic alignment)
        summary_sugg = self._suggest_summary(resume_text, jd_text, missing_skills)
        if summary_sugg:
            suggestions.append(summary_sugg)

        # Missing skills addition tip
        if missing_skills:
            # A job requirement is not evidence that the candidate has the skill: the tip asks, it does not assert.
            suggestions.append({
                "type":    "add_skills",
                "section": "Skills",
                "original": "",
                "suggested": (
                    f"The job asks for skills your resume doesn't mention: {', '.join(missing_skills[:6])}. "
                    "Add one only if you have actually used it."
                ),
                "skills":  list(missing_skills[:6]),
                "reason": "These skills appear in the job description but not in your resume.",
            })

        # FIX (Part 1, defensive final pass): never let a suggestion through
        # that targets contact/header content, even if it slipped past the
        # bullet/summary filters above (e.g. a future section-inference bug).
        suggestions = [
            s for s in suggestions
            if s.get("section", "").strip().lower() not in CONTACT_SECTION_KEYWORDS
            and not self._looks_like_contact_line(s.get("original", ""))
            # never suggest an experience duration the resume doesn't state ("3+ years of experience")
            and not unsupported_duration_claims(s.get("suggested", ""), resume_text)
        ]

        return suggestions[:8]

    def improve_section(
        self,
        section: str,
        content: str,
        jd_text: str,
        missing_skills: List[str],
    ) -> str:
        """Improve a specific section (single-section endpoint)."""
        if section.lower() in ["summary", "professional summary", "objective"]:
            # Insufficient verified evidence → keep the candidate's own text unchanged.
            if self.embedder:
                sim = self.embedder.cosine_similarity(content, jd_text)
                if sim < 0.6:
                    return self._suggest_summary_text(content, jd_text, missing_skills) or content
            else:
                return self._suggest_summary_text(content, jd_text, missing_skills) or content

        bullets = self._extract_bullets(content)
        rewritten = []
        for bullet in bullets:
            if self._is_weak(bullet):
                rw = self._rewrite_bullet(bullet, missing_skills)
                rewritten.append(rw if rw else bullet)
            else:
                rewritten.append(bullet)
        return "\n".join(rewritten)

    # ── Private helpers ────────────────────────────────────────

    def _extract_bullets(self, text: str) -> List[str]:
        lines = text.split("\n")
        bullets = []
        for line in lines:
            stripped = line.strip().lstrip("•-–*▪").strip()
            if 15 < len(stripped) < 250 and not self._looks_like_contact_line(stripped):
                bullets.append(stripped)
        return bullets

    def _looks_like_contact_line(self, line: str) -> bool:
        """
        FIX (Part 1): identify header/contact lines so they are NEVER
        treated as rewritable resume content (name, email, phone, address,
        LinkedIn, GitHub, portfolio, LeetCode, HackerRank, Codeforces, or
        any bare URL/social profile).
        """
        if not line:
            return False
        if _EMAIL_RE.search(line) or _URL_RE.search(line) or _CONTACT_KEYWORD_RE.search(line):
            return True
        if _PHONE_RE.search(line):
            return True
        return False

    def _is_weak(self, bullet: str) -> bool:
        lower = bullet.lower()
        for pattern in WEAK_VERB_PATTERNS:
            if lower.startswith(pattern):
                return True
        has_number = bool(re.search(r"\d", bullet))
        too_short  = len(bullet.split()) < 8
        return not has_number or too_short

    def _rewrite_bullet(self, bullet: str, missing_skills: List[str]) -> Optional[str]:
        """
        FIX (Part 1 — no hallucination): only strengthen the existing
        leading verb phrase. Never fabricate metrics, percentages, user
        counts, or technologies that are not already present in the
        original bullet. `missing_skills` is accepted for interface
        compatibility with existing call sites but is intentionally no
        longer used to invent unused-skill claims.

        Returns None when there is no genuine weak-verb phrase to replace,
        rather than manufacturing content — "only rewrite what already
        exists."
        """
        lower = bullet.lower()
        new_verb = None
        cleaned  = bullet

        for weak, strong_list in ACTION_VERB_REPLACEMENTS.items():
            if lower.startswith(weak):
                new_verb = random.choice(strong_list)
                cleaned  = bullet[len(weak):].strip()
                break

        if not new_verb:
            # Nothing genuine to strengthen — do not invent a rewrite.
            return None

        return f"{new_verb} {cleaned}"

    def _suggest_summary(
        self,
        resume_text: str,
        jd_text: str,
        missing_skills: List[str],
    ) -> Optional[Dict]:  # FIXED: was `dict | None` (Python 3.10+ only)
        low_alignment = True
        if self.embedder:
            try:
                sim = self.embedder.cosine_similarity(resume_text[:500], jd_text[:500])
                low_alignment = sim < 0.65
            except Exception:
                pass

        if low_alignment:
            improved = self._suggest_summary_text(resume_text, jd_text, missing_skills)
            if not improved:
                return None   # not enough verified evidence in the resume for a grounded summary
            return {
                "type":    "summary_rewrite",
                "section": "Professional Summary",
                "original": self._extract_summary(resume_text),
                "suggested": improved,
                "reason":  ("Your summary has low alignment with the job description. This version uses only skills and "
                            "experience already in your resume; add a job requirement only if you genuinely have it."),
            }
        return None

    def _suggest_summary_text(
        self,
        resume_text: str,
        jd_text: str,
        missing_skills: List[str],
    ) -> str:
        """
        FIX (grounded summary): built ONLY from facts in this candidate's resume text —
        the skills the existing SkillMatcher finds in it (shown as the candidate wrote
        them) and which kinds of experience sections it contains. The previous template
        invented "3+ years of experience", a role taken from the job description,
        technologies the resume lacked (default "React, Node.js, AWS" or the JD's
        missing skills) and impact claims. `jd_text` and `missing_skills` are kept for
        call-site compatibility but are never used as content: a job description is
        not evidence of what the candidate has done.

        Returns "" when the resume gives too little verified evidence for a summary.
        """
        # Contact/header lines are not evidence of skills (e.g. "github.com/…" is a profile link, not a skill).
        text = "\n".join(l for l in (resume_text or "").split("\n") if not self._looks_like_contact_line(l.strip()))
        low = text.lower()
        skills = []
        for skill in _SKILLS.extract_skills(text):
            m = re.search(r"(?<![A-Za-z0-9])" + re.escape(skill) + r"(?![A-Za-z0-9])", text, re.IGNORECASE)
            if m:   # aliases the candidate didn't literally write (e.g. "k8s" → "kubernetes") are skipped
                skills.append((m.start(), m.group(0)))
        skills = [s for _, s in sorted(skills)][:5]

        contexts = []
        if re.search(r"^\s*(academic |personal |key |technical )?projects?\b", text, re.IGNORECASE | re.MULTILINE):
            contexts.append("projects")
        has_internship = bool(re.search(r"\binterns?(hip)?s?\b", low))
        if has_internship:
            contexts.append("internship work")
        # An "Experience" heading may hold only that internship — don't present it as separate employment.
        elif re.search(r"^\s*(work |professional |relevant )?experience\b|^\s*employment\b", text, re.IGNORECASE | re.MULTILINE):
            contexts.append("work experience")

        def join(items):
            return items[0] if len(items) == 1 else ", ".join(items[:-1]) + " and " + items[-1]

        parts = []
        if contexts:
            parts.append(f"Experience includes {join(contexts)}.")
        if skills:
            parts.append(f"Skills include {join(skills)}.")
        return " ".join(parts)

    def _extract_summary(self, text: str) -> str:
        lines = text.split("\n")
        for i, line in enumerate(lines):
            if "summary" in line.lower() or "objective" in line.lower():
                return " ".join(lines[i+1:i+4]).strip()[:300]
        # FIX (Part 1): no explicit "Summary"/"Objective" heading found.
        # The old fallback returned `text[:200]`, which is almost always the
        # header/contact block (name, email, phone, links) — never fall
        # back to that. Instead, skip past contact/header lines and any
        # leading blank lines, then take the fallback slice from the first
        # substantive line so contact info can never appear as "original".
        body_lines = [
            l for l in lines
            if l.strip() and not self._looks_like_contact_line(l.strip())
        ]
        return " ".join(body_lines)[:200] if body_lines else ""

    def _infer_section(self, bullet: str, full_text: str) -> str:
        idx = full_text.lower().find(bullet.lower()[:30])
        if idx == -1:
            return "Work Experience"
        context = full_text[max(0, idx - 300):idx].lower()
        if "project" in context:
            return "Projects"
        if "experience" in context or "work" in context:
            return "Work Experience"
        return "Work Experience"
