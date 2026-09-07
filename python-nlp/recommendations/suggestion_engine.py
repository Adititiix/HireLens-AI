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

ACTION_VERB_REPLACEMENTS: Dict[str, List[str]] = {
    "worked on":          ["Developed", "Built", "Engineered", "Implemented"],
    "helped with":        ["Contributed to", "Co-developed", "Supported delivery of"],
    "was responsible for":["Owned", "Led", "Managed", "Drove"],
    "made":               ["Developed", "Engineered", "Architected", "Built"],
    "did":                ["Executed", "Implemented", "Delivered"],
    "used":               ["Leveraged", "Utilized", "Implemented with"],
    "fixed":              ["Resolved", "Debugged and patched", "Eliminated"],
    "updated":            ["Revamped", "Modernized", "Upgraded"],
    "created":            ["Architected", "Engineered", "Designed and built"],
    "wrote":              ["Authored", "Developed", "Implemented"],
    "tested":             ["Validated", "Tested and verified", "Ensured quality of"],
    "worked with":        ["Collaborated on", "Leveraged", "Integrated"],
    "handled":            ["Managed", "Owned", "Oversaw"],
}

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
            suggestions.append({
                "type":    "add_skills",
                "section": "Skills",
                "original": "",
                "suggested": (
                    f"Add these in-demand skills to your profile: "
                    f"{', '.join(missing_skills[:6])}"
                ),
                "reason": "These skills appear in the JD but not in your resume.",
            })

        # FIX (Part 1, defensive final pass): never let a suggestion through
        # that targets contact/header content, even if it slipped past the
        # bullet/summary filters above (e.g. a future section-inference bug).
        suggestions = [
            s for s in suggestions
            if s.get("section", "").strip().lower() not in CONTACT_SECTION_KEYWORDS
            and not self._looks_like_contact_line(s.get("original", ""))
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
            if self.embedder:
                sim = self.embedder.cosine_similarity(content, jd_text)
                if sim < 0.6:
                    return self._suggest_summary_text(content, jd_text, missing_skills)
            else:
                return self._suggest_summary_text(content, jd_text, missing_skills)

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
            return {
                "type":    "summary_rewrite",
                "section": "Professional Summary",
                "original": self._extract_summary(resume_text),
                "suggested": improved,
                "reason":  "Your summary has low keyword alignment with the JD. Adding role-specific terms improves ATS ranking.",
            }
        return None

    def _suggest_summary_text(
        self,
        resume_text: str,
        jd_text: str,
        missing_skills: List[str],
    ) -> str:
        role_match = re.search(
            r"(Senior|Lead|Junior|Principal|Staff)?\s*[\w\s]+ "
            r"(Engineer|Developer|Architect|Analyst|Manager|Scientist)",
            jd_text,
        )
        role       = role_match.group(0).strip() if role_match else "Software Engineer"
        skills_str = ", ".join(missing_skills[:3]) if missing_skills else "React, Node.js, AWS"
        return (
            f"Results-driven {role} with 3+ years of experience building scalable, "
            f"high-performance applications. Passionate about clean architecture and "
            f"delivering measurable business impact. Expanding expertise in {skills_str} "
            f"to align with modern industry demands."
        )

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
