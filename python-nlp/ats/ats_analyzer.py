"""
ATSAnalyzer — resume ATS compatibility checker (FIXED)

BUG FIXED: `list[str]` type hints require Python 3.9+.
           Changed to `List[str]` from typing module for 3.8+ compat.
"""
import re
from typing import Dict, List


REQUIRED_SECTIONS = {
    "summary":        ["summary", "objective", "profile", "about"],
    "experience":     ["experience", "work history", "employment", "work experience"],
    "education":      ["education", "academic", "qualification", "degree"],
    "skills":         ["skills", "technologies", "tech stack", "technical skills"],
    "certifications": ["certification", "certificate", "credential", "license"],
    "projects":       ["project", "portfolio", "github", "open source"],
}

ACTION_VERBS = [
    "developed","built","designed","implemented","led","managed","created","improved",
    "optimized","architected","delivered","launched","reduced","increased","automated",
    "collaborated","maintained","deployed","integrated","engineered","streamlined",
    "mentored","authored","spearheaded","coordinated","established","drove","scaled",
    "migrated","refactored","resolved","modernized","championed","owned",
]


class ATSAnalyzer:
    def analyze(self, resume_text: str) -> Dict:
        text_lower = resume_text.lower()
        issues: List[Dict] = []
        section_scores: Dict[str, int] = {}

        # Section presence check
        present_sections: Dict[str, bool] = {}
        for section, keywords in REQUIRED_SECTIONS.items():
            found = any(kw in text_lower for kw in keywords)
            present_sections[section] = found
            if not found and section in ["summary", "experience", "skills", "education"]:
                issues.append({
                    "type": "missing_section",
                    "severity": "high",
                    "message": f"Missing '{section}' section — ATS systems expect this heading.",
                })

        # Action verb count
        verb_count = sum(1 for v in ACTION_VERBS if v in text_lower)
        if verb_count < 4:
            issues.append({
                "type": "weak_verbs",
                "severity": "medium",
                "message": (
                    f"Only {verb_count} strong action verbs detected. "
                    f"Use: Developed, Architected, Optimized, Delivered."
                ),
            })

        # Measurable impact check
        has_metrics = bool(re.search(
            r"\d+\s*(%|percent|x|times|k\+|users|ms|seconds|minutes|\$[\d,]+)",
            text_lower
        ))
        if not has_metrics:
            issues.append({
                "type": "no_metrics",
                "severity": "medium",
                "message": "No quantified achievements found. Add: '40% faster', '10k+ users', '$2M revenue'.",
            })

        # Contact info
        has_email = bool(re.search(r"[\w.\-]+@[\w.\-]+\.\w+", resume_text))
        has_phone = bool(re.search(r"[\+\d][\d\s\-\(\)]{7,}", resume_text))
        if not has_email:
            issues.append({"type": "no_email", "severity": "high", "message": "Email not detected."})
        if not has_phone:
            issues.append({"type": "no_phone", "severity": "low", "message": "Phone number not detected."})

        # Length check
        word_count = len(resume_text.split())
        if word_count < 200:
            issues.append({
                "type": "too_short",
                "severity": "high",
                "message": f"Resume is too short ({word_count} words). ATS may rank it lower.",
            })

        # Per-section heuristic scores
        section_scores = {
            "summary": self._score_section(
                text_lower, REQUIRED_SECTIONS["summary"], verb_count, has_metrics
            ),
            "experience": self._score_section(
                text_lower, REQUIRED_SECTIONS["experience"], verb_count, has_metrics
            ),
            "skills": 90 if present_sections.get("skills") else 30,
            "projects": self._score_section(
                text_lower, REQUIRED_SECTIONS["projects"], verb_count, has_metrics
            ),
            "education": 90 if present_sections.get("education") else 40,
        }

        passed_checks: List[str] = []
        if has_email:       passed_checks.append("Email address detected")
        if has_phone:       passed_checks.append("Phone number detected")
        if verb_count >= 4: passed_checks.append(f"{verb_count} action verbs found")
        if has_metrics:     passed_checks.append("Quantified achievements present")
        for sec, found in present_sections.items():
            if found:
                passed_checks.append(f"'{sec}' section found")

        return {
            "section_scores":   section_scores,
            "issues":           issues,
            "sections_found":   present_sections,
            "passed_checks":    passed_checks,
        }

    def _score_section(
        self, text: str, keywords: List[str], verb_count: int, has_metrics: bool
    ) -> int:
        present = any(kw in text for kw in keywords)
        if not present:
            return 35
        base = 65
        base += min(verb_count * 4, 20)
        base += 15 if has_metrics else 0
        return min(base, 98)
