from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import List, Optional
import traceback  # FIX 5: needed for full exception logging
import uvicorn

from matching.skill_matcher import SkillMatcher
from scoring.score_engine import ScoreEngine
from ats.ats_analyzer import ATSAnalyzer
from recommendations.suggestion_engine import SuggestionEngine
from parsers.embedder import Embedder

app = FastAPI(title="ResumeIQ NLP Service", version="3.0.0")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

print("\n[startup] Initializing ResumeIQ NLP Service v3...")
embedder          = Embedder()
matcher           = SkillMatcher(embedder=embedder)
scorer            = ScoreEngine(embedder=embedder)
ats_analyzer      = ATSAnalyzer()
suggestion_engine = SuggestionEngine(embedder=embedder)
print("[startup] ✅ All components ready.\n")

class AnalyzeRequest(BaseModel):
    resume_text: str
    job_description: str

class ExtractRequest(BaseModel):
    resume_text: str
    job_description: Optional[str] = ""

class SimilarityRequest(BaseModel):
    text_a: str; text_b: str

class SuggestRequest(BaseModel):
    section: str; content: str; job_description: str; missing_skills: List[str]

@app.get("/health")
def health():
    return {"status":"ok","service":"ResumeIQ NLP v3","model":"all-MiniLM-L6-v2"}

@app.post("/extract")
async def extract(req: ExtractRequest):
    try:
        rs = matcher.extract_skills(req.resume_text)
        js = matcher.extract_skills(req.job_description) if req.job_description else []
        return {"resume_skills":rs,"jd_skills":js}
    except Exception as e:
        # FIX 5: print full traceback so errors are visible in the terminal
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/analyze")
async def analyze(req: AnalyzeRequest):
    try:
        rs = matcher.extract_skills(req.resume_text)
        js = matcher.extract_skills(req.job_description)
        mr = matcher.match_skills(rs, js, req.job_description)
        sc = scorer.compute_scores(mr, req.resume_text, req.job_description)
        at = ats_analyzer.analyze(req.resume_text)
        sg = suggestion_engine.generate(req.resume_text, req.job_description, mr["missing_skills"])
        return {
            "resume_skills":mr["resume_skills"],"jd_skills":mr["jd_skills"],
            "matched_skills":mr["matched_skills"],"missing_skills":mr["missing_skills"],
            "partial_skills":mr["partial_skills"],"priority_map":mr["priority_map"],
            "high_missing":mr["high_missing"],"medium_missing":mr["medium_missing"],
            "low_missing":mr["low_missing"],
            "match_score":sc["match_score"],"ats_score":sc["ats_score"],
            "keyword_score":sc["keyword_score"],"semantic_score":sc["semantic_score"],
            "formatting_score":sc["formatting_score"],"explanation":sc["explanation"],
            # Additive only — per-JD-skill priority + match status (does not
            # replace or rename any existing key).
            "skill_priorities":sc.get("skill_priorities", []),
            "section_scores":at["section_scores"],"ats_issues":at["issues"],
            "passed_checks":at["passed_checks"],"suggestions":sg,
        }
    except Exception as e:
        # FIX 5: print full traceback so errors are visible in the terminal
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/similarity")
async def similarity(req: SimilarityRequest):
    return {"similarity": round(embedder.cosine_similarity(req.text_a, req.text_b), 4)}

@app.post("/suggestions")
async def suggestions(req: SuggestRequest):
    r = suggestion_engine.improve_section(req.section, req.content, req.job_description, req.missing_skills)
    return {"suggestion": r}

if __name__ == "__main__":
    uvicorn.run("app:app", host="0.0.0.0", port=8000, reload=False)
