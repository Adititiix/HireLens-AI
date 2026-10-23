"""Grounding tests for the /analyze summary suggestion (recommendations/suggestion_engine.py)."""
import re
import unittest

from recommendations.suggestion_engine import SuggestionEngine

ENGINE = SuggestionEngine(embedder=None)   # no embedder → low alignment assumed → summary always attempted

RESUME = """ADITI S
aditi@example.com | github.com/aditi
EXPERIENCE
Full Stack Developer Intern | Briddlee
- Built REST APIs with Flask and PostgreSQL
PROJECTS
HireLens AI | React.js, FastAPI
- Matched resumes to job descriptions
SKILLS
Python, SQL"""

JD = ("Senior Data Scientist with 5+ years of experience. Must know Kubernetes, AWS, Node.js and TensorFlow. "
      "Led a team of 10 and improved model accuracy by 30%. Award-winning publications preferred.")
JD_MISSING = ["kubernetes", "aws", "node.js", "tensorflow"]


def summary(text=RESUME, jd=JD, missing=JD_MISSING):
    return ENGINE._suggest_summary_text(text, jd, missing)


class NothingUnsupportedIsInserted(unittest.TestCase):
    def test_no_years_of_experience(self):
        self.assertNotRegex(summary(), r"\d+\s*\+?\s*(years?|yrs?)")
        self.assertNotIn("years", summary().lower())

    def test_no_technologies_outside_the_resume(self):
        s = summary()
        for tech in ("Kubernetes", "AWS", "Node.js", "TensorFlow", "React, Node.js, AWS"):
            self.assertNotIn(tech.lower(), s.lower(), tech)

    def test_no_metrics_or_numbers(self):
        self.assertFalse(re.search(r"\d", summary()))

    def test_no_leadership_achievements_or_impact_claims(self):
        low = summary().lower()
        for claim in ("led", "lead", "team of", "award", "publication", "accuracy", "results-driven", "scalable",
                      "high-performance", "measurable", "impact", "passionate"):
            self.assertNotRegex(low, r"\b" + re.escape(claim) + r"\b", claim)

    def test_job_description_role_is_not_claimed(self):
        self.assertNotIn("Data Scientist", summary())
        self.assertNotIn("Senior", summary())


class OnlyVerifiedResumeFacts(unittest.TestCase):
    def test_uses_the_resumes_own_skills_as_written(self):
        s = summary()
        for skill in ("Flask", "PostgreSQL", "FastAPI", "Python"):
            self.assertIn(skill, s)
        self.assertEqual(s, "Experience includes projects and internship work. "
                            "Skills include Flask, PostgreSQL, React, FastAPI and Python.")

    def test_every_skill_mentioned_appears_in_the_resume(self):
        s = summary()
        listed = s.split("Skills include ", 1)[1].rstrip(".")
        for skill in re.split(r",\s*|\s+and\s+", listed):
            self.assertIn(skill.lower(), RESUME.lower(), skill)

    def test_job_description_does_not_change_the_content(self):
        self.assertEqual(summary(jd=JD, missing=JD_MISSING), summary(jd="", missing=[]))

    def test_internship_only_experience_is_not_called_employment(self):
        self.assertNotIn("work experience", summary())
        self.assertIn("work experience", summary(text="EXPERIENCE\nAnalyst | Contoso\n- Built dashboards in Python"))

    def test_scoped_to_current_candidate(self):
        a = summary(text="PROJECTS\nPortal | Django\n- Built a portal")
        b = summary(text="SKILLS\nRust")
        self.assertEqual(b, "Skills include Rust.")
        self.assertNotIn("Django", b)
        self.assertNotIn("Rust", a)


class InsufficientEvidence(unittest.TestCase):
    def test_empty_when_resume_has_no_verifiable_facts(self):
        self.assertEqual(summary(text="Jane Doe\njane@example.com\n+1 555 0100"), "")
        self.assertEqual(summary(text=""), "")

    def test_no_summary_suggestion_without_evidence(self):
        self.assertIsNone(ENGINE._suggest_summary("Jane Doe\njane@example.com", JD, JD_MISSING))
        sugg = ENGINE.generate("Jane Doe\njane@example.com", JD, JD_MISSING)
        self.assertFalse([s for s in sugg if s["type"] == "summary_rewrite"])

    def test_improve_section_keeps_original_when_evidence_is_insufficient(self):
        self.assertEqual(ENGINE.improve_section("summary", "Curious student.", JD, JD_MISSING), "Curious student.")


class AnalyzeFlow(unittest.TestCase):
    def test_generate_summary_suggestion_is_grounded(self):
        sugg = ENGINE.generate(RESUME, JD, JD_MISSING)
        [s] = [x for x in sugg if x["type"] == "summary_rewrite"]
        self.assertEqual(s["suggested"], summary())
        self.assertNotIn("3+", s["suggested"])
        self.assertNotIn("Adding role-specific terms", s["reason"])

    def test_response_shape_unchanged(self):
        [s] = [x for x in ENGINE.generate(RESUME, JD, JD_MISSING) if x["type"] == "summary_rewrite"]
        self.assertEqual(set(s), {"type", "section", "original", "suggested", "reason"})


if __name__ == "__main__":
    unittest.main()
