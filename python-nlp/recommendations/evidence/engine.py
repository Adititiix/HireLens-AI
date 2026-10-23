"""
EvidenceSuggestionEngine — evidence-grounded resume suggestions.

This is a RULE-BASED, retrieval-enhanced engine, not a generative model:
detectors.py finds issues with deterministic rules, retriever.py finds supporting
evidence (hybrid keyword + all-MiniLM-L6-v2 similarity), and every rewrite is a
template over the candidate's own words that validator.py re-checks before it is
returned. When the facts needed for a better bullet are not in the resume, the
engine asks a question instead of writing one.

Pipeline:  resume (+ optional JD / analysis)
  → segmenter (addressable units) → existing SkillMatcher (skills, skill gap)
  → detectors → EvidenceIndex (per request) → evidence attachment
  → validation → confidence → dedupe / conflict resolution → response
"""
import hashlib
import logging
import re
from typing import Dict, List, Optional

from .detectors import (SEVERITY_RANK, Context, Issue, detect_repeated_phrases, detect_repeated_verbs,
                        detect_unit_issues, end_sentence, strip_end)
from .guidelines import BY_CATEGORY, GUIDELINES
from .models import SuggestRequest
from .retriever import Chunk, EvidenceIndex
from .segmenter import Unit, segment_structured, segment_text
from .validator import confidence, numbers, validate_rewrite

logger = logging.getLogger("resumeiq.suggestions")

SECTION_TITLES = {"experience": "Experience", "projects": "Projects", "summary": "Summary", "skills": "Skills",
                  "achievements": "Achievements", "general": "General", "text": "Resume"}
SECTION_ORDER = {"experience": 0, "projects": 1, "summary": 2, "skills": 3, "general": 4}
# Which rewrite wins when several detectors rewrite the same line (lower = preferred).
REWRITE_PRIORITY = {"responsibility_not_contribution": 0, "weak_opener": 1, "metric_available": 2,
                    "tech_list_only": 3, "first_person": 4, "too_long": 5, "filler": 6,
                    "missing_technical_context": 7, "repeated_verb": 8}
MAX_PER_LINE = 2
_GENERIC_NAME_WORDS = {"the", "a", "an", "app", "application", "project", "system", "platform", "website", "tool"}


def _norm(s: str) -> str:
    return re.sub(r"\W+", " ", (s or "").lower()).strip()


def _sid(*parts: str) -> str:
    return hashlib.sha1("|".join(parts).encode("utf-8")).hexdigest()[:12]


_YEAR = re.compile(r"^(19|20)\d{2}$")


def metric_numbers(text: str) -> List[str]:
    """Numbers that express a result. Excluded: bare years ("2026") and numbers that are part of a
    name or version — i.e. directly after a capitalised word ("Ultron 8.0", "React 18", "Top 10")."""
    out = []
    for m in re.finditer(r"(?<![\w.])(\d+(?:[.,]\d+)*%?)", text or ""):
        n = m.group(1)
        before = re.search(r"([A-Za-z][\w\-]*)\W*$", text[:m.start()])
        if _YEAR.match(n) or (before and before.group(1)[0].isupper() and not n.endswith("%")):
            continue
        out.append(n)
    return out


def _clause_with_number(text: str) -> Optional[str]:
    """The shortest clause of `text` that carries a result metric — used to quote a verified result."""
    clauses = [c.strip() for c in re.split(r"(?<!\d)[.;](?!\d)\s*|\s+[—–]\s+|:\s+|,\s+(?=[a-z]+ing\b|[a-z]+ed\b)", text)
               if c and c.strip()]
    numeric = [c for c in clauses if metric_numbers(c) and 3 <= len(c.split()) <= 25]
    return min(numeric, key=len) if numeric else None


def _lower_first(s: str) -> str:
    """Lower-case the first letter unless the first word is an acronym ("IEEE", "AWS")."""
    return s if len(s) > 1 and s[1].isupper() else s[:1].lower() + s[1:]


class EvidenceSuggestionEngine:
    def __init__(self, embedder=None, skill_matcher=None, ats_analyzer=None):
        self.embedder = embedder              # shared all-MiniLM-L6-v2 instance from app.py (never reloaded)
        self.skill_matcher = skill_matcher    # existing SkillMatcher — skill extraction + gap
        self.ats_analyzer = ats_analyzer      # existing ATSAnalyzer — section checks for plain-text resumes

    # ── helpers ────────────────────────────────────────────────────────────
    def _skill_fn(self):
        cache: Dict[str, List[str]] = {}

        def skill_terms(text: str) -> List[str]:
            if self.skill_matcher is None or not text:
                return []
            if text not in cache:
                cache[text] = self.skill_matcher.extract_skills(text)
            return cache[text]
        return skill_terms

    @staticmethod
    def _label(u: Unit) -> str:
        sec = SECTION_TITLES.get(u.section, u.section.title())
        return f"{sec} › {u.entry_label}" if u.entry_label and u.section not in ("summary", "skills") else sec

    def _skill_gap(self, req: SuggestRequest, resume_text: str, skill_terms) -> dict:
        if req.analysis and (req.analysis.missing_skills or req.analysis.matched_skills):
            a = req.analysis
            high = a.high_missing or []
            return {"missing": a.missing_skills, "matched": a.matched_skills, "high": high,
                    "ordered": [*high, *a.medium_missing, *[s for s in a.missing_skills if s not in high and s not in a.medium_missing]]}
        jd = req.job_description.strip()
        if not jd or self.skill_matcher is None:
            return {"missing": [], "matched": [], "high": [], "ordered": []}
        mr = self.skill_matcher.match_skills(skill_terms(resume_text), skill_terms(jd), jd)  # existing matcher, unchanged
        return {"missing": mr["missing_skills"], "matched": mr["matched_skills"], "high": mr["high_missing"],
                "ordered": [*mr["high_missing"], *mr["medium_missing"], *mr["low_missing"]]}

    # ── main entry ─────────────────────────────────────────────────────────
    def suggest(self, req: SuggestRequest) -> dict:
        structured = req.resume is not None and bool(segment_structured(req.resume))
        units = segment_structured(req.resume) if structured else segment_text(req.resume_text)
        resume_text = req.resume_text or "\n".join(u.text for u in units)
        jd = req.job_description.strip()
        skill_terms = self._skill_fn()
        gap = self._skill_gap(req, resume_text, skill_terms)

        ctx = Context(skill_terms=skill_terms)
        for u in units:
            if u.meta.get("technologies"):
                ctx.entry_technologies[u.entry_key] = u.meta["technologies"]
            if u.field in ("bullets", "description", "text") and re.search(r"\d", u.text) and u.entry_key:
                ctx.entries_with_metrics.add(u.entry_key)
        if not structured:
            ctx.entries_with_metrics.clear()  # plain text has no reliable entry boundaries

        index = EvidenceIndex(self.embedder).build(self._chunks(units, jd, gap))

        issues: List[Issue] = []
        for u in units:
            issues.extend(detect_unit_issues(u, ctx))
        issues.extend(detect_repeated_verbs(units))
        issues.extend(detect_repeated_phrases(units, skill_terms))
        issues.extend(self._resume_level_issues(req, units, structured, resume_text, gap, skill_terms))
        # Not every bullet without a number is a problem: ask about outcomes at most once per entry.
        asked, kept = set(), []
        for i in issues:
            if i.category == "missing_outcome":
                if i.unit.entry_key in asked:
                    continue
                asked.add(i.unit.entry_key)
            kept.append(i)
        issues = kept

        suggestions = []
        for issue in issues:
            s = self._build(issue, units, index, structured, jd, skill_terms)
            if s:
                suggestions.append(s)
        suggestions = self._resolve(suggestions, units)
        suggestions.sort(key=lambda s: (SEVERITY_RANK[s["severity"]], SECTION_ORDER.get(s["_section_key"], 9),
                                        not s["applicable"], s["_order"]))
        suggestions = suggestions[: req.max_suggestions]
        for s in suggestions:
            s.pop("_section_key", None); s.pop("_order", None); s.pop("_uid", None)

        logger.info("resume-suggestions: %d units, %d issues → %d suggestions (jd=%s)",
                    len(units), len(issues), len(suggestions), bool(jd))   # counts only — never resume text
        by_cat, by_sev = {}, {}
        for s in suggestions:
            by_cat[s["category"]] = by_cat.get(s["category"], 0) + 1
            by_sev[s["severity"]] = by_sev.get(s["severity"], 0) + 1
        return {
            "suggestions": suggestions,
            "summary": {"total": len(suggestions), "by_category": by_cat, "by_severity": by_sev,
                        "job_description_used": bool(jd), "structured_resume": structured},
            "engine": {"type": "rule-based detection + evidence retrieval", "generative_model": False,
                       "embedding_model": "all-MiniLM-L6-v2" if self.embedder is not None else None},
        }

    # ── retrieval corpus ───────────────────────────────────────────────────
    def _chunks(self, units: List[Unit], jd: str, gap: dict) -> List[Chunk]:
        chunks = [Chunk(id=u.uid, text=u.text, source="resume", label=self._label(u), entry_key=u.entry_key, verified=True)
                  for u in units]
        for i, line in enumerate(l.strip(" •-–*\t") for l in re.split(r"\n|(?<=[.!?])\s+(?=[A-Z])", jd)):
            if len(line.split()) >= 3:
                chunks.append(Chunk(id=f"jd:{i}", text=line[:500], source="job_description", label="Job description"))
        if gap["missing"]:
            chunks.append(Chunk(id="analysis:missing", text="Skills required by the job but not found in the resume: "
                                + ", ".join(gap["missing"]), source="analysis", label="Skill-gap analysis", verified=True))
        if gap["matched"]:
            chunks.append(Chunk(id="analysis:matched", text="Job skills found in the resume: " + ", ".join(gap["matched"]),
                                source="analysis", label="Skill-gap analysis", verified=True))
        chunks += [Chunk(id=g["id"], text=g["text"], source="guideline", label="Writing guideline") for g in GUIDELINES]
        return chunks

    # ── resume-level issues (skills vs job, missing sections) ────────────────
    def _resume_level_issues(self, req, units, structured, resume_text, gap, skill_terms) -> List[Issue]:
        issues: List[Issue] = []
        low_resume = resume_text.lower()
        jd = req.job_description

        def display(skill: str) -> str:
            """The skill as the job description / resume writes it ("PostgreSQL", not the matcher's "postgresql")."""
            for text in (jd, resume_text):
                m = re.search(r"(?<![A-Za-z0-9])" + re.escape(skill) + r"(?![A-Za-z0-9])", text or "", re.I)
                if m:
                    return m.group(0)
            return skill

        for skill in gap["ordered"][:5]:
            if re.search(r"(?<![a-z0-9])" + re.escape(skill.lower()) + r"(?![a-z0-9])", low_resume):
                continue  # mentioned after all (matcher alias/partial) — not a real gap
            name = display(skill)
            issues.append(Issue(None, "missing_skill", "high" if skill in gap["high"] else "medium",
                                f"The job asks for {name}, but it doesn't appear anywhere in your resume.",
                                question=f"Have you used {name}? If so, in which project or role — "
                                         "add it there (and to Skills) only if you really used it.",
                                detail={"skill": skill, "display": name}))
        if gap["matched"]:
            # A role title ("Python Developer — Acme") doesn't show HOW a skill was used, so it isn't counted.
            body = " ".join(u.text for u in units if u.section in ("experience", "projects", "summary") and u.field != "title")
            shown = {s.lower() for s in skill_terms(body)}
            for skill in gap["matched"]:
                if skill.lower() not in shown and len([i for i in issues if i.category == "skill_not_demonstrated"]) < 3:
                    name = display(skill)
                    issues.append(Issue(None, "skill_not_demonstrated", "low",
                                        f"{name} is in your Skills list and the job asks for it, but no project or "
                                        "experience bullet shows how you used it.",
                                        question=f"Where did you use {name}? Mentioning it in that bullet shows real experience.",
                                        detail={"skill": skill, "display": name}))
        if structured:
            r = req.resume
            has_work = any(b.strip() for e in r.experience for b in e.bullets) or any(p.description.strip() or p.name.strip() for p in r.projects)
            if not has_work:
                issues.append(Issue(None, "ats_section", "high", "Your resume has no Experience or Projects content, "
                                    "which ATS systems and recruiters look for first.",
                                    question="Do you have internships, projects or coursework projects you can add?"))
            if not any(r.skills.values()):
                issues.append(Issue(None, "ats_section", "medium", "Your resume has no Skills section, so keyword matching has little to work with.",
                                    question="Which technologies and tools do you actually use? List them under Skills."))
            if not r.education:
                issues.append(Issue(None, "ats_section", "low", "No Education section was found."))
        elif self.ats_analyzer is not None and resume_text.strip():
            for it in self.ats_analyzer.analyze(resume_text).get("issues", []):   # existing analyzer, reused
                if it.get("type") == "missing_section":
                    issues.append(Issue(None, "ats_section", "medium", str(it.get("message", ""))[:200]))
        return issues

    # ── issue → suggestion ─────────────────────────────────────────────────
    def _build(self, issue: Issue, units: List[Unit], index: EvidenceIndex, structured: bool, jd: str, skill_terms) -> Optional[dict]:
        u = issue.unit
        evidence: List[dict] = []
        rewrite, question = issue.rewrite, issue.question
        category = issue.category

        # Grounding facts already attached by the detector (project title / project's own tech list).
        if u and issue.detail.get("grounding") == "project_title":
            evidence.append({"text": u.entry_label, "source": "resume", "label": f"Projects › {u.entry_label} (title)", "verified": True})
        if u and issue.detail.get("grounding") == "project_technologies":
            evidence.append({"text": "Technologies listed for this project: " + ", ".join(u.meta.get("technologies", [])),
                             "source": "resume", "label": self._label(u), "verified": True})

        # Missing outcome: is a result for this SAME entry reported elsewhere in the resume?
        if u and category == "missing_outcome":
            hit = self._metric_evidence(u, units, index)
            if hit:
                clause = _clause_with_number(hit.chunk.text)
                if clause:
                    category = "metric_available"
                    evidence.append({"text": hit.chunk.text, "source": "resume", "label": hit.chunk.label, "verified": True})
                    combined = end_sentence(f"{strip_end(u.text)} — {_lower_first(clause)}")
                    if len(combined.split()) <= 40:
                        rewrite = combined
                        question = "Only accept this if the result came from this work."
                    else:   # too long to append cleanly — point to the evidence and let the user work it in
                        rewrite = None
                        question = f"Your resume reports this result elsewhere: “{clause}”. If it came from this work, consider working it into this bullet."

        # Job relevance (related requirement) for bullet-level issues.
        related = None
        if jd and u is not None:
            jh = index.search(u.text, sources=["job_description"], top_k=1, min_score=0.35)
            if jh:
                related = jh[0].chunk.text
        if issue.detail.get("skill") and jd:
            jh = index.search(issue.detail["skill"], sources=["job_description"], top_k=1, min_score=0.0,
                              require_terms=[issue.detail["skill"]])
            if jh:
                related = jh[0].chunk.text
            # closest related work in the candidate's resume — shown as context, not as proof
            closest = index.search(related or issue.detail["skill"], sources=["resume"], top_k=1, min_score=0.3)
            if closest and category == "missing_skill":
                evidence.append({"text": closest[0].chunk.text, "source": "resume",
                                 "label": f"Closest related work: {closest[0].chunk.label}", "verified": True})
        if category in ("missing_skill", "skill_not_demonstrated"):
            evidence.append({"text": next((c.text for c in index.chunks if c.id == "analysis:missing" and category == "missing_skill"), "")
                             or next((c.text for c in index.chunks if c.source == "resume" and c.id == "skills"), ""),
                             "source": "analysis" if category == "missing_skill" else "resume",
                             "label": "Skill-gap analysis" if category == "missing_skill" else "Skills", "verified": True})

        # Validation: rewrites may only use the original + VERIFIED resume evidence.
        validated = False
        if rewrite:
            resume_ev = [e["text"] for e in evidence if e["source"] == "resume" and e["verified"]]
            ok, problems = validate_rewrite(u.text if u else "", rewrite, resume_ev, skill_terms)
            if ok:
                validated = True
            else:
                logger.debug("rejected rewrite (%s): %s", category, problems)
                rewrite = None
                if category == "metric_available":
                    category, question = "missing_outcome", issue.question
                if not question:
                    return None   # nothing safe to suggest for this line

        guideline = BY_CATEGORY.get(category) or BY_CATEGORY.get(issue.category)
        if guideline:
            evidence.append({"text": guideline["text"], "source": "guideline", "label": "Writing guideline", "verified": False})
        evidence = [e for e in evidence if e["text"]]

        resume_ev_count = sum(1 for e in evidence if e["source"] in ("resume", "analysis") and e["verified"])
        minimal = bool(rewrite) and category in ("weak_opener", "responsibility_not_contribution", "first_person",
                                                 "filler", "repeated_verb", "too_long")
        requires_input = rewrite is None and bool(question)
        assumption = ""
        if rewrite and issue.detail.get("grounding") == "project_technologies":
            assumption = "assumes the project's listed technologies were used for this bullet — accept only if accurate"
            question = f"Did this part of the project use {', '.join(u.meta.get('technologies', [])[:3])}? Accept only if it did."
        conf = confidence(has_rewrite=bool(rewrite), rewrite_validated=validated,
                          resume_evidence=resume_ev_count + (1 if (u and rewrite) else 0),
                          job_evidence=bool(related), requires_user_input=requires_input, minimal_edit=minimal,
                          assumption=assumption)

        # target: the exact editor line (so a user-written improvement can be applied there too);
        # applicable: the engine itself has a validated rewrite for it.
        target = None
        if u is not None and structured and u.rewritable:
            target = {"section": u.section, "entry_index": u.entry_index, "entry_id": u.entry_id,
                      "field": u.field, "line_index": u.line_index}
        applicable = bool(target and rewrite)
        section_key = u.section if u else ("skills" if category in ("missing_skill", "skill_not_demonstrated") else "general")
        return {
            "id": _sid(category, u.uid if u else "", issue.detail.get("skill", ""), issue.detail.get("phrase", "")),
            "category": category,
            "severity": issue.severity,
            "section": SECTION_TITLES.get(section_key, section_key.title()),
            "entry": u.entry_label if u else "",
            "original_text": u.text if u else "",
            "suggested_text": rewrite or "",
            "reason": issue.reason if category != "metric_available" else
                      "Your resume reports a result for this same work elsewhere; showing it in the bullet makes the impact visible.",
            "supporting_evidence": evidence,
            "evidence_source": sorted({e["source"] for e in evidence}),
            "related_job_requirement": related,
            "confidence": conf,
            "requires_user_input": requires_input,
            "follow_up_question": question if (requires_input or category == "metric_available" or assumption) else None,
            "target": target,
            "applicable": applicable,
            "skill": issue.detail.get("display") if category in ("missing_skill", "skill_not_demonstrated") else None,
            "_section_key": section_key,
            "_order": u.line_index if (u and u.line_index is not None) else 0,
            "_uid": u.uid if u else f"resume:{category}:{issue.detail.get('skill', '')}",
        }

    def _metric_evidence(self, u: Unit, units: List[Unit], index: EvidenceIndex):
        """A numeric result elsewhere in the resume that is about the same entry (same project/role)."""
        name = re.split(r"\s+[—–-]\s+|:\s+|\s+\(", u.entry_label or "", maxsplit=1)[0].strip()
        name_ok = len(name) >= 4 and _norm(name) not in _GENERIC_NAME_WORDS
        # Filter on "numeric + same entry" over ALL resume chunks, then take the most similar one.
        for hit in index.search(u.text, sources=["resume"], top_k=len(index.chunks), min_score=0.0, exclude_ids=[u.uid]):
            c = hit.chunk
            if not re.search(r"\d", c.text) or c.id.endswith(":title") or c.id == "skills":
                continue
            same_entry = c.entry_key == u.entry_key
            names_entry = name_ok and re.search(r"(?<!\w)" + re.escape(name.lower()) + r"(?!\w)", c.text.lower())
            if (same_entry or names_entry) and metric_numbers(c.text):
                return hit
        return None

    # ── duplicates and conflicting edits ───────────────────────────────────
    def _resolve(self, suggestions: List[dict], units: List[Unit]) -> List[dict]:
        existing_lines = {_norm(u.text) for u in units if u.field in ("bullets", "description", "text")}
        by_line: Dict[str, List[dict]] = {}
        seen_ids, seen_text = set(), set()
        out = []
        for s in suggestions:
            if s["id"] in seen_ids:
                continue
            seen_ids.add(s["id"])
            # A rewrite that would duplicate another existing bullet is not offered.
            if s["suggested_text"] and any(_norm(l) in existing_lines and _norm(l) != _norm(s["original_text"])
                                           for l in s["suggested_text"].split("\n")):
                if not s["follow_up_question"]:
                    continue
                s.update(suggested_text="", applicable=False, requires_user_input=True)
            key = (s["category"], _norm(s["original_text"]), _norm(s["suggested_text"]))
            if key in seen_text:
                continue
            seen_text.add(key)
            by_line.setdefault(s["_uid"], []).append(s)
        for uid, group in by_line.items():
            if uid.startswith("resume:"):
                out.extend(group)
                continue
            rewrites = sorted([s for s in group if s["suggested_text"]],
                              key=lambda s: (REWRITE_PRIORITY.get(s["category"], 9), SEVERITY_RANK[s["severity"]]))
            questions = sorted([s for s in group if not s["suggested_text"]], key=lambda s: SEVERITY_RANK[s["severity"]])
            # One rewrite per line (two rewrites of the same line would conflict when accepted).
            keep = rewrites[:1] + questions
            out.extend(keep[:MAX_PER_LINE])
        return out
