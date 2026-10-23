"""Evidence-grounding tests: what may (and may not) count as evidence of the candidate's experience."""
import contextlib
import copy
import io
import unittest

from matching.skill_matcher import SkillMatcher
from recommendations.evidence import EvidenceSuggestionEngine
from recommendations.evidence.models import SuggestRequest
from recommendations.evidence.validator import validate_rewrite
from tests.helpers import FakeEmbedder

MATCHER = SkillMatcher(embedder=None)
ALPHA_BULLET = "Developed the deployment service for the tracker."
JD_DEPLOY = "You will scale the deployment service for the tracker to 10,000 requests per second using Kubernetes."
JD_OTHER = "Our office hosts a weekly music concert for the team."


def resume(achievements=None, beta_bullet="Processed 5,000 records per second in the vault pipeline."):
    return {
        "experience": [],
        "projects": [
            {"id": "a", "name": "Alpha Tracker", "description": ALPHA_BULLET, "technologies": []},
            {"id": "b", "name": "Beta Vault", "description": beta_bullet, "technologies": []},
        ],
        "achievements": achievements or [],
        "skills": {"technical": ["Python"]},
        "education": [{"degree": "B.Tech"}],
    }


def run(r, jd=""):
    eng = EvidenceSuggestionEngine(embedder=FakeEmbedder(), skill_matcher=MATCHER)
    with contextlib.redirect_stdout(io.StringIO()):
        return eng.suggest(SuggestRequest(resume=r, job_description=jd))


def for_line(res, text):
    return [s for s in res["suggestions"] if s["original_text"] == text]


def outcome(res, text=ALPHA_BULLET):
    """The outcome-related suggestion for a line (a line may also get e.g. a technical-context one)."""
    found = [s for s in for_line(res, text) if s["category"] in ("missing_outcome", "metric_available")]
    assert len(found) == 1, found
    return found[0]


class JobDescriptionIsNotCandidateEvidence(unittest.TestCase):
    def setUp(self):
        self.res = run(resume(), jd=f"{JD_DEPLOY}\n{JD_OTHER}")

    def test_jd_establishes_the_requirement(self):
        alpha = outcome(self.res)
        self.assertEqual(alpha["related_job_requirement"], JD_DEPLOY, "the matching JD sentence, not the unrelated one")

    def test_jd_numbers_and_tools_never_become_candidate_claims(self):
        for s in self.res["suggestions"]:
            self.assertNotIn("10,000", s["suggested_text"])
            self.assertNotIn("Kubernetes", s["suggested_text"])
        self.assertEqual([s for s in self.res["suggestions"] if s["category"] == "metric_available"], [],
                         "a JD number is not a result the candidate achieved")
        alpha = outcome(self.res)
        self.assertEqual(alpha["category"], "missing_outcome")
        self.assertTrue(alpha["requires_user_input"])

    def test_evidence_labels_keep_sources_apart(self):
        for s in self.res["suggestions"]:
            for e in s["supporting_evidence"]:
                if e["source"] in ("job_description", "guideline"):
                    self.assertFalse(e["verified"], f"{e['source']} text must never be marked as verified candidate evidence")
                if e["verified"]:
                    self.assertIn(e["source"], ("resume", "analysis"))

    def test_validator_rejects_facts_that_only_the_jd_contains(self):
        # The engine passes only VERIFIED RESUME text as evidence; JD-only facts therefore fail validation.
        ok, problems = validate_rewrite(ALPHA_BULLET, "Developed the deployment service for the tracker, handling 10,000 requests per second.",
                                        [], MATCHER.extract_skills)
        self.assertFalse(ok)
        self.assertTrue(any("numbers" in p for p in problems))


class ResumeEvidenceSupportsClaims(unittest.TestCase):
    ACH = [{"id": "x", "title": "Load test", "description": "Alpha Tracker: handled 2,500 requests per second in load tests."}]

    def test_same_project_result_is_attached_with_traceable_source(self):
        s = outcome(run(resume(achievements=self.ACH)))
        self.assertEqual(s["category"], "metric_available")
        self.assertIn("2,500 requests per second", s["suggested_text"])
        resume_ev = [e for e in s["supporting_evidence"] if e["source"] == "resume"]
        self.assertTrue(any(e["verified"] and "2,500" in e["text"] for e in resume_ev))
        self.assertTrue(s["applicable"])

    def test_retrieved_chunk_changes_the_output_counterfactual(self):
        with_chunk = outcome(run(resume(achievements=self.ACH)))
        without = outcome(run(resume()))
        self.assertEqual((with_chunk["category"], without["category"]), ("metric_available", "missing_outcome"))
        self.assertNotEqual(with_chunk["suggested_text"], without["suggested_text"])
        self.assertEqual(without["suggested_text"], "", "without evidence the engine asks instead of writing")
        # The cited text is the achievement chunk exactly as indexed ("title — description").
        chunk_text = f"{self.ACH[0]['title']} — {self.ACH[0]['description']}"
        self.assertIn(chunk_text, [e["text"] for e in with_chunk["supporting_evidence"]], "the exact retrieved chunk is cited")

    def test_jd_sentence_retrieval_changes_the_output_counterfactual(self):
        linked = outcome(run(resume(), jd=JD_DEPLOY))
        unlinked = outcome(run(resume(), jd=JD_OTHER))
        self.assertEqual(linked["related_job_requirement"], JD_DEPLOY)
        self.assertIsNone(unlinked["related_job_requirement"], "an unrelated JD sentence is not attached")
        self.assertGreater(linked["confidence"]["score"], unlinked["confidence"]["score"])


class NoCrossProjectBorrowing(unittest.TestCase):
    def test_other_projects_number_is_not_attached(self):
        res = run(resume(achievements=[{"id": "y", "title": "Users", "description": "Beta Vault: reached 9,000 users."}]))
        alpha = for_line(res, ALPHA_BULLET)
        self.assertTrue(alpha)
        self.assertEqual(outcome(res)["category"], "missing_outcome")
        for s in alpha:
            self.assertNotEqual(s["category"], "metric_available")
            self.assertNotIn("5,000", s["suggested_text"])
            self.assertNotIn("9,000", s["suggested_text"])
            self.assertFalse(any("5,000" in e["text"] or "9,000" in e["text"] for e in s["supporting_evidence"]))

    def test_result_naming_another_project_is_not_attached_even_if_more_similar(self):
        # Wording copied from the Alpha bullet, but it is explicitly about Beta Vault.
        ach = [{"id": "z", "title": "Beta", "description": "Beta Vault: developed the deployment service, 7,000 deploys."}]
        for s in for_line(run(resume(achievements=ach)), ALPHA_BULLET):
            self.assertNotIn("7,000", s["suggested_text"])

    def test_input_is_unchanged(self):
        r = resume()
        before = copy.deepcopy(r)
        run(r, jd=JD_DEPLOY)
        self.assertEqual(r, before)


if __name__ == "__main__":
    unittest.main()
