/**
 * Skill categorization + normalization — shared by the Editor (grouped chip
 * editor) and ResumePreview (grouped "Category: a, b, c" lines), so the editor,
 * live preview and PDF export always agree on how skills are grouped.
 *
 * Every skill is assigned programmatically:
 *   1. exact dictionary match (canonical name + aliases, case-insensitive)
 *   2. pattern rules (e.g. "*.js" → framework, "*SQL*" → database)
 *   3. fallback → OTHER SKILLS (unknown skills are never discarded)
 *
 * Deduplication is case-insensitive and alias-aware ("python" / "Python",
 * "react" / "React.js" / "ReactJS" all collapse to one entry).
 */

export const OTHER_CATEGORY = "other";

// Order here = display order in editor and preview.
export const SKILL_CATEGORIES = [
  {
    id: "languages", label: "Languages",
    skills: [
      "Python", "Java", "C", "C++|cpp", "C#|csharp", "JavaScript|js|javascript es6|es6", "TypeScript|ts",
      "Go|golang", "Rust", "Ruby", "PHP", "Swift", "Kotlin", "Dart", "Scala", "R", "MATLAB",
      "Perl", "Lua", "Haskell", "Elixir", "Julia", "Bash|shell|shell scripting", "PowerShell",
      "SQL", "PL/SQL", "HTML", "CSS", "HTML/CSS|html & css|html5/css3", "HTML5", "CSS3", "Solidity", "Assembly",
    ],
  },
  {
    id: "frameworks", label: "Frameworks / Libraries",
    skills: [
      "React.js|react|reactjs", "Next.js|nextjs", "Vue.js|vue|vuejs", "Nuxt.js|nuxt", "Angular|angularjs",
      "Svelte", "Node.js|node|nodejs", "Express.js|express|expressjs", "NestJS|nest.js", "Django",
      "Flask", "FastAPI", "Spring|spring framework", "Spring Boot|springboot", "Hibernate", ".NET|dotnet",
      "ASP.NET", "Ruby on Rails|rails", "Laravel", "Flutter", "React Native", "Electron", "jQuery",
      "Redux", "Tailwind CSS|tailwind|tailwindcss", "Bootstrap", "Material UI|mui", "Vite", "Webpack",
      "Scikit-learn|sklearn|scikit learn", "Sentence Transformers|sentence-transformers|sentencetransformers",
      "TensorFlow", "PyTorch", "Keras", "Hugging Face|huggingface|hugging face transformers|transformers",
      "Pandas", "NumPy", "SciPy", "Matplotlib", "Seaborn", "OpenCV", "spaCy", "NLTK", "LangChain",
      "XGBoost", "LightGBM", "Streamlit", "Gradio", "Socket.IO|socketio", "Mongoose", "Prisma",
      "SQLAlchemy", "Pydantic", "JUnit", "Jest", "Pytest", "Selenium", "Cypress", "Three.js", "D3.js|d3",
      "GraphQL", "Tkinter", "Qt|pyqt",
    ],
  },
  {
    id: "databases", label: "Databases",
    skills: [
      "PostgreSQL|postgres|postgre sql", "MySQL", "SQLite", "MongoDB|mongo", "Firebase", "Firestore",
      "Supabase", "Redis", "Cassandra", "DynamoDB", "Oracle|oracle db", "SQL Server|mssql|microsoft sql server",
      "MariaDB", "Elasticsearch", "Neo4j", "CouchDB", "Snowflake", "BigQuery", "Pinecone", "ChromaDB|chroma",
      "FAISS", "Weaviate", "Milvus",
    ],
  },
  {
    id: "tools", label: "Tools / Platforms",
    skills: [
      "Git", "GitHub", "GitLab", "Bitbucket", "Linux", "Unix", "Windows", "macOS", "Postman", "Vercel",
      "Render", "Netlify", "Heroku", "Firebase Hosting", "AWS|amazon web services", "Azure|microsoft azure",
      "GCP|google cloud|google cloud platform", "Docker", "Kubernetes|k8s", "Jenkins", "GitHub Actions",
      "CI/CD|ci cd", "Terraform", "Ansible", "Nginx", "Apache", "Jira", "Confluence", "Figma", "VS Code|vscode",
      "IntelliJ|intellij idea", "Eclipse", "Jupyter|jupyter notebook", "Google Colab|colab", "Anaconda",
      "npm", "Yarn", "Maven", "Gradle", "Android Studio", "Xcode", "Tableau", "Power BI|powerbi", "Excel|ms excel",
      "Swagger", "Kafka|apache kafka", "RabbitMQ", "Airflow|apache airflow", "Spark|apache spark", "Hadoop",
      "Cloudflare", "Railway",
    ],
  },
  {
    id: "ai", label: "AI / Data",
    skills: [
      "NLP|natural language processing", "OCR", "Semantic Search", "TF-IDF|tfidf|tf idf",
      "Machine Learning|ml", "Deep Learning|dl", "Computer Vision|cv", "Data Analysis", "Data Science",
      "Data Visualization", "Data Mining", "Feature Engineering", "Statistics", "LLM|llms|large language models",
      "Generative AI|genai", "RAG|retrieval augmented generation", "Prompt Engineering", "Embeddings",
      "Neural Networks", "CNN", "RNN", "LSTM", "Reinforcement Learning",
      "Recommendation Systems", "Sentiment Analysis", "Text Classification", "Named Entity Recognition|ner",
      "Predictive Modeling", "Regression", "Classification", "Clustering", "Vector Search", "ETL",
      "Big Data", "Artificial Intelligence|ai",
    ],
  },
  {
    id: "concepts", label: "Concepts / Technologies",
    skills: [
      "Data Structures & Algorithms|data structures and algorithms|dsa|data structures|algorithms",
      "OOP|object oriented programming|object-oriented programming|oops", "DBMS|database management systems",
      "Operating Systems|os", "Computer Networks|networking", "System Design", "Software Engineering",
      "Design Patterns", "Microservices", "REST API|rest|restful|rest apis|restful apis", "WebSockets|websocket",
      "JWT Authentication|jwt|json web tokens", "OAuth|oauth2|oauth 2.0", "RBAC|role-based access control",
      "AES-256-GCM", "X25519 ECDH", "Cryptography", "Encryption", "Cybersecurity|cyber security",
      "Authentication", "Agile", "Scrum", "TDD|test driven development", "Unit Testing", "SDLC",
      "Distributed Systems", "Cloud Computing", "DevOps", "Compiler Design", "Computer Architecture",
      "Responsive Design", "MVC",
    ],
  },
];

// Pattern rules — catch skills not in the dictionary before falling back to "Other".
const PATTERN_RULES = [
  { re: /\b(sql|db|database)\b|sql$/i,                                                         category: "databases" },
  { re: /\.js$|\bjs\b|framework|library/i,                                                       category: "frameworks" },
  { re: /\b(aes|rsa|ecdh|ecdsa|sha-?\d+|tls|ssl|oauth|jwt|encryption|cryptograph|authentication|authorization|security|hashing)\b/i, category: "concepts" },
  { re: /learning|\bnlp\b|\bai\b|vision|neural|\bllm|language model|data (science|analysis|analytics|mining)|analytics|embedding|classification|regression|clustering|semantic/i, category: "ai" },
  { re: /\b(aws|azure|gcp|cloud|hosting|deploy|docker|kubernetes|ci\/cd|devops)\b/i,             category: "tools" },
  { re: /\b(algorithms?|data structures?|design|architecture|systems?|programming|networks?|patterns?|principles?)\b/i, category: "concepts" },
];

/* ── Internal lookup tables, built once from SKILL_CATEGORIES ── */

const normKey = (s) => String(s || "")
  .toLowerCase()
  .replace(/\s+/g, " ")
  .replace(/\s*([/&+])\s*/g, "$1")
  .replace(/[.,;:]+$/, "")
  .trim();

const ALIAS_TO_CANONICAL = new Map(); // normKey(alias) → canonical display name
const CANONICAL_TO_CATEGORY = new Map(); // normKey(canonical) → category id
for (const cat of SKILL_CATEGORIES) {
  for (const entry of cat.skills) {
    const [canonical, ...aliases] = entry.split("|");
    CANONICAL_TO_CATEGORY.set(normKey(canonical), cat.id);
    for (const name of [canonical, ...aliases]) {
      const k = normKey(name);
      if (!ALIAS_TO_CANONICAL.has(k)) ALIAS_TO_CANONICAL.set(k, canonical);
    }
  }
}

/** Identity key used for case-insensitive, alias-aware deduplication. */
export function skillKey(skill) {
  const k = normKey(skill);
  const canonical = ALIAS_TO_CANONICAL.get(k);
  return canonical ? normKey(canonical) : k;
}

/** Category id for a single skill (never null — unknown → OTHER_CATEGORY). */
export function categorizeSkill(skill) {
  const cat = CANONICAL_TO_CATEGORY.get(skillKey(skill));
  if (cat) return cat;
  const rule = PATTERN_RULES.find(r => r.re.test(String(skill)));
  return rule ? rule.category : OTHER_CATEGORY;
}

/**
 * Case-insensitive, alias-aware dedupe preserving first-seen order.
 * Display form: the first variant the user/parser wrote that isn't all-lowercase
 * (keeps the user's own spelling, e.g. "React" stays "React"); if every variant
 * is lowercase (e.g. keyword-scan "python"), the dictionary's canonical casing.
 * Also drops a lone part already covered by a slash compound ("HTML" when
 * "HTML/CSS" is present) so the same skill isn't listed twice.
 */
export function dedupeSkills(list = []) {
  const byKey = new Map();
  for (const raw of list) {
    const s = String(raw ?? "").trim().replace(/\s+/g, " ");
    if (!s) continue;
    const k = skillKey(s);
    const existing = byKey.get(k);
    if (!existing) byKey.set(k, s);
    else if (existing === existing.toLowerCase() && s !== s.toLowerCase()) byKey.set(k, s);
  }
  for (const [k, s] of byKey) {
    if (s === s.toLowerCase()) byKey.set(k, ALIAS_TO_CANONICAL.get(normKey(s)) || s);
  }
  const compoundParts = new Set();
  for (const k of byKey.keys()) {
    if (k.includes("/")) k.split("/").filter(Boolean).forEach(p => compoundParts.add(skillKey(p)));
  }
  return [...byKey.entries()]
    .filter(([k]) => k.includes("/") || !compoundParts.has(k))
    .map(([, s]) => s);
}

/** True when `skill` is already represented in `list` (incl. via a slash compound). */
export function hasSkill(list = [], skill) {
  const k = skillKey(skill);
  return list.some(s => {
    const sk = skillKey(s);
    return sk === k || (sk.includes("/") && sk.split("/").some(p => skillKey(p) === k));
  });
}

/**
 * Group skills into ordered categories. Empty categories are omitted;
 * OTHER SKILLS is always last.
 * @returns {{id:string,label:string,skills:string[]}[]}
 */
export function categorizeSkills(list = []) {
  const groups = new Map(SKILL_CATEGORIES.map(c => [c.id, []]));
  groups.set(OTHER_CATEGORY, []);
  for (const s of dedupeSkills(list)) groups.get(categorizeSkill(s)).push(s);
  return [...SKILL_CATEGORIES, { id: OTHER_CATEGORY, label: "Other Skills" }]
    .map(c => ({ id: c.id, label: c.label, skills: groups.get(c.id) }))
    .filter(g => g.skills.length > 0);
}

// The buckets the editor and preview have always displayed. The parser mirrors
// every extracted skill into `technical`, so the newer schema buckets
// (programmingLanguages, frameworks, …) are subsets of it and aren't read here —
// that keeps a skill the user deleted from resurfacing via a stale bucket.
export const DISPLAY_SKILL_BUCKETS = ["technical", "tools", "cloud", "languages"];

// Every non-soft-skill bucket in the Resume schema (new + legacy) — a removal is
// applied to all of them. Soft skills stay separate, exactly as before.
export const TECH_SKILL_BUCKETS = [
  ...DISPLAY_SKILL_BUCKETS, "programmingLanguages", "frameworks", "libraries", "databases", "developerTools",
];

/** Flatten the displayed technical skill buckets of a resume's `skills` object into one deduped list. */
export function collectTechnicalSkills(skills = {}) {
  return dedupeSkills(DISPLAY_SKILL_BUCKETS.flatMap(b => skills?.[b] || []));
}

/** Returns a new `skills` object with `skill` (and any parts of it, if it's a slash compound) removed from every technical bucket. */
export function removeSkill(skills = {}, skill) {
  const k = skillKey(skill);
  const keys = new Set([k, ...(k.includes("/") ? k.split("/").filter(Boolean).map(skillKey) : [])]);
  const next = { ...skills };
  for (const b of TECH_SKILL_BUCKETS) {
    if (Array.isArray(next[b])) next[b] = next[b].filter(s => !keys.has(skillKey(s)));
  }
  return next;
}
