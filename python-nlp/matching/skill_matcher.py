"""
SkillMatcher — 3-layer hybrid matching engine (FIXED & VERIFIED)

BUG FIXED: score_engine.py was creating a new Embedder() inside compute_scores()
           causing double model loading and ~500MB RAM waste.
           Now accepts injected embedder via constructor.

BUG FIXED: suggestion_engine.py used `dict | None` type hint (Python 3.10+ only).
           Fixed to use Optional[dict] for Python 3.8+ compatibility.

Layer 1: Exact match + taxonomy synonym resolution
Layer 2: Fuzzy match (RapidFuzz token_sort_ratio)
Layer 3: Semantic similarity via injected Embedder (optional)

Terminal debug output: prints colored logs to stdout for every analysis run.
"""
import re
import sys
from typing import List, Dict, Optional
from rapidfuzz import fuzz


# ── Colors for terminal output ─────────────────────────────────
GREEN  = "\033[92m"
RED    = "\033[91m"
YELLOW = "\033[93m"
CYAN   = "\033[96m"
BOLD   = "\033[1m"
RESET  = "\033[0m"


# ── Skill taxonomy ─────────────────────────────────────────────
SKILL_KEYWORDS: List[str] = [
    # Languages
    "python","javascript","typescript","java","c++","c#","golang","go","rust",
    "swift","kotlin","ruby","php","scala","r","dart","elixir","bash","sql",
    # Frontend
    "react","vue","angular","next.js","svelte","tailwindcss","html","css",
    "sass","webpack","vite","gatsby","remix",
    # Backend
    "node.js","express","django","flask","fastapi","spring boot","laravel",
    "rails","graphql","rest api","grpc","nestjs",
    # Databases
    "mongodb","postgresql","mysql","sqlite","redis","elasticsearch","cassandra",
    "dynamodb","firebase","supabase","oracle",
    # Cloud & DevOps
    "aws","gcp","azure","docker","kubernetes","terraform","ansible","jenkins",
    "github actions","ci/cd","linux","nginx",
    # ML / AI
    "machine learning","deep learning","nlp","computer vision","scikit-learn",
    "tensorflow","pytorch","keras","pandas","numpy","matplotlib","apache spark",
    # Tools & Methodology
    "git","github","gitlab","jira","agile","tdd","websocket","microservices",
    "data structures","algorithms","system design","oop",
    # Messaging
    "kafka","rabbitmq","celery",
    # Testing
    "jest","vitest","cypress","playwright","selenium",
    # Product & Business
    "product management","product strategy","product roadmap","roadmap planning","product lifecycle","product marketing","go-to-market",
    "gtm","market research","competitor analysis","user research","customer research","customer insights","user feedback",
    "stakeholder management","business analysis","business strategy","growth marketing","branding","positioning","analytics","data analysis",
    "performance tracking","kpi","okr",
    # Soft Skills
    "communication","presentation","public speaking","leadership","teamwork","collaboration","cross-functional collaboration",
    "problem solving","critical thinking","decision making","time management","organizational skills","attention to detail","adaptability",
    "creativity","negotiation","mentoring","ownership","strategic thinking",
    # Startup / Operations
    "startup",
    "operations",
    "execution",
    "growth",
    "business development",
    "customer success",
    "project management",
    "program management",
    "research",
    "field operations",
    "process improvement",
    # EV / Energy / Sustainability
    "electric vehicles",
    "ev",
    "renewable energy",
    "sustainability",
    "clean tech",
    "energy technology",
    "energy management",
    "smart grid",
    "battery technology",
    "charging infrastructure",
    "iot",
    "internet of things",
    # Engineering Domains
    "electronics",
    "electrical engineering",
    "mechanical engineering",
    "embedded systems",
    "automation",
    "control systems",
    #ai
    "llm","large language models","generative ai","rag","vector database","langchain","llamaindex","openai",
    "gemini","claude","hugging face","pinecone","chromadb","weaviate","faiss","agents","crewai","autogen",
    "prompt engineering",
]

# Alias → canonical mapping
ALIAS_MAP: Dict[str, str] = {
    "ml": "machine learning",
    "ai": "artificial intelligence",
    "dl": "deep learning",
    "nlp": "nlp",
    "cv": "computer vision",
    "js": "javascript",
    "ts": "typescript",
    "py": "python",
    "k8s": "kubernetes",
    "pg": "postgresql",
    "postgres": "postgresql",
    "nodejs": "node.js",
    "node": "node.js",
    "reactjs": "react",
    "vuejs": "vue",
    "angularjs": "angular",
    "rest": "rest api",
    "restful": "rest api",
    "gql": "graphql",
    "cicd": "ci/cd",
    "ec2": "aws",
    "s3": "aws",
    "lambda": "aws",
    "ecs": "aws",
    "eks": "aws",
    "gke": "gcp",
    "cloud functions": "gcp",
    "pm": "product management",
    "prod mgmt": "product management",
    "product mgr": "product management",
    "gtm": "go-to-market",
    "marketing": "product marketing",
    "stakeholders": "stakeholder management",
    "evs": "electric vehicles",
    "electric vehicle": "electric vehicles",
    "clean-tech": "clean tech",
    "iot": "internet of things",
    "lead": "leadership",
    "communication skills": "communication",
    "problem-solving": "problem solving",
    "analytical thinking": "critical thinking",
}
# Build reverse alias (canonical → canonical for lookup speed)
for canonical in SKILL_KEYWORDS:
    ALIAS_MAP.setdefault(canonical, canonical)


# ============================================================
# SKILL PRIORITY TAXONOMY  (canonical home — consumed by ScoreEngine)
# ------------------------------------------------------------
# Priority is a property of the JD skill ITSELF, never of whether the
# resume happens to contain it and never of surrounding JD prose.
#   HIGH   = core technical / domain requirements
#   MEDIUM = supporting technical / business skills
#   LOW    = soft / professional skills
# Anything not explicitly listed defaults to MEDIUM (never HIGH).
# ============================================================

HIGH_PRIORITY_SKILLS = {
    # Programming
    "python", "java", "javascript", "typescript",
    "c", "c++", "c#", "go", "golang", "rust",
    "kotlin", "swift", "dart", "r", "scala", "matlab",

    # Core CS
    "algorithms", "data structures",
    "data structures and algorithms",
    "oop", "object oriented programming",
    "system design", "distributed systems",
    "computer networks", "operating systems", "dbms",

    # Web / Backend / Frontend
    "react", "react.js", "angular", "vue",
    "next.js", "node.js", "node",
    "express", "express.js",
    "spring", "spring boot",
    "django", "flask", "fastapi",
    "rest api", "restful api", "graphql",
    "microservices", "backend development",
    "frontend development", "full stack development",

    # AI / ML / Data Science
    "artificial intelligence", "ai",
    "machine learning", "deep learning",
    "data science", "data analytics",
    "data analysis", "nlp",
    "natural language processing",
    "computer vision",
    "generative ai", "genai",
    "large language models", "llm", "llms",
    "transformers", "reinforcement learning",
    "predictive modeling", "statistical modeling",
    "feature engineering", "neural networks",
    "pytorch", "tensorflow", "keras",
    "scikit-learn", "hugging face",
    "langchain", "rag",
    "retrieval augmented generation",
    "prompt engineering",

    # Databases
    "sql", "mysql", "postgresql", "postgres",
    "mongodb", "sqlite", "oracle", "redis",
    "cassandra", "dynamodb", "firebase",
    "supabase", "nosql", "database design",

    # Cloud
    "aws", "amazon web services",
    "azure", "microsoft azure",
    "gcp", "google cloud",
    "cloud computing", "cloud architecture",

    # DevOps
    "docker", "kubernetes", "jenkins",
    "ci/cd", "cicd", "terraform",
    "ansible", "linux", "git",
    "github", "gitlab", "devops",

    # Cybersecurity
    "cybersecurity", "information security",
    "network security", "application security",
    "cloud security", "ethical hacking",
    "penetration testing", "vulnerability assessment",
    "threat detection", "threat intelligence",
    "incident response", "digital forensics",
    "malware analysis", "siem",
    "intrusion detection", "cryptography",
    "authentication", "authorization",

    # Data Engineering
    "data engineering", "etl", "elt",
    "data pipelines", "data warehousing",
    "data lake", "apache spark", "spark",
    "hadoop", "kafka", "airflow",
    "pyspark", "big data",

    # Analytics / BI
    "business intelligence", "bi",
    "tableau", "power bi",
    "advanced excel", "statistics",
    "statistical analysis",
}


MEDIUM_PRIORITY_SKILLS = {
    # Software practices
    "software development", "software engineering",
    "agile", "scrum", "kanban",
    "test driven development", "tdd",
    "unit testing", "integration testing",
    "debugging", "code review",
    "design patterns", "clean code",
    "version control",

    # APIs
    "api development", "api integration",
    "web services", "oauth", "jwt",
    "webhooks", "json", "xml",

    # Data
    "data visualization", "data mining",
    "data cleaning", "data preprocessing",
    "data exploration", "business analytics",
    "customer analytics", "marketing analytics",
    "product analytics", "research",
    "market research", "competitor analysis",
    "customer insights", "performance tracking",
    "reporting", "forecasting",

    # Product / Business
    "product management", "product strategy",
    "product development", "product lifecycle",
    "product marketing", "roadmap planning",
    "requirements gathering", "requirements analysis",
    "user research", "user feedback",
    "customer experience", "customer success",
    "stakeholder management", "business strategy",
    "business development", "market analysis",
    "go-to-market", "growth",
    "operations", "project management",

    # Engineering
    "electrical engineering", "electronics",
    "embedded systems", "internet of things",
    "iot", "robotics", "automation",
    "control systems", "signal processing",
    "energy technology", "renewable energy",
    "ev", "electric vehicles",
    "clean tech", "sustainability",

    # Tools
    "jira", "confluence", "notion",
    "postman", "figma", "vs code",
    "jupyter", "jupyter notebook",

    # Professional
    "technical writing", "documentation",
    "presentation", "cross functional collaboration",
    "team collaboration", "mentoring",
}


LOW_PRIORITY_SKILLS = {
    "communication",
    "leadership",
    "teamwork",
    "collaboration",
    "critical thinking",
    "problem solving",
    "analytical thinking",
    "attention to detail",
    "decision making",
    "time management",
    "organizational skills",
    "adaptability",
    "flexibility",
    "creativity",
    "initiative",
    "ownership",
    "accountability",
    "negotiation",
    "conflict resolution",
    "interpersonal skills",
    "presentation skills",
    "public speaking",
    "verbal communication",
    "written communication",
    "self motivated",
    "self-motivated",
    "fast learner",
    "learning ability",
    "multitasking",
    "work ethic",
    "team player",
}


def classify_skill_priority(skill: str) -> str:
    """
    Classify a single JD skill into 'high' / 'medium' / 'low' based purely
    on the skill name (normalized: lowercase + strip). Unknown skills
    default to 'medium' — never 'high'.
    """
    skill = skill.lower().strip()

    if skill in HIGH_PRIORITY_SKILLS:
        return "high"
    if skill in MEDIUM_PRIORITY_SKILLS:
        return "medium"
    if skill in LOW_PRIORITY_SKILLS:
        return "low"
    return "medium"


class SkillMatcher:
    FUZZY_THRESHOLD = 84
    FUZZY_PARTIAL_THRESHOLD = 58
    SEMANTIC_THRESHOLD = 0.72
    SEMANTIC_PARTIAL_THRESHOLD = 0.52

    def __init__(self, embedder=None):
        """
        Args:
            embedder: Optional Embedder instance. Injected from app.py at startup.
                      Bug fix: do NOT create Embedder() here — it gets created
                      per-request in score_engine causing double model load.
        """
        self.embedder = embedder

    def normalize(self, text: str) -> str:
        text = text.lower()
        text = re.sub(r"[^\w\s\.\+#]", " ", text)
        return re.sub(r"\s+", " ", text).strip()

    def extract_skills(self, text: str) -> List[str]:
        """
        Extract only meaningful technology/skill keywords from free text.
        Filters ALL stopwords — only returns proper skill names.

        Uses:
        - SKILL_KEYWORDS vocabulary (no stopwords possible)
        - Bigram scanning for multi-word skills (e.g. "rest api", "machine learning")
        - Alias resolution (k8s → kubernetes, ml → machine learning)
        """
        normalized = self.normalize(text)
        found: set = set()

        # Unigram scan
        for skill in SKILL_KEYWORDS:
            pattern = r"\b" + re.escape(skill) + r"\b"
            if re.search(pattern, normalized):
                found.add(ALIAS_MAP.get(skill, skill))

        # Bigram + trigram scan
        tokens = normalized.split()
        for n in (2, 3):
            for i in range(len(tokens) - n + 1):
                gram = " ".join(tokens[i:i+n])
                if gram in ALIAS_MAP:
                    found.add(ALIAS_MAP[gram])
                for sk in SKILL_KEYWORDS:
                    if gram == sk:
                        found.add(ALIAS_MAP.get(sk, sk))

        return sorted(found)

    def match_skills(
        self,
        resume_skills: List[str],
        jd_skills: List[str],
        jd_text: Optional[str] = None,   # FIX 1: added — app.py passes job_description as 3rd arg
    ) -> Dict:
        """
        Compare resume skills vs JD skills using 3-layer matching.
        Prints colored terminal output for debugging.

        Args:
            resume_skills: skills extracted from the resume
            jd_skills:     skills extracted from the job description
            jd_text:       raw JD text — retained for backward compatibility
                           (app.py passes job_description); no longer used for
                           priority classification, which is now taxonomy-based.
        """
        matched: List[str] = []
        partial: List[str] = []
        missing: List[str] = []

        for jd_skill in jd_skills:
            result = self._classify_skill(jd_skill, resume_skills)
            if result == "matched":
                matched.append(jd_skill)
            elif result == "partial":
                partial.append(jd_skill)
            else:
                missing.append(jd_skill)

        total = len(jd_skills)
        match_pct = round(
            ((len(matched) + len(partial) * 0.5) / max(total, 1)) * 100
        )

        # Build priority_map, high_missing, medium_missing, low_missing.
        # These fields are required by app.py and consumed by ScoreEngine.
        # Priority is derived from the JD skill NAME via the taxonomy
        # (classify_skill_priority) — NOT from JD prose and NOT from whether
        # the resume contains the skill. Every JD skill lands in exactly one
        # bucket; unknown skills default to "medium".
        # NOTE: `jd_text` is retained in the signature for backward
        # compatibility (app.py passes job_description) but is no longer used
        # for priority classification.
        priority_map = {"high": [], "medium": [], "low": []}
        for skill in jd_skills:
            priority_map[classify_skill_priority(skill)].append(skill)

        high_missing   = [s for s in missing if s in priority_map["high"]]
        medium_missing = [s for s in missing if s in priority_map["medium"]]
        low_missing    = [s for s in missing if s in priority_map["low"]]

        # ── TERMINAL DEBUG OUTPUT (required per spec) ──────────
        self._print_debug(
            resume_skills, jd_skills, matched, partial, missing, match_pct, priority_map
        )

        return {
            "matched_skills":   matched,
            "partial_skills":   partial,
            "missing_skills":   missing,
            "resume_skills":    resume_skills,
            "jd_skills":        jd_skills,
            "match_percentage": match_pct,
            # FIX 2: new fields required by app.py
            "priority_map":     priority_map,
            "high_missing":     high_missing,
            "medium_missing":   medium_missing,
            "low_missing":      low_missing,
        }

    def _classify_skill(self, skill: str, resume_skills: List[str]) -> str:
        skill_norm = self.normalize(skill)
        skill_can = ALIAS_MAP.get(skill_norm, skill_norm)

        # Layer 1: exact + taxonomy
        for rs in resume_skills:
            rs_norm = self.normalize(rs)
            rs_can = ALIAS_MAP.get(rs_norm, rs_norm)
            if skill_norm == rs_norm or skill_can == rs_can:
                return "matched"

        # Layer 2: fuzzy
        best_fuzzy = max(
            (fuzz.token_sort_ratio(skill_norm, self.normalize(rs)) for rs in resume_skills),
            default=0
        )
        if best_fuzzy >= self.FUZZY_THRESHOLD:
            return "matched"
        if best_fuzzy >= self.FUZZY_PARTIAL_THRESHOLD:
            return "partial"

        # Layer 3: semantic (optional — only if embedder injected)
        if self.embedder and resume_skills:
            try:
                sims = self.embedder.batch_similarity([skill], resume_skills)[0]
                best_sim = float(max(sims))
                if best_sim >= self.SEMANTIC_THRESHOLD:
                    return "matched"
                if best_sim >= self.SEMANTIC_PARTIAL_THRESHOLD:
                    return "partial"
            except Exception:
                pass

        return "missing"

    def _print_debug(
        self,
        resume_skills: List[str],
        jd_skills: List[str],
        matched: List[str],
        partial: List[str],
        missing: List[str],
        match_pct: int,
        priority_map: Optional[Dict] = None,   # FIX 3: added — printed below if present
    ) -> None:
        """Print colored terminal debug output as required in the spec."""
        sep = f"{CYAN}{'─'*55}{RESET}"
        print(f"\n{sep}")
        print(f"{BOLD}{CYAN}  🔍 ResumeIQ NLP Analysis Debug Output{RESET}")
        print(sep)

        print(f"\n{BOLD}  Resume Skills:{RESET}")
        print(f"  {GREEN}{resume_skills}{RESET}")

        print(f"\n{BOLD}  JD Skills:{RESET}")
        print(f"  {YELLOW}{jd_skills}{RESET}")

        print(f"\n{BOLD}  Matched:{RESET}")
        print(f"  {GREEN}{matched}{RESET}")

        if partial:
            print(f"\n{BOLD}  Partial Matches:{RESET}")
            print(f"  {YELLOW}{partial}{RESET}")

        print(f"\n{BOLD}  Missing:{RESET}")
        print(f"  {RED}{missing}{RESET}")

        # FIX 3: print priority breakdown when available (ALL tiers including LOW)
        if priority_map:
            print(f"\n{BOLD}  JD Priority Ranking:{RESET}")
            print(f"  HIGH   🔴 {priority_map.get('high', [])}")
            print(f"  MEDIUM 🟡 {priority_map.get('medium', [])}")
            print(f"  LOW    🟢 {priority_map.get('low', [])}")

        color = GREEN if match_pct >= 75 else YELLOW if match_pct >= 50 else RED
        print(f"\n{BOLD}  Match Score: {color}{match_pct}%{RESET}")
        print(sep + "\n")
        sys.stdout.flush()
