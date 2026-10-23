"""Shared test fixtures: a deterministic fake embedder and a sample structured resume."""
import hashlib
import re

import numpy as np


class FakeEmbedder:
    """Bag-of-words hashing vectors (normalized) — deterministic stand-in for all-MiniLM-L6-v2 in tests.
    Texts sharing words get higher cosine similarity, which is all the retriever needs to be exercised."""
    DIM = 256

    def __init__(self):
        self.calls = 0

    def encode(self, texts):
        self.calls += 1
        out = np.zeros((len(texts), self.DIM), dtype=np.float32)
        for i, t in enumerate(texts):
            for w in re.findall(r"[a-z0-9]+", (t or "").lower()):
                out[i, int(hashlib.md5(w.encode()).hexdigest(), 16) % self.DIM] += 1.0
            n = np.linalg.norm(out[i])
            if n:
                out[i] /= n
        return out


def sample_resume():
    return {
        "summary": "Computer science student building ML-driven applications.",
        "experience": [{
            "id": "exp1", "title": "Full Stack Developer Intern", "company": "Briddlee",
            "bullets": [
                "Responsible for maintaining the hotel recommendation backend.",
                "Developed REST APIs with Flask for the recommendation service.",
                "Developed an admin dashboard for hotel managers.",
                "Worked on the deployment pipeline on Vercel and Firebase.",
            ],
        }],
        "projects": [
            {"id": "p1", "name": "HireLens AI — AI Resume Screening Platform",
             "description": "Used React, FastAPI and NLP.\nDeveloped semantic resume-job matching and skill-gap analysis.",
             "technologies": ["React", "FastAPI", "Sentence Transformers"]},
            {"id": "p2", "name": "TrustVault", "description": "Optimized the encryption pipeline for session-based key management.",
             "technologies": ["Python", "FastAPI"]},
        ],
        "achievements": [{"id": "a1", "title": "IEEE ICISC 2026",
                          "description": "TrustVault: recorded 35,349 records/sec cryptographic throughput."}],
        "skills": {"technical": ["Python", "React", "FastAPI", "PostgreSQL", "Flask"]},
        "education": [{"degree": "B.Tech"}],
    }
