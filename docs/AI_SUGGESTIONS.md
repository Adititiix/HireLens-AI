# AI Resume Suggestions

Evidence-grounded improvement suggestions for the resume open in the editor.

> **What it is — and isn't.** This is a **rule-based, retrieval-enhanced recommendation engine**, not a
> generative language model. Issues are found with deterministic rules; supporting evidence is retrieved
> from the candidate's own resume (plus the job description and writing guidelines) using keyword
> matching and the existing `all-MiniLM-L6-v2` embeddings; rewrites are templates over the candidate's
> own words and are validated before they are shown. It runs entirely locally: no OpenAI/Anthropic or
> other paid API, no new model download, no new database.

## Architecture

```
Editor (React)  ──POST /api/resume/suggestions──▶  Express gateway  ──POST /resume-suggestions──▶  FastAPI (python-nlp)
 SuggestionsPanel                                  suggestionController.js                          recommendations/evidence/
   ▲  Accept / Edit applies ONE line                (validation, rate limit,                          segmenter → SkillMatcher (existing)
   └─ via utils/suggestions.applySuggestion          error mapping)                                   → detectors → EvidenceIndex (retrieval)
                                                                                                       → validator → confidence → response
```

| Module (`python-nlp/recommendations/evidence/`) | Responsibility |
|---|---|
| `models.py` | Pydantic request/response models, size limits, null-tolerant parsing |
| `segmenter.py` | Resume → addressable units (section, entry, field, line index); plain-text fallback |
| `detectors.py` | Rule-based issue detectors (see below) |
| `retriever.py` | Per-request in-memory hybrid retrieval (keyword + MiniLM cosine), typed sources |
| `guidelines.py` | Curated writing guidelines (the only "general knowledge" used) |
| `validator.py` | Anti-hallucination checks and rule-based confidence |
| `engine.py` | Orchestration, evidence attachment, dedupe and conflict resolution |
| `api.py` | FastAPI router (`create_router`), safe error handling |

Reused, not duplicated: the shared `Embedder` (loaded once at startup), `SkillMatcher.extract_skills` /
`match_skills` (skill extraction and skill gap) and `ATSAnalyzer` (section checks for plain-text resumes).
The existing `/analyze` endpoint, `SuggestionEngine` and the match-score weights
(skill 0.40, semantic 0.35, project relevance 0.15, ATS 0.10) are unchanged — accepting a suggestion never
changes a score.

Frontend: `frontend/src/components/editor/SuggestionsPanel.jsx` (UI) and `frontend/src/utils/suggestions.js`
(pure apply/state logic). Backend: `backend/controllers/suggestionController.js`, route in `routes/resume.js`.

## API

`POST /api/resume/suggestions` (Express; public like `upload-anon`, rate-limited to 60/hour/IP; stores nothing)

```json
{
  "resume": { "summary": "…", "experience": [{ "id": "e1", "title": "Intern", "company": "Acme",
              "bullets": ["Responsible for maintaining the booking API."] }],
              "projects": [{ "id": "p1", "name": "HireLens AI — AI Resume Screening Platform",
              "description": "Used React, FastAPI and NLP.", "technologies": ["React", "FastAPI"] }],
              "achievements": [], "skills": { "technical": ["Python"] }, "education": [] },
  "resumeText": "",            // alternative to `resume` (plain text; suggestions are copy-only)
  "jobDescription": "…",       // optional
  "analysis": { "missing_skills": [], "matched_skills": [], "high_missing": [] },  // optional, reused from /analyze
  "maxSuggestions": 25         // optional, 1–50
}
```

Response (`200`):

```json
{
  "success": true,
  "suggestions": [{
    "id": "3f2a…", "category": "responsibility_not_contribution", "severity": "high",
    "section": "Experience", "entry": "Intern — Acme",
    "original_text": "Responsible for maintaining the booking API.",
    "suggested_text": "Maintained the booking API.",
    "reason": "The bullet describes a responsibility rather than what you actually did or delivered.",
    "supporting_evidence": [{ "text": "Describe what you contributed…", "source": "guideline",
                              "label": "Writing guideline", "verified": false }],
    "evidence_source": ["guideline"],
    "related_job_requirement": null,
    "confidence": { "level": "high", "score": 90, "signals": ["…"] },
    "requires_user_input": false, "follow_up_question": null,
    "target": { "section": "experience", "entry_index": 0, "entry_id": "e1", "field": "bullets", "line_index": 0 },
    "applicable": true
  }],
  "summary": { "total": 1, "by_category": {}, "by_severity": {}, "job_description_used": false, "structured_resume": true },
  "engine": { "type": "rule-based detection + evidence retrieval", "generative_model": false, "embedding_model": "all-MiniLM-L6-v2" }
}
```

Errors: `400` missing/invalid input (field + message only — resume text is never echoed), `413` body too
large, `503` NLP service not running, `502` NLP internal error. The NLP endpoint itself is
`POST /resume-suggestions` (snake_case fields) and returns `422` for invalid input.

## Detection rules (`detectors.py`)

| Category | Rule | Output |
|---|---|---|
| `responsibility_not_contribution` | "Responsible for / in charge of / tasked with …" | Gerund → past tense from the same words ("Responsible for maintaining X" → "Maintained X"); otherwise a question |
| `weak_opener` | "Worked on / helped with / involved in …" | "Contributed to …" (meaning-preserving) + question asking for a more specific verb |
| `repeated_verb` | Same opening verb ≥3 times, or twice in one entry | Near-synonym only (`SYNONYMS`); verbs without an equally accurate alternative are left alone |
| `repeated_phrase` | Generic phrase (e.g. "responsible for various tasks") in ≥2 bullets | Advice only; technical terminology never counts |
| `tech_list_only` | Bullet that only lists technologies | Purpose taken from the project's own title, else a question |
| `missing_action` | Bullet doesn't start with an action | Question |
| `vague_description` | "various features", "etc.", … | Question asking for specifics |
| `filler` | "in order to", leading "Successfully" | Tightened wording |
| `too_long` | > 35 words | Split at a clause boundary when one exists, else a question |
| `missing_outcome` | Build/improve verb, no result — at most once per entry, skipped when the entry already shows metrics, low severity for research/academic work, never for learning bullets | Targeted question (dataset/metric, requests/latency, data volume, users…) |
| `metric_available` | A result for the **same** project/role exists elsewhere in the resume | That result quoted from its source (with "only accept if it came from this work") |
| `missing_technical_context` | Short build bullet without how | Project's own listed technologies (flagged as an assumption, lower confidence) or a question |
| `first_person` | "I built …" | "Built …" |
| `missing_skill` | High/medium-priority job skill absent from the resume | Question only — never written into a bullet |
| `skill_not_demonstrated` | Job skill only in the Skills list | Question asking where it was used |
| `ats_section` | No experience/projects, skills or education | Advice/question |

## Retrieval (`retriever.py`)

For each request an in-memory index is built over typed chunks: `resume` (every bullet, project title,
achievement, the skills list), `job_description` (its sentences/lines), `analysis` (skill-gap results) and
`guideline`. Every chunk is embedded once in one batched call (guideline vectors are cached for the
process); the index is discarded after the request. Scores blend keyword overlap (0.4 — exact skill terms
matter) with MiniLM cosine similarity (0.6). Searches are always restricted by source, so job text or
guidelines can never be used as evidence of what the candidate did. Used for: finding a result reported
elsewhere for the same entry, linking a bullet to the job requirement it relates to (similarity ≥ 0.35),
and finding the job sentence for a missing skill plus the candidate's closest related work.

## Anti-hallucination validation (`validator.py`)

A rewrite is returned only if, compared with the original line **plus verified resume evidence**:
no new numbers (years and version numbers such as "Ultron 8.0" are not treated as results), no new
technologies (via the existing skill extractor), no new leadership/impact claims ("led", "users",
"revenue", "accuracy", …), no generic filler ("results-driven", "passionate", …), ≥70% of the original's
content words kept, and at most two new words beyond a small set of neutral connectors. Failing rewrites
become a question or are dropped. A rewrite that would duplicate an existing bullet is never offered, and
each line gets at most one rewrite (so accepted suggestions can't conflict).

## Confidence

Rule-based and documented — **not a calibrated probability**: start at 40; +20 supported by resume
evidence; +20 rewrite passed validation; +10 only rewords existing text; +5 linked to a job requirement;
−15 needs user input; −20 relies on an assumption (e.g. project technologies applied to a bullet).
≥75 high, ≥50 medium, otherwise low. The signals are returned with each suggestion and shown as a tooltip.

## Editor integration

The "AI Suggestions" card sits at the top of the editor's left column. Nothing changes until the user acts:
**Accept** (validated rewrites), **Edit/Rewrite** (write your own version, applied to the same line),
**Copy**, **Reject**, **Dismiss** (restorable). `applySuggestion` replaces only the targeted line, finds the
entry by id (robust to reordering), refuses if that line changed since the analysis, never creates duplicate
bullets, and leaves every other field (links, dates, other entries) untouched. Suggestions are not persisted;
accepted text is saved with the normal Save button.

## Privacy and safety

Resume data goes only to the local NLP service; logs contain counts and error types, never resume text.
Resume content is treated purely as data (it is only matched, embedded and templated — there is no model
that could follow instructions embedded in it). Each request builds and discards its own index.

## Running and testing

Start the three services as usual (see the README). No new setup or dependencies.

```bash
cd python-nlp && venv\Scripts\python -m unittest discover -s tests -t .   # Python: detectors, engine, API, regression
cd backend && npm test                                                     # Express gateway (+ existing tests)
cd frontend && npm test                                                    # apply logic + panel state (+ existing tests)
```

Python tests use a deterministic fake embedder, so they run in under a second without loading the model.

## Retrieval evaluation (labelled datasets)

`python-nlp/evaluation/evaluate_rag.py` runs the existing pipeline (real all-MiniLM-L6-v2, the engine's own
corpus builder and `EvidenceIndex.search`) over `evaluation/datasets/*.csv` and writes per-query, per-record,
suggestion-audit and summary files to `evaluation/results/`:

```bash
cd python-nlp
venv\Scripts\python -m evaluation.evaluate_rag            # --datasets DIR --out DIR --top-k 5 --min-score 0.2
```

Relevance is an exact mapping from the labelled evidence to chunk ids (no similarity judging); every metric is
reported next to an exact random-ranking baseline. Synthetic queries are pipeline smoke tests only, and no labels
exist for the original records or for Summary, so those metrics are reported as unavailable.

### Claim-verification evaluation

```bash
cd python-nlp
venv\Scripts\python -m evaluation.build_claim_dataset   # → evaluation/datasets/hirelens_claim_verification_cases.csv
venv\Scripts\python -m evaluation.evaluate_claims       # → evaluation/results_claims/
```

Cases are derived mechanically from the resume data: a technology claim is `supported` only when the technology
is literally named in a bullet of that entry; negatives cover Skills-section-only, another-entry-only, title-only,
entry-metadata-only and absent technologies. Metrics (evidence@1, MRR, P@k, false support, correct abstention)
are reported by dataset type and section, also over distinct cases because the source data contains duplicated
resumes. Literal-mention labels cannot recognise paraphrases (e.g. "CCNA routing and switching" for Networking).

## Adding or changing a rule

1. Add `_detect_<name>(unit, ctx) -> List[Issue]` in `detectors.py` and register it in `UNIT_DETECTORS`
   (or add a cross-bullet detector called from `engine.py`). Return a rewrite only if it is built from the
   bullet's own words; otherwise return a `question`.
2. Give the category a guideline in `guidelines.py` and a label in `SuggestionsPanel.jsx` (`CATEGORY_LABELS`).
3. If the rewrite may legitimately introduce a new neutral word, add it to `ALLOWED_NEW` in `validator.py`.
4. Add tests in `python-nlp/tests/`.

## Known limitations

- English-only rules; verb tense conversion uses a fixed table (unknown verbs get a question instead).
- Section/entry boundaries come from the existing parser; plain-text input gives copy-only suggestions.
- Similarity thresholds were checked on real resumes with MiniLM but are heuristics, not tuned on a labelled set.
- Results are found only when the other mention names the same project/role (or is in the same entry).
- Suggestions and their accept/reject state are not saved between sessions.
- Experience/internship entries have a "Role — Company" title chunk (like project titles).
  Two separate behaviours use it to identify the named entry:
  - **Claim verification** — `EvidenceIndex.search_entry_evidence()`: only bullets of that entry that reach the normal
    threshold against the query's *claim* count as evidence (`supported` / `insufficient_evidence`); a query that
    makes no claim returns `no_claim` and nothing is treated as verified.
  - **Entry lookup** — `EvidenceIndex.lookup_entry()`: the identified internship, job or project's own lines, ranked
    by similarity and marked `entry_content` — descriptive content, never evidence for a claim.
  Neither is used by the engine's in-app suggestions (they never issue role/company queries); both are used by the
  evaluation, which reports them separately.
- The older `/analyze` summary (`recommendations/suggestion_engine.py`) is now grounded in the resume's own skills
  and sections only (previously it invented "3+ years of experience", a JD role and default technologies).
