# HireLens AI

> **AI-powered resume analysis, ATS evaluation, job matching, and resume
> improvement platform**

HireLens AI is a full-stack web application that helps candidates
understand how well their resume aligns with a target job description.
It parses uploaded resumes, extracts structured sections and skills,
compares the resume against a job description, calculates ATS and
job-match scores, identifies skill gaps, generates rule-based
improvement suggestions, stores analysis history, and provides an
editable resume preview with PDF export.

The project uses a **React/Vite frontend**, **Node.js/Express backend**,
**MongoDB**, and a separate **Python/FastAPI NLP service** powered by
**Sentence Transformers, scikit-learn, RapidFuzz, and rule-based
analysis**.

> **Important:** HireLens currently uses a rule-based Python suggestion
> engine. No LLM/OpenAI service is required for the core analysis
> pipeline.

------------------------------------------------------------------------

## Features

### Resume parsing

-   Upload resume files through the web interface.
-   Extract structured resume information including:
    -   Name and contact information
    -   Professional summary
    -   Work experience
    -   Projects
    -   Skills
    -   Education
    -   Certifications
    -   Achievements
-   Supports PDF and DOCX parsing.
-   Converts DOCX content into structured text while preserving
    list/bullet information.
-   Detects experience/project entries and date ranges.
-   Normalizes and extracts technical skills from resume content.

### Job description analysis

-   Upload or enter a target job description.
-   Extract relevant job skills and requirements.
-   Categorize missing skills by priority.

### Resume-to-JD matching

-   Exact skill matching
-   Partial/fuzzy skill matching
-   Missing skill detection
-   Priority-aware skill scoring
-   Semantic similarity using `all-MiniLM-L6-v2`
-   Section-level semantic comparison

### ATS analysis

Provides an ATS-oriented breakdown including: - ATS score - Formatting
score - Keyword/skill score - Semantic score - Section completeness -
Missing required sections - Formatting issues - Passed checks

### Resume improvement suggestions

The Python suggestion engine can: - Detect weak or non-action-oriented
bullet openings - Suggest stronger action verbs - Identify low
summary/JD alignment - Recommend missing skills from the target JD -
Avoid rewriting contact/header information - Avoid fabricating metrics
or technologies in bullet rewrites

### Dashboard

-   Overall resume/job-match score
-   ATS score
-   Skill-match score
-   Semantic score
-   Section-level scores
-   Skill-gap visualization
-   Improvement suggestions
-   Resume editing entry point
-   PDF/print export

### Resume editor

-   Editable resume content
-   Live resume preview
-   Shared preview component for consistent rendering
-   Print-friendly layout
-   Browser-based Save as PDF workflow

### Analysis history

-   Stores completed analyses in MongoDB
-   Lists previous analyses
-   Opens a specific historical analysis by ID
-   Restores the corresponding resume data when viewing a historical
    result

### Authentication

-   Email/password authentication
-   JWT-based session handling
-   Firebase Authentication / Google Sign-In integration
-   Firebase Admin token verification on the backend

### Security

-   Helmet security headers
-   CORS configuration
-   JWT authentication middleware
-   Password hashing with bcrypt
-   Request validation
-   API rate limiting
-   File-size limits
-   Server-side ownership checks for resume/analysis data

------------------------------------------------------------------------

## System Architecture

``` text
                         ┌─────────────────────┐
                         │   React + Vite UI    │
                         │  Firebase Hosting    │
                         └──────────┬──────────┘
                                    │
                                    │ REST / JSON
                                    ▼
                         ┌─────────────────────┐
                         │ Node.js + Express    │
                         │      Backend         │
                         └───────┬───────┬─────┘
                                 │       │
                    ┌────────────┘       └──────────────┐
                    ▼                                   ▼
          ┌──────────────────┐                ┌─────────────────┐
          │    MongoDB       │                │ Python/FastAPI  │
          │ Resume + History │                │   NLP Service   │
          └──────────────────┘                └────────┬────────┘
                                                       │
                                      ┌────────────────┼───────────────┐
                                      ▼                ▼               ▼
                              Sentence Transformers  scikit-learn  Rule Engines
```

### Analysis flow

``` text
Resume upload
     │
     ▼
Node/Express parser
     │
     ├── Structured resume data
     └── Raw resume text
              │
              ▼
       Python /analyze
              │
       ┌──────┼───────────────┐
       ▼      ▼               ▼
  Skill Match  Score Engine   ATS Analyzer
       │      │               │
       └──────┼───────────────┘
              ▼
       Suggestion Engine
              │
              ▼
       Node maps result
              │
              ▼
          MongoDB
              │
              ▼
       React Dashboard
```

------------------------------------------------------------------------

## Technology Stack

### Frontend

-   React 18
-   Vite
-   React Router
-   Axios
-   Tailwind CSS
-   Framer Motion
-   Recharts
-   Lucide React
-   React Dropzone
-   Firebase Authentication

### Backend

-   Node.js
-   Express.js
-   MongoDB
-   Mongoose
-   JWT
-   bcryptjs
-   Multer
-   Mammoth
-   pdf-parse
-   Helmet
-   CORS
-   express-rate-limit
-   express-validator
-   Morgan

### NLP / Machine Learning

-   Python 3.11 recommended
-   FastAPI
-   Uvicorn
-   Sentence Transformers
-   `all-MiniLM-L6-v2`
-   scikit-learn
-   RapidFuzz
-   NumPy
-   Pydantic

### Deployment

A practical production setup for this architecture is:

``` text
Frontend  → Firebase Hosting
Backend   → Render / another Node-compatible service
NLP       → Render / Cloud Run / another Python-compatible service
Database  → MongoDB Atlas
Auth      → Firebase Authentication
```

------------------------------------------------------------------------

# Local Development

## Prerequisites

Install:

-   Node.js 18+
-   npm
-   Python 3.11
-   MongoDB Community Server or MongoDB Atlas
-   Git

For Google Sign-In: - A Firebase project - Firebase Authentication with
Google provider enabled - Firebase web app configuration - Firebase
Admin service-account credentials for the backend

------------------------------------------------------------------------

## 1. Clone the repository

``` bash
git clone https://github.com/Adititiix/HireLens-AI.git
cd HireLens-AI
```

------------------------------------------------------------------------

## 2. Install frontend dependencies

``` bash
cd frontend
npm install
```

Create:

``` text
frontend/.env
```

Example:

``` env
VITE_API_URL=http://localhost:5000/api
```

Start the frontend:

``` bash
npm run dev
```

Vite normally runs at:

``` text
http://localhost:5173
```

------------------------------------------------------------------------

## 3. Install backend dependencies

Open a second terminal:

``` bash
cd backend
npm install
```

Create:

``` text
backend/.env
```

Example:

``` env
PORT=5000
MONGODB_URI=mongodb://127.0.0.1:27017/hirelens
JWT_SECRET=replace_with_a_long_random_secret
JWT_EXPIRES_IN=7d
NLP_SERVICE_URL=http://localhost:8000
MAX_FILE_SIZE_MB=10
NODE_ENV=development
FRONTEND_URL=http://localhost:5173
```

Start the backend:

``` bash
npm run dev
```

or:

``` bash
npm start
```

Health endpoint:

``` text
http://localhost:5000/api/health
```

------------------------------------------------------------------------

## 4. Set up the Python NLP service

Open a third terminal:

``` bash
cd python-nlp
```

Create/use the Python 3.11 virtual environment.

### Windows PowerShell

``` powershell
py -3.11 -m venv venv
.\venv\Scripts\Activate.ps1
```

Install dependencies:

``` powershell
pip install -r requirements.txt
```

Start FastAPI:

``` powershell
uvicorn app:app --reload --port 8000
```

Health endpoint:

``` text
http://localhost:8000/health
```

Expected response:

``` json
{
  "status": "ok",
  "service": "ResumeIQ NLP v3",
  "model": "all-MiniLM-L6-v2"
}
```

### First-run model download

`SentenceTransformer` may download the `all-MiniLM-L6-v2` model the
first time the service starts. The first startup can therefore be slower
than subsequent runs.

------------------------------------------------------------------------

# Google Sign-In Setup

HireLens uses Firebase Authentication for Google Sign-In.

## Firebase Console

1.  Create/select the Firebase project.
2.  Open **Authentication**.
3.  Enable the **Google** sign-in provider.
4.  Register the web application.
5.  Copy the Firebase web configuration into the frontend Firebase
    service.
6.  Add the deployed frontend domain to Firebase Authentication's
    authorized domains when deploying.

The frontend obtains a Firebase ID token after Google authentication.

The backend verifies that token using Firebase Admin and then issues the
application's existing JWT.

``` text
Google Popup
     ↓
Firebase ID Token
     ↓
POST /api/auth/google-login
     ↓
Firebase Admin verification
     ↓
MongoDB user
     ↓
Application JWT
     ↓
Authenticated React session
```

### Service-account security

Never commit the Firebase Admin service-account JSON.

For local development, PowerShell can use:

``` powershell
$env:GOOGLE_APPLICATION_CREDENTIALS="C:\path\to\firebase-service-account.json"
```

For production, configure the credential through the hosting provider's
secure secret/environment-variable mechanism rather than committing it
to Git.

------------------------------------------------------------------------

# NLP Scoring Methodology

HireLens separates different aspects of resume quality instead of
treating the entire resume as one keyword count.

## Skill matching

The matching engine identifies:

-   Matched skills
-   Missing skills
-   Partial skills
-   JD skill priorities

The priority taxonomy uses:

``` text
HIGH    = 3 points
MEDIUM  = 2 points
LOW     = 1 point
```

For a matched skill, the full weighted value is earned.

For a partial skill, half of the weighted value is earned.

For a missing skill, zero is earned.

This produces a priority-aware skill score rather than treating every JD
keyword as equally important.

------------------------------------------------------------------------

## Semantic scoring

Semantic similarity uses the Sentence Transformer:

``` text
all-MiniLM-L6-v2
```

The current section weights are:

  Resume section     Weight
  ---------------- --------
  Summary               20%
  Experience            35%
  Projects              30%
  Skills                15%

The system compares relevant resume sections against corresponding
job-description sections instead of embedding the entire documents as
undifferentiated text.

If a section is missing, its weight can be proportionally redistributed
rather than automatically assigning a zero to that section.

------------------------------------------------------------------------

## ATS scoring

The ATS analyzer checks resume structure and formatting-related signals
such as:

-   Required section presence
-   Formatting issues
-   Section completeness
-   Passed checks

The ATS score is kept separate from semantic/job-match scoring so a
resume can have good formatting while still having a poor match with a
particular job description.

------------------------------------------------------------------------

# API Overview

Base URL:

``` text
http://localhost:5000/api
```

## Authentication

``` text
POST /auth/register
POST /auth/login
POST /auth/google-login
GET  /auth/me
```

## Resume

``` text
POST   /resume/upload
GET    /resume
GET    /resume/:id
PUT    /resume/:id
DELETE /resume/:id
```

## Job description

``` text
POST /jd/upload
```

## Analysis

``` text
POST /analysis/run
GET  /analysis/history
GET  /analysis/detail/:id
GET  /analysis/:resumeId
```

The detail endpoint is important for history navigation because it
retrieves the selected analysis rather than simply requesting the latest
analysis for a resume.

------------------------------------------------------------------------

# Security and Data Handling

The backend includes several protections:

### Authentication

Protected routes require a valid JWT.

### Authorization

Resume and analysis queries are scoped to the authenticated user.

### Password security

Passwords are hashed using bcrypt before storage.

### Rate limiting

General API requests are rate limited.

Analysis execution has a stricter limit:

``` text
30 analysis requests per hour
```

This helps prevent accidental or abusive repeated NLP computations.

### File limits

The application is configured around a:

``` text
10 MB
```

maximum file size.

### HTTP security

Helmet is enabled for common HTTP security headers.

### Secrets

Do not commit:

``` text
.env
Firebase service-account JSON
JWT secrets
MongoDB credentials
API keys
```

Use `.env.example` as the template for local configuration.

------------------------------------------------------------------------

# Deployment

## Recommended architecture

### Frontend --- Firebase Hosting

Build:

``` bash
cd frontend
npm run build
```

The production build is generated in:

``` text
frontend/dist
```

Initialize Firebase Hosting from the project and configure the hosting
root to the frontend build directory.

Deploy:

``` bash
firebase deploy --only hosting
```

Before building for production, set:

``` env
VITE_API_URL=https://your-backend-domain/api
```

The frontend must **not** point to `localhost` in production.

------------------------------------------------------------------------

## Backend --- Render example

Create a Web Service connected to the GitHub repository.

Recommended settings:

``` text
Root Directory: backend
Build Command: npm install
Start Command: npm start
```

Configure environment variables:

``` env
NODE_ENV=production
PORT=10000
MONGODB_URI=<MongoDB Atlas connection string>
JWT_SECRET=<strong random secret>
JWT_EXPIRES_IN=7d
NLP_SERVICE_URL=<deployed Python NLP URL>
FRONTEND_URL=<Firebase Hosting URL>
```

Do not upload `.env` to GitHub.

------------------------------------------------------------------------

## Python NLP --- Render example

Create a second Web Service.

Recommended settings:

``` text
Root Directory: python-nlp
Build Command: pip install -r requirements.txt
Start Command: uvicorn app:app --host 0.0.0.0 --port $PORT
```

The Node backend should then use:

``` env
NLP_SERVICE_URL=https://your-python-service-url
```

------------------------------------------------------------------------

## MongoDB Atlas

For production, use MongoDB Atlas instead of a local MongoDB server.

Set:

``` env
MONGODB_URI=<Atlas connection string>
```

Configure the Atlas network access rules and database user securely.

------------------------------------------------------------------------

# Project Metrics

-   **4** semantic resume sections are scored with dedicated weights:
    Summary, Experience, Projects, and Skills.
-   **3-tier** skill-priority system: High, Medium, and Low.
-   **30/hour** analysis endpoint rate limit.
-   **10 MB** configured maximum upload size.
-   Up to **20** completed analyses are returned in the history listing
    endpoint.
-   Up to **8** rule-based improvement suggestions can be returned per
    analysis.
-   Uses a **384-dimensional Sentence Transformer embedding model
    (`all-MiniLM-L6-v2`)** for semantic similarity.
-   Supports **PDF and DOCX** resume parsing.
-   Provides separate **ATS, skill-match, semantic, formatting, and
    overall** scoring dimensions.

### Example local smoke-test measurements

A single local end-to-end test during development produced
approximately:

``` text
Resume upload + parsing: ~1.1 s
JD upload:               ~0.2 s
Analysis request:        ~2.2 s
```

These numbers are **sample local observations, not benchmark results**.
They should not be presented as guaranteed production latency.

------------------------------------------------------------------------

# Future Improvements

Potential future work:

-   Resume version comparison
-   Job recommendation based on historical analyses
-   More robust section classification
-   Additional document formats
-   Multilingual resume parsing
-   Automated benchmark dataset for parser and matching evaluation
-   Precision/recall evaluation for skill extraction
-   Human-labeled evaluation of ATS issue detection
-   Background processing for large-scale analysis
-   Production monitoring and observability
-   Improved deployment autoscaling

------------------------------------------------------------------------

# Project Structure

``` text
HireLens-AI/
│
├── frontend/
│   ├── src/
│   │   ├── components/
│   │   │   ├── analyzer/
│   │   │   ├── dashboard/
│   │   │   ├── editor/
│   │   │   └── ui/
│   │   ├── context/
│   │   ├── pages/
│   │   ├── services/
│   │   └── utils/
│   ├── package.json
│   └── vite.config.js
│
├── backend/
│   ├── controllers/
│   ├── middleware/
│   ├── models/
│   ├── routes/
│   ├── services/
│   ├── package.json
│   └── server.js
│
├── python-nlp/
│   ├── ats/
│   ├── matching/
│   ├── parsers/
│   ├── recommendations/
│   ├── scoring/
│   ├── app.py
│   └── requirements.txt
│
├── docs/
│   └── GOOGLE_OAUTH.md
│
└── README.md
```

------------------------------------------------------------------------

# Author

**Aditi**

GitHub: `https://github.com/Adititiix/HireLens-AI`
