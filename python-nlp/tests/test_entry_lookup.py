"""Entry lookup (lookup_entry) vs claim verification (search_entry_evidence)."""
import unittest

from tests.test_entry_evidence import RESUME, index


def ids(hits):
    return [h.chunk.id for h in hits]


class EntryLookup(unittest.TestCase):
    def setUp(self):
        self.idx = index(RESUME)

    def test_lookup_internship_by_company_name(self):
        r = self.idx.lookup_entry("Find evidence for the candidate's internship at Northwind Labs.")
        self.assertEqual((r.status, r.entry_key, r.kind), ("entry_content", "experience:0", "entry_content"))
        self.assertEqual(sorted(ids(r.content)), ["experience:0:0", "experience:0:1"])

    def test_lookup_job_by_role(self):
        r = self.idx.lookup_entry("Show the Junior Software Engineer role")
        self.assertEqual((r.status, r.entry_key), ("entry_content", "experience:1"))
        self.assertEqual(sorted(ids(r.content)), ["experience:1:0", "experience:1:1"])

    def test_lookup_returns_only_the_selected_entry_and_never_its_title(self):
        r = self.idx.lookup_entry("internship at Northwind Labs", top_k=50)
        self.assertTrue(all(h.chunk.entry_key == "experience:0" for h in r.content))
        self.assertNotIn("experience:0:title", ids(r.content))
        self.assertFalse([h for h in r.content if h.chunk.id in ("skills", "projects:0:0")])

    def test_lookup_content_is_ranked_by_existing_similarity(self):
        r = self.idx.lookup_entry("internship at Northwind Labs survey datasets")
        self.assertEqual(ids(r.content)[0], "experience:0:0")
        scores = [h.score for h in r.content]
        self.assertEqual(scores, sorted(scores, reverse=True))

    def test_lookup_can_identify_a_project(self):
        r = self.idx.lookup_entry("Show the Campus Event Portal project")
        self.assertEqual((r.status, r.entry_key), ("entry_content", "projects:0"))
        self.assertEqual(ids(r.content), ["projects:0:0"])


class ClaimVerificationStaysStrict(unittest.TestCase):
    def setUp(self):
        self.idx = index(RESUME)

    def test_lookup_query_is_not_a_verified_claim(self):
        r = self.idx.search_entry_evidence("Find evidence for the candidate's internship at Northwind Labs.")
        self.assertEqual((r.status, r.bullets, r.claim), ("no_claim", [], ""))
        self.assertEqual(r.entry_key, "experience:0", "the entry is still identified, nothing is verified")

    def test_same_entry_claim_is_verified_only_by_a_supporting_bullet(self):
        r = self.idx.search_entry_evidence("internship at Northwind Labs using Pandas")
        self.assertEqual((r.status, ids(r.bullets)), ("supported", ["experience:0:0"]))
        lookup = self.idx.lookup_entry("internship at Northwind Labs using Pandas")
        self.assertEqual(len(lookup.content), 2, "lookup lists both lines; verification keeps only the supporting one")

    def test_missing_skill_is_insufficient_evidence(self):
        r = self.idx.search_entry_evidence("internship at Northwind Labs using Kubernetes")
        self.assertEqual((r.status, r.bullets), ("insufficient_evidence", []))

    def test_skill_named_in_the_title_is_still_a_claim_and_not_proven_by_the_title(self):
        idx = index({"experience": [{"id": "x", "title": "Python Developer", "company": "Acme",
                                     "bullets": ["Answered customer support tickets."]}]})
        r = idx.search_entry_evidence("Python Developer at Acme using Python")
        self.assertEqual((r.claim, r.status, r.bullets), ("python", "insufficient_evidence", []))


class AmbiguityEmptinessIsolation(unittest.TestCase):
    def test_ambiguous_roles_or_companies(self):
        idx = index({"experience": [
            {"id": "a", "title": "Analyst", "company": "Acme", "bullets": ["Wrote SQL reports."]},
            {"id": "b", "title": "Tester", "company": "Acme", "bullets": ["Wrote test plans."]}]})
        lk = idx.lookup_entry("Acme")
        self.assertEqual((lk.status, lk.content), ("ambiguous_entry", []))
        self.assertEqual(idx.search_entry_evidence("Acme SQL").status, "ambiguous_entry")

    def test_entry_without_bullets_is_empty(self):
        idx = index({"experience": [{"id": "e", "title": "Teaching Assistant", "company": "State University", "bullets": []}],
                     "skills": {"technical": ["Python"]}})
        r = idx.lookup_entry("Teaching Assistant at State University")
        self.assertEqual((r.status, r.entry_key, r.content), ("empty_entry", "experience:0", []))

    def test_other_candidates_entries_are_never_returned(self):
        other = index({"experience": [{"id": "z", "title": "Barista", "company": "Cafe Uno", "bullets": ["Made espresso."]}]})
        self.assertEqual(other.lookup_entry("internship at Northwind Labs").status, "no_entry_match")
        self.assertEqual(other.search_entry_evidence("internship at Northwind Labs using Pandas").status, "no_entry_match")

    def test_entries_do_not_leak_into_each_other(self):
        idx = index(RESUME)
        for q in ("Junior Software Engineer at Contoso", "internship at Northwind Labs"):
            r = idx.lookup_entry(q, top_k=50)
            self.assertEqual({h.chunk.entry_key for h in r.content}, {r.entry_key}, q)

    def test_query_naming_nothing_is_no_match(self):
        self.assertEqual(index(RESUME).lookup_entry("Show me something interesting").status, "no_entry_match")
        self.assertEqual(index(RESUME).lookup_entry("   ").status, "no_entry_match")


class ProjectRetrievalUnchanged(unittest.TestCase):
    def test_plain_search_and_claim_verification_for_projects_unchanged(self):
        idx = index(RESUME)
        q = "Find evidence of the candidate's work on Campus Event Portal."
        self.assertEqual(ids(idx.search(q, sources=["resume"]))[0], "projects:0:title")
        self.assertEqual(idx.search_entry_evidence(q).status, "no_entry_match")

    def test_project_sharing_words_with_an_internship_is_looked_up_as_the_project(self):
        idx = index({"projects": [{"id": "p", "name": "Campus Event Portal - Synthetic Case 01", "technologies": [],
                                   "description": "Built a portal where students register for events."}],
                     "experience": [{"id": "i", "title": "Software Engineering Intern", "company": "Synthetic Software Lab 01",
                                     "bullets": ["Implemented API endpoints for event registration."]}]})
        self.assertEqual(idx.lookup_entry("Find evidence of the candidate's work on Campus Event Portal - Synthetic Case 01.").entry_key,
                         "projects:0")
        self.assertEqual(idx.lookup_entry("Find evidence for the candidate's internship at Synthetic Software Lab 01.").entry_key,
                         "experience:0")


if __name__ == "__main__":
    unittest.main()
