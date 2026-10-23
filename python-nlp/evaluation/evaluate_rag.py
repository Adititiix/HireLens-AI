"""
Retrieval evaluation of the EXISTING evidence pipeline (recommendations/evidence) on the
supplied HireLens RAG datasets. Runs fully locally (no network, no paid APIs).

    cd python-nlp
    venv\\Scripts\\python -m evaluation.evaluate_rag                       # real all-MiniLM-L6-v2
    venv\\Scripts\\python -m evaluation.evaluate_rag --datasets <dir> --out <dir> --min-score 0.2 --top-k 5

What is evaluated (and with what):
  * Retrieval: the engine's own corpus builder (EvidenceSuggestionEngine._chunks) and
    EvidenceIndex.search over ONE candidate's resume chunks, with the shared Embedder.
  * Relevance: EXACT mapping of the labelled `expected_evidence` to chunk ids (labels are
    verbatim section text), at two levels — `evidence` (the labelled chunks) and `entry`
    (any chunk of the labelled project/role, e.g. its title). No text-similarity judging.
  * Suggestions: EvidenceSuggestionEngine.suggest on every usable record, each rewrite
    re-checked against THAT record's own text (unsupported numbers / technologies /
    claims / years of experience). The legacy /analyze summary template is audited too.

Synthetic and original records are always reported separately. Synthetic results are
pipeline smoke tests, not real-world accuracy. Metrics without supporting labels are
reported as unavailable, never estimated.
"""
import argparse
import contextlib
import csv
import io
import json
import math
import os
import re
import sys
import time
from collections import defaultdict
from statistics import mean

HERE = os.path.dirname(os.path.abspath(__file__))
NLP_ROOT = os.path.dirname(HERE)
if NLP_ROOT not in sys.path:
    sys.path.insert(0, NLP_ROOT)

from evaluation.rag_dataset import (SECTION_OF_SOURCE, adapt_record, expected_units, load_csv, norm,   # noqa: E402
                                    random_baseline, ranking_metrics, relevant_chunk_ids)
from matching.skill_matcher import SkillMatcher                                                    # noqa: E402
from recommendations.evidence import EvidenceSuggestionEngine                                     # noqa: E402
from recommendations.evidence.models import ResumeIn, SuggestRequest                               # noqa: E402
from recommendations.evidence.retriever import EvidenceIndex, tokens                              # noqa: E402
from recommendations.evidence.segmenter import segment_structured                                 # noqa: E402
from recommendations.evidence.validator import CLAIM_WORDS, numbers, stem                         # noqa: E402
from recommendations.suggestion_engine import SuggestionEngine                                    # noqa: E402

TARGETS = {"projects": "projects", "internships": "internships", "experience": "experience"}
MODES = ("thresholded", "ranked", "section_scoped")
METRIC_KEYS = ["P@1", "P@3", "P@5", "Hit@1", "Hit@3", "Hit@5", "Recall@1", "Recall@3", "Recall@5", "RR"]
YEARS_RE = re.compile(r"\b\d+\s*\+?\s*(?:years?|yrs?)\b", re.I)


def default_dataset_dir():
    for cand in (os.path.join(NLP_ROOT, "..", "..", "evaluation", "datasets"),     # <workspace>/evaluation/datasets
                 os.path.join(NLP_ROOT, "..", "evaluation", "datasets")):          # <repo>/evaluation/datasets
        if os.path.isdir(cand):
            return os.path.abspath(cand)
    return os.path.abspath(os.path.join(NLP_ROOT, "..", "evaluation", "datasets"))


def quiet(fn, *a, **kw):
    with contextlib.redirect_stdout(io.StringIO()):   # SkillMatcher prints a debug table per call
        return fn(*a, **kw)


def load_embedder(fake: bool):
    if fake:
        sys.path.insert(0, os.path.join(NLP_ROOT, "tests"))
        from helpers import FakeEmbedder
        return FakeEmbedder(), "FAKE word-hash embedder (pipeline smoke only — NOT RAG performance)"
    from parsers.embedder import Embedder
    return quiet(Embedder), "all-MiniLM-L6-v2 (local, normalized embeddings)"


def resume_text(resume: dict) -> str:
    parts = [resume.get("summary", "")]
    for e in resume.get("experience", []):
        parts += [e.get("title", ""), e.get("company", ""), *e.get("bullets", [])]
    for p in resume.get("projects", []):
        parts += [p.get("name", ""), p.get("description", ""), " ".join(p.get("technologies", []))]
    parts += [" ".join(v) for v in resume.get("skills", {}).values()]
    return "\n".join(x for x in parts if x)


def section_of(chunk, entry_section):
    return entry_section.get(chunk.entry_key) or chunk.entry_key.split(":")[0] or chunk.source


def nanmean(xs):
    xs = [x for x in xs if not (isinstance(x, float) and math.isnan(x))]
    return round(mean(xs), 4) if xs else None


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--datasets", default=default_dataset_dir(), help="folder with the supplied CSV files")
    ap.add_argument("--resumes", default="hirelens_rag_test_resumes.csv")
    ap.add_argument("--queries", default="hirelens_synthetic_rag_queries.csv")
    ap.add_argument("--out", default=None, help="output folder (default: <datasets>/../results)")
    ap.add_argument("--top-k", type=int, default=5)
    ap.add_argument("--min-score", type=float, default=0.2, help="retriever threshold (EvidenceIndex.search default 0.2)")
    ap.add_argument("--skip-suggestions", action="store_true", help="retrieval metrics only")
    ap.add_argument("--fake-embedder", action="store_true", help="pipeline smoke run without the model (results are NOT RAG performance)")
    args = ap.parse_args(argv)

    out_dir = os.path.abspath(args.out or os.path.join(args.datasets, "..", "results"))
    os.makedirs(out_dir, exist_ok=True)
    t0 = time.time()
    embedder, embedder_label = load_embedder(args.fake_embedder)
    matcher = SkillMatcher(embedder=embedder)
    engine = EvidenceSuggestionEngine(embedder=embedder, skill_matcher=matcher)
    print(f"[eval] embedder: {embedder_label}  (loaded in {time.time() - t0:.1f}s)")

    # ── records ────────────────────────────────────────────────────────────
    rows = load_csv(os.path.join(args.datasets, args.resumes))
    records, record_rows = {}, []
    for row in rows:
        rec = adapt_record(row)
        status, n_chunks, placeholder_chunks, err = "usable", 0, 0, ""
        units, index, chunks = [], None, []
        if not rec.resume_id:
            status, err = "rejected", "missing resume_id"
        else:
            try:
                rin = ResumeIn(**rec.resume)
                units = segment_structured(rin)
                if not any(u.section in ("projects", "experience") for u in units):
                    status = "no_target_sections"
                chunks = engine._chunks(units, "", {"missing": [], "matched": [], "high": [], "ordered": []})
                index = EvidenceIndex(embedder).build(chunks)
                chunks = index.chunks
                n_chunks = sum(1 for c in chunks if c.source == "resume")
                placeholder_chunks = sum(1 for c in chunks if c.source == "resume" and norm(c.text) in ("unknown", "n/a", "none"))
            except Exception as e:  # noqa: BLE001
                status, err = "rejected", f"{type(e).__name__}: {str(e)[:150]}"
        records[rec.resume_id] = {"rec": rec, "status": status, "units": units, "index": index, "chunks": chunks}
        record_rows.append({"resume_id": rec.resume_id, "record_type": rec.record_type, "status": status,
                            "projects_indexed": rec.counts.get("projects", 0), "internships_indexed": rec.counts.get("internships", 0),
                            "experience_indexed": rec.counts.get("experience", 0), "resume_chunks": n_chunks,
                            "placeholders_dropped": rec.counts.get("placeholders_dropped", 0),
                            "entries_empty_after_cleaning": rec.counts.get("entries_empty_after_cleaning", 0),
                            "placeholder_chunks_indexed": placeholder_chunks, "issues": " | ".join(rec.issues), "error": err})

    # ── labelled queries ───────────────────────────────────────────────────
    qrows = load_csv(os.path.join(args.datasets, args.queries))
    query_results = []
    for q in qrows:
        res = {"query_id": q.get("query_id", ""), "resume_id": q.get("resume_id", ""), "target_section": q.get("target_section", ""),
               "synthetic_test": q.get("synthetic_test", ""), "expected_source": q.get("expected_source", ""),
               "expected_evidence": q.get("expected_evidence", ""), "query_text": q.get("query_text", ""), "status": "evaluated", "detail": ""}
        r = records.get(res["resume_id"])
        res["record_type"] = r["rec"].record_type if r else ""
        target = TARGETS.get(res["target_section"].strip().lower())
        if r is None:
            res.update(status="error", detail="resume_id not found in resumes file")
        elif r["status"] == "rejected" or r["index"] is None:
            res.update(status="error", detail=f"record unusable: {r['status']}")
        elif target is None:
            res.update(status="unsupported", detail=f"target_section '{res['target_section']}' is outside the RAG scope / dataset")
        elif SECTION_OF_SOURCE.get(res["expected_source"]) not in (None, target):
            res.update(status="error", detail=f"expected_source {res['expected_source']} disagrees with target_section")
        elif not res["query_text"].strip():
            res.update(status="unsupported", detail="empty query_text")
        if res["status"] != "evaluated":
            query_results.append(res)
            continue
        rec, index = r["rec"], r["index"]
        units = expected_units(res["expected_evidence"], res["target_section"])
        relevant, missing, entry_ids = relevant_chunk_ids(index.chunks, units, rec.entry_section, target)
        res["relevant_chunk_ids"] = sorted(relevant)
        res["missing_expected_units"] = missing
        if not relevant:
            res.update(status="error", detail="expected evidence not present in the indexed section (label/data mismatch)")
            query_results.append(res)
            continue
        if missing:
            res["detail"] = f"{len(missing)} of {len(units)} expected units not indexed"
        own_ids = {c.id for c in index.chunks}
        resume_chunks = [c for c in index.chunks if c.source == "resume"]
        outside_target = [c.id for c in resume_chunks if rec.entry_section.get(c.entry_key) != target]
        n_section = len(resume_chunks) - len(outside_target)
        res["n_resume_chunks"], res["n_section_chunks"] = len(resume_chunks), n_section
        # Expected metrics of a random ranking over the same candidates (small corpora inflate Hit@k).
        res["baseline_all"] = {"evidence": random_baseline(len(resume_chunks), len(relevant)),
                               "entry": random_baseline(len(resume_chunks), len(entry_ids))}
        res["baseline_section"] = {"evidence": random_baseline(n_section, len(relevant)),
                                   "entry": random_baseline(n_section, len(entry_ids))}
        # thresholded / ranked: all of the candidate's resume chunks (as the engine searches);
        # section_scoped: only the target section's chunks, via the retriever's existing exclude_ids.
        def record(mode, hits):
            ids = [h.chunk.id for h in hits]
            assert set(ids) <= own_ids, "retrieved a chunk from another resume"   # per-record index isolation
            res[f"{mode}_retrieved"] = [{"chunk_id": h.chunk.id, "section": section_of(h.chunk, rec.entry_section),
                                          "score": h.score, "keyword": h.keyword, "semantic": h.semantic,
                                          "relevant": h.chunk.id in relevant, "same_entry": h.chunk.id in entry_ids,
                                          "text": h.chunk.text[:240]} for h in hits]
            res[f"{mode}_empty"] = not hits
            res[f"{mode}_evidence"] = ranking_metrics(ids, relevant)
            res[f"{mode}_entry"] = ranking_metrics(ids, entry_ids)
            res[f"{mode}_section_of_top1"] = section_of(hits[0].chunk, rec.entry_section) if hits else ""

        for mode, ms, excl in (("thresholded", args.min_score, ()), ("ranked", 0.0, ()),
                               ("section_scoped", args.min_score, outside_target)):
            record(mode, index.search(res["query_text"], sources=["resume"], top_k=args.top_k, min_score=ms, exclude_ids=excl))
        labelled_entries = {cid.rsplit(":", 1)[0] for cid in relevant}
        # Claim verification (search_entry_evidence): bullets count as evidence only for an explicit claim.
        cv = index.search_entry_evidence(res["query_text"], top_k=args.top_k, min_score=args.min_score)
        res["claim_status"], res["claim_text"] = cv.status, cv.claim
        res["claim_entry"] = cv.entry_key or ""
        if cv.status in ("supported", "insufficient_evidence"):     # a claim was made and checked
            record("claim", cv.bullets)
        # Entry lookup (lookup_entry): descriptive entry content — reported separately, NEVER as evidence.
        lk = index.lookup_entry(res["query_text"], top_k=args.top_k, min_score=args.min_score)
        content_ids = [h.chunk.id for h in lk.content]
        assert set(content_ids) <= own_ids, "lookup returned a chunk from another resume"
        res["lookup_status"], res["lookup_entry"] = lk.status, lk.entry_key or ""
        res["lookup_correct_entry"] = bool(lk.entry_key) and lk.entry_key in labelled_entries
        res["lookup_content_ids"] = content_ids
        res["lookup_single_entry"] = len({h.chunk.entry_key for h in lk.content}) <= 1
        res["lookup_labelled_coverage"] = len(set(content_ids) & relevant) / len(relevant)
        query_results.append(res)

    # ── suggestions: unsupported-claim audit (own resume only) ─────────────
    sugg_rows, legacy_rows = [], []
    legacy = SuggestionEngine(embedder=None)
    if not args.skip_suggestions:
        for rid, r in records.items():
            if r["status"] == "rejected":
                continue
            resume = r["rec"].resume
            own = resume_text(resume)
            own_tokens = {stem(t) for t in tokens(own)}
            own_tech = {s.lower() for s in quiet(matcher.extract_skills, own)}
            try:
                out = quiet(engine.suggest, SuggestRequest(resume=resume, max_suggestions=50))
            except Exception as e:  # noqa: BLE001
                sugg_rows.append({"resume_id": rid, "record_type": r["rec"].record_type, "category": "ERROR", "error": f"{type(e).__name__}"})
                continue
            for s in out["suggestions"]:
                text = s["suggested_text"]
                problems = []
                if text:
                    if numbers(text) - numbers(own):
                        problems.append("number:" + ",".join(sorted(numbers(text) - numbers(own))))
                    new_tech = {t.lower() for t in quiet(matcher.extract_skills, text)} - own_tech
                    if new_tech:
                        problems.append("technology:" + ",".join(sorted(new_tech)))
                    claims = {w for w in tokens(text) if w in CLAIM_WORDS and stem(w) not in own_tokens}
                    if claims:
                        problems.append("claim:" + ",".join(sorted(claims)))
                    if YEARS_RE.search(text) and not YEARS_RE.search(own):
                        problems.append("years_of_experience")
                sugg_rows.append({"resume_id": rid, "record_type": r["rec"].record_type, "category": s["category"],
                                  "section": s["section"], "has_rewrite": bool(text), "requires_user_input": s["requires_user_input"],
                                  "applicable": s["applicable"], "unsupported": bool(problems), "problems": "; ".join(problems),
                                  "original_text": s["original_text"][:240], "suggested_text": text[:300], "error": ""})
            # Legacy /analyze summary template (recommendations/suggestion_engine.py), audited as-is.
            summary = legacy._suggest_summary_text(own, "", [])
            lp = []
            if YEARS_RE.search(summary) and not YEARS_RE.search(own):
                lp.append("years_of_experience")
            new_tech = {t.lower() for t in quiet(matcher.extract_skills, summary)} - own_tech
            if new_tech:
                lp.append("technology:" + ",".join(sorted(new_tech)))
            legacy_rows.append({"resume_id": rid, "record_type": r["rec"].record_type, "unsupported": bool(lp),
                                "problems": "; ".join(lp), "legacy_summary": summary})

    # ── aggregates ─────────────────────────────────────────────────────────
    def agg(results):
        ev = [x for x in results if x["status"] == "evaluated"]
        block = {"labelled_queries": len(results), "evaluated": len(ev),
                 "errors": sum(1 for x in results if x["status"] == "error"),
                 "unsupported": sum(1 for x in results if x["status"] == "unsupported")}
        if ev:
            block["mean_resume_chunks"] = round(mean(x["n_resume_chunks"] for x in ev), 2)
            block["mean_target_section_chunks"] = round(mean(x["n_section_chunks"] for x in ev), 2)
        for mode in MODES:
            if not ev:
                block[mode] = "unavailable (no evaluable labelled queries)"
                continue
            base = "baseline_section" if mode == "section_scoped" else "baseline_all"
            block[mode] = {"empty_retrieval_rate": round(sum(x[f"{mode}_empty"] for x in ev) / len(ev), 4),
                           "evidence_level": {k: nanmean([x[f"{mode}_evidence"][k] for x in ev]) for k in METRIC_KEYS},
                           "entry_level": {k: nanmean([x[f"{mode}_entry"][k] for x in ev]) for k in METRIC_KEYS},
                           "random_baseline_evidence": {k: nanmean([x[base]["evidence"][k] for x in ev]) for k in METRIC_KEYS},
                           "random_baseline_entry": {k: nanmean([x[base]["entry"][k] for x in ev]) for k in METRIC_KEYS},
                           "top1_in_target_section": round(sum(1 for x in ev if x[f"{mode}_section_of_top1"] == TARGETS[x["target_section"].lower()]) / len(ev), 4)}
            block[mode]["MRR"] = block[mode]["evidence_level"]["RR"]
        if ev:
            counts = lambda key: {s: sum(1 for x in ev if x[key] == s) for s in sorted({x[key] for x in ev})}
            claims = [x for x in ev if x["claim_status"] in ("supported", "insufficient_evidence")]
            cv = {"status_counts": counts("claim_status"), "queries_with_a_claim": len(claims)}
            if claims:
                cv.update({"supported_rate": round(sum(x["claim_status"] == "supported" for x in claims) / len(claims), 4),
                           "evidence_level": {k: nanmean([x["claim_evidence"][k] for x in claims]) for k in METRIC_KEYS},
                           "random_baseline_evidence": {k: nanmean([x["baseline_all"]["evidence"][k] for x in claims]) for k in METRIC_KEYS}})
            else:
                cv["metrics"] = "unavailable — no labelled query contains a claim to verify"
            block["claim_verification"] = cv
            block["entry_lookup"] = {
                "kind": "descriptive entry content — NOT verified evidence; excluded from all evidence metrics",
                "status_counts": counts("lookup_status"),
                "correct_entry_identified_rate": round(sum(x["lookup_correct_entry"] for x in ev) / len(ev), 4),
                "wrong_entry_rate": round(sum(1 for x in ev if x["lookup_entry"] and not x["lookup_correct_entry"]) / len(ev), 4),
                "single_entry_content_rate": round(sum(x["lookup_single_entry"] for x in ev) / len(ev), 4),
                "labelled_content_coverage": nanmean([x["lookup_labelled_coverage"] for x in ev]),
            }
        return block

    by_type = defaultdict(list)
    for x in query_results:
        by_type[x.get("record_type") or "unknown"].append(x)
    retrieval = {}
    for rtype in ("synthetic", "source_dataset"):
        group = by_type.get(rtype, [])
        if not group:
            retrieval[rtype] = {"status": "unavailable — no labelled queries reference these records"}
            continue
        retrieval[rtype] = {"overall": agg(group)}
        for sec in ("Projects", "Internships", "Experience", "Summary"):
            sub = [x for x in group if x["target_section"].lower() == sec.lower()]
            retrieval[rtype][sec] = agg(sub) if sub else "unavailable — no labelled queries for this section"

    def claim_block(rows_, legacy_):
        rw = [x for x in rows_ if x.get("has_rewrite")]
        return {"records": len({x["resume_id"] for x in rows_}) if rows_ else 0,
                "suggestions": len([x for x in rows_ if x.get("category") != "ERROR"]),
                "with_rewrite": len(rw), "questions_only": len([x for x in rows_ if x.get("category") != "ERROR" and not x.get("has_rewrite")]),
                "unsupported_rewrites": sum(1 for x in rw if x["unsupported"]),
                "unsupported_claim_rate": round(sum(1 for x in rw if x["unsupported"]) / len(rw), 4) if rw else "unavailable (no rewrites generated)",
                "summary_rewrites_by_evidence_engine": sum(1 for x in rows_ if x.get("section") == "Summary" and x.get("has_rewrite")),
                "engine_errors": sum(1 for x in rows_ if x.get("category") == "ERROR"),
                "legacy_analyze_summary_template": {"audited": len(legacy_), "unsupported": sum(1 for x in legacy_ if x["unsupported"]),
                                                    "rate": round(sum(1 for x in legacy_ if x["unsupported"]) / len(legacy_), 4) if legacy_ else None}}

    summary = {
        "embedder": embedder_label, "is_real_rag_evaluation": not args.fake_embedder,
        "settings": {"top_k": args.top_k, "min_score": args.min_score, "relevance": "exact label→chunk mapping (evidence / entry level)"},
        "records": {"loaded": len(rows), "by_type": {t: sum(1 for r in record_rows if r["record_type"] == t) for t in sorted({r["record_type"] for r in record_rows})},
                    "status": {s: sum(1 for r in record_rows if r["status"] == s) for s in sorted({r["status"] for r in record_rows})},
                    "with_issues": sum(1 for r in record_rows if r["issues"]),
                    "placeholders_dropped": sum(r["placeholders_dropped"] for r in record_rows),
                    "placeholder_chunks_indexed": sum(r["placeholder_chunks_indexed"] for r in record_rows)},
        "queries": {"loaded": len(qrows), "evaluated": sum(1 for x in query_results if x["status"] == "evaluated"),
                    "errors": sum(1 for x in query_results if x["status"] == "error"),
                    "unsupported": sum(1 for x in query_results if x["status"] == "unsupported"),
                    "partially_indexed_labels": sum(1 for x in query_results if x.get("missing_expected_units"))},
        "retrieval": retrieval,
        "suggestions_audit": {t: claim_block([x for x in sugg_rows if x["record_type"] == t], [x for x in legacy_rows if x["record_type"] == t])
                              for t in ("synthetic", "source_dataset")} if not args.skip_suggestions else "skipped",
        "notes": ["Synthetic records/queries are pipeline smoke tests; they do not measure real-world retrieval accuracy.",
                  "No labelled queries exist for original (source_dataset) records or for Professional Summary: those metrics are unavailable.",
                  "P@3/P@5 are bounded by the number of labelled chunks (a project label is a single chunk, so max P@3 = 0.33).",
                  "Modes: thresholded/ranked search ALL of the candidate's resume chunks (as the engine does); section_scoped "
                  "restricts candidates to the target section using the retriever's existing exclude_ids.",
                  "claim_verification: EvidenceIndex.search_entry_evidence — metrics only over queries that make a claim "
                  "(bullets of the identified entry reaching min_score against the claim); claim-less queries are counted, not scored.",
                  "entry_lookup: EvidenceIndex.lookup_entry — the identified entry's own lines, descriptive content only; "
                  "reported as identification + coverage, never as evidence.",
                  "Synthetic resumes have ~7 chunks, so top-5 covers most of the corpus: compare every metric with its "
                  "random_baseline (exact expectation for a random ranking of the same candidates).",
                  "Unsupported-claim checks are rule-based (numbers, skill terms, claim words, years) against the record's own text."],
        "runtime_seconds": round(time.time() - t0, 1),
    }

    # ── write ──────────────────────────────────────────────────────────────
    def write_csv(name, rows_, fields):
        with open(os.path.join(out_dir, name), "w", encoding="utf-8", newline="") as f:
            w = csv.DictWriter(f, fieldnames=fields, extrasaction="ignore")
            w.writeheader()
            w.writerows(rows_)
    write_csv("rag_eval_records.csv", record_rows, list(record_rows[0].keys()) if record_rows else ["resume_id"])
    flat = []
    for x in query_results:
        row = {k: x.get(k, "") for k in ("query_id", "resume_id", "record_type", "synthetic_test", "target_section", "status", "detail", "query_text", "expected_evidence")}
        row["relevant_chunk_ids"] = ";".join(x.get("relevant_chunk_ids", []))
        for k in ("claim_status", "claim_text", "claim_entry", "lookup_status", "lookup_entry", "lookup_correct_entry",
                  "lookup_labelled_coverage"):
            row[k] = x.get(k, "")
        row["lookup_content_ids"] = ";".join(x.get("lookup_content_ids", []))
        for mode in MODES:
            ret = x.get(f"{mode}_retrieved", [])
            row[f"{mode}_retrieved_ids"] = ";".join(h["chunk_id"] for h in ret)
            row[f"{mode}_retrieved_sections"] = ";".join(h["section"] for h in ret)
            row[f"{mode}_scores"] = ";".join(str(h["score"]) for h in ret)
            row[f"{mode}_top1_text"] = ret[0]["text"] if ret else ""
            for lvl in ("evidence", "entry"):
                for k, v in (x.get(f"{mode}_{lvl}") or {}).items():
                    row[f"{mode}_{lvl}_{k}"] = v
        flat.append(row)
    write_csv("rag_eval_queries.csv", flat, sorted({k for r in flat for k in r}, key=lambda k: list(flat[0]).index(k) if k in flat[0] else 999))
    with open(os.path.join(out_dir, "rag_eval_queries.json"), "w", encoding="utf-8") as f:
        json.dump(query_results, f, indent=1, default=str)
    if sugg_rows:
        write_csv("rag_eval_suggestions.csv", sugg_rows, ["resume_id", "record_type", "category", "section", "has_rewrite", "requires_user_input",
                                                          "applicable", "unsupported", "problems", "original_text", "suggested_text", "error"])
        write_csv("rag_eval_legacy_summary.csv", legacy_rows, ["resume_id", "record_type", "unsupported", "problems", "legacy_summary"])
    with open(os.path.join(out_dir, "rag_eval_summary.json"), "w", encoding="utf-8") as f:
        json.dump(summary, f, indent=2, default=str)
    print(json.dumps(summary, indent=2, default=str))
    print(f"[eval] results written to {out_dir}")
    return summary


if __name__ == "__main__":
    main()
