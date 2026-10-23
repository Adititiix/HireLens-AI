"""
Resume → addressable text units.

Each Unit remembers exactly where it came from (section, entry index/id, field,
line index) so a suggestion can be applied to that one line in the editor — or
refused if the line has changed since. Units from a plain-text resume carry no
editor location (they can be copied, not applied).
"""
import re
from dataclasses import dataclass, field as dc_field
from typing import List, Optional

from .models import ResumeIn

_BULLET_PREFIX = re.compile(r"^\s*(?:[•\-–*▪●○■□◦►▸➢➤✓✔→]|\d+[.)])\s*")


def clean_line(s: str) -> str:
    return re.sub(r"\s+", " ", _BULLET_PREFIX.sub("", s or "")).strip()


@dataclass
class Unit:
    uid: str
    section: str                 # experience | projects | summary | achievements | skills | text
    text: str
    entry_label: str = ""        # "Full Stack Developer Intern — Briddlee", "HireLens AI — …"
    entry_key: str = ""          # groups lines of the same entry
    entry_index: Optional[int] = None
    entry_id: str = ""
    field: str = ""              # bullets | description | summary | achievement | skills
    line_index: Optional[int] = None
    rewritable: bool = False     # True when the editor can replace this exact line
    meta: dict = dc_field(default_factory=dict)


def _entry_label(*parts: str) -> str:
    return " — ".join(p.strip() for p in parts if p and p.strip())


def segment_structured(resume: ResumeIn) -> List[Unit]:
    units: List[Unit] = []
    if resume.summary.strip():
        units.append(Unit(uid="summary", section="summary", text=clean_line(resume.summary),
                          entry_label="Professional Summary", entry_key="summary",
                          field="summary", rewritable=True))
    for i, e in enumerate(resume.experience):
        key = f"experience:{i}"
        label = _entry_label(e.title, e.company)
        for j, b in enumerate(e.bullets):
            t = clean_line(b)
            if t:
                units.append(Unit(uid=f"{key}:{j}", section="experience", text=t, entry_label=label,
                                  entry_key=key, entry_index=i, entry_id=e.id, field="bullets",
                                  line_index=j, rewritable=True))
        if label:  # "Role — Company" as its own searchable evidence chunk, like a project title
            units.append(Unit(uid=f"{key}:title", section="experience", text=label, entry_label=label,
                              entry_key=key, entry_index=i, entry_id=e.id, field="title"))
    for i, p in enumerate(resume.projects):
        key = f"projects:{i}"
        label = p.name.strip()
        # description = one bullet per line (raw line index kept so the editor can replace it)
        for j, line in enumerate((p.description or "").split("\n")):
            t = clean_line(line)
            if t:
                units.append(Unit(uid=f"{key}:{j}", section="projects", text=t, entry_label=label,
                                  entry_key=key, entry_index=i, entry_id=p.id, field="description",
                                  line_index=j, rewritable=True,
                                  meta={"technologies": [x for x in p.technologies if x]}))
        if label:  # the title itself is evidence (it often states the project's purpose)
            units.append(Unit(uid=f"{key}:title", section="projects", text=label, entry_label=label,
                              entry_key=key, entry_index=i, entry_id=p.id, field="name"))
    for i, a in enumerate(resume.achievements):
        t = clean_line(" — ".join(x for x in (a.title, a.description) if x and x.strip()))
        if t:
            units.append(Unit(uid=f"achievements:{i}", section="achievements", text=t,
                              entry_label=a.title.strip(), entry_key=f"achievements:{i}",
                              entry_index=i, entry_id=a.id, field="achievement"))
    skills = sorted({s.strip() for lst in resume.skills.values() for s in lst if s and s.strip()}, key=str.lower)
    if skills:
        units.append(Unit(uid="skills", section="skills", text="Skills: " + ", ".join(skills),
                          entry_label="Skills", entry_key="skills", field="skills",
                          meta={"skills": skills}))
    return units


_HEADINGS = [
    ("summary", r"summary|professional summary|profile|objective|about me"),
    ("experience", r"experience|work experience|professional experience|employment|work history|internships?"),
    ("projects", r"projects|academic projects|personal projects|technical projects"),
    ("skills", r"skills|technical skills|technologies"),
    ("education", r"education"),
    ("achievements", r"achievements|awards|honou?rs|accomplishments"),
    ("certifications", r"certifications?"),
]


def segment_text(text: str) -> List[Unit]:
    """Fallback for plain resume text: headings → sections, every content line → a unit (not editor-addressable)."""
    units: List[Unit] = []
    section = "text"
    for n, raw in enumerate((text or "").split("\n")):
        line = clean_line(raw.replace("\t", " "))
        if not line:
            continue
        low = line.lower().rstrip(":")
        heading = next((key for key, pat in _HEADINGS if re.fullmatch(pat, low)), None)
        if heading:
            section = heading
            continue
        if section in ("education", "certifications", "text"):
            continue  # header/contact block and education lines are not rewritten
        units.append(Unit(uid=f"text:{n}", section=section, text=line, entry_key=f"text:{section}",
                          field="text", line_index=n))
    return units
