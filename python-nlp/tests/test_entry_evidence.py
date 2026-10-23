"""Entry-anchored bullet retrieval (EvidenceIndex.search_entry_evidence) for internship / experience queries."""
import unittest

from recommendations.evidence import EvidenceSuggestionEngine
from recommendations.evidence.models import ResumeIn
from recommendations.evidence.retriever import EvidenceIndex
from recommendations.evidence.segmenter import segment_structured
from tests.helpers import FakeEmbedder

EMPTY_GAP = {"missing": [], "matched": [], "high": [], "ordered": []}


class WideFakeEmbedder(FakeEmbedder):
    """Same deterministic word-hash embedder with more dimensions: at 256 dims unrelated words can collide
    ("fabrikam" ~ "invoicing" scored 0.45), which would test hash luck instead of retrieval logic."""
    DIM = 4096


def index(resume):
    units = segment_structured(ResumeIn(**resume))
    return EvidenceIndex(WideFakeEmbedder()).build(EvidenceSuggestionEngine()._chunks(units, "", EMPTY_GAP))


RESUME = {
    "projects": [{"id": "p", "name": "Campus Event Portal", "technologies": ["React"],
                  "description": "Built a portal where students register for campus events."}],
    "experience": [
        {"id": "i", "title": "Data Analyst Intern", "company": "Northwind Labs",
         "bullets": ["Cleaned survey datasets with Pandas.", "Wrote weekly KPI reports for managers."]},
        {"id": "e", "title": "Junior Software Engineer", "company": "Contoso",
         "bullets": ["Implemented REST endpoints for invoicing.", "Fixed flaky integration tests in CI."]},
    ],
    "skills": {"technical": ["Python", "Pandas", "Docker"]},
}


def ids(hits):
    return [h.chunk.id for h in hits]


class EntryThenBullet(unittest.TestCase):
    def setUp(self):
        self.idx = index(RESUME)

    def test_internship_by_company_then_supporting_bullet(self):
        r = self.idx.search_entry_evidence("Find evidence of the internship at Northwind Labs using Pandas.")
        self.assertEqual(r.status, "supported")
        self.assertEqual(r.entry_key, "experience:0")
        self.assertEqual(r.claim, "pandas")
        self.assertEqual(ids(r.bullets), ["experience:0:0"], "only the bullet that supports the claim")

    def test_experience_by_role_then_supporting_bullet(self):
        r = self.idx.search_entry_evidence("Junior Software Engineer work on REST endpoints for invoicing")
        self.assertEqual((r.status, r.entry_key), ("supported", "experience:1"))
        self.assertEqual(ids(r.bullets)[0], "experience:1:0")
        self.assertTrue(all(h.chunk.entry_key == "experience:1" for h in r.bullets))

    def test_title_is_identification_never_evidence(self):
        r = self.idx.search_entry_evidence("internship at Northwind Labs using Pandas")
        self.assertEqual(r.title.chunk.id, "experience:0:title")
        self.assertNotIn("experience:0:title", ids(r.bullets))

    def test_not_every_bullet_of_the_entry_is_returned(self):
        r = self.idx.search_entry_evidence("internship at Northwind Labs using Pandas", top_k=10)
        self.assertNotIn("experience:0:1", ids(r.bullets), "the KPI-report bullet doesn't support a Pandas claim")

    def test_skill_absent_from_matching_entry_is_insufficient_evidence(self):
        r = self.idx.search_entry_evidence("internship at Northwind Labs using Kubernetes")
        self.assertEqual((r.status, r.entry_key, r.bullets), ("insufficient_evidence", "experience:0", []))

    def test_skill_from_another_entry_or_the_skills_list_is_not_borrowed(self):
        # "Docker" is only in the Skills list; "REST endpoints" belongs to the Contoso role.
        for q in ("internship at Northwind Labs with Docker", "internship at Northwind Labs building REST endpoints"):
            r = self.idx.search_entry_evidence(q)
            self.assertEqual(r.entry_key, "experience:0")
            self.assertEqual(r.bullets, [], q)
            self.assertEqual(r.status, "insufficient_evidence")

    def test_role_title_does_not_imply_a_technology(self):
        r = index({"experience": [{"id": "x", "title": "Python Developer", "company": "Acme",
                                   "bullets": ["Answered customer support tickets."]}]}
                  ).search_entry_evidence("Python Developer at Acme using Python")
        self.assertEqual(r.status, "insufficient_evidence", "the title 'Python Developer' is not proof of Python use")


class AmbiguityAndSimilarNames(unittest.TestCase):
    def test_multiple_roles_at_same_company(self):
        idx = index({"experience": [
            {"id": "a", "title": "Data Intern", "company": "Acme", "bullets": ["Built Tableau dashboards for sales."]},
            {"id": "b", "title": "Software Engineer", "company": "Acme", "bullets": ["Built Tableau dashboards for ops."]}]})
        r = idx.search_entry_evidence("Software Engineer at Acme built Tableau dashboards")
        self.assertEqual(r.entry_key, "experience:1")
        self.assertEqual(ids(r.bullets), ["experience:1:0"], "same wording in the other role is not returned")

    def test_equally_matching_roles_are_ambiguous(self):
        idx = index({"experience": [
            {"id": "a", "title": "Analyst", "company": "Acme", "bullets": ["Wrote SQL reports."]},
            {"id": "b", "title": "Tester", "company": "Acme", "bullets": ["Wrote test plans."]}]})
        r = idx.search_entry_evidence("Acme")
        self.assertEqual((r.status, r.bullets), ("ambiguous_entry", []))

    def test_companies_with_similar_names(self):
        idx = index({"experience": [
            {"id": "a", "title": "Intern", "company": "Northwind Labs", "bullets": ["Cleaned datasets with Pandas."]},
            {"id": "b", "title": "Intern", "company": "Northwind Logistics", "bullets": ["Cleaned routing data with Pandas."]}]})
        r = idx.search_entry_evidence("internship at Northwind Logistics using Pandas")
        self.assertEqual(r.entry_key, "experience:1")
        self.assertEqual(ids(r.bullets), ["experience:1:0"])


class Boundaries(unittest.TestCase):
    def test_no_leakage_across_candidates(self):
        other = index({"experience": [{"id": "z", "title": "Barista", "company": "Cafe Uno", "bullets": ["Cleaned espresso machines."]}]})
        r = other.search_entry_evidence("internship at Northwind Labs using Pandas")
        self.assertEqual(r.status, "no_entry_match")
        self.assertEqual(r.bullets, [])

    def test_bullets_never_leave_the_matched_entry(self):
        idx = index(RESUME)
        for q in ("internship at Northwind Labs Pandas reports", "Junior Software Engineer at Contoso tests"):
            r = idx.search_entry_evidence(q, top_k=10)
            self.assertTrue(all(h.chunk.entry_key == r.entry_key for h in r.bullets), q)

    def test_project_queries_are_not_expanded(self):
        idx = index(RESUME)
        r = idx.search_entry_evidence("Find evidence of the candidate's work on Campus Event Portal.")
        self.assertEqual(r.status, "no_entry_match")
        self.assertEqual(ids(idx.search("Find evidence of the candidate's work on Campus Event Portal.", sources=["resume"]))[0],
                         "projects:0:title", "existing project retrieval unchanged")

    def test_project_query_sharing_a_word_with_an_internship_is_not_captured(self):
        # Regression (real-model evaluation): "… Synthetic Case 01" project queries share words with
        # "… — Synthetic Software Lab 01" and were wrongly expanded into the internship's bullets.
        idx = index({"projects": [{"id": "p", "name": "Campus Event Portal - Synthetic Case 01", "technologies": [],
                                   "description": "Built a portal where students register for events."}],
                     "experience": [{"id": "i", "title": "Software Engineering Intern", "company": "Synthetic Software Lab 01",
                                     "bullets": ["Implemented API endpoints for event registration."]}]})
        q = "Find evidence of the candidate's work on Campus Event Portal - Synthetic Case 01."
        self.assertEqual(idx.search_entry_evidence(q).status, "no_entry_match")
        r = idx.search_entry_evidence("Find evidence for the candidate's internship at Synthetic Software Lab 01.")
        self.assertEqual(r.entry_key, "experience:0", "the internship query itself is still identified")

    def test_role_at_a_different_company_yields_no_evidence(self):
        # Shares "software engineer" with the Contoso title but names another employer: the closest role may be
        # identified (lexical identification), yet none of its bullets supports a "Fabrikam" claim.
        r = index(RESUME).search_entry_evidence("Software Engineer at Fabrikam")
        self.assertEqual(r.bullets, [])
        self.assertIn(r.status, ("insufficient_evidence", "no_entry_match"))

    def test_empty_query(self):
        self.assertEqual(index(RESUME).search_entry_evidence("   ").status, "no_entry_match")


if __name__ == "__main__":
    unittest.main()
