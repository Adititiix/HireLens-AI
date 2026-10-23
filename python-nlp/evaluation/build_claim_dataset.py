"""
Build the claim-verification evaluation dataset from facts ALREADY in hirelens_rag_test_resumes.csv.

    cd python-nlp
    venv\\Scripts\\python -m evaluation.build_claim_dataset          # writes <datasets>/hirelens_claim_verification_cases.csv

Every label is derived mechanically from the data — nothing is hand-written or invented:

  supported               the technology is literally named (whole word, case-insensitive) in a bullet of THAT
                          entry → expected evidence = those bullets (chunk ids + exact text)
  insufficient_evidence   one case per entry for each negative type the data allows:
    skills_section_only   in the candidate's Skills list, named in no bullet of any entry, not in this title/metadata
    other_entry_only      named in a bullet of ANOTHER entry of the same candidate, not in this entry at all
    title_only            named only in this entry's job title
    entry_metadata_only   in this entry's technologies / technical_environment list but in none of its bullets
                          (the app does not index that metadata, so no bullet can support the claim)
    absent_from_resume    a technology from other records that appears nowhere in this resume

Entries are read through the same adapter as evaluate_rag.py, so entry ids / chunk ids match what the
retriever indexes. Single-letter technology names ("C", "R") and matcher aliases the candidate did not
literally write are excluded (counted), because they cannot be labelled reliably.
"""
import argparse
import csv
import json
import os
import re
import sys
from collections import Counter

HERE = os.path.dirname(os.path.abspath(__file__))
NLP_ROOT = os.path.dirname(HERE)
if NLP_ROOT not in sys.path:
    sys.path.insert(0, NLP_ROOT)

from evaluation.evaluate_rag import default_dataset_dir                 # noqa: E402
from evaluation.rag_dataset import adapt_record, is_placeholder, load_csv  # noqa: E402
from matching.skill_matcher import SkillMatcher                         # noqa: E402

FIELDS = ["case_id", "resume_id", "record_type", "synthetic_test", "target_section", "expected_entry_id",
          "expected_entry_key", "expected_entry_label", "claim_term", "query_text", "expected_outcome",
          "expected_bullet_ids", "expected_bullet_texts", "case_type", "label_basis"]
NO_COMPANY = {"fresher", "self", "self-employed", "freelance", "freelancer", "personal", "independent"}


def mentions(term: str, text: str):
    """Whole-word, case-insensitive literal mention; returns the text as written, or None."""
    m = re.search(r"(?<![A-Za-z0-9+#.])" + re.escape(term) + r"(?![A-Za-z0-9+#])", text or "", re.I)
    return m.group(0) if m else None


def raw_entries(row):
    out = {}
    for source in ("internships", "experience"):
        try:
            data = json.loads(row.get(source) or "[]")
        except json.JSONDecodeError:
            data = []
        for i, e in enumerate(data if isinstance(data, list) else []):
            out[f"{row['resume_id']}-{source[0]}{i}"] = e if isinstance(e, dict) else {}
    return out


def metadata_terms(raw: dict):
    env = raw.get("technical_environment") if isinstance(raw.get("technical_environment"), dict) else {}
    items = list(raw.get("technologies") or []) + list(env.get("technologies") or []) + list(env.get("tools") or [])
    return [str(t).strip() for t in items if isinstance(t, str) and not is_placeholder(t)]


def composite(term: str) -> bool:
    """"Linux/Unix", "HTML/CSS": a bullet naming one part ("linux") neither matches literally nor clearly
    supports the whole — such terms cannot be labelled reliably, so they are not used for negatives."""
    return "/" in term


def query(section: str, tech: str, title: str, company: str) -> str:
    where = company if company and company.lower() not in NO_COMPANY else ""
    if section == "internships":
        return f"Did the candidate use {tech} during the internship at {where or title}?"
    return f"Did the candidate use {tech} in the {title} role{f' at {where}' if where else ''}?"


def build(datasets_dir: str):
    matcher = SkillMatcher(embedder=None)
    rows = load_csv(os.path.join(datasets_dir, "hirelens_rag_test_resumes.csv"))
    skipped = Counter()
    # "Technology" = a term the dataset itself lists as a skill/technology somewhere (Skills names or an entry's
    # technology/tool list). The skill matcher's vocabulary also has generic words ("operations"), which would
    # make meaningless claims ("did the candidate use Operations?") — those are excluded and counted.
    tech_vocab = {}
    for r in rows:
        rec0 = adapt_record(r)
        listed = list((rec0.resume or {}).get("skills", {}).get("technical", []))
        for raw in raw_entries(r).values():
            listed += metadata_terms(raw)
        for t in listed:
            if len(t.strip()) > 1:
                tech_vocab.setdefault(t.strip().lower(), t.strip())   # first spelling seen in the data
    is_tech = lambda t: bool(t) and t.lower() in tech_vocab
    pool = sorted(t for t in tech_vocab if t in {s for r in rows for s in matcher.extract_skills(r.get("skills", ""))})
    cases = []
    for row_index, row in enumerate(rows):
        rec = adapt_record(row)
        if not rec.resume:
            continue
        raws = raw_entries(row)
        row_text = " ".join(row.get(c, "") for c in ("skills", "projects", "internships", "experience", "education"))
        skills = rec.resume.get("skills", {}).get("technical", [])
        entries = [(f"experience:{k}", e) for k, e in enumerate(rec.resume["experience"])]
        all_bullets = {key: " ".join(e["bullets"]) for key, e in entries}
        for key, e in entries:
            section = rec.entry_section[key]
            label = " — ".join(x for x in (e["title"], e["company"]) if x)
            if not e["title"] and not (e["company"] and e["company"].lower() not in NO_COMPANY):
                skipped["entry_without_title_or_company"] += 1
                continue
            raw = raws.get(e["id"], {})
            meta = metadata_terms(raw)
            base = {"resume_id": rec.resume_id, "record_type": rec.record_type,
                    "synthetic_test": str(rec.record_type == "synthetic"), "target_section": section.capitalize(),
                    "expected_entry_id": e["id"], "expected_entry_key": key, "expected_entry_label": label}

            def add(case_type, tech, outcome, bullet_ids=(), bullet_texts=(), basis=""):
                cases.append({**base, "claim_term": tech, "query_text": query(section, tech, e["title"] or e["company"], e["company"]),
                              "expected_outcome": outcome, "case_type": case_type, "label_basis": basis,
                              "expected_bullet_ids": ";".join(bullet_ids) or "insufficient_evidence",
                              "expected_bullet_texts": " || ".join(bullet_texts)})

            # supported: technology literally named in a bullet of this entry
            in_entry = set()
            for j, b in enumerate(e["bullets"]):
                for t in matcher.extract_skills(b):
                    if len(t) <= 1:
                        skipped["single_letter_term"] += 1
                        continue
                    written = mentions(t, b)
                    if not written:
                        skipped["alias_not_literally_written"] += 1
                        continue
                    if not is_tech(written):
                        skipped["generic_term_not_a_listed_technology"] += 1
                        continue
                    in_entry.add(written.lower())
            for t in sorted(in_entry):
                hits = [(f"{key}:{j}", b) for j, b in enumerate(e["bullets"]) if mentions(t, b)]
                written = mentions(t, hits[0][1])
                add("supported_in_bullet", written, "supported", [h[0] for h in hits], [h[1] for h in hits],
                    f"'{written}' is written in {len(hits)} bullet(s) of this entry")

            entry_text = " ".join([e["title"], e["company"], *e["bullets"], *meta])

            def absent_from_entry(t):
                return not mentions(t, entry_text)

            other = " ".join(v for k2, v in all_bullets.items() if k2 != key)
            # skills_section_only
            cand = [s for s in skills if len(s) > 1 and is_tech(s) and not composite(s) and absent_from_entry(s)
                    and not mentions(s, " ".join(all_bullets.values()))]
            if cand:
                add("skills_section_only", cand[0], "insufficient_evidence", basis="in Skills list only; no bullet of any entry names it")
            # other_entry_only
            cand = sorted({mentions(t, other) for t in matcher.extract_skills(other) if len(t) > 1 and mentions(t, other)
                           and is_tech(mentions(t, other)) and absent_from_entry(t)} - {None}, key=str.lower)
            if cand:
                add("other_entry_only", cand[0], "insufficient_evidence", basis="named in another entry's bullet, not in this entry")
            # title_only
            cand = [mentions(t, e["title"]) for t in matcher.extract_skills(e["title"]) if len(t) > 1 and mentions(t, e["title"])
                    and is_tech(mentions(t, e["title"])) and not mentions(t, " ".join(e["bullets"] + meta))]
            if cand:
                add("title_only", cand[0], "insufficient_evidence", basis="named only in the job title")
            # entry_metadata_only
            cand = [t for t in meta if len(t) > 1 and not composite(t) and not mentions(t, " ".join(e["bullets"]))
                    and not mentions(t, e["title"])]
            skipped["composite_metadata_terms"] += sum(1 for t in meta if composite(t))
            if cand:
                add("entry_metadata_only", cand[0], "insufficient_evidence",
                    basis="in this entry's technology list (not indexed by the app) but in none of its bullets")
            # absent_from_resume
            cand = [t for t in pool if not composite(t) and not mentions(t, row_text)]
            if cand:   # deterministic rotation so negatives are not all the same term
                pick = cand[(row_index + int(key.split(":")[1])) % len(cand)]
                add("absent_from_resume", tech_vocab[pick], "insufficient_evidence", basis="appears nowhere in this resume")
    for i, c in enumerate(cases, 1):
        c["case_id"] = f"C-{i:03d}"
    return cases, skipped


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--datasets", default=default_dataset_dir())
    ap.add_argument("--out", default=None, help="output CSV (default: <datasets>/hirelens_claim_verification_cases.csv)")
    args = ap.parse_args(argv)
    cases, skipped = build(args.datasets)
    out = args.out or os.path.join(args.datasets, "hirelens_claim_verification_cases.csv")
    with open(out, "w", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(f, fieldnames=FIELDS)
        w.writeheader()
        w.writerows(cases)
    counts = Counter((c["record_type"], c["target_section"], c["expected_outcome"]) for c in cases)
    print(f"[claims] {len(cases)} cases written to {out}")
    for k in sorted(counts):
        print(f"  {k[0]:15} {k[1]:12} {k[2]:22} {counts[k]}")
    print("  by case_type:", dict(Counter(c["case_type"] for c in cases)))
    print("  excluded terms:", dict(skipped))
    return cases


if __name__ == "__main__":
    main()
