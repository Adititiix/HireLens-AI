"""
Rule-based issue detectors.

Each detector looks at the candidate's own text and returns Issues. An Issue may
carry a *conservative* rewrite — one that only rearranges or tightens words that
are already there (e.g. "Responsible for maintaining X" → "Maintained X") — or a
targeted question when an improvement would need facts the resume doesn't
contain. Detectors never add numbers, technologies, features or claims; the
validator (validator.py) re-checks every rewrite before it is returned.

To add a rule: write a function `_detect_<name>(unit, ctx) -> List[Issue]`, add it
to UNIT_DETECTORS, and give its category a guideline in guidelines.py.
"""
import re
from collections import Counter, defaultdict
from dataclasses import dataclass, field
from typing import Callable, Dict, List, Optional, Set

from .retriever import STOPWORDS, tokens
from .segmenter import Unit

SEVERITY_RANK = {"high": 0, "medium": 1, "low": 2}
BULLET_SECTIONS = {"experience", "projects"}


@dataclass
class Issue:
    unit: Optional[Unit]
    category: str
    severity: str
    reason: str
    rewrite: Optional[str] = None       # conservative rewrite of unit.text, or None
    question: Optional[str] = None      # what to ask the user when facts are missing
    detail: dict = field(default_factory=dict)


@dataclass
class Context:
    """Per-request facts the detectors may consult."""
    skill_terms: Callable[[str], List[str]]           # existing SkillMatcher.extract_skills
    entry_technologies: Dict[str, List[str]] = field(default_factory=dict)  # entry_key → listed technologies
    entries_with_metrics: Set[str] = field(default_factory=set)


# ── Verb knowledge ──────────────────────────────────────────────────────────
IRREGULAR_PAST = {"built", "wrote", "led", "ran", "made", "drove", "won", "took", "set", "grew", "cut", "began",
                  "brought", "taught", "held", "kept", "met", "sent", "spent", "chose", "gave", "got", "did", "rebuilt",
                  "rewrote", "oversaw", "undertook", "sought", "fed", "shot", "spun", "split"}
VERB_BASES = {"develop", "build", "implement", "design", "create", "engineer", "architect", "deploy", "integrate",
              "optimize", "optimise", "automate", "analyze", "analyse", "test", "write", "lead", "manage", "collaborate",
              "research", "evaluate", "train", "improve", "reduce", "increase", "migrate", "maintain", "refactor",
              "document", "present", "publish", "organize", "coordinate", "mentor", "conduct", "contribute", "deliver",
              "launch", "ship", "configure", "monitor", "debug", "fix", "resolve", "enhance", "streamline", "establish",
              "prototype", "model", "visualize", "scrape", "clean", "process", "extract", "apply", "achieve", "earn",
              "win", "secure", "complete", "enable", "investigate", "explore", "assist", "support", "help", "work",
              "participate", "handle", "prepare", "review", "plan", "define", "run", "set", "add", "cut", "fine-tune",
              "benchmark", "validate", "author", "co-develop", "co-author", "host", "serve", "survey", "teach", "tutor"}
GERUND_TO_PAST = {
    "maintaining": "Maintained", "developing": "Developed", "building": "Built", "creating": "Created",
    "designing": "Designed", "implementing": "Implemented", "testing": "Tested", "managing": "Managed",
    "writing": "Wrote", "debugging": "Debugged", "documenting": "Documented", "deploying": "Deployed",
    "monitoring": "Monitored", "analyzing": "Analyzed", "analysing": "Analysed", "preparing": "Prepared",
    "coordinating": "Coordinated", "handling": "Handled", "supporting": "Supported", "updating": "Updated",
    "integrating": "Integrated", "optimizing": "Optimized", "optimising": "Optimised", "conducting": "Conducted",
    "organizing": "Organized", "organising": "Organised", "reviewing": "Reviewed", "training": "Trained",
    "collecting": "Collected", "cleaning": "Cleaned", "automating": "Automated", "migrating": "Migrated",
    "configuring": "Configured", "researching": "Researched", "evaluating": "Evaluated", "processing": "Processed",
    "preprocessing": "Preprocessed", "refactoring": "Refactored", "running": "Ran", "leading": "Led",
    "planning": "Planned", "delivering": "Delivered", "fixing": "Fixed", "resolving": "Resolved",
}
# Near-synonyms only (same meaning). A repeated verb with no entry here is left alone.
SYNONYMS = {
    "developed": ["built", "implemented"], "built": ["developed", "implemented"],
    "implemented": ["built", "developed"], "created": ["built", "developed"],
    "improved": ["enhanced"], "enhanced": ["improved"], "collaborated": ["partnered"],
    "wrote": ["authored"], "authored": ["wrote"], "managed": ["oversaw"], "deployed": ["shipped", "released"],
    "reduced": ["cut", "lowered"], "increased": ["raised"], "conducted": ["ran", "carried out"],
    "researched": ["investigated"], "analyzed": ["examined"], "tested": ["validated"],
    "integrated": ["incorporated"],
}
BUILD_VERBS = {"developed", "built", "implemented", "designed", "created", "engineered", "optimized", "optimised",
               "improved", "automated", "deployed", "reduced", "increased", "migrated", "trained", "enhanced",
               "architected", "launched", "shipped", "streamlined", "refactored", "integrated"}

OUTCOME_CUE = re.compile(r"\d|%|\b(reduc|improv|increas|achiev|result|accura|latency|throughput|faster|slower|"
                         r"saving|saved|users?|customers?|adopt|enabl|recall|precision|f1|score|rank|award|won|"
                         r"published|accepted|selected|deployed to|in production)\w*", re.I)
PURPOSE_CUE = re.compile(r"\b(to|for|that|which|enabling|allowing|so that|by|so users|helping)\b", re.I)
# "Built foundational understanding of …", "Developed strong public speaking, … and teamwork skills …"
LEARNING_OBJECT = re.compile(r"^\w+\s+(?:(?!\b(?:that|which|for|using|with|based|to|by)\b)[^.;]){0,90}?"
                             r"\b(understanding|knowledge|familiarity|expertise|proficiency|skills?|foundation)\b(?!-)", re.I)
RESEARCH_CUE = re.compile(r"\b(research|paper|thesis|academic|study|coursework|ongoing|conference|survey)\b", re.I)
URL_RE = re.compile(r"https?://|www\.|\b[\w-]+\.(com|io|dev|app|org|net)\b/?", re.I)
VAGUE_RE = re.compile(r"\b(various|several|multiple|many|numerous|different)\s+(tasks|things|features|projects|modules|"
                      r"technologies|tools|activities|areas|responsibilities|functionalities|components)\b|\betc\.?|"
                      r"\band (so on|more)\b|\bstuff\b", re.I)
GENERIC_PHRASE_WORDS = {"responsible", "various", "multiple", "worked", "helped", "involved", "successfully",
                        "efficiently", "effectively", "ensure", "ensuring", "variety", "range", "assisted", "duties",
                        "tasks", "things", "hands-on", "passionate", "strong", "skills"}

_WORD = re.compile(r"[A-Za-z][A-Za-z\-']*")


def first_word(text: str) -> str:
    m = _WORD.match(text.strip())
    return m.group(0).lower() if m else ""


def is_action_word(w: str) -> bool:
    w = w.lower()
    if not w:
        return False
    if w in IRREGULAR_PAST or w in VERB_BASES or w in GERUND_TO_PAST:
        return True
    if w.endswith("ed") and len(w) > 4:
        return True
    if w.endswith("s") and w[:-1] in VERB_BASES:   # "Builds", "Develops"
        return True
    return False


def cap(s: str) -> str:
    return s[:1].upper() + s[1:] if s else s


def end_sentence(s: str) -> str:
    s = s.rstrip()
    return s if re.search(r"[.!?)]$", s) else s + "."


def strip_end(s: str) -> str:
    return re.sub(r"[.\s]+$", "", s)


def join_list(items: List[str]) -> str:
    items = [i for i in items if i]
    return items[0] if len(items) == 1 else ", ".join(items[:-1]) + " and " + items[-1]


def descriptor_case(s: str) -> str:
    """'AI Resume Screening Platform' → 'AI resume screening platform' (keep acronyms)."""
    return " ".join(w if sum(ch.isupper() for ch in w) >= 2 or not w[:1].isupper() else w.lower() for w in s.split())


def _tech_ratio(text: str, ctx: Context) -> float:
    content = [t for t in tokens(text) if not t.isdigit()]
    if not content:
        return 0.0
    tech_tokens = set()
    for skill in ctx.skill_terms(text):
        tech_tokens.update(tokens(skill))
    return sum(1 for t in content if t in tech_tokens) / len(content)


# ── Per-unit detectors ──────────────────────────────────────────────────────

def _detect_first_person(u: Unit, ctx: Context) -> List[Issue]:
    m = re.match(r"^(?:i|we)\s+([A-Za-z][\w-]*)\s+(.+)$", u.text, re.I)
    if not m or not is_action_word(m.group(1)):
        return []
    return [Issue(u, "first_person", "low",
                  "Resume bullets are conventionally written without first-person pronouns.",
                  rewrite=f"{cap(m.group(1))} {m.group(2)}")]


_WEAK_OPENERS = [
    (re.compile(r"^(?:i\s+)?worked\s+on\s+(.+)$", re.I), "Contributed to {0}"),
    (re.compile(r"^(?:i\s+)?(?:helped|assisted)\s+(?:with|in)\s+(.+)$", re.I), "Contributed to {0}"),
    (re.compile(r"^(?:i\s+)?(?:was\s+)?involved\s+in\s+(.+)$", re.I), "Contributed to {0}"),
]
_RESPONSIBILITY = re.compile(r"^(?:i\s+)?(?:was\s+)?(?:responsible\s+for|in\s+charge\s+of|tasked\s+with|"
                             r"duties\s+included|my\s+role\s+was\s+to|role\s+included)\s+(.+)$", re.I)


def _detect_weak_opener(u: Unit, ctx: Context) -> List[Issue]:
    m = _RESPONSIBILITY.match(u.text)
    if m:
        rest = m.group(1)
        g = re.match(r"^([A-Za-z]+ing)\b(.*)$", rest)
        rewrite = None
        if g and g.group(1).lower() in GERUND_TO_PAST:
            rewrite = GERUND_TO_PAST[g.group(1).lower()] + g.group(2)
        return [Issue(u, "responsibility_not_contribution", "high" if u.section == "experience" else "medium",
                      "The bullet describes a responsibility rather than what you actually did or delivered.",
                      rewrite=rewrite,
                      question=None if rewrite else
                      f"What did you personally do for “{strip_end(rest)[:80]}”, and what came out of it?")]
    for pat, template in _WEAK_OPENERS:
        m = pat.match(u.text)
        if m:
            return [Issue(u, "weak_opener", "medium",
                          "Vague openers like “worked on” or “helped with” hide your actual contribution.",
                          rewrite=template.format(m.group(1)),
                          question=f"Which part did you build or own in “{strip_end(m.group(1))[:80]}”? "
                                   "A specific verb (e.g. designed, implemented, tested) is stronger if accurate.")]
    return []


def _detect_tech_list_only(u: Unit, ctx: Context) -> List[Issue]:
    text = u.text
    starts_with_use = re.match(r"^(?:used|using|utili[sz]ed|leveraged|tech(?:nolog(?:y|ies))?(?:\s+stack)?|"
                               r"tools(?:\s+used)?|stack|built with)\b[:\s]", text, re.I)
    ratio = _tech_ratio(text, ctx)
    short = len(text.split()) <= 14
    if not ((starts_with_use and short) or (ratio >= 0.6 and short)):
        return []
    if PURPOSE_CUE.search(re.sub(r"^(?:used|using)\b", "", text, flags=re.I)) and not re.match(r"^tech|^tools|^stack", text, re.I):
        return []  # already says what the technology was used for
    issue = Issue(u, "tech_list_only", "medium",
                  "The bullet lists technologies but doesn't explain what they were used to build or why.",
                  question=f"What did you build with these technologies in “{u.entry_label or 'this project'}”, "
                           "and what problem does it solve?")
    # Grounded rewrite: the project's own title often states its purpose ("HireLens AI — AI Resume Screening Platform").
    desc = re.split(r"\s+[—–-]\s+|:\s+", u.entry_label, maxsplit=1)
    if (u.section == "projects" and len(desc) == 2 and not re.match(r"^(tech|tools|stack)", text, re.I)
            and not set(tokens(desc[1])) <= set(tokens(text))):
        issue.rewrite = f"{strip_end(text)} for the {descriptor_case(desc[1])}."
        issue.detail["grounding"] = "project_title"
    return [issue]


def _detect_missing_action(u: Unit, ctx: Context) -> List[Issue]:
    w = first_word(u.text)
    if not w or is_action_word(w) or len(u.text.split()) < 4 or URL_RE.search(u.text):
        return []
    if re.match(r"^(i|we|responsible|worked|helped|assisted|involved|used|using|tech|tools|stack|built with)\b", u.text, re.I):
        return []
    return [Issue(u, "missing_action", "medium",
                  "The bullet doesn't start with what you did, so your contribution is unclear.",
                  question="What did you do here? Starting with a specific verb (built, designed, analyzed, …) "
                           "makes your contribution clear.")]


def _detect_vague(u: Unit, ctx: Context) -> List[Issue]:
    m = VAGUE_RE.search(u.text)
    if not m:
        return []
    return [Issue(u, "vague_description", "medium",
                  f"“{m.group(0).strip()}” is vague — specifics show the real scope of your work.",
                  question=f"Which specific {m.group(2) if m.group(2) else 'items'} do you mean? Name the most important ones.")]


_FILLERS = [(re.compile(r"\bin order to\b", re.I), "to"),
            (re.compile(r"^successfully\s+", re.I), "")]


def _detect_filler(u: Unit, ctx: Context) -> List[Issue]:
    new = u.text
    for pat, rep in _FILLERS:
        new = pat.sub(rep, new)
    new = cap(re.sub(r"\s{2,}", " ", new).strip())
    if new == u.text:
        return []
    return [Issue(u, "filler", "low", "Filler words make the bullet longer without adding information.", rewrite=new)]


_SPLIT_AND_VERB = re.compile(r",?\s+and\s+(?=(?:[a-z]+ed|built|wrote|led|ran|made|drove)\b)", re.I)


def _detect_too_long(u: Unit, ctx: Context) -> List[Issue]:
    n = len(u.text.split())
    if n <= 35:
        return []
    issue = Issue(u, "too_long", "medium" if n > 45 else "low",
                  f"At {n} words this bullet is hard to scan; recruiters skim bullets of one or two lines.",
                  question="Which single result or contribution matters most here? Keep that, and move the rest to its own bullet.")
    parts = re.split(r";\s+", u.text, maxsplit=1)
    if len(parts) != 2:
        parts = _SPLIT_AND_VERB.split(u.text, maxsplit=1)
    if len(parts) == 2 and all(len(p.split()) >= 6 for p in parts) and is_action_word(first_word(parts[1])):
        issue.rewrite = f"{end_sentence(parts[0].strip())}\n{end_sentence(cap(parts[1].strip()))}"
        issue.detail["split"] = True
    return [issue]


def _outcome_question(text: str) -> str:
    low = text.lower()
    if re.search(r"\b(model|classif|predict|detect|train|nlp|machine learning|ml|accuracy|neural)\b", low):
        return "What dataset size did you evaluate this on, and which metric (accuracy, F1, recall, …) did you measure?"
    if re.search(r"\b(api|backend|server|endpoint|service|database|query)\b", low):
        return "Do you know how many requests, records or users this handled, or its response time?"
    if re.search(r"\b(pipeline|etl|data|ingest|batch|stream)\b", low):
        return "How much data did this process, and how often or how fast?"
    if re.search(r"\b(ui|frontend|front-end|website|web app|page|interface|app)\b", low):
        return "How many people used it, or what measurable improvement did it bring?"
    return "What changed because of this work — time saved, scale handled, quality improved? Only include numbers you can back up."


def _detect_missing_outcome(u: Unit, ctx: Context) -> List[Issue]:
    if u.entry_key in ctx.entries_with_metrics:          # the entry already demonstrates outcomes
        return []
    if first_word(u.text) not in BUILD_VERBS or OUTCOME_CUE.search(u.text):
        return []
    if LEARNING_OBJECT.match(u.text):   # "Built foundational understanding of …" is learning, not a deliverable
        return []
    research = bool(RESEARCH_CUE.search(u.text + " " + u.entry_label))
    return [Issue(u, "missing_outcome", "low" if research else "medium",
                  "The bullet says what you built but not what it achieved (scale, performance, results)."
                  + (" Research work doesn't always have business metrics — add one only if you measured it." if research else ""),
                  question=_outcome_question(u.text))]


def _detect_missing_technical_context(u: Unit, ctx: Context) -> List[Issue]:
    if first_word(u.text) not in BUILD_VERBS or len(u.text.split()) > 12:
        return []
    if ctx.skill_terms(u.text) or re.search(r"\b(using|with|via|in|on)\b", u.text, re.I):
        return []
    issue = Issue(u, "missing_technical_context", "low",
                  "The bullet doesn't say how it was built, so the technical depth isn't visible.",
                  question="Which technologies or techniques did you use for this?")
    listed = ctx.entry_technologies.get(u.entry_key, [])
    if listed:  # technologies the resume itself lists for this same project
        issue.rewrite = f"{strip_end(u.text)} using {join_list(listed[:3])}."
        issue.detail["grounding"] = "project_technologies"
    return [issue]


UNIT_DETECTORS = [_detect_first_person, _detect_weak_opener, _detect_tech_list_only, _detect_missing_action,
                  _detect_vague, _detect_filler, _detect_too_long, _detect_missing_outcome,
                  _detect_missing_technical_context]


def detect_unit_issues(u: Unit, ctx: Context) -> List[Issue]:
    if u.section not in BULLET_SECTIONS or u.field not in ("bullets", "description", "text"):
        return []
    found: List[Issue] = []
    for det in UNIT_DETECTORS:
        found.extend(det(u, ctx))
    return found


# ── Cross-bullet detectors ─────────────────────────────────────────────────

def detect_repeated_verbs(units: List[Unit]) -> List[Issue]:
    bullets = [u for u in units if u.section in BULLET_SECTIONS and u.field in ("bullets", "description", "text")]
    verbs = [(u, first_word(u.text)) for u in bullets]
    total = Counter(v for _, v in verbs if v)
    per_entry = Counter((u.entry_key, v) for u, v in verbs if v)
    usage = Counter(total)
    issues, seen = [], Counter()
    for u, v in verbs:
        if v not in SYNONYMS:
            continue  # no equally accurate alternative → leave accurate wording alone
        seen[v] += 1
        repeated = total[v] >= 3 or per_entry[(u.entry_key, v)] >= 2
        if not repeated or seen[v] == 1:
            continue
        alt = min(SYNONYMS[v], key=lambda a: (usage[a], SYNONYMS[v].index(a)))
        usage[alt] += 1
        word = re.match(r"\s*([A-Za-z][A-Za-z\-']*)", u.text).group(1)
        rewrite = (alt.capitalize() if word[:1].isupper() else alt) + u.text.strip()[len(word):]
        issues.append(Issue(u, "repeated_verb", "low",
                            f"“{word}” opens {total[v]} bullets; “{alt}” means the same here and adds variety.",
                            rewrite=rewrite, detail={"verb": v, "count": total[v], "alternative": alt}))
    return issues


def detect_repeated_phrases(units: List[Unit], skill_terms: Callable[[str], List[str]]) -> List[Issue]:
    bullets = [u for u in units if u.section in BULLET_SECTIONS and u.field in ("bullets", "description", "text")]
    occurrences: Dict[str, List[Unit]] = defaultdict(list)
    for u in bullets:
        words = [w.lower() for w in _WORD.findall(u.text)]
        tech = {t for s in skill_terms(u.text) for t in tokens(s)}
        grams = set()
        for n in (5, 4, 3):
            for i in range(1, len(words) - n + 1):          # skip the opening verb (handled above)
                g = words[i:i + n]
                if any(t in tech for t in g) or not any(t in GENERIC_PHRASE_WORDS for t in g):
                    continue  # technical terminology is legitimate repetition
                if sum(1 for t in g if t not in STOPWORDS) < 2:
                    continue
                grams.add(" ".join(g))
        for g in grams:
            occurrences[g].append(u)
    issues, flagged = [], set()
    for phrase in sorted(occurrences, key=lambda p: -len(p.split())):
        us = occurrences[phrase]
        if len({x.uid for x in us}) < 2 or any(phrase in f for f in flagged):
            continue
        flagged.add(phrase)
        for u in us[1:]:
            issues.append(Issue(u, "repeated_phrase", "low",
                                f"The phrase “{phrase}” appears in {len(us)} bullets — repeating generic wording dilutes each one.",
                                question="Can you replace the repeated wording with what was specific about this piece of work?",
                                detail={"phrase": phrase, "count": len(us)}))
    return issues
