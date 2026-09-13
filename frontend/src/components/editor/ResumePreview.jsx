import React from "react";

/**
 * ResumePreview — shared, exported component.
 *
 * TASK 3 FIX: this used to live only inline inside EditorPage.jsx, and mixed
 * TWO font families in the actual generated resume — the body text was
 * `Georgia,'Times New Roman',serif` while every heading/name/job-title/date
 * used `Arial,Helvetica,sans-serif`. That is the literal "3-4 visibly
 * different fonts" complaint (serif body + sans-serif everything else, at
 * several weights). Fixed by unifying to ONE font stack, `RESUME_FONT`
 * below, used for every single text element in the document — only size
 * and weight vary, exactly as requested (Inter primary — already loaded via
 * Google Fonts in index.html for the rest of the app — falling back to
 * Arial/Helvetica if Inter fails to load, e.g. offline printing).
 *
 * TASK 4 FIX: extracted out of EditorPage.jsx into its own file so BOTH the
 * Editor and the Results page (DashboardPage.jsx) can import the exact same
 * component for their Export buttons — one export mechanism, reused from
 * two entry points, instead of a second competing implementation.
 */
export const RESUME_FONT = "'Inter', Arial, Helvetica, sans-serif";

export const DEFAULT_SECTION_ORDER = ["header","summary","skills","experience","projects","certifications","education","achievements","additionalInfo"];

export default function ResumePreview({ data, sectionOrder, hiddenSections=[] }) {
  if (!data) return null;
  const allSkills = [
    ...(data.skills?.technical||[]), ...(data.skills?.tools||[]),
    ...(data.skills?.cloud||[]), ...(data.skills?.languages||[]),
  ];
  const sections = (sectionOrder || DEFAULT_SECTION_ORDER).filter(s => !hiddenSections.includes(s));
  const contactLine = [data.email, data.phone, data.linkedin, data.github, data.portfolio, data.leetcode, data.hackerrank,
    ...(data.otherLinks||[]).map(l=>l.url)].filter(Boolean).join("  |  ");

  const heading = (label) => (
    <div style={{ marginBottom:"6px" }}>
      <div style={{ fontFamily:RESUME_FONT, fontSize:"11px", fontWeight:700, textTransform:"uppercase", letterSpacing:"1.2px", color:"#111" }}>{label}</div>
      <div style={{ height:"1px", background:"#111", marginTop:"2px" }} />
    </div>
  );

  return (
    <div className="bg-white shadow-lg" style={{ fontFamily:RESUME_FONT, fontSize:"11.5px", color:"#111", lineHeight:1.45, padding:"14mm 16mm", width:"210mm", minHeight:"297mm" }}>
      {!hiddenSections.includes("header") && (
        <div style={{ textAlign:"center", marginBottom:"14px" }}>
          <h1 style={{ fontFamily:RESUME_FONT, fontSize:"20px", fontWeight:700, letterSpacing:"0.5px", margin:0 }}>{(data.name||"YOUR NAME").toUpperCase()}</h1>
          {data.jobTitle && <div style={{ fontFamily:RESUME_FONT, fontSize:"12px", fontWeight:500, marginTop:"2px", color:"#333" }}>{data.jobTitle}</div>}
          {contactLine && <div style={{ fontFamily:RESUME_FONT, fontSize:"10px", color:"#333", marginTop:"5px" }}>{contactLine}</div>}
        </div>
      )}

      {sections.filter(s=>s!=="header").map(sec => {
        if (sec==="summary" && data.summary) return (
          <div key={sec} style={{ marginBottom:"12px" }}>
            {heading("Summary")}
            <p style={{ fontFamily:RESUME_FONT, fontSize:"11.5px", color:"#222", marginTop:"4px" }}>{data.summary}</p>
          </div>
        );
        if (sec==="skills" && allSkills.length>0) return (
          <div key={sec} style={{ marginBottom:"12px" }}>
            {heading("Skills")}
            <p style={{ fontFamily:RESUME_FONT, fontSize:"11.5px", color:"#222", marginTop:"4px" }}>{allSkills.join("  •  ")}</p>
          </div>
        );
        if (sec==="experience" && data.experience?.length>0) return (
          <div key={sec} style={{ marginBottom:"12px" }}>
            {heading("Experience")}
            {data.experience.map((e,i) => (
              <div key={i} style={{ marginTop:"8px" }}>
                <div style={{ fontFamily:RESUME_FONT, display:"flex", justifyContent:"space-between", fontWeight:700, fontSize:"12px" }}>
                  <span>{e.title}{e.company?` — ${e.company}`:""}</span>
                  <span style={{ fontWeight:400, fontSize:"10.5px", color:"#333" }}>{e.startDate}{e.endDate?` – ${e.endDate}`:""}</span>
                </div>
                {e.location && <div style={{ fontFamily:RESUME_FONT, fontSize:"10.5px", color:"#555" }}>{e.location}</div>}
                {e.bullets?.filter(Boolean).length>0 && (
                  <ul style={{ paddingLeft:"16px", margin:"3px 0 0" }}>
                    {e.bullets.filter(Boolean).map((b,j) => <li key={j} style={{ fontFamily:RESUME_FONT, fontSize:"11px", color:"#222", marginBottom:"2px" }}>{b}</li>)}
                  </ul>
                )}
              </div>
            ))}
          </div>
        );
        if (sec==="projects" && data.projects?.length>0) return (
          <div key={sec} style={{ marginBottom:"12px" }}>
            {heading("Projects")}
            {data.projects.map((p,i) => (
              <div key={i} style={{ marginTop:"8px" }}>
                <div style={{ fontFamily:RESUME_FONT, display:"flex", justifyContent:"space-between", fontWeight:700, fontSize:"12px" }}>
                  <span>{p.name}</span>
                  {p.technologies?.length>0 && <span style={{ fontWeight:400, fontSize:"10.5px", color:"#333" }}>{p.technologies.join(", ")}</span>}
                </div>
                {p.description && <p style={{ fontFamily:RESUME_FONT, fontSize:"11px", color:"#222", marginTop:"2px" }}>{p.description}</p>}
              </div>
            ))}
          </div>
        );
        if (sec==="certifications" && data.certifications?.length>0) return (
          <div key={sec} style={{ marginBottom:"12px" }}>
            {heading("Certifications")}
            {data.certifications.map((c,i) => (
              <div key={i} style={{ fontFamily:RESUME_FONT, display:"flex", justifyContent:"space-between", marginTop:"4px", fontSize:"11px" }}>
                <span><strong>{c.name}</strong>{c.provider?` — ${c.provider}`:""}</span>
                <span style={{ color:"#333" }}>{c.issueDate}</span>
              </div>
            ))}
          </div>
        );
        if (sec==="education" && data.education?.length>0) return (
          <div key={sec} style={{ marginBottom:"12px" }}>
            {heading("Education")}
            {data.education.map((e,i) => (
              <div key={i} style={{ fontFamily:RESUME_FONT, display:"flex", justifyContent:"space-between", marginTop:"4px", fontSize:"11px" }}>
                <span><strong>{e.degree}</strong>{e.institution?` — ${e.institution}`:""}{e.gpa?` (GPA: ${e.gpa})`:""}</span>
                <span style={{ color:"#333" }}>{e.endDate}</span>
              </div>
            ))}
          </div>
        );
        if (sec==="achievements" && data.achievements?.length>0) return (
          <div key={sec} style={{ marginBottom:"12px" }}>
            {heading("Achievements")}
            {data.achievements.map((a,i) => (
              <div key={i} style={{ fontFamily:RESUME_FONT, marginTop:"4px", fontSize:"11px" }}>
                <strong>{a.title}</strong>
                {a.description && <span style={{ color:"#222" }}> — {a.description}</span>}
              </div>
            ))}
          </div>
        );
        if (sec==="additionalInfo" && data.additionalInfo) return (
          <div key={sec} style={{ marginBottom:"12px" }}>
            {heading("Additional Information")}
            <p style={{ fontFamily:RESUME_FONT, fontSize:"11px", color:"#222", marginTop:"4px" }}>{data.additionalInfo}</p>
          </div>
        );
        return null;
      })}
    </div>
  );
}
