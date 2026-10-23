// AI Resume Suggestions — gateway to the NLP service's POST /resume-suggestions.
// The engine is rule-based + retrieval (no generative model, no external API);
// see python-nlp/recommendations/evidence/. Resume data is forwarded only to the
// local NLP service and never logged.
const axios = require("axios");
const NLP = process.env.NLP_SERVICE_URL || "http://localhost:8000";

const MAX_BODY_CHARS = 300_000;

function isPlainObject(v){ return v!==null && typeof v==="object" && !Array.isArray(v); }

exports.getSuggestions = async (req, res) => {
  const { resume, resumeText, jobDescription, analysis, maxSuggestions } = req.body || {};
  if (!isPlainObject(resume) && !(typeof resumeText === "string" && resumeText.trim())) {
    return res.status(400).json({ error: "Provide the resume to analyse (resume or resumeText)." });
  }
  if (jobDescription != null && typeof jobDescription !== "string") {
    return res.status(400).json({ error: "jobDescription must be text." });
  }
  if (JSON.stringify(req.body).length > MAX_BODY_CHARS) {
    return res.status(413).json({ error: "Resume data is too large to analyse." });
  }
  const payload = {
    resume: isPlainObject(resume) ? resume : undefined,
    resume_text: typeof resumeText === "string" ? resumeText : "",
    job_description: jobDescription || "",
    analysis: isPlainObject(analysis) ? analysis : undefined,
    max_suggestions: Number.isInteger(maxSuggestions) ? maxSuggestions : undefined,
  };
  try {
    const { data } = await axios.post(`${NLP}/resume-suggestions`, payload, { timeout: 60000 });
    res.json({ success: true, ...data });
  } catch (err) {
    const status = err.response?.status;
    if (status === 422) {
      // Pydantic echoes the offending input back — return only field + message, never the resume content.
      const details = (Array.isArray(err.response.data?.detail) ? err.response.data.detail : [])
        .map(d => ({ field: (d.loc || []).filter(x => x !== "body").join("."), message: String(d.msg || "") }));
      return res.status(400).json({ error: "The resume data could not be analysed.", details });
    }
    if (!err.response) {
      console.error(`[suggestions] NLP service unreachable: ${err.code || err.message}`);
      return res.status(503).json({ error: "AI Suggestions is unavailable — the NLP service isn't running (port 8000)." });
    }
    console.error(`[suggestions] NLP service error: HTTP ${status}`);
    res.status(502).json({ error: "Could not generate suggestions. Please try again." });
  }
};
