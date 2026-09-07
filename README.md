# ResumeIQ AI v3 — Full Product Upgrade

## What's New in v3

### Part 1 — Priority ATS Scoring
- JD skills ranked HIGH / MEDIUM / LOW using context signals + position + frequency
- Missing HIGH skills penalise ATS score 3x more than LOW skills
- Frontend shows only HIGH and MEDIUM missing skills — clean UI
- Terminal logs print ALL skills including LOW priority
- Dynamic ATS explanation: "Your ATS score is 38%. Major gaps: Product Management, Product Strategy..."

### Part 2 — Resume Import Modal
- On entering Editor: modal offers "Create New" or "Import Existing"
- Import: upload PDF/DOCX → auto-parsed → editor sections populated automatically

### Part 3 — Structured Section Editor
- Header / Summary / Skills / Experience / Projects / Certifications / Education / Achievements / Additional Info
- Each section has dedicated editing UI with proper field types

### Part 4 — Drag-and-Drop Section Ordering
- All 9 sections draggable via sidebar
- Custom order persisted to MongoDB `sectionOrder` field
- Preview respects custom order

### Part 5 — Header Redesign
- Separate fields: LinkedIn, GitHub, Portfolio, LeetCode, HackerRank
- "Add link" for unlimited custom links with labels

### Part 6 — Projects Redesign
- Name, Description, Technologies, GitHub Link, Live Demo Link, Additional Link

### Part 7 — Certifications Redesign
- Name, Provider, Issue Date, Credential ID, Credential URL

### Part 8 — AI Suggestions Panel
- Per-section AI tips from analysis results
- Apply / Reject buttons with state tracking
- Sidebar shows badge count per section

### Part 9 — Professional SaaS UI
- Redesigned with glassmorphism navbar, card elevation, consistent spacing
- Light + dark mode with localStorage persistence and FOUC prevention

### Part 10 — ATS Dashboard Redesign
- Priority skill sections (High / Medium only — not Low)
- ATSExplanationPanel with dynamic narrative
- All score cards with animated progress bars

### Part 11 — Analysis History
- `GET /api/analysis/history` returns last 20 analyses
- Select 2 analyses → side-by-side score comparison
- Score diff displayed with colour coding

### Part 12 — Code Quality
- Removed all dead code and unused imports
- Consistent error handling across all routes
- No mock data anywhere in the codebase
- All routes scoped to authenticated user

## Quick Start

```bash
# 1. Python NLP Service (Terminal 1)
cd python-nlp
python -m venv venv && source venv/bin/activate
pip install -r requirements.txt
python app.py
# → http://localhost:8000

# 2. Backend (Terminal 2)
cd backend
cp .env.example .env   # fill in MONGODB_URI
npm install && npm run dev
# → http://localhost:5000

# 3. Frontend (Terminal 3)
cd frontend
npm install && npm run dev
# → http://localhost:5173
```

## Database Schema Changes (v2 → v3)

### Resume model — new fields
- `parsedData.leetcode`, `parsedData.hackerrank`, `parsedData.otherLinks[]`
- `parsedData.achievements[]` (new section)
- `parsedData.additionalInfo` (new section)
- `parsedData.projects[].liveDemoUrl`, `parsedData.projects[].additionalUrl`
- `parsedData.certifications[].provider`, `parsedData.certifications[].credentialUrl`
- `sectionOrder: [String]` — drag-and-drop ordering

### Analysis model — new fields
- `skillGap.priorityMap: { high, medium, low }`
- `skillGap.highMissing`, `skillGap.mediumMissing`, `skillGap.lowMissing`
- `atsExplanation: String` — dynamic narrative

## API Changes (v2 → v3)

| Change | Details |
|--------|---------|
| `GET /api/analysis/history` | NEW — returns last 20 analyses for user |
| `POST /api/analysis/run` | response now includes `priorityMap`, `highMissing`, `mediumMissing`, `atsExplanation` |
| `POST /api/resume/upload-anon` | NEW — upload without auth (for editor import) |
| `PUT /api/resume/:id` | now accepts `sectionOrder` field |

## Migration from v2

MongoDB is schema-flexible — no migration needed. New fields will be `undefined` for old documents and default gracefully. To add defaults to existing records:

```js
// In mongo shell
db.resumes.updateMany({sectionOrder:{$exists:false}},{$set:{sectionOrder:["header","summary","skills","experience","projects","certifications","education","achievements","additionalInfo"]}})
db.analyses.updateMany({"skillGap.priorityMap":{$exists:false}},{$set:{"skillGap.priorityMap":{high:[],medium:[],low:[]},"skillGap.highMissing":[],"skillGap.mediumMissing":[],"skillGap.lowMissing":[],"atsExplanation":""}})
```

## Testing Checklist

- [ ] Upload PDF resume → skills printed in Python terminal
- [ ] Upload JD → JD skills printed with priority ranking
- [ ] Run analysis → ATS explanation appears on dashboard
- [ ] Dashboard shows only HIGH/MEDIUM missing skills (not LOW)
- [ ] Editor modal shows Create New / Import options
- [ ] Import PDF → sections auto-populated in editor
- [ ] Drag sections in sidebar → order changes in preview
- [ ] LeetCode/HackerRank fields appear in Header section
- [ ] Projects have GitHub, Live Demo, Additional link fields
- [ ] Certifications have Provider + Credential URL fields
- [ ] AI suggestions badge appears on relevant sidebar sections
- [ ] Dark mode toggles and persists on refresh
- [ ] History page loads previous analyses
- [ ] Select 2 analyses → comparison panel appears
- [ ] `GET /api/health` returns `{"status":"ok"}`
- [ ] `GET /api/analysis/history` returns array
