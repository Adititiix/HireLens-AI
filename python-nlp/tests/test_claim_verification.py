"""Claim verification (search_entry_evidence) with question-form claims, and the claim-dataset generator."""
import csv
import json
import os
import tempfile
import unittest

from evaluation.build_claim_dataset import build
from tests.test_entry_evidence import index

RESUME = {
    "experience": [
        {"id": "i", "title": "Data Analyst Intern", "company": "Northwind Labs",
         "bullets": ["Cleaned survey datasets with Pandas.", "Wrote weekly KPI reports for managers."]},
        {"id": "e", "title": "Junior Software Engineer", "company": "Contoso",
         "bullets": ["Implemented REST endpoints with FastAPI.", "Fixed flaky integration tests in CI."]},
    ],
    "skills": {"technical": ["Python", "Pandas", "FastAPI", "Docker"]},
}


def ids(hits):
    return [h.chunk.id for h in hits]


class QuestionFormClaims(unittest.TestCase):
    def setUp(self):
        self.idx = index(RESUME)

    def test_supported_claim_returns_the_expected_bullet(self):
        r = self.idx.search_entry_evidence("Did the candidate use Pandas during the internship at Northwind Labs?")
        self.assertEqual((r.status, r.entry_key), ("supported", "experience:0"))
        self.assertEqual(ids(r.bullets)[0], "experience:0:0")

    def test_unsupported_claim_is_insufficient_evidence(self):
        r = self.idx.search_entry_evidence("Did the candidate use Kubernetes during the internship at Northwind Labs?")
        self.assertEqual((r.status, r.bullets), ("insufficient_evidence", []))

    def test_skills_section_does_not_prove_use_in_an_entry(self):
        # Docker is listed under Skills but named in no bullet of the internship.
        r = self.idx.search_entry_evidence("Did the candidate use Docker during the internship at Northwind Labs?")
        self.assertEqual((r.status, r.bullets), ("insufficient_evidence", []))

    def test_skill_in_one_role_does_not_prove_another_role(self):
        # FastAPI is in the Contoso role's bullet, not the Northwind internship's.
        r = self.idx.search_entry_evidence("Did the candidate use FastAPI during the internship at Northwind Labs?")
        self.assertEqual((r.status, r.entry_key, r.bullets), ("insufficient_evidence", "experience:0", []))
        ok = self.idx.search_entry_evidence("Did the candidate use FastAPI in the Junior Software Engineer role at Contoso?")
        self.assertEqual((ok.status, ids(ok.bullets)[0]), ("supported", "experience:1:0"))

    def test_technology_in_a_title_does_not_prove_use(self):
        idx = index({"experience": [{"id": "x", "title": "Python Developer", "company": "Acme",
                                     "bullets": ["Answered customer support tickets."]}]})
        r = idx.search_entry_evidence("Did the candidate use Python in the Python Developer role at Acme?")
        self.assertEqual((r.status, r.bullets), ("insufficient_evidence", []))

    def test_candidate_isolation(self):
        other = index({"experience": [{"id": "z", "title": "Barista", "company": "Cafe Uno", "bullets": ["Made espresso."]}]})
        r = other.search_entry_evidence("Did the candidate use Pandas during the internship at Northwind Labs?")
        self.assertEqual((r.status, r.bullets), ("no_entry_match", []))

    def test_entry_isolation(self):
        r = self.idx.search_entry_evidence("Did the candidate use Pandas in the Junior Software Engineer role at Contoso?", top_k=10)
        self.assertEqual(r.entry_key, "experience:1")
        self.assertTrue(all(h.chunk.entry_key == "experience:1" for h in r.bullets))
        self.assertNotIn("experience:0:0", ids(r.bullets), "the internship's Pandas bullet is never borrowed")

    def test_no_claim_query_returns_no_claim(self):
        r = self.idx.search_entry_evidence("Find evidence for the candidate's internship at Northwind Labs.")
        self.assertEqual((r.status, r.bullets, r.claim), ("no_claim", [], ""))


ROW = {
    "resume_id": "T-1", "record_type": "synthetic", "education": "[]", "projects": "[]", "internships": "",
    "skills": json.dumps({"technical": {"languages": [{"name": "Python"}, {"name": "Docker"}, {"name": "Linux/Unix"}]}}),
    "experience": json.dumps([
        {"company": "Contoso", "title": "Kubernetes Engineer", "responsibilities": ["Built ETL jobs in Python", "Wrote operations runbooks"],
         "technical_environment": {"technologies": ["Airflow", "Linux/Unix"], "tools": []}},
        {"company": "Fabrikam", "title": "Analyst", "responsibilities": ["Built dashboards with Tableau"],
         "technical_environment": {"technologies": [], "tools": []}},
    ]),
}
OTHER = dict(ROW, resume_id="T-2", experience=json.dumps([{"company": "X", "title": "Dev", "responsibilities": ["Used React"],
                                                             "technical_environment": {"technologies": ["React", "Kubernetes"]}}]))


class ClaimDatasetGenerator(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        with tempfile.TemporaryDirectory() as d:
            with open(os.path.join(d, "hirelens_rag_test_resumes.csv"), "w", encoding="utf-8", newline="") as f:
                w = csv.DictWriter(f, fieldnames=list(ROW))
                w.writeheader()
                w.writerows([ROW, OTHER])
            cls.cases, cls.skipped = build(d)
        cls.t1 = [c for c in cls.cases if c["resume_id"] == "T-1"]

    def case(self, entry, case_type):
        return [c for c in self.t1 if c["expected_entry_key"] == entry and c["case_type"] == case_type]

    def test_supported_only_when_literally_in_a_bullet_of_that_entry(self):
        [c] = self.case("experience:0", "supported_in_bullet")
        self.assertEqual((c["claim_term"], c["expected_outcome"], c["expected_bullet_ids"]), ("Python", "supported", "experience:0:0"))
        self.assertEqual(c["expected_bullet_texts"], "Built ETL jobs in Python")

    def test_negative_types_are_insufficient_evidence(self):
        for c in self.t1:
            if c["case_type"] != "supported_in_bullet":
                self.assertEqual((c["expected_outcome"], c["expected_bullet_ids"]), ("insufficient_evidence", "insufficient_evidence"))

    def test_skills_only_metadata_only_title_only_and_other_entry(self):
        self.assertEqual(self.case("experience:0", "skills_section_only")[0]["claim_term"], "Docker")
        self.assertEqual(self.case("experience:0", "entry_metadata_only")[0]["claim_term"], "Airflow")
        self.assertEqual(self.case("experience:0", "title_only")[0]["claim_term"], "Kubernetes")
        self.assertEqual(self.case("experience:1", "other_entry_only")[0]["claim_term"], "Python")

    def test_composite_and_generic_terms_are_not_used(self):
        terms = {c["claim_term"] for c in self.cases}
        self.assertNotIn("Linux/Unix", terms)
        self.assertFalse([t for t in terms if t.lower() == "operations"])

    def test_queries_are_question_form_and_name_the_entry(self):
        self.assertEqual(self.case("experience:0", "supported_in_bullet")[0]["query_text"],
                         "Did the candidate use Python in the Kubernetes Engineer role at Contoso?")

    def test_synthetic_flag_preserved(self):
        self.assertTrue(all(c["synthetic_test"] == "True" for c in self.cases))


if __name__ == "__main__":
    unittest.main()
