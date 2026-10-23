"""Regression guards for existing analysis behaviour the suggestions feature must not change."""
import contextlib
import io
import unittest

from matching.skill_matcher import SkillMatcher
from scoring.score_engine import ScoreEngine


class ScoringRegressionTests(unittest.TestCase):
    def test_match_score_weights_unchanged(self):
        self.assertEqual(ScoreEngine.WEIGHTS, {"skill_match": 0.40, "semantic": 0.35, "project_relevance": 0.15, "ats_format": 0.10})

    def test_skill_extraction_and_matching_unchanged(self):
        m = SkillMatcher(embedder=None)
        self.assertEqual(m.extract_skills("Built REST APIs in Python with FastAPI and PostgreSQL"),
                         sorted(m.extract_skills("Built REST APIs in Python with FastAPI and PostgreSQL")))
        rs = m.extract_skills("Python, FastAPI, PostgreSQL, React")
        js = m.extract_skills("Python, Docker, PostgreSQL")
        with contextlib.redirect_stdout(io.StringIO()):
            r = m.match_skills(rs, js, "")
        self.assertIn("python", r["matched_skills"])
        self.assertIn("docker", r["missing_skills"])
        self.assertEqual(set(r), {"matched_skills", "partial_skills", "missing_skills", "resume_skills", "jd_skills",
                                  "match_percentage", "priority_map", "high_missing", "medium_missing", "low_missing"})


if __name__ == "__main__":
    unittest.main()
