"""Tests for the RAG evaluation harness (evaluation/rag_dataset.py) — adapter, relevance mapping, metrics."""
import json
import math
import unittest

from evaluation.rag_dataset import (adapt_record, expected_units, random_baseline, ranking_metrics,
                                    relevant_chunk_ids)
from recommendations.evidence.engine import EvidenceSuggestionEngine
from recommendations.evidence.models import ResumeIn
from recommendations.evidence.retriever import EvidenceIndex
from recommendations.evidence.segmenter import segment_structured


def row(**kw):
    base = {"resume_id": "R-1", "record_type": "synthetic", "education": "[]", "skills": "{}",
            "projects": "[]", "internships": "", "experience": "[]"}
    base.update({k: (json.dumps(v) if not isinstance(v, str) else v) for k, v in kw.items()})
    return base


def index_for(rec):
    units = segment_structured(ResumeIn(**rec.resume))
    chunks = EvidenceSuggestionEngine()._chunks(units, "", {"missing": [], "matched": [], "high": [], "ordered": []})
    return EvidenceIndex(None).build(chunks)


class AdapterTests(unittest.TestCase):
    def test_sections_mapped_and_internships_kept_distinct(self):
        rec = adapt_record(row(
            projects=[{"name": "Portal", "description": "Built a portal.", "technologies": ["React"], "impact": "Used by clubs [SYNTHETIC TEST DATA]"}],
            internships=[{"company": "Lab", "title": "Intern", "responsibilities": ["Wrote tests", "Fixed bugs"]}],
            experience=[{"company": "Acme", "title": "Analyst", "responsibilities": ["Built dashboards"]}]))
        self.assertEqual(rec.entry_section, {"projects:0": "projects", "experience:0": "internships", "experience:1": "experience"})
        self.assertEqual(rec.resume["projects"][0]["description"], "Built a portal.\nUsed by clubs")
        self.assertNotIn("SYNTHETIC", json.dumps(rec.resume), "marker stripped from indexed text")
        self.assertEqual(rec.record_type, "synthetic", "record_type preserved as metadata")

    def test_unknown_placeholders_never_become_experience(self):
        rec = adapt_record(row(
            projects=[{"name": "Unknown", "description": "Unknown", "technologies": ["Unknown"], "impact": "Unknown"}],
            experience=[{"company": "Unknown", "title": "Unknown", "responsibilities": ["Unknown", ""]}]))
        self.assertEqual(rec.resume["projects"], [])
        self.assertEqual(rec.resume["experience"], [])
        self.assertIn("no indexable project, internship or experience content", rec.issues)
        idx = index_for(rec)
        self.assertFalse([c for c in idx.chunks if c.source == "resume" and "unknown" in c.text.lower()])

    def test_parse_errors_are_recorded_not_hidden(self):
        rec = adapt_record(row(projects="[{not json", experience="", internships=""))
        self.assertTrue(any("projects: JSON parse error" in i for i in rec.issues))
        self.assertTrue(any("experience: empty" in i for i in rec.issues))

    def test_unsupported_entry_format_recorded(self):
        rec = adapt_record(row(projects=["just a string"]))
        self.assertTrue(any("unsupported format" in i for i in rec.issues))

    def test_nested_skills_flattened(self):
        rec = adapt_record(row(skills={"technical": {"programming_languages": [{"name": "Python", "level": "x"}, {"name": "Unknown"}]}}))
        self.assertEqual(rec.resume["skills"], {"technical": ["Python"]})


class RelevanceAndMetricTests(unittest.TestCase):
    def setUp(self):
        self.rec = adapt_record(row(
            projects=[{"name": "Portal", "description": "Built a portal for events.", "technologies": [], "impact": ""}],
            internships=[{"company": "Lab", "title": "Intern", "responsibilities": ["Wrote unit tests", "Built a portal for events."]}]))
        self.idx = index_for(self.rec)

    def test_internship_label_maps_to_its_bullets_only(self):
        units = expected_units("Wrote unit tests; Built a portal for events.", "Internships")
        rel, missing, entry = relevant_chunk_ids(self.idx.chunks, units, self.rec.entry_section, "internships")
        self.assertEqual(rel, {"experience:0:0", "experience:0:1"})
        self.assertEqual(missing, [])
        self.assertNotIn("projects:0:0", rel, "identical text in ANOTHER section is not counted as relevant")

    def test_project_label_and_entry_level(self):
        rel, _, entry = relevant_chunk_ids(self.idx.chunks, ["Built a portal for events."], self.rec.entry_section, "projects")
        self.assertEqual(rel, {"projects:0:0"})
        self.assertEqual(entry, {"projects:0:0", "projects:0:title"})

    def test_missing_label_is_reported(self):
        _, missing, _ = relevant_chunk_ids(self.idx.chunks, ["Never written anywhere"], self.rec.entry_section, "projects")
        self.assertEqual(missing, ["Never written anywhere"])

    def test_ranking_metrics(self):
        m = ranking_metrics(["a", "b", "c"], {"b", "x"})
        self.assertEqual((m["P@1"], m["Hit@1"], m["RR"]), (0.0, 0.0, 0.5))
        self.assertAlmostEqual(m["P@3"], 1 / 3)
        self.assertEqual(m["Recall@3"], 0.5)
        self.assertEqual(ranking_metrics([], {"a"})["RR"], 0.0)
        self.assertTrue(math.isnan(ranking_metrics(["a"], set())["Recall@1"]))

    def test_random_baseline_exact_values(self):
        b = random_baseline(7, 1)
        self.assertAlmostEqual(b["Hit@1"], 1 / 7)
        self.assertAlmostEqual(b["Hit@5"], 5 / 7)
        self.assertAlmostEqual(b["RR"], sum(1 / i for i in range(1, 8)) / 7)
        self.assertEqual(random_baseline(3, 3)["Hit@1"], 1.0)
        self.assertEqual(random_baseline(4, 1)["Hit@5"], 1.0, "top-5 of a 4-chunk corpus always contains it")


if __name__ == "__main__":
    unittest.main()
