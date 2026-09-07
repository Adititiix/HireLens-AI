"""
ScoreEngine — weighted ATS scoring with priority-aware skill gap
(v4: section-based semantic scoring)

IMPROVED (this revision — semantic scoring quality):
  The OLD semantic score compared `resume_text[:2000]` against `jd_text[:2000]`
  as two undifferentiated blobs. That comparison is diluted by header/contact
  noise (name, phone, email, GitHub, LinkedIn, education headings, empty
  whitespace) which contributes nothing to job relevance, systematically
  under-scoring strong candidates.

  This revision replaces that single whole-document comparison with:
    1. Section extraction — pull out Professional Summary / Experience /
       Projects / Skills from the resume, and Job Overview / Responsibilities
       (+ Requirements/Qualifications folded in) / Required Skills /
       Preferred Skills from the JD — while dropping header/contact/URL lines
       from BOTH documents entirely (never fed to the embedder).
    2. Section pairing — Summary↔Overview, Experience↔Responsibilities,
       Projects↔Responsibilities, Skills↔Required Skills.
    3. A weighted average of the 4 pair similarities (20/35/30/15), with
       automatic proportional weight redistribution when a section is
       missing on either side of a pair (never assigned a hard zero).
    4. Lightweight synonym/concept normalization (e.g. FastAPI → "Python
       Backend") applied to BOTH sides before embedding, so genuinely
       related concepts expressed with different words score correctly.
       This never manipulates the numeric score directly — the score still
       comes entirely from the SentenceTransformer's real cosine similarity
       computed over this concept-enriched text.

  The SentenceTransformer model (all-MiniLM-L6-v2, injected via `embedder`),
  the `compute_scores()` signature, and every key in its returned dict are
  UNCHANGED — this is purely an internal quality improvement to how
  `semantic_score` is derived. `explanation` is enriched with per-section
  alignment detail (Summary/Experience/Projects/Skills alignment, top
  contributing section, largest semantic gap) using the exact same key name,
  so app.py and everything downstream needs zero changes.
"""
import re
import sys
from typing import Dict, List, Optional, Tuple

# Priority taxonomy lives with SkillMatcher (its logical owner). Imported here
# so there is a single source of truth — no duplicate taxonomy / classifier.
# matching.skill_matcher does NOT import scoring, so this is not circular.
from matching.skill_matcher import (  # noqa: F401  (re-exported for back-compat)
    HIGH_PRIORITY_SKILLS,
    MEDIUM_PRIORITY_SKILLS,
    LOW_PRIORITY_SKILLS,
    classify_skill_priority,
)

GREEN = "\033[92m"; YELLOW = "\033[93m"; CYAN = "\033[96m"; BOLD = "\033[1m"; RESET = "\033[0m"


# ── Section heading patterns (whole-line match, case-insensitive) ─────────
_RESUME_HEADINGS = {
    "summary":     r"^(professional\s+summary|summary|career\s+summary|objective|profile|about\s+me)\s*:?\s*$",
    "experience":  r"^(professional\s+experience|work\s+experience|experience|employment(\s+history)?|career\s+history)\s*:?\s*$",
    "projects":    r"^(projects|personal\s+projects|academic\s+projects|key\s+projects|selected\s+projects)\s*:?\s*$",
    "skills":      r"^(technical\s+skills|skills|core\s+competencies|competencies|skill\s+set)\s*:?\s*$",
    # Recognized-but-dropped buckets — prevents their content bleeding into summary/experience/projects/skills
    "_ignore":     r"^(education|academic\s+background|certifications?|licenses?|credentials|achievements?|awards?|honors?|additional\s+information|interests|languages|references|volunteer(ing)?)\s*:?\s*$",
}

_JD_HEADINGS = {
    "overview":          r"^(job\s+overview|overview|about\s+the\s+role|about\s+this\s+role|role\s+overview|position\s+summary|the\s+role)\s*:?\s*$",
    "responsibilities":  r"^(responsibilities|key\s+responsibilities|duties|what\s+you.?ll\s+do|your\s+role|role\s+responsibilities)\s*:?\s*$",
    # "Requirements" and "Qualifications" folded into required_skills — they describe the same
    # "what's required" concept the spec pairs against Resume Skills.
    "required_skills":   r"^(required\s+skills|requirements|qualifications|required\s+qualifications|minimum\s+qualifications|must\s+have)\s*:?\s*$",
    "preferred_skills":  r"^(preferred\s+skills|preferred\s+qualifications|nice\s+to\s+have|bonus\s+skills|good\s+to\s+have)\s*:?\s*$",
    "_ignore":           r"^(benefits|perks|about\s+(the\s+)?company|equal\s+opportunity|compensation|salary|how\s+to\s+apply)\s*:?\s*$",
}

# ── Header/contact detection — dropped from BOTH resume and JD text ───────
_EMAIL_RE   = re.compile(r"[\w.\-]+@[\w.\-]+\.\w+")
_PHONE_RE   = re.compile(r"(\+?\d[\d\s().\-]{7,}\d)")
_URL_RE     = re.compile(r"(https?://|www\.)", re.IGNORECASE)
_CONTACT_KEYWORD_RE = re.compile(
    r"\b(linkedin|github|portfolio|leetcode|hackerrank|codeforces)\b", re.IGNORECASE
)
# Heuristic for an unrecognized heading-like line (short, no sentence punctuation, capitalized) —
# used so unlisted sections (e.g. "Company Culture", "EEO Statement") don't leak into a real bucket.
_GENERIC_HEADING_RE = re.compile(r"^[A-Z][A-Za-z0-9 &/\-]{2,44}:?$")

# ── Synonym / concept normalization (semantic interpretation only — never used to set a score) ──
SYNONYM_MAP: Dict[str, str] = {
    "express":       "Node.js",
    "express.js":    "Node.js",
    "fastapi":       "Python Backend",
    "flask":         "Python Backend",
    "tensorflow":    "Deep Learning",
    "pytorch":       "Deep Learning",
    "hugging face":  "NLP",
    "huggingface":   "NLP",
    "transformers":  "NLP",
    "llms":          "Generative AI",
    "llm":           "Generative AI",
    "openai api":    "Generative AI",
    "openai":        "Generative AI",
    "rest api":      "Backend Development",
    "restful api":   "Backend Development",
    "jwt":           "Authentication",
    "oauth":         "Authentication",
    "postgresql":    "SQL",
    "mongodb":       "NoSQL",
}

# Expanded vocabulary — used ONLY to name specific overlapping terms in the human-readable
# explanation (e.g. "Your Projects section highlights FastAPI, PyTorch, LangChain"). Never used
# to compute or bias the numeric similarity score itself.
_SEMANTIC_VOCAB: List[str] = [
    "numpy", "pandas", "scikit-learn", "fastapi", "flask", "tailwind css", "tailwindcss",
    "express.js", "express", "next.js", "docker", "kubernetes", "redis", "rabbitmq",
    "langchain", "openai api", "openai", "hugging face", "tensorflow", "pytorch",
    "postgresql", "firebase", "azure", "aws", "gcp", "oauth", "jwt", "ci/cd",
    "python", "javascript", "typescript", "react", "node.js", "mongodb", "graphql",
    "machine learning", "deep learning", "nlp", "sentence transformers", "semantic matching",
]

# ── Skill priority taxonomy ──────────────────────────────────────────────
# HIGH_PRIORITY_SKILLS / MEDIUM_PRIORITY_SKILLS / LOW_PRIORITY_SKILLS and
# classify_skill_priority() are imported from matching.skill_matcher (see the
# import block at the top of this file). The taxonomy lives with SkillMatcher
# because priority is a property of the JD skill itself; ScoreEngine only
# *consumes* the resulting priority_map produced by match_skills().


_SEMANTIC_SECTION_WEIGHTS: Dict[str, float] = {
    "summary": 0.20, "experience": 0.35, "projects": 0.30, "skills": 0.15,
}

def calculate_weighted_skill_score(
    jd_skills,
    matched_skills,
    partial_skills,
    priority_map
):
    """
    Calculate skill match using priority weighting.

    High   = 3 points
    Medium = 2 points
    Low    = 1 point

    Exact match = 100%
    Partial     = 50%
    Missing     = 0%
    """

    priority_weights = {
        "high": 3,
        "medium": 2,
        "low": 1
    }

    matched_skills = set(
        s.lower().strip() for s in matched_skills
    )

    partial_skills = set(
        s.lower().strip() for s in partial_skills
    )

    # Normalize priority_map
    high = set(
        s.lower().strip()
        for s in priority_map.get("high", [])
    )

    medium = set(
        s.lower().strip()
        for s in priority_map.get("medium", [])
    )

    low = set(
        s.lower().strip()
        for s in priority_map.get("low", [])
    )

    total_weight = 0
    earned_weight = 0
    skill_priorities = []

    for skill in jd_skills:

        skill_clean = skill.lower().strip()

        # Determine priority
        if skill_clean in high:
            priority = "high"
        elif skill_clean in medium:
            priority = "medium"
        elif skill_clean in low:
            priority = "low"
        else:
            priority = "medium"

        weight = priority_weights[priority]

        total_weight += weight

        # Calculate earned score
        if skill_clean in matched_skills:
            earned_weight += weight
            status = "matched"

        elif skill_clean in partial_skills:
            earned_weight += weight * 0.5
            status = "partial"

        else:
            status = "missing"

        skill_priorities.append({
            "skill": skill_clean,
            "priority": priority,
            "weight": weight,
            "status": status
        })

    if total_weight == 0:
        return 0, skill_priorities

    score = (earned_weight / total_weight) * 100

    return round(score), skill_priorities
class ScoreEngine:
    WEIGHTS = {"skill_match": 0.40, "semantic": 0.35, "project_relevance": 0.15, "ats_format": 0.10}

    def __init__(self, embedder=None):
        self.embedder = embedder

    # ══════════════════════════════════════════════════════════════════
    # Public API — UNCHANGED signature and return-dict keys
    # ══════════════════════════════════════════════════════════════════

    def compute_scores(self, match_result: Dict, resume_text: str, jd_text: str) -> Dict:
        matched = match_result.get("matched_skills", [])
        partial = match_result.get("partial_skills", [])
        priority = match_result.get(
        "priority_map",
        {"high": [], "medium": [], "low": []})

        skill_score, skill_priorities = calculate_weighted_skill_score(
            match_result.get("jd_skills", []),
            matched,
            partial,
            priority
        )

        skill_ratio = skill_score / 100

        semantic_score, semantic_breakdown = self._compute_semantic_score(resume_text, jd_text, skill_ratio)

        project_score = self._project_relevance(resume_text, matched)
        ats_format_score = self._ats_format_score(resume_text)
        composite = (
            skill_ratio * self.WEIGHTS["skill_match"] +
            semantic_score * self.WEIGHTS["semantic"] +
            project_score * self.WEIGHTS["project_relevance"] +
            ats_format_score * self.WEIGHTS["ats_format"]
        )

        match_score = round(composite * 100)
        ats_score = round(ats_format_score * 100)
        kw_score = round(skill_ratio * 100)
        sem_pct = round(semantic_score * 100)
        fmt_score = round(ats_format_score * 100)

        explanation = self._generate_explanation(
            match_score, matched, match_result.get("missing_skills", []), partial, priority,
            semantic_breakdown,
        )
        self._print_ats_debug(match_score, ats_score, kw_score, sem_pct, fmt_score, semantic_breakdown)

        return {
            "match_score": match_score, "ats_score": ats_score, "keyword_score": kw_score,
            "semantic_score": sem_pct, "formatting_score": fmt_score, "explanation": explanation,
            # Additive only — app.py does not currently read this key, so the HTTP response shape
            # is unaffected either way; kept for future use / debugging.
            "semantic_breakdown": semantic_breakdown,
            # Additive only — per-JD-skill priority + match status, e.g.
            #   [{"skill": "python", "priority": "high", "weight": 3, "status": "matched"}, ...]
            "skill_priorities": skill_priorities,
        }

    # ══════════════════════════════════════════════════════════════════
    # NEW: section-based semantic scoring
    # ══════════════════════════════════════════════════════════════════

    def _compute_semantic_score(self, resume_text: str, jd_text: str, fallback_ratio: float) -> Tuple[float, Dict]:
        """
        Returns (semantic_score in [0,1], breakdown dict for explanation/debug).
        Falls back to `fallback_ratio` (the skill_ratio) if no embedder is
        injected or if anything goes wrong — identical resilience to the
        previous implementation's try/except-around-cosine_similarity.
        """
        if not self.embedder:
            return fallback_ratio, {}

        try:
            resume_sections = self._extract_resume_sections(resume_text)
            jd_sections = self._extract_jd_sections(jd_text)

            # Section pairing per spec:
            #   Resume Summary    ↔ JD Overview
            #   Resume Experience ↔ JD Responsibilities
            #   Resume Projects   ↔ JD Responsibilities
            #   Resume Skills     ↔ JD Required Skills
            pairs = {
                "summary":    (resume_sections["summary"],    jd_sections["overview"]),
                "experience": (resume_sections["experience"], jd_sections["responsibilities"]),
                "projects":   (resume_sections["projects"],   jd_sections["responsibilities"]),
                "skills":     (resume_sections["skills"],     jd_sections["required_skills"]),
            }

            pair_scores: Dict[str, Optional[float]] = {}
            for key, (r_text, j_text) in pairs.items():
                if not r_text.strip() or not j_text.strip():
                    pair_scores[key] = None  # FALLBACK: missing section — excluded, weight redistributed
                    continue
                r_enriched = self._normalize_semantic_text(r_text)
                j_enriched = self._normalize_semantic_text(j_text)
                sim = self.embedder.cosine_similarity(r_enriched[:2000], j_enriched[:2000])
                pair_scores[key] = float(sim)

            final_score, used_weights = self._weighted_average(pair_scores, _SEMANTIC_SECTION_WEIGHTS)

            # If literally nothing could be extracted/compared (e.g. totally unstructured input on
            # both sides), fall back to a single whole-document comparison (minus header/contact
            # noise) rather than returning 0 — never worse than the previous behavior.
            if not used_weights:
                r_clean = self._strip_header_lines(resume_text)
                j_clean = self._strip_header_lines(jd_text)
                if r_clean.strip() and j_clean.strip():
                    final_score = self.embedder.cosine_similarity(
                        self._normalize_semantic_text(r_clean)[:2000],
                        self._normalize_semantic_text(j_clean)[:2000],
                    )
                else:
                    final_score = fallback_ratio

            breakdown = {
                "pair_scores": pair_scores,
                "resume_sections_found": {k: bool(v.strip()) for k, v in resume_sections.items()},
                "jd_sections_found": {k: bool(v.strip()) for k, v in jd_sections.items()},
                "resume_sections": resume_sections,
            }
            return float(final_score), breakdown

        except Exception:
            return fallback_ratio, {}

    def _weighted_average(
        self, pair_scores: Dict[str, Optional[float]], base_weights: Dict[str, float]
    ) -> Tuple[float, Dict[str, float]]:
        """
        FALLBACK (spec): redistribute weights proportionally instead of
        assigning zero when a section/pair is unavailable.
        """
        available = {k: v for k, v in pair_scores.items() if v is not None}
        if not available:
            return 0.0, {}
        total_weight = sum(base_weights[k] for k in available)
        if total_weight <= 0:
            return 0.0, {}
        normalized_weights = {k: base_weights[k] / total_weight for k in available}
        final = sum(available[k] * normalized_weights[k] for k in available)
        return final, normalized_weights

    # ── Section extraction ────────────────────────────────────────────

    def _is_header_or_contact_line(self, line: str) -> bool:
        """Ignore: Header, Name, Email, Phone, Github, LinkedIn, Portfolio, Leetcode, URLs."""
        if not line:
            return False
        if _EMAIL_RE.search(line) or _URL_RE.search(line) or _CONTACT_KEYWORD_RE.search(line):
            return True
        if _PHONE_RE.search(line):
            return True
        return False

    def _strip_header_lines(self, text: str) -> str:
        lines = [l for l in text.split("\n") if not self._is_header_or_contact_line(l.strip())]
        return "\n".join(lines)

    def _extract_resume_sections(self, resume_text: str) -> Dict[str, str]:
        buckets = {"summary": [], "experience": [], "projects": [], "skills": []}
        current = None
        # First substantive (non-contact) line onward is eligible; nothing before any heading
        # is assigned anywhere, matching "ignore header/name" — a resume's opening name/contact
        # block naturally precedes the first recognized heading.
        for raw_line in resume_text.split("\n"):
            line = raw_line.strip()
            if not line or self._is_header_or_contact_line(line):
                continue

            matched_heading = None
            for key, pattern in _RESUME_HEADINGS.items():
                if re.match(pattern, line, re.IGNORECASE):
                    matched_heading = key
                    break
            if matched_heading:
                current = None if matched_heading == "_ignore" else matched_heading
                continue
            if current is None and _GENERIC_HEADING_RE.match(line) and len(line.split()) <= 6:
                # Unrecognized heading-like line — drop into the ignored state so its content
                # doesn't bleed into whatever bucket was open before it.
                continue

            if current:
                buckets[current].append(line)

        return {k: "\n".join(v) for k, v in buckets.items()}

    def _extract_jd_sections(self, jd_text: str) -> Dict[str, str]:
        buckets = {"overview": [], "responsibilities": [], "required_skills": [], "preferred_skills": []}
        current = "overview"  # JDs typically open with an intro/overview paragraph before any heading
        seen_any_heading = False

        for raw_line in jd_text.split("\n"):
            line = raw_line.strip()
            if not line or self._is_header_or_contact_line(line):
                continue

            matched_heading = None
            for key, pattern in _JD_HEADINGS.items():
                if re.match(pattern, line, re.IGNORECASE):
                    matched_heading = key
                    break
            if matched_heading:
                seen_any_heading = True
                current = None if matched_heading == "_ignore" else matched_heading
                continue

            # Unrecognized heading-like line: only treat it as a bucket-reset while still in the
            # pre-heading preamble (nothing real matched yet). Once a real heading has opened a
            # bucket (e.g. "Required Skills"), short title-case lines are almost always skill-list
            # items ("Machine Learning", "NLP", "Python") — NEVER reset an already-open real bucket,
            # otherwise legitimate content gets silently dropped (caught by explicit test).
            if not seen_any_heading and _GENERIC_HEADING_RE.match(line) and len(line.split()) <= 6:
                continue

            if current:
                buckets[current].append(line)

        return {k: "\n".join(v) for k, v in buckets.items()}

    # ── Synonym / concept normalization ───────────────────────────────

    def _normalize_semantic_text(self, text: str) -> str:
        """
        Appends related-concept phrases when a synonym key term is present,
        so genuinely equivalent concepts expressed with different wording
        align correctly in the embedding space. Never touches or removes
        original content, never assigns a score directly — the returned
        text is still scored purely by the embedder's real cosine similarity.
        """
        lower = text.lower()
        additions: List[str] = []
        for term, concept in SYNONYM_MAP.items():
            if re.search(r"\b" + re.escape(term) + r"\b", lower) and concept not in additions:
                additions.append(concept)
        if not additions:
            return text
        return text + "\n" + " ".join(additions)

    def _find_vocab_terms(self, text: str, limit: int = 3) -> List[str]:
        lower = text.lower()
        found = []
        for term in _SEMANTIC_VOCAB:
            if re.search(r"\b" + re.escape(term) + r"\b", lower):
                found.append(term)
            if len(found) >= limit:
                break
        return found

    # ══════════════════════════════════════════════════════════════════
    # Existing methods — UNCHANGED
    # ══════════════════════════════════════════════════════════════════

    def _generate_explanation(self, score, matched, missing, partial, priority, semantic_breakdown=None):
        strong = matched[:4]
        high_missing = [s for s in missing if s in priority.get("high", [])]
        parts = [f"Your ATS score is {score}%."]
        if strong:
            parts.append(f"Strong areas: {', '.join(s.title() for s in strong[:4])}.")
        if high_missing:
            sl = ", ".join(s.title() for s in high_missing[:5])
            tot = len(matched) + len(missing) + len(partial)
            pct = round(len(high_missing) / max(tot, 1) * 100)
            n = {1: "One", 2: "Two", 3: "Three", 4: "Four", 5: "Five"}.get(min(len(high_missing), 5), str(len(high_missing)))
            noun = "skill" if len(high_missing) == 1 else "skills"
            parts.append(f"Major gaps: {sl}.")
            parts.append(f"{'This' if len(high_missing) == 1 else 'These'} {n.lower()} high-priority {noun} account for approximately {pct}% of the job requirements.")
        elif [s for s in missing if s in priority.get("medium", [])]:
            ml = ", ".join(s.title() for s in missing if s in priority.get("medium", []))[:3]
            parts.append(f"Medium-priority gaps to address: {ml}.")

        # NEW: per-section semantic alignment narrative (Summary/Experience/Projects/Skills
        # Alignment, top contributing section, largest semantic gap) — additive only.
        semantic_sentence = self._describe_semantic_breakdown(semantic_breakdown)
        if semantic_sentence:
            parts.append(semantic_sentence)

        parts.append("You are a strong candidate." if score >= 80 else
                     "Addressing the gaps above will significantly improve your fit." if score >= 60 else
                     "Consider gaining experience in the high-priority areas before applying.")
        return " ".join(parts)

    def _describe_semantic_breakdown(self, breakdown: Optional[Dict]) -> str:
        if not breakdown:
            return ""
        pair_scores = breakdown.get("pair_scores") or {}
        available = {k: v for k, v in pair_scores.items() if v is not None}
        if not available:
            return ""

        LABELS = {"summary": "Summary", "experience": "Experience", "projects": "Projects", "skills": "Skills"}
        pcts = {k: round(v * 100) for k, v in available.items()}

        alignment_str = ", ".join(f"{LABELS[k]} Alignment {pcts[k]}%" for k in ["summary", "experience", "projects", "skills"] if k in pcts)

        top_key = max(available, key=lambda k: available[k])
        gap_key = min(available, key=lambda k: available[k])

        sentence = f"Semantic breakdown — {alignment_str}."

        resume_sections = breakdown.get("resume_sections") or {}
        top_terms = self._find_vocab_terms(resume_sections.get(top_key, ""))
        if top_terms:
            sentence += f" Your {LABELS[top_key]} section ({pcts[top_key]}% aligned) is the top contributing section, highlighting {', '.join(t.title() for t in top_terms)}."
        else:
            sentence += f" Your {LABELS[top_key]} section ({pcts[top_key]}% aligned) is the top contributing section."

        if len(available) > 1 and pcts[gap_key] < 50:
            sentence += f" The largest semantic gap is in {LABELS[gap_key]} ({pcts[gap_key]}% aligned) relative to the job description."

        return sentence

    def _project_relevance(self, resume_text, matched_skills):
        tl = resume_text.lower()
        block = next((tl[tl.find(k):tl.find(k)+1500] for k in ["project", "experience", "work"] if k in tl), "")
        if not block or not matched_skills: return 0.5
        return min(sum(1 for s in matched_skills if s.lower() in block) / max(len(matched_skills), 1), 1.0)

    def _ats_format_score(self, resume_text):
        score = 0.0; tl = resume_text.lower()
        sections = ["experience", "education", "skills", "summary", "objective", "certification", "project"]
        score += min(sum(1 for s in sections if s in tl) / 5, 1.0) * 0.35
        verbs = ["developed", "built", "designed", "implemented", "led", "managed", "created", "improved",
                 "optimized", "architected", "delivered", "launched", "reduced", "increased", "automated", "deployed"]
        score += min(sum(1 for v in verbs if v in tl) / 5, 1.0) * 0.30
        if re.search(r"\d+\s*(%|percent|x|times|users|customers|ms|k\+)", tl): score += 0.20
        if re.search(r"[\w.\-]+@[\w.\-]+\.\w+", resume_text): score += 0.15
        return min(score, 1.0)

    def _print_ats_debug(self, match_score, ats_score, kw, sem, fmt, semantic_breakdown=None):
        sep = f"{CYAN}{'─'*60}{RESET}"
        print(f"\n{sep}\n{BOLD}{CYAN}  📊 ATS Score Breakdown{RESET}\n{sep}")
        print(f"  {BOLD}ATS Score:        {GREEN}{ats_score}{RESET}")
        print(f"  {BOLD}Skill Match:      {GREEN}{kw}{RESET}")
        print(f"  {BOLD}Semantic Match:   {GREEN}{sem}{RESET}")
        if semantic_breakdown and semantic_breakdown.get("pair_scores"):
            print(f"  {BOLD}{YELLOW}  ↳ Section breakdown:{RESET}")
            for key, val in semantic_breakdown["pair_scores"].items():
                shown = f"{round(val*100)}%" if val is not None else "n/a (weight redistributed)"
                print(f"      {key.capitalize():<12} {shown}")
        print(f"  {BOLD}Formatting Score: {GREEN}{fmt}{RESET}")
        print(f"  {BOLD}Overall Score:    {GREEN}{match_score}{RESET}")
        print(sep + "\n"); sys.stdout.flush()
