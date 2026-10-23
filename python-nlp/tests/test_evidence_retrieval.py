"""Deterministic retrieval tests for recommendations/evidence/retriever.py (no model, no torch, no downloads)."""
import gc
import importlib
import sys
import types
import unittest

import numpy as np

from recommendations.evidence.retriever import Chunk, EvidenceIndex

# Synonyms share one dimension, so related wording scores high with ZERO shared keywords.
CONCEPTS = {
    "vehicle": {"car", "automobile", "vehicle", "cars"},
    "repair": {"repair", "maintenance", "fixing", "servicing"},
    "database": {"database", "postgresql", "sql", "datastore"},
    "music": {"music", "concert", "festival", "band"},
    "api": {"api", "apis", "endpoint", "endpoints", "rest"},
}
WORD_TO_DIM = {w: i for i, (_, words) in enumerate(sorted(CONCEPTS.items())) for w in words}


class ConceptEmbedder:
    """Deterministic, L2-normalized concept vectors (like Embedder.encode with normalize_embeddings=True)."""
    DIM = 64

    def __init__(self):
        self.calls = []

    def encode(self, texts):
        self.calls.append(list(texts))
        out = np.zeros((len(texts), self.DIM), dtype=np.float64)
        for i, t in enumerate(texts):
            for w in t.lower().replace(",", " ").split():
                dim = WORD_TO_DIM.get(w, len(CONCEPTS) + (sum(map(ord, w)) % (self.DIM - len(CONCEPTS))))
                out[i, dim] += 1.0
            n = np.linalg.norm(out[i])
            if n:
                out[i] /= n
        return out


def cosine(a, b):
    return float(np.dot(a, b) / (np.linalg.norm(a) * np.linalg.norm(b)))


def corpus():
    return [
        Chunk(id="r1", text="Built REST endpoints for the booking database", source="resume", entry_key="experience:0", verified=True),
        Chunk(id="r2", text="Automobile maintenance scheduling tool", source="resume", entry_key="projects:0", verified=True),
        Chunk(id="r3", text="Organized the college music festival", source="resume", entry_key="achievements:0", verified=True),
        Chunk(id="j1", text="Experience with PostgreSQL and REST APIs is required", source="job_description"),
        Chunk(id="g1", text="Start each bullet with an action verb", source="guideline"),
    ]


class EmbedderContractTests(unittest.TestCase):
    """The retriever scores with np.dot, which equals cosine only for unit vectors."""

    def test_embedder_requests_normalized_embeddings(self):
        captured = {}

        class FakeSentenceTransformer:
            def __init__(self, name):
                captured["model"] = name

            def encode(self, texts, **kwargs):
                captured.update(kwargs)
                v = np.array([[3.0, 4.0]] * len(texts))
                return v / np.linalg.norm(v, axis=1, keepdims=True) if kwargs.get("normalize_embeddings") else v

        fake = types.ModuleType("sentence_transformers")
        fake.SentenceTransformer = FakeSentenceTransformer
        saved = {k: sys.modules.get(k) for k in ("sentence_transformers", "parsers.embedder")}
        sys.modules["sentence_transformers"] = fake
        sys.modules.pop("parsers.embedder", None)
        try:
            import io, contextlib
            with contextlib.redirect_stdout(io.StringIO()):
                Embedder = importlib.import_module("parsers.embedder").Embedder
                vecs = Embedder().encode(["a", "b"])
        finally:
            for k, v in saved.items():
                if v is None:
                    sys.modules.pop(k, None)
                else:
                    sys.modules[k] = v
        self.assertIs(captured.get("normalize_embeddings"), True, "Embedder.encode must request L2-normalized vectors")
        np.testing.assert_allclose(np.linalg.norm(vecs, axis=1), 1.0)

    def test_semantic_score_equals_cosine_similarity(self):
        emb = ConceptEmbedder()
        idx = EvidenceIndex(emb).build(corpus())
        q = "car repair"
        qv = emb.encode([q])[0]
        for hit in idx.search(q, top_k=10, min_score=0.0):
            cv = emb.encode([hit.chunk.text])[0]
            self.assertAlmostEqual(hit.semantic, round(max(0.0, min(1.0, cosine(qv, cv))), 4), places=4)

    def test_hybrid_score_uses_documented_weights(self):
        idx = EvidenceIndex(ConceptEmbedder()).build(corpus())
        for hit in idx.search("REST database", top_k=10, min_score=0.0):
            self.assertAlmostEqual(hit.score, round(0.6 * hit.semantic + 0.4 * hit.keyword, 4), places=3)
        self.assertEqual((EvidenceIndex.SEMANTIC_WEIGHT, EvidenceIndex.KEYWORD_WEIGHT), (0.6, 0.4))


class RetrievalTests(unittest.TestCase):
    def setUp(self):
        self.idx = EvidenceIndex(ConceptEmbedder()).build(corpus())

    def test_exact_keyword_match(self):
        kw_only = EvidenceIndex(None).build(corpus())
        hits = kw_only.search("PostgreSQL", min_score=0.0)
        self.assertEqual(hits[0].chunk.id, "j1")
        self.assertGreater(hits[0].keyword, 0)
        self.assertEqual(hits[0].semantic, 0.0)

    def test_semantically_related_text_with_no_keyword_overlap(self):
        hits = self.idx.search("car repair", min_score=0.2)
        self.assertEqual(hits[0].chunk.id, "r2")
        self.assertEqual(hits[0].keyword, 0.0, "no shared words")
        # 2 of the chunk's 4 words match the query's 2 concepts → cosine 2/sqrt(8)
        self.assertAlmostEqual(hits[0].semantic, round(2 / np.sqrt(8), 4), places=4)
        # keyword-only retrieval cannot find it — the semantic component is what makes it relevant
        self.assertEqual(EvidenceIndex(None).build(corpus()).search("car repair", min_score=0.2), [])

    def test_unrelated_text_is_not_retrieved(self):
        self.assertEqual(self.idx.search("quantum chromodynamics lecture", min_score=0.2), [])

    def test_source_filtering(self):
        hits = self.idx.search("REST APIs database", sources=["resume"], top_k=10, min_score=0.0)
        self.assertTrue(hits)
        self.assertEqual({h.chunk.source for h in hits}, {"resume"})
        jd = self.idx.search("REST APIs database", sources=["job_description"], top_k=10, min_score=0.0)
        self.assertEqual([h.chunk.id for h in jd], ["j1"])

    def test_entry_filter_and_excluded_ids(self):
        hits = self.idx.search("REST database", entry_key="experience:0", top_k=10, min_score=0.0)
        self.assertEqual([h.chunk.id for h in hits], ["r1"])
        hits = self.idx.search("REST database", top_k=10, min_score=0.0, exclude_ids=["r1", "j1"])
        self.assertNotIn("r1", [h.chunk.id for h in hits])
        self.assertNotIn("j1", [h.chunk.id for h in hits])

    def test_require_terms(self):
        hits = self.idx.search("REST", require_terms=["postgresql"], top_k=10, min_score=0.0)
        self.assertEqual([h.chunk.id for h in hits], ["j1"])

    def test_empty_queries(self):
        for q in ("", "   ", None):
            self.assertEqual(self.idx.search(q, min_score=0.0), [])
        self.assertEqual(EvidenceIndex(ConceptEmbedder()).build([]).search("anything", min_score=0.0), [])

    def test_min_score_threshold_is_inclusive(self):
        best = self.idx.search("car repair", min_score=0.0)[0]
        self.assertIn(best.chunk.id, [h.chunk.id for h in self.idx.search("car repair", min_score=best.score)])
        self.assertNotIn(best.chunk.id, [h.chunk.id for h in self.idx.search("car repair", min_score=best.score + 0.001)])

    def test_stable_ranking_for_controlled_corpus(self):
        dup = [Chunk(id=f"d{i}", text="REST endpoints for the database", source="resume") for i in range(4)]
        idx = EvidenceIndex(ConceptEmbedder()).build([*corpus(), *dup])
        first = [h.chunk.id for h in idx.search("REST database", top_k=10, min_score=0.0)]
        for _ in range(3):
            self.assertEqual([h.chunk.id for h in idx.search("REST database", top_k=10, min_score=0.0)], first)
        tied = [i for i in first if i.startswith("d")]
        self.assertEqual(tied, ["d0", "d1", "d2", "d3"], "equal scores keep corpus order")
        self.assertEqual([h.chunk.id for h in idx.search("REST database", top_k=2, min_score=0.0)], first[:2])

    def test_each_chunk_embedded_once_and_queries_cached(self):
        emb = ConceptEmbedder()
        idx = EvidenceIndex(emb).build(corpus())
        self.assertEqual(len(emb.calls), 1, "corpus encoded in one batch")
        idx.search("car repair"); idx.search("car repair")
        self.assertEqual(len(emb.calls), 2, "repeated query is not re-encoded")


class GuidelineCacheTests(unittest.TestCase):
    """Regression: the guideline-vector cache used to be keyed by id(embedder), which Python reuses."""

    def test_cache_belongs_to_its_embedder(self):
        a, b = ConceptEmbedder(), ConceptEmbedder()
        EvidenceIndex(a).build(corpus())
        EvidenceIndex(b).build(corpus())
        self.assertIn("Start each bullet with an action verb", b.calls[0], "b encodes guidelines itself")
        EvidenceIndex(a).build(corpus())
        self.assertNotIn("Start each bullet with an action verb", a.calls[-1], "a reuses its own cached vectors")

    def test_new_embedder_never_gets_a_previous_models_vectors(self):
        class Dim:
            def __init__(self, d): self.d = d
            def encode(self, texts):
                v = np.ones((len(texts), self.d)); return v / np.linalg.norm(v, axis=1, keepdims=True)
        chunks = [Chunk(id="g", text="Guideline", source="guideline"), Chunk(id="r", text="resume line", source="resume")]
        for _ in range(30):            # ids of collected objects are frequently reused
            a = Dim(8); EvidenceIndex(a).build(chunks); del a; gc.collect()
            idx = EvidenceIndex(Dim(16)).build(chunks)
            self.assertEqual(idx._vecs.shape, (2, 16))


if __name__ == "__main__":
    unittest.main()
