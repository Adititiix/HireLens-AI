"""
Lightweight in-memory retrieval (RAG without a generator) over ONE request's data.

Chunks are typed by source so evidence of the candidate's accomplishments is
never confused with job requirements or generic advice:
    resume           — the candidate's own text (the only source of facts about them)
    job_description  — requirements of the target job
    analysis         — computed results (skill gap) about this resume
    guideline        — curated writing rules (guidelines.py)

Scoring is hybrid: keyword overlap (exact terms matter for skills/ATS) blended
with cosine similarity from the shared all-MiniLM-L6-v2 embedder. Every chunk is
embedded once per request (guideline vectors are cached for the process); the
index is discarded after the request, so nothing leaks between users.
"""
import math
from collections import Counter
import re
from dataclasses import dataclass, field
from typing import Dict, Iterable, List, Optional

import numpy as np

_TOKEN = re.compile(r"[a-z0-9][a-z0-9+#.\-/]*[a-z0-9+#]|[a-z0-9]")
STOPWORDS = frozenset("""
a an the and or of to in on for with by from at as is are was were be been being it its this that these those
into using use used via over under per my our we i you your their they them he she his her not no
""".split())


def tokens(text: str) -> List[str]:
    return [t for t in _TOKEN.findall((text or "").lower()) if t not in STOPWORDS]


@dataclass
class Chunk:
    id: str
    text: str
    source: str                   # resume | job_description | analysis | guideline
    label: str = ""
    entry_key: str = ""
    verified: bool = False
    terms: frozenset = field(default_factory=frozenset)


@dataclass
class Hit:
    chunk: Chunk
    score: float
    keyword: float
    semantic: float


@dataclass
class EntryEvidence:
    """CLAIM VERIFICATION result (search_entry_evidence). `title` only says WHICH entry the query identified —
    it is never evidence of a skill or accomplishment; only `bullets` are, and only for `claim`."""
    status: str                       # supported | insufficient_evidence | no_claim | no_entry_match | ambiguous_entry
    entry_key: Optional[str] = None
    title: Optional[Hit] = None
    bullets: List[Hit] = field(default_factory=list)
    claim: str = ""                   # the text the bullets were scored against ("" when the query makes no claim)


@dataclass
class EntryLookup:
    """ENTRY LOOKUP result (lookup_entry): the identified entry's own lines, ranked by similarity to the query.
    This is descriptive entry content — NOT verified evidence for any claim."""
    status: str                       # entry_content | empty_entry | no_entry_match | ambiguous_entry
    entry_key: Optional[str] = None
    title: Optional[Hit] = None
    content: List[Hit] = field(default_factory=list)
    kind: str = "entry_content"


# Words that express the request ("find evidence of the candidate's internship…") rather than a claim.
QUERY_INTENT_WORDS = frozenset({"find", "show", "evidence", "supporting", "support", "supports", "candidate", "candidates",
                                "s", "work", "worked", "working", "responsibilities", "responsibility", "duties",
                                "internship", "internships", "intern", "experience", "role", "job", "position", "during"})


class EvidenceIndex:
    SEMANTIC_WEIGHT = 0.6
    KEYWORD_WEIGHT = 0.4

    def __init__(self, embedder=None):
        self.embedder = embedder
        self.chunks: List[Chunk] = []
        self._vecs: Optional[np.ndarray] = None
        self._query_cache: Dict[str, np.ndarray] = {}

    @staticmethod
    def _guideline_cache(embedder) -> Dict[str, np.ndarray]:
        """Static guideline vectors cached ON the embedder instance, so the cache lives and dies with that
        model. (A global cache keyed by id(embedder) could hand a new embedder another model's vectors
        once Python reuses the id of a garbage-collected one.)"""
        cache = getattr(embedder, "_evidence_guideline_vecs", None)
        if cache is None:
            cache = {}
            try:
                setattr(embedder, "_evidence_guideline_vecs", cache)
            except AttributeError:   # e.g. an object with __slots__ — just don't cache
                pass
        return cache

    def build(self, chunks: Iterable[Chunk]) -> "EvidenceIndex":
        self.chunks = [Chunk(**{**c.__dict__, "terms": frozenset(tokens(c.text))}) for c in chunks if c.text.strip()]
        if self.embedder is not None and self.chunks:
            guideline_cache = self._guideline_cache(self.embedder)
            vecs: List[Optional[np.ndarray]] = [None] * len(self.chunks)
            todo = []
            for i, c in enumerate(self.chunks):
                cached = guideline_cache.get(c.text) if c.source == "guideline" else None
                if cached is not None:
                    vecs[i] = cached
                else:
                    todo.append(i)
            if todo:
                encoded = self.embedder.encode([self.chunks[i].text for i in todo])  # one batched call
                for i, v in zip(todo, encoded):
                    vecs[i] = v
                    if self.chunks[i].source == "guideline":
                        guideline_cache[self.chunks[i].text] = v
            self._vecs = np.vstack(vecs)
        return self

    def _query_vec(self, query: str) -> Optional[np.ndarray]:
        if self.embedder is None:
            return None
        if query not in self._query_cache:
            self._query_cache[query] = self.embedder.encode([query])[0]
        return self._query_cache[query]

    @staticmethod
    def keyword_score(q: frozenset, c: frozenset) -> float:
        if not q or not c:
            return 0.0
        return len(q & c) / math.sqrt(len(q) * len(c))

    def search(self, query: str, sources: Optional[Iterable[str]] = None, top_k: int = 3,
               min_score: float = 0.2, exclude_ids: Iterable[str] = (), entry_key: Optional[str] = None,
               require_terms: Iterable[str] = ()) -> List[Hit]:
        if not self.chunks or not (query or "").strip():
            return []
        allowed = set(sources) if sources else None
        excluded = set(exclude_ids)
        needed = [t.lower() for t in require_terms]
        q_terms = frozenset(tokens(query))
        q_vec = self._query_vec(query)
        hits: List[Hit] = []
        for i, c in enumerate(self.chunks):
            if (allowed and c.source not in allowed) or c.id in excluded:
                continue
            if entry_key is not None and c.entry_key != entry_key:
                continue
            if needed and not all(re.search(r"(?<![a-z0-9])" + re.escape(t) + r"(?![a-z0-9])", c.text.lower()) for t in needed):
                continue
            kw = self.keyword_score(q_terms, c.terms)
            sem = float(np.clip(np.dot(q_vec, self._vecs[i]), 0.0, 1.0)) if q_vec is not None else 0.0
            score = self.SEMANTIC_WEIGHT * sem + self.KEYWORD_WEIGHT * kw if q_vec is not None else kw
            score = round(score, 4)   # the threshold is applied to the same value that is reported
            if score >= min_score:
                hits.append(Hit(c, score, round(kw, 4), round(sem, 4)))
        hits.sort(key=lambda h: h.score, reverse=True)
        return hits[:top_k]

    # ── Entry-anchored retrieval: two distinct behaviours sharing one identification step ──────────────
    #   claim verification (search_entry_evidence): "did they use Pandas in the Northwind internship?" —
    #       only bullets that reach min_score against the CLAIM count as evidence; no claim → no_claim.
    #   entry lookup (lookup_entry): "show the Northwind internship" — the entry's own lines, ranked, labelled
    #       as entry content and never as verified evidence for any claim.

    def _identify_entry(self, query: str, min_score: float, prefixes: tuple):
        """Return (status, best_title_hit). The query names an entry when a title chunk of one of `prefixes`
        shares a non-request word with it and reaches min_score (existing search); the best-scoring one wins and
        an exact tie between two entries is ambiguous. Titles of other entry types still compete: an experience
        title must outscore every project title (else the query is about a project)."""
        if not (query or "").strip():
            return "no_entry_match", None
        named = set(tokens(query)) - QUERY_INTENT_WORDS
        ranked = self.search(query, sources=["resume"], top_k=len(self.chunks), min_score=min_score)
        all_titles = [h for h in ranked if h.chunk.id.endswith(":title")]
        titles = [h for h in all_titles if h.chunk.entry_key.startswith(prefixes) and named & h.chunk.terms]
        if not titles:
            return "no_entry_match", None
        best = titles[0]
        rivals = [h for h in all_titles if h.chunk.entry_key != best.chunk.entry_key
                  and not h.chunk.entry_key.startswith(prefixes) and h.score >= best.score]
        if rivals:                                            # another entry TYPE fits at least as well
            return "no_entry_match", None
        if any(h.score == best.score for h in titles[1:]):   # fits two entries equally well — don't guess
            return "ambiguous_entry", best
        return "identified", best

    @staticmethod
    def _claim(query: str, title_text: str) -> str:
        """The query minus request words and the title's words — each title word removed ONCE, so a skill that
        is also part of the title ("Python Developer … using Python") still counts as the claim."""
        remaining = Counter(tokens(title_text))
        out = []
        for t in tokens(query):
            if t in QUERY_INTENT_WORDS:
                continue
            if remaining[t] > 0:
                remaining[t] -= 1
                continue
            out.append(t)
        return " ".join(out)

    def search_entry_evidence(self, query: str, top_k: int = 3, min_score: float = 0.2) -> EntryEvidence:
        """CLAIM VERIFICATION for internship / work-experience entries.

        1. Identify the named experience entry (see _identify_entry; projects are not handled here).
        2. The claim is the query minus request words and the title's words. No claim left → `no_claim`
           (nothing to verify; use lookup_entry to show the entry).
        3. Supporting bullets: only inside that entry (entry_key filter), title excluded, ranked by the existing
           hybrid score against the claim and kept only if they reach `min_score`; none → insufficient_evidence.
        The title never counts as evidence, and entry membership alone is not support.
        """
        status, best = self._identify_entry(query, min_score, ("experience:",))
        if status != "identified":
            return EntryEvidence(status=status, title=best)
        claim = self._claim(query, best.chunk.text)
        if not claim:
            return EntryEvidence(status="no_claim", entry_key=best.chunk.entry_key, title=best)
        bullets = self.search(claim, sources=["resume"], top_k=top_k, min_score=min_score,
                              entry_key=best.chunk.entry_key, exclude_ids=[best.chunk.id])
        return EntryEvidence(status="supported" if bullets else "insufficient_evidence",
                             entry_key=best.chunk.entry_key, title=best, bullets=bullets, claim=claim)

    def lookup_entry(self, query: str, top_k: int = 10, min_score: float = 0.2) -> EntryLookup:
        """ENTRY LOOKUP for an internship, job or project the query names.

        Identification uses the same rules and threshold as claim verification (min_score applies to the
        title match). The identified entry's own lines (title excluded) are returned ranked by the existing
        similarity score; they are not relevance-filtered because listing an entry is not a claim — every
        line is marked as entry content, never as verified evidence.
        """
        status, best = self._identify_entry(query, min_score, ("experience:", "projects:"))
        if status != "identified":
            return EntryLookup(status=status, title=best)
        content = self.search(query, sources=["resume"], top_k=top_k, min_score=0.0,
                              entry_key=best.chunk.entry_key, exclude_ids=[best.chunk.id])
        return EntryLookup(status="entry_content" if content else "empty_entry",
                           entry_key=best.chunk.entry_key, title=best, content=content)
