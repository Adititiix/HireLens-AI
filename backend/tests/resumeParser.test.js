// Regression tests for resume section extraction, spacing and hyperlink mapping.
// Run: npm test   (node:test — no extra dependencies)
const test = require("node:test");
const assert = require("node:assert/strict");
const { parseResumeText } = require("../controllers/resumeController");

// Mirrors what utils/documentText.extractPdf now produces for a LaTeX template
// (FAANGPath-style): a TAB marks a column break (label → value, title → date).
const COLUMN_RESUME = [
  "JANE DOE",
  "+1 555 010 2030⋄ Austin, USA",
  "jane@example.com⋄ LinkedIn⋄ GitHub",
  "EDUCATION",
  "B.Tech in Computer Science, Example Institute of Technology\tAug 2021 – May 2025",
  "CGPA: 8.9/10",
  "Relevant Coursework: Data Structures, Operating Systems, Databases.",
  "EXPERIENCE",
  "Software Engineer Intern\tJun 2024 – Dec 2024",
  "Acme Corp\tRemote",
  "• Improved search relevance by building a ranking",
  "pipeline that processed 2M events/day.",
  "• Built retrieval features alongside the recommendation system’s documen-",
  "tation and tests.",
  "PROJECTS",
  "Pipeline Doctor — Incident Investigation Assistant\tOct 2025",
  "• Retrieves logs and runbooks to explain data pipeline failures.",
  "• Achieved 79.5% Hit@5 across 50 questions.",
  "Resume Lens — AI Resume Screening\tMar 2025",
  "• Screened 100 resumes with a 0.92 s median latency.",
  "SKILLS",
  "Programming\tPython, Java, C, JavaScript, SQL",
  "AI/ML & NLP\tMachine  Learning,  NLP,  TF-IDF,",
  "RAG, Prompt Engineering",
  "Databases\tPostgreSQL, MongoDB, SQLite",
  "Methodologies\tAgile, Scrum",
  "ACHIEVEMENTS",
  "• Best Paper Award – Example Conference (2024): recognised for retrieval research.",
].join("\n");

const HEADER_LINE = "jane@example.com⋄ LinkedIn⋄ GitHub";

test("label/value columns are not concatenated (no 'DatabasesPostgreSQL')", () => {
  const p = parseResumeText(COLUMN_RESUME);
  const all = Object.values(p.skills).flat();
  assert.ok(all.includes("PostgreSQL"));
  assert.ok(all.includes("Agile"));
  assert.ok(!all.some(s => /^(Databases|Methodologies|Programming)\S/.test(s)), `glued label in ${JSON.stringify(all)}`);
  assert.deepEqual(p.skills.databases, ["PostgreSQL", "MongoDB", "SQLite"]);
  assert.ok(p.skills.technical.includes("Machine Learning"), "inner double spaces collapsed");
  assert.ok(p.skills.technical.includes("Prompt Engineering"), "wrapped skills line kept");
});

test("projects without '|' separators are extracted with dates and every bullet", () => {
  const p = parseResumeText(COLUMN_RESUME);
  assert.equal(p.projects.length, 2);
  assert.equal(p.projects[0].name, "Pipeline Doctor — Incident Investigation Assistant");
  assert.equal(p.projects[0].date, "Oct 2025");
  assert.deepEqual(p.projects[0].description.split("\n"), [
    "Retrieves logs and runbooks to explain data pipeline failures.",
    "Achieved 79.5% Hit@5 across 50 questions.",
  ]);
  assert.deepEqual(p.projects[0].technologies, [], "no technologies invented");
  assert.equal(p.projects[1].date, "Mar 2025");
});

test("experience: title/date column, company/location line, wrapped bullets re-joined", () => {
  const [e] = parseResumeText(COLUMN_RESUME).experience;
  assert.equal(e.title, "Software Engineer Intern");
  assert.equal(e.company, "Acme Corp");
  assert.equal(e.location, "Remote");
  assert.equal(e.startDate, "Jun 2024");
  assert.equal(e.endDate, "Dec 2024");
  assert.equal(e.bullets.length, 2);
  assert.equal(e.bullets[0], "Improved search relevance by building a ranking pipeline that processed 2M events/day.");
  assert.match(e.bullets[1], /system’s documentation and tests\.$/, "hyphenated line-wrap undone");
});

test("education: degree and institution split, dates, GPA and coursework preserved", () => {
  const [ed] = parseResumeText(COLUMN_RESUME).education;
  assert.equal(ed.degree, "B.Tech in Computer Science");
  assert.equal(ed.institution, "Example Institute of Technology");
  assert.equal(ed.startDate, "Aug 2021");
  assert.equal(ed.endDate, "May 2025");
  assert.equal(ed.gpa, "8.9/10");
  assert.match(ed.honors, /^Relevant Coursework: Data Structures/);
});

test("contact details come from the header block", () => {
  const p = parseResumeText(COLUMN_RESUME);
  assert.equal(p.name, "JANE DOE");
  assert.equal(p.email, "jane@example.com");
  assert.equal(p.phone, "+1 555 010 2030");
  assert.equal(p.location, "Austin, USA");
});

test("hyperlinks whose visible text differs from the URL are mapped to the right fields", () => {
  const links = [
    { url: "mailto:jane@example.com", text: "jane@example.com", line: HEADER_LINE },
    { url: "https://linkedin.com/in/jane-doe-123", text: "LinkedIn", line: HEADER_LINE },
    { url: "https://github.com/janedoe", text: "GitHub", line: HEADER_LINE },
    { url: "https://github.com/janedoe/pipeline-doctor", text: "Pipeline Doctor — Incident Investigation Assistant", line: "Pipeline Doctor — Incident Investigation Assistant\tOct 2025" },
    { url: "https://resume-lens.example.app", text: "Screened 100 resumes with a 0.92 s median latency.", line: "• Screened 100 resumes with a 0.92 s median latency." },
  ];
  const p = parseResumeText(COLUMN_RESUME, { links });
  assert.equal(p.linkedin, "https://linkedin.com/in/jane-doe-123");
  assert.equal(p.github, "https://github.com/janedoe");
  assert.equal(p.projects[0].githubUrl, "https://github.com/janedoe/pipeline-doctor");
  assert.equal(p.projects[1].liveDemoUrl, "https://resume-lens.example.app");
  assert.match(p.projects[1].description, /Screened 100 resumes/, "a hyperlinked sentence keeps its text");
});

test("unsafe link targets are never used", () => {
  const links = [{ url: "javascript:alert(1)", text: "LinkedIn", line: HEADER_LINE }];
  const p = parseResumeText(COLUMN_RESUME, { links });
  assert.equal(p.linkedin, "");
});

test("URLs written in project/certification text are kept (not dropped as 'contact noise')", () => {
  const text = [
    "Sam Lee", "sam@example.com",
    "PROJECTS",
    "TrustVault | Python, FastAPI, SQLite Aug 2026",
    "• End-to-end encrypted vault.",
    "• GitHub: github.com/samlee/trustvault",
    "CERTIFICATIONS",
    "AWS Cloud Practitioner — Amazon Web Services 2024",
    "https://www.credly.com/badges/abc123",
  ].join("\n");
  const p = parseResumeText(text);
  assert.equal(p.projects.length, 1);
  assert.deepEqual(p.projects[0].technologies, ["Python", "FastAPI", "SQLite"]);
  assert.equal(p.projects[0].githubUrl, "github.com/samlee/trustvault", "kept exactly as written — no scheme invented");
  assert.equal(p.projects[0].description, "End-to-end encrypted vault.");
  assert.equal(p.certifications.length, 1);
  assert.equal(p.certifications[0].name, "AWS Cloud Practitioner");
  assert.equal(p.certifications[0].provider, "Amazon Web Services");
  assert.equal(p.certifications[0].credentialUrl, "https://www.credly.com/badges/abc123");
});

test("pipe-style resumes (previous format) still parse the same way", () => {
  const text = [
    "ALEX KIM", "alex@example.com | github.com/alexkim",
    "EXPERIENCE",
    "Software Intern | Acme Corp Jun 2025 – Dec 2025",
    "• Built REST APIs with FastAPI",
    "PROJECTS",
    "TrustVault | Python, FastAPI, JWT Aug 2026",
    "• Encrypted vault",
    "HireLens AI | React.js, Node.js, MongoDB Mar 2026",
    "• Resume analyzer",
    "EDUCATION",
    "B.Tech Computer Science 2022 - 2026",
    "XYZ Institute of Technology",
  ].join("\n");
  const p = parseResumeText(text);
  assert.equal(p.experience.length, 1);
  assert.equal(p.experience[0].title, "Software Intern");
  assert.equal(p.experience[0].company, "Acme Corp");
  assert.equal(p.projects.length, 2);
  assert.deepEqual(p.projects[0].technologies, ["Python", "FastAPI", "JWT"]);
  assert.equal(p.projects[0].date, "Aug 2026");
  assert.equal(p.education.length, 1);
  assert.equal(p.education[0].institution, "XYZ Institute of Technology");
  assert.equal(p.education[0].startDate, "2022");
  assert.equal(p.github, "github.com/alexkim");
});

test("section headings: variants detected, keywords inside sentences are not headings", () => {
  const text = [
    "Pat Q", "pat@example.com",
    "Professional Experience",
    "Data Analyst\tJan 2023 – Present",
    "Contoso\tSeattle, USA",
    "• Led projects with stakeholders across the experience platform.",
    "Projects and skills were reviewed quarterly.",
    "Academic Projects",
    "Forecaster\tMay 2022",
    "• Built a demand forecasting model.",
  ].join("\n");
  const p = parseResumeText(text);
  assert.equal(p.experience.length, 1);
  assert.equal(p.experience[0].current, true);
  assert.equal(p.experience[0].bullets.length, 2, "sentence containing 'Projects' stays in experience");
  assert.equal(p.projects.length, 1);
  assert.equal(p.projects[0].name, "Forecaster");
});

// Two-column / Canva-style PDFs come out "stacked": organisation, role, bullets,
// then the date range and location on lines of their own; narrow columns wrap.
const STACKED_RESUME = [
  "Riya M", "riya@example.com", "Chennai, TN 600078",
  "EDUCATION",
  "Example Institute of Technology",
  "Bachelor of Technology, Computer Science",
  "CGPA :8.75",
  "05/2027",
  "Kattankulathur",
  "Sample School And Junior College",
  "High School Diploma",
  "04/2023",
  "WORK HISTORY",
  "Acme Labs",
  "FULL STACK DEVELOPER INTERN",
  "•Developed, coded and debugged application programs of varying degree of ",
  "complexity with full independence.",
  "06/2025 – 12/2025",
  "Bengaluru, India",
  "(Remote)",
  "•Optimized website performance through code refactoring.",
  "ORGANISATIONS",
  "Helping Hands Trust",
  "Volunteer",
  "•Conducted learning sessions for students.",
  "05/2025 – 06/2025",
  "CERTIFICATIONS",
  "Udemy - The complete Python ",
  "bootcamp from zero to hero in ",
  "Python",
  "[December 1, 2023]",
  "Coursera - Database Structures & ",
  "Management with MySQL",
  "AWS Technical Essentials",
  "[January 14, 2025]",
  "SKILLS",
  "Databases & Backend: MySQL, ",
  "Firebase, MongoDB",
  "Design Thinking & User-Centered ",
  "Design",
  "LANGUAGES",
  "Python",
  "SQL",
].join("\n");

test("stacked layout: org + role lines form one job; lone date/location lines attach to it", () => {
  const p = parseResumeText(STACKED_RESUME);
  assert.equal(p.experience.length, 2);
  const [job, vol] = p.experience;
  assert.equal(job.company, "Acme Labs");
  assert.equal(job.title, "FULL STACK DEVELOPER INTERN");
  assert.equal(job.startDate, "06/2025");
  assert.equal(job.endDate, "12/2025");
  assert.equal(job.location, "Bengaluru, India (Remote)");
  assert.deepEqual(job.bullets, [
    "Developed, coded and debugged application programs of varying degree of complexity with full independence.",
    "Optimized website performance through code refactoring.",
  ]);
  assert.equal(vol.company, "Helping Hands Trust");
  assert.equal(vol.title, "Volunteer", "a role line saying 'Volunteer' is not a section heading");
  assert.equal(p.location, "Chennai, TN 600078");
});

test("stacked layout: two schools, lone dates and locations", () => {
  const { education } = parseResumeText(STACKED_RESUME);
  assert.equal(education.length, 2);
  assert.equal(education[0].institution, "Example Institute of Technology");
  assert.equal(education[0].degree, "Bachelor of Technology, Computer Science");
  assert.equal(education[0].gpa, "8.75");
  assert.equal(education[0].endDate, "05/2027");
  assert.equal(education[0].location, "Kattankulathur");
  assert.equal(education[1].institution, "Sample School And Junior College");
  assert.equal(education[1].degree, "High School Diploma");
  assert.equal(education[1].endDate, "04/2023");
});

test("certifications: wrapped names re-joined, bracketed dates, 'Provider - Course' order", () => {
  const { certifications } = parseResumeText(STACKED_RESUME);
  assert.deepEqual(certifications.map(c => [c.provider, c.name, c.issueDate]), [
    ["Udemy", "The complete Python bootcamp from zero to hero in Python", "December 1, 2023"],
    ["Coursera", "Database Structures & Management with MySQL", ""],
    ["", "AWS Technical Essentials", "January 14, 2025"],
  ]);
});

test("skills: narrow-column wraps re-joined, ALL-CAPS sub-headings not added as skills", () => {
  const { skills } = parseResumeText(STACKED_RESUME);
  assert.ok(skills.technical.includes("Firebase"));
  assert.ok(skills.technical.includes("Design Thinking & User-Centered Design"), JSON.stringify(skills.technical));
  assert.ok(!skills.technical.includes("Design"));
  assert.ok(!skills.technical.includes("LANGUAGES"));
  assert.ok(skills.technical.includes("Python") && skills.technical.includes("SQL"));
});

test("missing sections don't remove other extracted information", () => {
  const p = parseResumeText(["Kim R", "kim@example.com", "SKILLS", "Languages: Go, Rust"].join("\n"));
  assert.deepEqual(p.projects, []);
  assert.deepEqual(p.experience, []);
  assert.deepEqual(p.education, []);
  assert.deepEqual(p.skills.programmingLanguages, ["Go", "Rust"]);
  assert.equal(p.email, "kim@example.com");
});
