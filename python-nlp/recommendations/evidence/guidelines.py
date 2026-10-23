"""
Curated resume-writing guidelines — the only "general knowledge" the engine uses.

These are cited as evidence of type "guideline" (never as evidence of what the
candidate did). To add a rule: add an entry here, give it the categories it
supports, and reference it from a detector in detectors.py.
"""
GUIDELINES = [
    {"id": "G-ACTION", "categories": ["weak_opener", "missing_action"],
     "text": "Start each bullet with a specific past-tense action verb that says what you did."},
    {"id": "G-CONTRIBUTION", "categories": ["responsibility_not_contribution"],
     "text": "Describe what you contributed and delivered, not the duties you were assigned."},
    {"id": "G-PURPOSE", "categories": ["tech_list_only", "vague_description"],
     "text": "Explain what a project or feature does and why it matters, not only which technologies it uses."},
    {"id": "G-TECHNICAL", "categories": ["missing_technical_context"],
     "text": "Say how you built it — the key technologies or techniques — so the technical depth of the work is visible."},
    {"id": "G-OUTCOME", "categories": ["missing_outcome", "metric_available"],
     "text": "Add real results where you have them (scale, performance, reliability, users, evaluation metrics). Never estimate or invent numbers."},
    {"id": "G-VARIETY", "categories": ["repeated_verb", "repeated_phrase"],
     "text": "Avoid opening many bullets with the same verb when an equally accurate alternative exists; keep technical terms consistent."},
    {"id": "G-CONCISE", "categories": ["too_long", "filler"],
     "text": "Keep bullets to one or two lines (about 15-30 words) and cut filler words; split bullets that describe several distinct contributions."},
    {"id": "G-KEYWORDS", "categories": ["missing_skill", "skill_not_demonstrated"],
     "text": "Use the job's exact terms for skills you genuinely have, and show them in a project or experience bullet, not only in the skills list."},
    {"id": "G-PRONOUNS", "categories": ["first_person"],
     "text": "Write bullets without first-person pronouns (I, my, we); start with the action verb."},
    {"id": "G-SECTIONS", "categories": ["ats_section"],
     "text": "Use standard section headings (Experience or Projects, Skills, Education) so ATS parsers can find your content."},
]

BY_CATEGORY = {c: g for g in GUIDELINES for c in g["categories"]}
