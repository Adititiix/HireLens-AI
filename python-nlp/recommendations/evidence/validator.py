"""
Evidence validation (anti-hallucination) and rule-based confidence.

A rewrite is only returned if every fact in it can be traced to the original
bullet or to VERIFIED resume evidence attached to the suggestion. Job-description
text and writing guidelines are never accepted as a source of facts about the
candidate.
"""
import re
from typing import Callable, Iterable, List, Tuple

from .retriever import STOPWORDS, tokens

NUMBER_RE = re.compile(r"\d+(?:[.,]\d+)*\s*%?|\b(?:one|two|three|four|five|six|seven|eight|nine|ten|hundred|thousand|million|billion)\b", re.I)
CLAIM_WORDS = {
    # leadership / ownership
    "led", "lead", "managed", "owned", "spearheaded", "mentored", "supervised", "headed", "directed", "oversaw",
    # impact / scale claims
    "revenue", "profit", "sales", "users", "customers", "clients", "accuracy", "latency", "throughput", "percent",
    "award", "awarded", "published", "patent", "certified", "promoted", "million", "thousand",
}
GENERIC_FILLER = ("results-driven", "passionate", "synergy", "dynamic", "detail-oriented", "team player",
                  "go-getter", "best-in-class", "world-class", "cutting-edge", "state-of-the-art", "seamless")
# Words a conservative rewrite may legitimately introduce (connectors / neutral verbs).
ALLOWED_NEW = {"contributed", "built", "developed", "implemented", "enhanced", "improved", "partnered", "authored",
               "wrote", "shipped", "released", "lowered", "raised", "ran", "carried", "out", "investigated", "examined",
               "validated", "incorporated", "cut", "for", "the", "using", "to", "and", "maintained", "created",
               "designed", "tested"}

_IRREGULAR = {"led": "lead", "oversaw": "oversee", "ran": "run", "wrote": "write", "built": "build", "made": "make",
              "drove": "drive", "won": "win", "took": "take", "grew": "grow", "began": "begin", "taught": "teach"}


def stem(word: str) -> str:
    """Crude stem so 'managing' / 'managed' / 'manages' compare equal (rewrites change tense, not meaning)."""
    w = _IRREGULAR.get(word, word)
    for suf in ("ing", "ed", "es", "s"):
        if w.endswith(suf) and len(w) - len(suf) >= 3:
            w = w[: -len(suf)]
            break
    return w[:-1] if w.endswith("e") and len(w) > 4 else w


def numbers(text: str) -> set:
    return {re.sub(r"\s+", "", m.group(0)).lower() for m in NUMBER_RE.finditer(text or "")}


def validate_rewrite(original: str, rewrite: str, evidence_texts: Iterable[str],
                     skill_terms: Callable[[str], List[str]]) -> Tuple[bool, List[str]]:
    """Return (ok, problems). `evidence_texts` must be VERIFIED resume text only."""
    problems: List[str] = []
    source = " ".join([original, *evidence_texts])
    if not rewrite or not rewrite.strip():
        return False, ["empty rewrite"]
    if re.sub(r"\W+", "", rewrite.lower()) == re.sub(r"\W+", "", original.lower()):
        return False, ["rewrite is identical to the original"]

    new_numbers = numbers(rewrite) - numbers(source)
    if new_numbers:
        problems.append(f"introduces numbers not found in the resume: {sorted(new_numbers)}")

    new_tech = {s.lower() for s in skill_terms(rewrite)} - {s.lower() for s in skill_terms(source)}
    if new_tech:
        problems.append(f"introduces technologies not found in the resume: {sorted(new_tech)}")

    src_tokens = set(tokens(source))
    src_stems = {stem(t) for t in src_tokens}
    new_claims = {w for w in tokens(rewrite) if w in CLAIM_WORDS and stem(w) not in src_stems}
    if new_claims:
        problems.append(f"introduces unsupported claims: {sorted(new_claims)}")

    low = rewrite.lower()
    filler = [f for f in GENERIC_FILLER if f in low and f not in original.lower()]
    if filler:
        problems.append(f"adds generic filler: {filler}")

    # Meaning preservation: the original's content words must survive (weak openers aside).
    orig_content = {t for t in tokens(original) if t not in STOPWORDS and len(t) > 2} - {
        "responsible", "worked", "helped", "assisted", "involved", "successfully", "order", "charge", "tasked"}
    if orig_content:
        rewrite_stems = {stem(t) for t in tokens(rewrite)}
        kept = sum(1 for t in orig_content if stem(t) in rewrite_stems) / len(orig_content)
        if kept < 0.7:
            problems.append(f"drops too much of the original content ({kept:.0%} kept)")

    # Every other new word must come from the evidence or the small set of neutral connectors/verbs.
    unexplained = {t for t in tokens(rewrite)
                   if stem(t) not in src_stems and t not in ALLOWED_NEW and not t.isdigit()}
    if len(unexplained) > 2:
        problems.append(f"adds wording not grounded in the resume: {sorted(unexplained)[:5]}")
    return (not problems), problems


def confidence(*, has_rewrite: bool, rewrite_validated: bool, resume_evidence: int, job_evidence: bool,
               requires_user_input: bool, minimal_edit: bool, assumption: str = "") -> dict:
    """Deterministic, documented signals — NOT a calibrated probability."""
    score, signals = 40, []
    if resume_evidence:
        score += 20; signals.append(f"supported by {resume_evidence} excerpt(s) from your resume")
    if has_rewrite and rewrite_validated:
        score += 20; signals.append("rewrite passed validation: no new numbers, technologies or claims")
    if minimal_edit:
        score += 10; signals.append("only rewords text that is already there")
    if job_evidence:
        score += 5; signals.append("linked to a requirement in the job description")
    if requires_user_input:
        score -= 15; signals.append("needs details only you can provide")
    if assumption:
        score -= 20; signals.append(assumption)
    score = max(0, min(100, score))
    level = "high" if score >= 75 else "medium" if score >= 50 else "low"
    return {"level": level, "score": score, "signals": signals}
