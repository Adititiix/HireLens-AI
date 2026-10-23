"""
Request / response models for POST /resume-suggestions.

The resume arrives in the same shape the editor and the Express backend already
use (Resume.parsedData): experience[].bullets, projects[].description (one bullet
per line), achievements[], skills{bucket: [...]}, summary. A plain `resume_text`
is accepted as a fallback for callers that only have extracted text.

Everything in a request is treated as DATA: nothing in it is ever interpreted
as an instruction. Size limits keep a single request bounded.
"""
from typing import Any, Dict, List, Optional

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

MAX_LINE = 2000          # one bullet / description line
MAX_ITEMS = 100          # entries or bullets per list
MAX_RESUME_TEXT = 60000
MAX_JD_TEXT = 20000


class _Lenient(BaseModel):
    """Ignore unknown fields and treat explicit nulls (common in MongoDB documents) as 'not provided'."""
    model_config = ConfigDict(extra="ignore")

    @model_validator(mode="before")
    @classmethod
    def _drop_nulls(cls, values: Any) -> Any:
        if isinstance(values, dict):
            return {k: v for k, v in values.items() if v is not None}
        return values


def _clip(s: Any) -> str:
    return str(s)[:MAX_LINE] if s is not None else ""


class ExperienceIn(_Lenient):
    id: str = ""
    title: str = ""
    company: str = ""
    bullets: List[str] = Field(default_factory=list, max_length=MAX_ITEMS)

    @field_validator("bullets", mode="before")
    @classmethod
    def _clean(cls, v):
        return [_clip(b) for b in (v or []) if isinstance(b, (str, int, float))]


class ProjectIn(_Lenient):
    id: str = ""
    name: str = ""
    description: str = Field("", max_length=MAX_LINE * 20)
    technologies: List[str] = Field(default_factory=list, max_length=MAX_ITEMS)


class AchievementIn(_Lenient):
    id: str = ""
    title: str = ""
    description: str = ""


class ResumeIn(_Lenient):
    summary: str = Field("", max_length=MAX_LINE * 3)
    experience: List[ExperienceIn] = Field(default_factory=list, max_length=MAX_ITEMS)
    projects: List[ProjectIn] = Field(default_factory=list, max_length=MAX_ITEMS)
    achievements: List[AchievementIn] = Field(default_factory=list, max_length=MAX_ITEMS)
    skills: Dict[str, List[str]] = Field(default_factory=dict)
    education: List[Dict[str, Any]] = Field(default_factory=list, max_length=MAX_ITEMS)
    certifications: List[Dict[str, Any]] = Field(default_factory=list, max_length=MAX_ITEMS)

    @field_validator("skills", mode="before")
    @classmethod
    def _skills(cls, v):
        if not isinstance(v, dict):
            return {}
        return {str(k): [str(s) for s in (lst or []) if isinstance(s, str)][:MAX_ITEMS]
                for k, lst in v.items() if isinstance(lst, list)}


class AnalysisIn(_Lenient):
    """Optional results of an existing /analyze run (skill gap), reused instead of recomputed."""
    missing_skills: List[str] = Field(default_factory=list)
    matched_skills: List[str] = Field(default_factory=list)
    high_missing: List[str] = Field(default_factory=list)
    medium_missing: List[str] = Field(default_factory=list)


class SuggestRequest(_Lenient):
    resume: Optional[ResumeIn] = None
    resume_text: str = Field("", max_length=MAX_RESUME_TEXT)
    job_description: str = Field("", max_length=MAX_JD_TEXT)
    analysis: Optional[AnalysisIn] = None
    max_suggestions: int = Field(25, ge=1, le=50)

    @model_validator(mode="after")
    def _needs_content(self):
        has_structured = self.resume is not None and any([
            self.resume.summary.strip(),
            any(b.strip() for e in self.resume.experience for b in e.bullets),
            any(p.description.strip() or p.name.strip() for p in self.resume.projects),
            any(a.title.strip() or a.description.strip() for a in self.resume.achievements),
            any(self.resume.skills.values()),
        ])
        if not has_structured and not self.resume_text.strip():
            raise ValueError("Provide resume content: a structured `resume` or non-empty `resume_text`.")
        return self


# ── Response ────────────────────────────────────────────────────────────────

class Evidence(BaseModel):
    text: str
    source: str            # "resume" | "job_description" | "analysis" | "guideline"
    label: str = ""        # e.g. "Projects › HireLens AI", "Writing guideline"
    verified: bool         # True only for content taken from the candidate's own resume / computed analysis


class Confidence(BaseModel):
    level: str             # "high" | "medium" | "low" — rule-based, NOT a calibrated probability
    score: int             # 0-100 sum of documented signals
    signals: List[str]


class Target(BaseModel):
    """Where the suggestion applies in the editor's resume data."""
    section: str           # "experience" | "projects" | "summary"
    entry_index: Optional[int] = None
    entry_id: str = ""
    field: str             # "bullets" | "description" | "summary"
    line_index: Optional[int] = None


class Suggestion(BaseModel):
    id: str
    category: str
    severity: str          # "high" | "medium" | "low"
    section: str
    entry: str = ""
    original_text: str = ""
    suggested_text: str = ""
    reason: str
    supporting_evidence: List[Evidence] = Field(default_factory=list)
    evidence_source: List[str] = Field(default_factory=list)
    related_job_requirement: Optional[str] = None
    confidence: Confidence
    requires_user_input: bool = False
    follow_up_question: Optional[str] = None
    target: Optional[Target] = None
    applicable: bool = False   # True when suggested_text can replace original_text at `target`
    skill: Optional[str] = None  # missing_skill / skill_not_demonstrated: the skill as written (job description or resume)


class SuggestResponse(BaseModel):
    suggestions: List[Suggestion]
    summary: Dict[str, Any]
    engine: Dict[str, Any]
