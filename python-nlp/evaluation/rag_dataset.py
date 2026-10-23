"""
Dataset adapter + metrics for the RAG retrieval evaluation (evaluate_rag.py).

Converts rows of hirelens_rag_test_resumes.csv into the SAME resume schema the app
uses (Resume.parsedData / recommendations.evidence.models.ResumeIn), so the existing
segmenter → retriever pipeline is evaluated unchanged. Nothing here re-implements
retrieval.

Adapter decisions (documented, deliberately conservative):
  * internships → `experience` entries, exactly as the app's parser files an
    "Internships" section under Experience. An entry map records which dataset
    section every entry came from, so results can be reported per section.
  * "Unknown" / empty placeholder values are DROPPED, never indexed — a
    placeholder must not become "experience". Every drop is counted.
  * project `impact` is kept as a second description line (it is project text);
    the dataset's "[SYNTHETIC TEST DATA]" marker is stripped from text, while the
    record_type / synthetic_test flags are preserved as metadata.
  * fields with no place in the app schema (project role/url, company_info,
    technical_environment, dates) are not indexed — the app would not index them either.
"""
import csv
import json
import re
from dataclasses import dataclass, field
from typing import Dict, List, Optional, Tuple

PLACEHOLDERS = {"", "unknown", "n/a", "na", "none", "null", "-"}
SYNTHETIC_MARKER = re.compile(r"\s*\[SYNTHETIC TEST DATA\]\s*", re.I)

SECTION_OF_SOURCE = {"resume_projects": "projects", "resume_internships": "internships", "resume_experience": "experience"}


def is_placeholder(v) -> bool:
    return v is None or str(v).strip().lower() in PLACEHOLDERS


def clean_text(v) -> str:
    return SYNTHETIC_MARKER.sub(" ", str(v)).strip() if not is_placeholder(v) else ""


def norm(s: str) -> str:
    """Normalisation used for EXACT evidence matching (case, whitespace, trailing punctuation)."""
    return re.sub(r"\s+", " ", (s or "").lower()).strip().rstrip(".;,").strip()


@dataclass
class AdaptedRecord:
    resume_id: str
    record_type: str
    resume: Optional[dict]                     # ResumeIn-shaped dict, or None if unusable
    entry_section: Dict[str, str] = field(default_factory=dict)   # "projects:0" / "experience:1" → projects|internships|experience
    issues: List[str] = field(default_factory=list)              # parse errors, empty sections, dropped placeholders
    counts: Dict[str, int] = field(default_factory=dict)


def _load_json(raw: str, column: str, issues: List[str]):
    if raw is None or not raw.strip():
        issues.append(f"{column}: empty")
        return None
    try:
        return json.loads(raw)
    except json.JSONDecodeError as e:
        issues.append(f"{column}: JSON parse error at char {e.pos}")
        return None


def _as_list(v) -> list:
    return v if isinstance(v, list) else ([v] if v not in (None, "") else [])


def _skill_names(skills) -> List[str]:
    """Flatten the dataset's nested skills object ({"technical": {"programming_languages": [{"name": …}]}})."""
    out = []
    def walk(x):
        if isinstance(x, dict):
            if "name" in x and not is_placeholder(x["name"]):
                out.append(str(x["name"]).strip())
            else:
                for v in x.values():
                    walk(v)
        elif isinstance(x, list):
            for v in x:
                walk(v)
        elif isinstance(x, str) and not is_placeholder(x):
            out.append(x.strip())
    walk(skills)
    return list(dict.fromkeys(out))


def _bullets(resp) -> List[str]:
    items = []
    for r in _as_list(resp):
        if isinstance(r, str):
            items += [p for p in re.split(r"\n|;\s+", r)]
        elif not isinstance(r, (dict, list)):
            items.append(str(r))
    return [clean_text(b) for b in items if not is_placeholder(b) and clean_text(b)]


def adapt_record(row: Dict[str, str]) -> AdaptedRecord:
    rec = AdaptedRecord(resume_id=row.get("resume_id", "").strip(), record_type=row.get("record_type", "").strip(), resume=None)
    c = rec.counts = {"projects": 0, "internships": 0, "experience": 0, "placeholders_dropped": 0, "entries_empty_after_cleaning": 0}
    issues = rec.issues
    projects_raw = _load_json(row.get("projects", ""), "projects", issues)
    intern_raw = _load_json(row.get("internships", ""), "internships", issues)
    exp_raw = _load_json(row.get("experience", ""), "experience", issues)
    skills_raw = _load_json(row.get("skills", ""), "skills", issues)
    edu_raw = _load_json(row.get("education", ""), "education", issues)

    resume = {"summary": "", "experience": [], "projects": [], "achievements": [], "skills": {}, "education": []}
    for i, p in enumerate(_as_list(projects_raw)):
        if not isinstance(p, dict):
            issues.append(f"projects[{i}]: unsupported format ({type(p).__name__})")
            continue
        name, desc, impact = clean_text(p.get("name")), clean_text(p.get("description")), clean_text(p.get("impact"))
        c["placeholders_dropped"] += sum(is_placeholder(p.get(k)) for k in ("name", "description", "impact"))
        techs = [clean_text(t) for t in _as_list(p.get("technologies")) if not is_placeholder(t)]
        lines = [l for l in (desc, impact) if l]
        if not name and not lines:
            c["entries_empty_after_cleaning"] += 1
            issues.append(f"projects[{i}]: only placeholders — not indexed")
            continue
        key = f"projects:{len(resume['projects'])}"
        resume["projects"].append({"id": f"{rec.resume_id}-p{i}", "name": name, "description": "\n".join(lines), "technologies": techs})
        rec.entry_section[key] = "projects"
        c["projects"] += 1

    for source, raw in (("internships", intern_raw), ("experience", exp_raw)):
        for i, e in enumerate(_as_list(raw)):
            if not isinstance(e, dict):
                issues.append(f"{source}[{i}]: unsupported format ({type(e).__name__})")
                continue
            bullets = _bullets(e.get("responsibilities"))
            title, company = clean_text(e.get("title")), clean_text(e.get("company"))
            c["placeholders_dropped"] += sum(is_placeholder(e.get(k)) for k in ("title", "company"))
            if not bullets:
                c["entries_empty_after_cleaning"] += 1
                issues.append(f"{source}[{i}]: no responsibilities — nothing to index")
                continue
            key = f"experience:{len(resume['experience'])}"
            resume["experience"].append({"id": f"{rec.resume_id}-{source[0]}{i}", "title": title, "company": company, "bullets": bullets})
            rec.entry_section[key] = source
            c[source] += 1

    names = _skill_names(skills_raw) if skills_raw is not None else []
    if names:
        resume["skills"] = {"technical": names}
    resume["education"] = [e for e in _as_list(edu_raw) if isinstance(e, dict)]
    if not resume["projects"] and not resume["experience"]:
        issues.append("no indexable project, internship or experience content")
    rec.resume = resume
    return rec


def load_csv(path: str) -> List[Dict[str, str]]:
    csv.field_size_limit(10 ** 8)
    with open(path, encoding="utf-8-sig", newline="") as f:
        return list(csv.DictReader(f))


# ── relevance + metrics ─────────────────────────────────────────────────────

def expected_units(expected_evidence: str, target_section: str) -> List[str]:
    """Labelled evidence → the units it was built from. Internship/experience labels join
    responsibilities with '; '; a project label is its description."""
    text = SYNTHETIC_MARKER.sub(" ", expected_evidence or "").strip()
    if target_section.lower() in ("internships", "experience"):
        return [u.strip() for u in re.split(r";\s+", text) if u.strip()]
    return [text] if text else []


def relevant_chunk_ids(chunks, units: List[str], entry_section: Dict[str, str], expected_section: str) -> Tuple[set, List[str], set]:
    """EXACT label → chunk mapping inside the expected section.
    Returns (relevant chunk ids, units not found in the index, ids of the whole relevant entries)."""
    relevant, missing, entries = set(), [], set()
    in_section = [c for c in chunks if c.source == "resume" and entry_section.get(c.entry_key) == expected_section]
    for u in units:
        hits = [c for c in in_section if norm(c.text) == norm(u)]
        if not hits:
            missing.append(u)
        for c in hits:
            relevant.add(c.id)
            entries.add(c.entry_key)
    entry_ids = {c.id for c in in_section if c.entry_key in entries}
    return relevant, missing, entry_ids


def random_baseline(n: int, r: int, ks=(1, 3, 5)) -> Dict[str, float]:
    """Exact expected metrics of a uniformly random ranking of n candidate chunks with r relevant
    (top-k truncation). Small corpora make Hit@k/Recall@k high by chance — compare against this."""
    from math import comb
    m = {}
    if n <= 0 or r <= 0:
        return {f"{x}@{k}": float("nan") for k in ks for x in ("P", "Hit", "Recall")} | {"RR": float("nan")}
    r = min(r, n)
    for k in ks:
        kk = min(k, n)
        m[f"P@{k}"] = (kk * r / n) / k
        m[f"Hit@{k}"] = 1 - comb(n - r, kk) / comb(n, kk)
        m[f"Recall@{k}"] = kk / n
    m["RR"] = sum((1 / i) * comb(n - i, r - 1) / comb(n, r) for i in range(1, n - r + 2))
    return m


def ranking_metrics(retrieved_ids: List[str], relevant: set, ks=(1, 3, 5)) -> Dict[str, float]:
    m = {}
    for k in ks:
        top = retrieved_ids[:k]
        hits = sum(1 for i in top if i in relevant)
        m[f"P@{k}"] = hits / k
        m[f"Hit@{k}"] = 1.0 if hits else 0.0
        m[f"Recall@{k}"] = hits / len(relevant) if relevant else float("nan")
    rr = 0.0
    for rank, i in enumerate(retrieved_ids, 1):
        if i in relevant:
            rr = 1.0 / rank
            break
    m["RR"] = rr
    return m
