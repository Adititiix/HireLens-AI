"""Regression tests: internship / work-experience entries have searchable "Role — Company" title chunks."""
import contextlib
import io
import unittest

from matching.skill_matcher import SkillMatcher
from recommendations.evidence import EvidenceSuggestionEngine
from recommendations.evidence.models import ResumeIn, SuggestRequest
from recommendations.evidence.retriever import EvidenceIndex
from recommendations.evidence.segmenter import segment_structured
from tests.helpers import FakeEmbedder

EMPTY_GAP = {"missing": [], "matched": [], "high": [], "ordered": []}

RESUME = {
    "projects": [{"id": "p1", "name": "Campus Event Portal", "technologies": ["React"],
                  "description": "Built a web portal where students browse campus events."}],
    "experience": [
        {"id": "i1", "title": "Data Analyst Intern", "company": "Northwind Labs",
         "bullets": ["Cleaned survey datasets in Pandas.", "Wrote weekly KPI reports."]},
        {"id": "e1", "title": "Junior Software Engineer", "company": "Contoso",
         "bullets": ["Implemented REST endpoints for invoicing.", "Fixed flaky integration tests."]},
    ],
    "skills": {"technical": ["Python", "Pandas", "React"]},
    "education": [{"degree": "B.Tech"}],
}


def build(resume):
    units = segment_structured(ResumeIn(**resume))
    chunks = EvidenceSuggestionEngine()._chunks(units, "", EMPTY_GAP)
    return units, EvidenceIndex(FakeEmbedder()).build(chunks)


class TitleChunkTests(unittest.TestCase):
    def setUp(self):
        self.units, self.idx = build(RESUME)

    def test_each_experience_entry_gets_one_title_chunk_tied_to_its_entry(self):
        titles = {u.uid: u for u in self.units if u.field == "title"}
        self.assertEqual(set(titles), {"experience:0:title", "experience:1:title"})
        self.assertEqual(titles["experience:0:title"].text, "Data Analyst Intern — Northwind Labs")
        self.assertEqual(titles["experience:1:title"].text, "Junior Software Engineer — Contoso")
        for uid, u in titles.items():
            self.assertEqual(u.entry_key, uid.rsplit(":", 1)[0])
            self.assertFalse(u.rewritable, "a title is evidence, never a rewrite target")
        self.assertEqual(titles["experience:0:title"].entry_id, "i1")

    def test_internship_found_by_company_name(self):
        hits = self.idx.search("Find evidence for the candidate's internship at Northwind Labs.", sources=["resume"])
        self.assertTrue(hits)
        self.assertEqual(hits[0].chunk.id, "experience:0:title")
        self.assertEqual(hits[0].chunk.entry_key, "experience:0")

    def test_experience_found_by_role(self):
        hits = self.idx.search("Evidence supporting the Junior Software Engineer responsibilities.", sources=["resume"])
        self.assertEqual(hits[0].chunk.id, "experience:1:title")

    def test_query_for_unrelated_entry_matches_no_title(self):
        hits = self.idx.search("Internship at Fabrikam Robotics", sources=["resume"], top_k=10)
        self.assertFalse([h for h in hits if h.chunk.id.endswith(":title")])

    def test_role_query_does_not_return_the_other_role(self):
        hits = self.idx.search("Data Analyst Intern at Northwind Labs", sources=["resume"], top_k=10)
        ids = [h.chunk.id for h in hits]
        self.assertEqual(ids[0], "experience:0:title")
        self.assertNotIn("experience:1:title", ids[:1])

    def test_entry_filter_keeps_title_with_its_own_entry(self):
        hits = self.idx.search("Northwind Labs", sources=["resume"], entry_key="experience:1", top_k=10)
        self.assertFalse([h for h in hits if h.chunk.id == "experience:0:title"])

    def test_project_retrieval_unchanged(self):
        hits = self.idx.search("Find evidence of the candidate's work on Campus Event Portal.", sources=["resume"])
        self.assertEqual(hits[0].chunk.id, "projects:0:title")

    def test_no_title_chunk_when_role_and_company_are_empty(self):
        units, _ = build({"experience": [{"title": "", "company": "", "bullets": ["Built a scheduler."]}]})
        self.assertFalse([u for u in units if u.field == "title"])

    def test_other_candidates_entries_are_not_in_the_index(self):
        _, other = build({"experience": [{"id": "x", "title": "Barista", "company": "Cafe Uno", "bullets": ["Served customers."]}]})
        hits = other.search("internship at Northwind Labs", sources=["resume"], top_k=10)
        self.assertFalse([h for h in hits if "Northwind" in h.chunk.text])


class TitleChunksDoNotChangeSuggestions(unittest.TestCase):
    def run_engine(self, resume, jd=""):
        eng = EvidenceSuggestionEngine(embedder=FakeEmbedder(), skill_matcher=SkillMatcher(embedder=None))
        with contextlib.redirect_stdout(io.StringIO()):
            return eng.suggest(SuggestRequest(resume=resume, job_description=jd))

    def test_titles_are_never_suggestion_targets(self):
        titles = {"Data Analyst Intern — Northwind Labs", "Junior Software Engineer — Contoso"}
        for s in self.run_engine(RESUME)["suggestions"]:
            self.assertNotIn(s["original_text"], titles)

    def test_role_title_does_not_count_as_demonstrating_a_skill(self):
        r = {"experience": [{"id": "e", "title": "Python Developer", "company": "Acme", "bullets": ["Fixed reporting bugs."]}],
             "skills": {"technical": ["Python"]}, "education": [{"degree": "BSc"}]}
        res = self.run_engine(r, jd="We need strong Python skills for backend work.")
        self.assertTrue([s for s in res["suggestions"] if s["category"] == "skill_not_demonstrated" and "Python" in s["reason"]])


if __name__ == "__main__":
    unittest.main()
