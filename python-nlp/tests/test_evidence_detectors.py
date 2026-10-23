"""Rule-based detector tests.  Run from python-nlp/:  venv\\Scripts\\python -m unittest discover -s tests -t ."""
import unittest

from matching.skill_matcher import SkillMatcher
from recommendations.evidence.detectors import (Context, detect_repeated_phrases, detect_repeated_verbs,
                                                detect_unit_issues)
from recommendations.evidence.segmenter import Unit

MATCHER = SkillMatcher(embedder=None)


def bullet(text, entry="experience:0", i=0, section="experience", label="Intern — Acme"):
    return Unit(uid=f"{entry}:{i}", section=section, text=text, entry_label=label, entry_key=entry,
                entry_index=0, field="bullets" if section == "experience" else "description", line_index=i, rewritable=True)


def ctx(**kw):
    return Context(skill_terms=MATCHER.extract_skills, **kw)


def cats(issues):
    return [i.category for i in issues]


class RepetitionTests(unittest.TestCase):
    def test_repeated_action_verbs_across_bullets(self):
        units = [bullet("Developed REST APIs with Flask.", i=0), bullet("Developed an admin dashboard.", i=1),
                 bullet("Developed a reporting module for managers.", i=2, entry="experience:1")]
        issues = detect_repeated_verbs(units)
        self.assertEqual(len(issues), 2, "first use is fine; later repeats are flagged")
        self.assertEqual({i.rewrite.split()[0] for i in issues}, {"Built", "Implemented"},
                         "alternatives are near-synonyms and are spread out")
        self.assertTrue(all(i.severity == "low" for i in issues))

    def test_repeated_technical_terms_are_not_flagged(self):
        units = [bullet("Built a React dashboard using React Query and React Router.", i=0),
                 bullet("Designed React components with React Testing Library.", i=1),
                 bullet("Migrated the React frontend to React 18.", i=2)]
        self.assertEqual(detect_repeated_phrases(units, MATCHER.extract_skills), [])
        self.assertEqual(detect_repeated_verbs(units), [], "different opening verbs → nothing to flag")

    def test_accurate_verb_without_synonym_is_left_alone(self):
        units = [bullet(f"Benchmarked model {n} on the test set.", i=n) for n in range(3)]
        self.assertEqual(detect_repeated_verbs(units), [])

    def test_repeated_generic_phrase(self):
        units = [bullet("Built the parser and was responsible for various tasks in testing.", i=0),
                 bullet("Wrote docs and was responsible for various tasks in testing.", i=1)]
        issues = detect_repeated_phrases(units, MATCHER.extract_skills)
        self.assertTrue(issues)
        self.assertEqual(issues[0].category, "repeated_phrase")
        self.assertIsNone(issues[0].rewrite, "phrase repetition only gets advice, never an invented rewrite")


class WeakDescriptionTests(unittest.TestCase):
    def test_responsibility_bullet_rewritten_from_own_words(self):
        [i] = [x for x in detect_unit_issues(bullet("Responsible for maintaining the booking API."), ctx())
               if x.category == "responsibility_not_contribution"]
        self.assertEqual(i.rewrite, "Maintained the booking API.")
        self.assertEqual(i.severity, "high")

    def test_responsibility_without_known_verb_asks_instead(self):
        [i] = [x for x in detect_unit_issues(bullet("Responsible for the onboarding process."), ctx())
               if x.category == "responsibility_not_contribution"]
        self.assertIsNone(i.rewrite)
        self.assertIn("What did you personally do", i.question)

    def test_weak_opener(self):
        [i] = [x for x in detect_unit_issues(bullet("Worked on the payment service integration."), ctx())
               if x.category == "weak_opener"]
        self.assertEqual(i.rewrite, "Contributed to the payment service integration.")

    def test_vague_project_description(self):
        u = bullet("Implemented various features and etc.", section="projects", entry="projects:0", label="Shop")
        issues = [x for x in detect_unit_issues(u, ctx()) if x.category == "vague_description"]
        self.assertTrue(issues)
        self.assertIsNone(issues[0].rewrite)
        self.assertTrue(issues[0].question)

    def test_tech_list_only_uses_project_title_as_purpose(self):
        u = bullet("Used React, FastAPI and NLP.", section="projects", entry="projects:0",
                   label="HireLens AI — AI Resume Screening Platform")
        [i] = [x for x in detect_unit_issues(u, ctx()) if x.category == "tech_list_only"]
        self.assertEqual(i.rewrite, "Used React, FastAPI and NLP for the AI resume screening platform.")

    def test_tech_list_without_purpose_evidence_asks(self):
        u = bullet("Used React, FastAPI and NLP.", section="projects", entry="projects:0", label="HireLens")
        [i] = [x for x in detect_unit_issues(u, ctx()) if x.category == "tech_list_only"]
        self.assertIsNone(i.rewrite)
        self.assertIn("What did you build", i.question)

    def test_missing_action(self):
        issues = detect_unit_issues(bullet("Recommendation engine for hotel listings and search."), ctx())
        self.assertIn("missing_action", cats(issues))

    def test_too_long_split_at_clause_boundary(self):
        text = ("Built a data ingestion service that collects hotel reviews and ratings from several partner booking "
                "sources every night; designed the database schema and the indexes that let the internal analytics "
                "dashboard query reviews by city, hotel and rating")  # > 35 words
        self.assertGreater(len(text.split()), 35)
        [i] = [x for x in detect_unit_issues(bullet(text), ctx()) if x.category == "too_long"]
        first, second = i.rewrite.split("\n")
        self.assertTrue(first.endswith(".") and second.startswith("Designed"))

    def test_first_person(self):
        [i] = [x for x in detect_unit_issues(bullet("I built the login flow with JWT."), ctx()) if x.category == "first_person"]
        self.assertEqual(i.rewrite, "Built the login flow with JWT.")


class OutcomeTests(unittest.TestCase):
    def test_strong_specific_outcome_not_flagged(self):
        u = bullet("Reduced API latency from 900 ms to 120 ms by adding Redis caching.")
        self.assertEqual([c for c in cats(detect_unit_issues(u, ctx())) if c in ("missing_outcome", "weak_opener",
                                                                                   "missing_action", "vague_description")], [])

    def test_bullet_without_metric_gets_question_not_number(self):
        [i] = [x for x in detect_unit_issues(bullet("Developed a sentiment classification model for reviews."), ctx())
               if x.category == "missing_outcome"]
        self.assertIsNone(i.rewrite)
        self.assertIn("dataset size", i.question)

    def test_entry_that_already_has_metrics_is_not_flagged(self):
        u = bullet("Developed the review ingestion job.")
        issues = detect_unit_issues(u, ctx(entries_with_metrics={"experience:0"}))
        self.assertNotIn("missing_outcome", cats(issues))

    def test_learning_bullet_is_not_asked_for_metrics(self):
        for t in ("Built foundational understanding of retrieval-based AI architectures by exploring RAG concepts.",
                  "Developed strong public speaking, critical thinking, and teamwork skills while collaborating."):
            self.assertNotIn("missing_outcome", cats(detect_unit_issues(bullet(t), ctx())), t)
        # …but a real deliverable that merely mentions skills is still checked
        u = bullet("Built a recommendation system that suggests jobs based on skills.")
        self.assertIn("missing_outcome", cats(detect_unit_issues(u, ctx())))

    def test_research_work_is_low_severity(self):
        u = bullet("Developed a channel model for the ISAC research paper.", section="projects", entry="projects:0",
                   label="Cooperative ISAC (Conference Paper – Ongoing)")
        [i] = [x for x in detect_unit_issues(u, ctx()) if x.category == "missing_outcome"]
        self.assertEqual(i.severity, "low")


if __name__ == "__main__":
    unittest.main()
