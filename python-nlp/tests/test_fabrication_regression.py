"""Regression: the editor showed "Results-driven Technology Development Program Software Engineer with 3+ years of
experience …" for a resume with one internship and academic projects (stored analysis, 2026-10-23).
Every legacy /analyze path and the evidence engine's skill suggestions are checked here."""
import contextlib
import io
import re
import unittest

from recommendations.evidence.models import SuggestRequest
from recommendations.suggestion_engine import ACTION_VERB_REPLACEMENTS, SuggestionEngine, unsupported_duration_claims
from tests.test_evidence_engine import engine as evidence_engine

RESUME = """ADITI S
aditi@example.com | github.com/aditi
EDUCATION
B.Tech Computer Science, XYZ University, 2022 - 2026
Relevant Coursework: Data Structures and Algorithms, Operating Systems
EXPERIENCE
Software Engineering Intern | Briddlee | Jun 2025 - Aug 2025
- Worked on REST APIs with Flask and PostgreSQL
PROJECTS
HireLens AI | React.js, FastAPI
- Made a resume matcher with NLP
SKILLS
Python, SQL"""

JD = ("Technology Development Program Software Engineer. We need 3+ years of experience building scalable, "
      "high-performance applications with Java, Kubernetes and Large Language Models. Results-driven engineers wanted.")
MISSING = ["java", "kubernetes", "large language models"]

OLD_TEMPLATE = ("Results-driven Technology Development Program Software Engineer with 3+ years of experience building "
                "scalable, high-performance applications.")
INFLATED = {"led", "drove", "oversaw", "architected", "engineered", "eliminated", "spearheaded", "owned"}


def legacy(resume=RESUME, jd=JD, missing=MISSING):
    return SuggestionEngine(embedder=None).generate(resume, jd, missing)


class LegacySummaryNeverInventsExperience(unittest.TestCase):
    def test_exact_reported_case_has_no_duration_role_or_filler(self):
        for s in legacy():
            text = s["suggested"]
            self.assertFalse(re.search(r"\d+\s*\+?\s*(years?|yrs?)", text, re.I), text)
            self.assertNotIn("Technology Development Program", text)   # job title ≠ candidate's title
            self.assertNotIn("Results-driven", text)
            self.assertNotIn("scalable", text.lower())

    def test_internship_is_not_presented_as_employment(self):
        [s] = [s for s in legacy() if s["type"] == "summary_rewrite"]
        self.assertIn("internship work", s["suggested"])
        self.assertNotIn("work experience", s["suggested"])
        self.assertNotIn("Software Engineer", s["suggested"])

    def test_old_template_is_filtered_even_if_a_code_path_returns_it(self):
        eng = SuggestionEngine(embedder=None)
        eng._suggest_summary = lambda *a: {"type": "summary_rewrite", "section": "Professional Summary",
                                           "original": "", "suggested": OLD_TEMPLATE, "reason": ""}
        self.assertEqual([s for s in eng.generate(RESUME, JD, MISSING) if s["type"] == "summary_rewrite"], [])

    def test_insufficient_evidence_abstains(self):
        self.assertEqual([s for s in legacy("JANE DOE\njane@example.com") if s["type"] == "summary_rewrite"], [])

    def test_duration_stated_in_resume_is_allowed(self):
        self.assertEqual(unsupported_duration_claims("2 years of experience", "Analyst — 2 years of experience at Acme"), [])
        self.assertEqual(unsupported_duration_claims(OLD_TEMPLATE, RESUME), ["3+ years"])
        self.assertEqual(unsupported_duration_claims("built three years of data", "x"), ["three years"])


class LegacyTipsDoNotAssertSkillsOrLeadership(unittest.TestCase):
    def test_add_skills_tip_asks_instead_of_asserting(self):
        [s] = [s for s in legacy() if s["type"] == "add_skills"]
        self.assertEqual(s["skills"], MISSING)
        self.assertIn("only if you have actually used it", s["suggested"])
        self.assertNotIn("in-demand", s["suggested"])

    def test_verb_replacements_never_inflate_the_claim(self):
        for weak, options in ACTION_VERB_REPLACEMENTS.items():
            for verb in options:
                self.assertFalse(set(verb.lower().split()) & INFLATED, f"{weak!r} → {verb!r}")

    def test_bullet_rewrites_keep_the_rest_of_the_bullet(self):
        for s in legacy():
            if s["type"] == "bullet_rewrite":
                rest = s["original"].split(" ", 2)[-1]
                self.assertTrue(s["suggested"].endswith(rest), s)


class EvidenceSkillSuggestionsAreNotAutoApplied(unittest.TestCase):
    def run_engine(self):
        payload = {"resume": {"summary": "", "skills": {"technical": ["Python", "Docker"]},
                              "experience": [{"id": "e1", "title": "Software Engineering Intern", "company": "Briddlee",
                                              "bullets": ["Built REST APIs with Flask and PostgreSQL."]}]},
                   "job_description": "Backend engineer: Python, Docker, Flask and Large Language Models required."}
        with contextlib.redirect_stdout(io.StringIO()):
            return evidence_engine().suggest(SuggestRequest(**payload))["suggestions"]

    def test_skill_suggestions_carry_the_skill_but_no_rewrite(self):
        skills = [s for s in self.run_engine() if s["category"] in ("missing_skill", "skill_not_demonstrated")]
        self.assertTrue(skills)
        for s in skills:
            self.assertTrue(s["skill"])
            self.assertEqual((s["applicable"], s["target"], s["suggested_text"]), (False, None, ""), s["category"])
        self.assertIn("Docker", [s["skill"] for s in skills if s["category"] == "skill_not_demonstrated"])

    def test_other_suggestions_have_no_skill_field(self):
        for s in self.run_engine():
            if s["category"] not in ("missing_skill", "skill_not_demonstrated"):
                self.assertIsNone(s["skill"])


if __name__ == "__main__":
    unittest.main()
