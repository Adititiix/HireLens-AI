"""API contract tests for POST /resume-suggestions (router mounted on a test app with a fake embedder)."""
import contextlib
import io
import unittest

from fastapi import FastAPI
from fastapi.testclient import TestClient

from ats.ats_analyzer import ATSAnalyzer
from matching.skill_matcher import SkillMatcher
from recommendations.evidence import EvidenceSuggestionEngine
from recommendations.evidence.api import create_router
from tests.helpers import FakeEmbedder, sample_resume

ENGINE = EvidenceSuggestionEngine(embedder=FakeEmbedder(), skill_matcher=SkillMatcher(embedder=None), ats_analyzer=ATSAnalyzer())


class _Boom:
    def suggest(self, req):
        raise RuntimeError("secret resume text: Jane Doe, 555-0100, C:\\Users\\jane\\resume.pdf")


def client(engine=ENGINE):
    app = FastAPI()
    app.include_router(create_router(lambda: engine))
    return TestClient(app)


class ApiTests(unittest.TestCase):
    def post(self, body, engine=ENGINE):
        with contextlib.redirect_stdout(io.StringIO()):
            return client(engine).post("/resume-suggestions", json=body)

    def test_success_response_shape(self):
        r = self.post({"resume": sample_resume(), "job_description": "Python and Docker backend role building REST APIs."})
        self.assertEqual(r.status_code, 200)
        body = r.json()
        self.assertEqual(set(body), {"suggestions", "summary", "engine"})
        s = body["suggestions"][0]
        for key in ("id", "category", "severity", "section", "original_text", "suggested_text", "reason",
                    "supporting_evidence", "evidence_source", "related_job_requirement", "confidence",
                    "requires_user_input", "follow_up_question", "target", "applicable"):
            self.assertIn(key, s)
        self.assertIn(s["confidence"]["level"], ("high", "medium", "low"))
        self.assertFalse(body["engine"]["generative_model"])

    def test_resume_only(self):
        r = self.post({"resume": sample_resume()})
        self.assertEqual(r.status_code, 200)
        self.assertFalse(r.json()["summary"]["job_description_used"])

    def test_plain_text_resume(self):
        r = self.post({"resume_text": "EXPERIENCE\n• Worked on the billing API."})
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.json()["suggestions"][0]["category"], "weak_opener")

    def test_empty_resume_is_422(self):
        self.assertEqual(self.post({"resume": {}}).status_code, 422)
        self.assertEqual(self.post({}).status_code, 422)
        self.assertEqual(self.post({"resume_text": "   "}).status_code, 422)

    def test_malformed_types_are_422(self):
        self.assertEqual(self.post({"resume": "not an object"}).status_code, 422)
        self.assertEqual(self.post({"resume": sample_resume(), "max_suggestions": 999}).status_code, 422)
        self.assertEqual(self.post({"resume_text": "x" * 70000}).status_code, 422)

    def test_max_suggestions_respected(self):
        r = self.post({"resume": sample_resume(), "max_suggestions": 2})
        self.assertLessEqual(len(r.json()["suggestions"]), 2)

    def test_internal_error_does_not_leak_details(self):
        r = self.post({"resume": sample_resume()}, engine=_Boom())
        self.assertEqual(r.status_code, 500)
        self.assertEqual(r.json(), {"detail": "Could not generate suggestions."})


if __name__ == "__main__":
    unittest.main()
