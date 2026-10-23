"""Grounding and scope tests for the evidence engine (RAG used only for Projects / Experience)."""
import contextlib
import io
import re
import unittest

from matching.skill_matcher import SkillMatcher
from recommendations.evidence import EvidenceSuggestionEngine
from recommendations.evidence.models import SuggestRequest
from recommendations.suggestion_engine import SuggestionEngine
from tests.helpers import FakeEmbedder

MATCHER = SkillMatcher(embedder=None)
ENGINE = EvidenceSuggestionEngine(embedder=FakeEmbedder(), skill_matcher=MATCHER)


def run(resume, jd=""):
    with contextlib.redirect_stdout(io.StringIO()):
        return ENGINE.suggest(SuggestRequest(resume=resume, job_description=jd))


def all_text(res):
    return " ".join(s["suggested_text"] + " " + " ".join(e["text"] for e in s["supporting_evidence"] if e["source"] == "resume")
                    for s in res["suggestions"])


INTERN = {"experience": [{"id": "i1", "title": "Software Engineering Intern", "company": "Lab",
                          "bullets": ["Responsible for writing unit tests for the booking API.",
                                      "Worked on the registration endpoint."]}],
          "projects": [{"id": "p1", "name": "Portal", "description": "Built a portal serving 3,000 students.", "technologies": []}],
          "skills": {"technical": ["Python"]}, "education": [{"degree": "B.Tech"}]}


class InternshipGrounding(unittest.TestCase):
    def test_internship_rewrites_only_use_that_internship_text(self):
        res = run(INTERN)
        intern = [s for s in res["suggestions"] if s["section"] == "Experience" and s["suggested_text"]]
        self.assertTrue(intern)
        for s in intern:
            self.assertEqual(s["target"]["section"], "experience")
            self.assertIn(s["original_text"], INTERN["experience"][0]["bullets"])
            self.assertNotIn("3,000", s["suggested_text"], "the project's number is not moved into the internship")
            self.assertNotIn("students", s["suggested_text"])

    def test_expected_internship_rewrites(self):
        texts = {s["original_text"]: s["suggested_text"] for s in run(INTERN)["suggestions"] if s["suggested_text"]}
        self.assertEqual(texts["Responsible for writing unit tests for the booking API."], "Wrote unit tests for the booking API.")
        self.assertEqual(texts["Worked on the registration endpoint."], "Contributed to the registration endpoint.")


class ScopeOfRag(unittest.TestCase):
    def test_summary_is_never_rewritten_by_the_evidence_engine(self):
        r = dict(INTERN, summary="I am a student who worked on various projects.")
        res = run(r)
        self.assertFalse([s for s in res["suggestions"] if s["section"] == "Summary"])

    def test_only_projects_and_experience_lines_are_rewritten(self):
        r = dict(INTERN, achievements=[{"id": "a", "title": "Award", "description": "Responsible for organizing the hackathon."}],
                 certifications=[{"name": "Worked on AWS certificate"}], education=[{"degree": "Worked on B.Tech"}])
        for s in run(r)["suggestions"]:
            if s["suggested_text"]:
                self.assertIn(s["target"]["section"], ("experience", "projects"))
                self.assertNotIn("hackathon", s["original_text"])

    def test_unknown_or_empty_sections_create_no_experience(self):
        res = run({"experience": [{"title": "Unknown", "company": "", "bullets": []}], "projects": [], "skills": {"technical": ["Python"]},
                   "education": [{"degree": "B.Tech"}]})
        self.assertFalse([s for s in res["suggestions"] if s["section"] in ("Experience", "Projects")])
        self.assertTrue(any(s["category"] == "ats_section" for s in res["suggestions"]))


class NoCrossResumeBorrowing(unittest.TestCase):
    def test_evidence_from_one_resume_never_appears_for_another(self):
        a = {"projects": [{"id": "x", "name": "Zephyr Ledger", "description": "Optimized the zephyr settlement pipeline.", "technologies": []}],
             "achievements": [{"id": "z", "title": "Zephyr", "description": "Zephyr Ledger: processed 48,000 settlements per hour."}],
             "skills": {"technical": ["Go"]}, "education": [{"degree": "BSc"}]}
        b = {"projects": [{"id": "y", "name": "Orion Tracker", "description": "Optimized the zephyr settlement pipeline.", "technologies": []}],
             "skills": {"technical": ["Go"]}, "education": [{"degree": "BSc"}]}
        ra = run(a)
        self.assertIn("48,000", all_text(ra), "A's own result is used for A")
        rb = run(b)                                  # same engine instance, next request
        self.assertNotIn("48,000", all_text(rb))
        self.assertNotIn("Zephyr Ledger", all_text(rb))
        self.assertFalse([s for s in rb["suggestions"] if s["category"] == "metric_available"])


class NothingInvented(unittest.TestCase):
    def test_no_new_numbers_dates_leadership_or_technologies(self):
        res = run(INTERN, jd="Lead a team of 5 engineers using Kubernetes since 2019; 99.9% uptime required.")
        source = " ".join(INTERN["experience"][0]["bullets"] + [INTERN["projects"][0]["description"]])
        for s in res["suggestions"]:
            t = s["suggested_text"]
            for n in re.findall(r"\d[\d,.%]*", t):
                self.assertIn(n.rstrip(".,"), source)
            self.assertNotRegex(t.lower(), r"\b(led|lead|managed|kubernetes|2019|99\.9)\b")


class LegacySummaryTemplate(unittest.TestCase):
    """The /analyze summary suggestion (recommendations/suggestion_engine.py) used to invent "3+ years of
    experience" and default technologies. Fixed — this was an expectedFailure until then.
    Detailed coverage: tests/test_summary_grounding.py."""

    def test_legacy_summary_does_not_invent_years_or_technologies(self):
        resume = "Student. Projects: Built a portal with Flask."
        summary = SuggestionEngine(embedder=None)._suggest_summary_text(resume, "", [])
        self.assertNotRegex(summary, r"\d+\+?\s*years")
        for tech in ("React", "Node.js", "AWS"):
            self.assertNotIn(tech, summary)
        self.assertIn("Flask", summary, "the resume's own skill is used")


if __name__ == "__main__":
    unittest.main()
