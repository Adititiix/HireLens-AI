"""
Claim-verification evaluation: EvidenceIndex.search_entry_evidence() on hirelens_claim_verification_cases.csv
(built by evaluation/build_claim_dataset.py) with the real all-MiniLM-L6-v2 model. Fully local.

    cd python-nlp
    venv\\Scripts\\python -m evaluation.evaluate_claims          # --datasets DIR --out DIR --top-k 5 --min-score 0.2

Only claim verification is measured — entry lookup is not called, and no descriptive entry content is
counted as evidence. Results go to <datasets>/../results_claims/ (existing result folders are not touched).

Per case (expected label from the dataset → system status):
  supported claims   correct entry, evidence@1, evidence MRR, P@k / Recall@k over returned bullets,
                     false abstention (expected supported, system did not support), wrong-evidence support
  unsupported claims false support (system said supported), correct abstention (insufficient_evidence on the
                     expected entry), abstention without identifying the entry (no_entry_match / ambiguous / no_claim)
Synthetic and original records are reported separately; synthetic results are smoke tests only.
"""
import argparse
import csv
import json
import os
import sys
import time
from collections import defaultdict

HERE = os.path.dirname(os.path.abspath(__file__))
NLP_ROOT = os.path.dirname(HERE)
if NLP_ROOT not in sys.path:
    sys.path.insert(0, NLP_ROOT)

from evaluation.evaluate_rag import default_dataset_dir, load_embedder, nanmean        # noqa: E402
from evaluation.rag_dataset import adapt_record, load_csv, norm, random_baseline, ranking_metrics  # noqa: E402
from recommendations.evidence import EvidenceSuggestionEngine                          # noqa: E402
from recommendations.evidence.models import ResumeIn                                   # noqa: E402
from recommendations.evidence.retriever import EvidenceIndex                           # noqa: E402
from recommendations.evidence.segmenter import segment_structured                      # noqa: E402

EMPTY_GAP = {"missing": [], "matched": [], "high": [], "ordered": []}
EVIDENCE_KEYS = ["P@1", "P@3", "P@5", "Recall@1", "Recall@3", "Recall@5", "Hit@1", "RR"]


def evaluate_case(case, index, rec, top_k, min_score):
    out = {k: case[k] for k in ("case_id", "resume_id", "record_type", "synthetic_test", "target_section", "case_type",
                                "claim_term", "query_text", "expected_outcome", "expected_entry_key", "expected_bullet_ids")}
    expected_ids = [] if case["expected_bullet_ids"] == "insufficient_evidence" else case["expected_bullet_ids"].split(";")
    # labels are verified against the indexed text before use (no silent mismatch)
    by_id = {c.id: c for c in index.chunks}
    texts = [t for t in case["expected_bullet_texts"].split(" || ") if t]
    if any(i not in by_id for i in expected_ids) or [norm(by_id[i].text) for i in expected_ids] != [norm(t) for t in texts]:
        out.update(status="label_error", detail="expected bullet ids/text do not match the index")
        return out
    entry_text = " | ".join(norm(c.text) for c in index.chunks if c.entry_key == case["expected_entry_key"])
    out["distinct_key"] = f"{case['claim_term'].lower()}::{entry_text}"   # same claim on the same entry text (duplicated source rows)
    r = index.search_entry_evidence(case["query_text"], top_k=top_k, min_score=min_score)
    ids = [h.chunk.id for h in r.bullets]
    assert all(by_id[i].entry_key == r.entry_key for i in ids), "evidence left the identified entry"
    out.update(status="evaluated", system_status=r.status, system_entry=r.entry_key or "", claim_extracted=r.claim,
               returned_bullets=";".join(ids), returned_scores=";".join(str(h.score) for h in r.bullets),
               correct_entry=r.entry_key == case["expected_entry_key"])
    supported = r.status == "supported"
    if case["expected_outcome"] == "supported":
        m = ranking_metrics(ids, set(expected_ids))
        out.update({f"ev_{k}": m[k] for k in EVIDENCE_KEYS})
        n_bullets = sum(1 for c in index.chunks if c.entry_key == case["expected_entry_key"] and not c.id.endswith(":title"))
        b = random_baseline(n_bullets, len(expected_ids))
        out.update({f"rand_{k}": b[k] for k in EVIDENCE_KEYS})
        out["false_abstention"] = not supported
        out["supported_with_wrong_evidence"] = supported and not (set(ids) & set(expected_ids))
    else:
        out["false_support"] = supported
        out["correct_abstention"] = r.status == "insufficient_evidence" and out["correct_entry"]
        out["abstained_without_entry"] = r.status in ("no_entry_match", "ambiguous_entry", "no_claim")
    return out


def rate(xs, key):
    xs = [x for x in xs if key in x]
    return round(sum(bool(x[key]) for x in xs) / len(xs), 4) if xs else None


def distinct(rows):
    seen, out = set(), []
    for x in rows:
        if x.get("distinct_key") not in seen:
            seen.add(x.get("distinct_key"))
            out.append(x)
    return out


def summarize(rows, dedupe=True):
    ev = [x for x in rows if x["status"] == "evaluated"]
    sup = [x for x in ev if x["expected_outcome"] == "supported"]
    uns = [x for x in ev if x["expected_outcome"] != "supported"]
    block = {"cases": len(rows), "evaluated": len(ev), "label_errors": sum(1 for x in rows if x["status"] == "label_error"),
             "supported_claims": len(sup), "unsupported_claims": len(uns),
             "entry_identified_rate": rate(ev, "correct_entry")}
    if sup:
        block["supported"] = {
            "correct_evidence_at_1": nanmean([x["ev_Hit@1"] for x in sup]),
            "evidence_level": {k: nanmean([x[f"ev_{k}"] for x in sup]) for k in EVIDENCE_KEYS},
            "random_within_entry": {k: nanmean([x[f"rand_{k}"] for x in sup]) for k in EVIDENCE_KEYS},
            "false_abstention_rate": rate(sup, "false_abstention"),
            "supported_with_wrong_evidence_rate": rate(sup, "supported_with_wrong_evidence"),
        }
    else:
        block["supported"] = "unavailable — no supported claims for this group in the data"
    if uns:
        block["unsupported"] = {"false_support_rate": rate(uns, "false_support"),
                                "correct_abstention_rate": rate(uns, "correct_abstention"),
                                "abstained_without_entry_rate": rate(uns, "abstained_without_entry")}
    else:
        block["unsupported"] = "unavailable — no unsupported claims for this group"
    block["system_status_counts"] = {s: sum(1 for x in ev if x["system_status"] == s) for s in sorted({x["system_status"] for x in ev})}
    if dedupe:   # the source dataset contains copied resumes: the same metrics over distinct (claim, entry text) cases
        block["distinct_cases"] = summarize(distinct(rows), dedupe=False)
    return block


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--datasets", default=default_dataset_dir())
    ap.add_argument("--cases", default="hirelens_claim_verification_cases.csv")
    ap.add_argument("--resumes", default="hirelens_rag_test_resumes.csv")
    ap.add_argument("--out", default=None)
    ap.add_argument("--top-k", type=int, default=5)
    ap.add_argument("--min-score", type=float, default=0.2)
    ap.add_argument("--fake-embedder", action="store_true", help="pipeline smoke run only — NOT real performance")
    args = ap.parse_args(argv)
    out_dir = os.path.abspath(args.out or os.path.join(args.datasets, "..", "results_claims"))
    os.makedirs(out_dir, exist_ok=True)
    t0 = time.time()
    embedder, label = load_embedder(args.fake_embedder)
    print(f"[claims] embedder: {label}")
    records = {r["resume_id"]: r for r in load_csv(os.path.join(args.datasets, args.resumes))}
    indexes = {}
    rows = []
    for case in load_csv(os.path.join(args.datasets, args.cases)):
        rid = case["resume_id"]
        if rid not in indexes:
            rec = adapt_record(records[rid])
            units = segment_structured(ResumeIn(**rec.resume))
            indexes[rid] = (EvidenceIndex(embedder).build(EvidenceSuggestionEngine()._chunks(units, "", EMPTY_GAP)), rec)
        index, rec = indexes[rid]
        rows.append(evaluate_case(case, index, rec, args.top_k, args.min_score))

    groups = defaultdict(list)
    for x in rows:
        groups[(x["record_type"], x["target_section"])].append(x)
    summary = {"embedder": label, "is_real_evaluation": not args.fake_embedder,
               "settings": {"top_k": args.top_k, "min_score": args.min_score, "method": "EvidenceIndex.search_entry_evidence"},
               "by_dataset_and_section": {f"{t} / {s}": summarize(v) for (t, s), v in sorted(groups.items())},
               "by_dataset": {t: summarize([x for x in rows if x["record_type"] == t]) for t in sorted({x["record_type"] for x in rows})},
               "by_case_type": {f"{t} / {c}": summarize([x for x in rows if x["record_type"] == t and x["case_type"] == c])
                                for t, c in sorted({(x["record_type"], x["case_type"]) for x in rows})},
               "notes": ["Synthetic records are pipeline smoke tests; they do not measure real-world accuracy.",
                         "Original records come from the supplied dataset; labels are derived mechanically from their text "
                         "(a technology is 'supported' only when literally named in a bullet of that entry).",
                         "Entry lookup is not evaluated here; descriptive entry content is never counted as evidence.",
                         "random_within_entry = exact expectation for a random ranking of the expected entry's bullets."],
               "runtime_seconds": round(time.time() - t0, 1)}
    fields = sorted({k for x in rows for k in x}, key=lambda k: (k not in rows[0], list(rows[0]).index(k) if k in rows[0] else 0, k))
    with open(os.path.join(out_dir, "claim_eval_cases.csv"), "w", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(f, fieldnames=fields)
        w.writeheader()
        w.writerows(rows)
    with open(os.path.join(out_dir, "claim_eval_summary.json"), "w", encoding="utf-8") as f:
        json.dump(summary, f, indent=2, default=str)
    print(json.dumps(summary, indent=2, default=str))
    print(f"[claims] results written to {out_dir}")
    return summary


if __name__ == "__main__":
    main()
