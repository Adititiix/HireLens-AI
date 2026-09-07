"""
Embedder — sentence-transformer wrapper (FIXED)

Used by SkillMatcher (layer 3) and SuggestionEngine for semantic similarity.
Instantiated ONCE at app.py startup and injected into all components.

BUG FIXED in score_engine.py: was calling `emb = Embedder()` inside
compute_scores() creating a new 80MB model load on every request.
"""
import numpy as np
from typing import List
from sentence_transformers import SentenceTransformer
from sklearn.metrics.pairwise import cosine_similarity as sk_cosine


class Embedder:
    def __init__(self, model_name: str = "all-MiniLM-L6-v2"):
        print(f"[Embedder] Loading model: {model_name} ...")
        self.model = SentenceTransformer(model_name)
        print(f"[Embedder] ✅ Model loaded: {model_name}")

    def encode(self, texts: List[str]) -> np.ndarray:
        """Encode texts to normalized dense vectors."""
        return self.model.encode(
            texts,
            convert_to_numpy=True,
            normalize_embeddings=True,
        )

    def cosine_similarity(self, text_a: str, text_b: str) -> float:
        """Return cosine similarity (0.0–1.0) between two texts."""
        vecs  = self.encode([text_a, text_b])
        score = sk_cosine([vecs[0]], [vecs[1]])[0][0]
        return float(np.clip(score, 0.0, 1.0))

    def batch_similarity(
        self, queries: List[str], corpus: List[str]
    ) -> np.ndarray:
        """
        Returns (len(queries) × len(corpus)) cosine similarity matrix.
        Efficient batched encoding.
        """
        q_vecs = self.encode(queries)
        c_vecs = self.encode(corpus)
        return sk_cosine(q_vecs, c_vecs)
