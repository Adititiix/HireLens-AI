import React from "react";
import { categorizeSkills, collectTechnicalSkills } from "../../utils/skillCategories";
import { toRichHtml, isRichTextEmpty } from "./RichTextEditor";
import { safeHref, displayUrl } from "../../utils/links";

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

// User-added sections live in data.customSections and are referenced in the
// section order as "custom:<id>".
export const CUSTOM_SECTION_PREFIX = "custom:";

// Title-case a title typed entirely in lowercase ("senior developer" → "Senior
// Developer"); any deliberate casing ("iOS Developer") is left untouched.
const SMALL_WORDS = new Set(["a","an","and","as","at","by","for","in","of","on","or","the","to","with"]);
function formatJobTitle(title) {
  const t = String(title||"").trim();
  if (t !== t.toLowerCase()) return t;
  return t.split(/\s+/).map((w,i) => i>0 && SMALL_WORDS.has(w) ? w : w.charAt(0).toUpperCase()+w.slice(1)).join(" ");
}

export default function ResumePreview({ data, sectionOrder, hiddenSections=[] }) {
  if (!data) return null;
  const skillGroups = categorizeSkills(collectTechnicalSkills(data.skills));
  const customSections = data.customSections || [];
  const order = sectionOrder || DEFAULT_SECTION_ORDER;
  // Custom sections missing from the given order (e.g. a caller passing no order) still render, at the end.
  const fullOrder = [...order, ...customSections.map(c => CUSTOM_SECTION_PREFIX+c.id).filter(id => !order.includes(id))];
  const sections = fullOrder.filter(s => !hiddenSections.includes(s));
  // Contact items; links are real (safe) anchors so they stay clickable in the printed PDF.
  const contactItems = [
    data.email && { text:data.email, href:safeHref(data.email) },
    data.phone && { text:data.phone, href:null },
    data.location && { text:data.location, href:null },
    ...[data.linkedin, data.github, data.portfolio, data.leetcode, data.hackerrank].filter(Boolean).map(u => ({ text:displayUrl(u), href:safeHref(u) })),
    ...(data.otherLinks||[]).filter(l=>l.url).map(l => ({ text:l.label || displayUrl(l.url), href:safeHref(l.url) })),
  ].filter(Boolean);
  const link = (text, href, key) => href
    ? <a key={key} href={href} target="_blank" rel="noopener noreferrer" style={{ color:"inherit", textDecoration:"none" }}>{text}</a>
    : <span key={key}>{text}</span>;

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
          {data.jobTitle && <div style={{ fontFamily:RESUME_FONT, fontSize:"14px", fontWeight:600, letterSpacing:"0.3px", lineHeight:1.3, marginTop:"4px", color:"#222" }}>{formatJobTitle(data.jobTitle)}</div>}
          {contactItems.length>0 && (
            <div style={{ fontFamily:RESUME_FONT, fontSize:"10px", color:"#333", marginTop:"6px" }}>
              {contactItems.map((c,i) => <React.Fragment key={i}>{i>0 && "  |  "}{link(c.text, c.href)}</React.Fragment>)}
            </div>
          )}
        </div>
      )}

      {sections.filter(s=>s!=="header").map(sec => {
        if (sec==="summary" && data.summary) return (
          <div key={sec} style={{ marginBottom:"12px" }}>
            {heading("Summary")}
            <p style={{ fontFamily:RESUME_FONT, fontSize:"11.5px", color:"#222", marginTop:"4px" }}>{data.summary}</p>
          </div>
        );
        if (sec==="skills" && skillGroups.length>0) return (
          <div key={sec} style={{ marginBottom:"12px" }}>
            {heading("Skills")}
            <div style={{ marginTop:"4px" }}>
              {skillGroups.map(g => (
                <div key={g.id} style={{ fontFamily:RESUME_FONT, fontSize:"11px", color:"#222", marginBottom:"2px" }}>
                  <strong style={{ color:"#111" }}>{g.label}:</strong> {g.skills.join(", ")}
                </div>
              ))}
            </div>
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
            {data.projects.map((p,i) => {
              const tech = (p.technologies||[]).filter(Boolean);
              const descLines = (p.description||"").split(/\n/).map(s=>s.trim()).filter(Boolean);
              const projectLinks = [["GitHub",p.githubUrl],["Live Demo",p.liveDemoUrl],["Link",p.additionalUrl]]
                .map(([label,url]) => url && safeHref(url) ? { label, href:safeHref(url) } : null).filter(Boolean);
              return (
                <div key={i} style={{ marginTop:"8px" }}>
                  <div style={{ fontFamily:RESUME_FONT, display:"flex", justifyContent:"space-between", gap:"12px", fontWeight:700, fontSize:"12px" }}>
                    <span>{p.name}</span>
                    {p.date
                      ? <span style={{ fontWeight:400, fontSize:"10.5px", color:"#333", whiteSpace:"nowrap" }}>{p.date}</span>
                      : tech.length>0 && <span style={{ fontWeight:400, fontSize:"10.5px", color:"#333" }}>{tech.join(", ")}</span>}
                  </div>
                  {(p.date && tech.length>0 || projectLinks.length>0) && (
                    <div style={{ fontFamily:RESUME_FONT, fontSize:"10.5px", color:"#444" }}>
                      {p.date && tech.length>0 && <span style={{ fontStyle:"italic" }}>{tech.join(", ")}</span>}
                      {projectLinks.map((l,j) => <React.Fragment key={j}>{(j>0 || (p.date && tech.length>0)) && "  |  "}{link(l.label, l.href)}</React.Fragment>)}
                    </div>
                  )}
                  {descLines.length>1 ? (
                    <ul style={{ paddingLeft:"16px", margin:"3px 0 0", listStyle:"disc" }}>
                      {descLines.map((b,j) => <li key={j} style={{ fontFamily:RESUME_FONT, fontSize:"11px", color:"#222", marginBottom:"2px" }}>{b}</li>)}
                    </ul>
                  ) : descLines.length===1 && <p style={{ fontFamily:RESUME_FONT, fontSize:"11px", color:"#222", marginTop:"2px" }}>{descLines[0]}</p>}
                </div>
              );
            })}
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
            {data.education.map((e,i) => {
              // The editor's "Description" field (stored as `honors`): coursework, honors, activities — one line each.
              const detailLines = String(e.honors||"").split(/\n/).map(s=>s.trim()).filter(Boolean);
              return (
                <div key={i} style={{ marginTop:"4px" }}>
                  <div style={{ fontFamily:RESUME_FONT, display:"flex", justifyContent:"space-between", fontSize:"11px" }}>
                    <span><strong>{e.degree}</strong>{e.institution?` — ${e.institution}`:""}{e.gpa?` (GPA: ${e.gpa})`:""}</span>
                    <span style={{ color:"#333" }}>{e.endDate}</span>
                  </div>
                  {detailLines.map((l,j) => (
                    <p key={j} data-testid="education-detail" style={{ fontFamily:RESUME_FONT, fontSize:"10.5px", color:"#222", margin:"2px 0 0", lineHeight:1.4 }}>{l}</p>
                  ))}
                </div>
              );
            })}
          </div>
        );
        if (sec==="achievements" && data.achievements?.length>0) return (
          <div key={sec} style={{ marginBottom:"12px" }}>
            {heading("Achievements")}
            {data.achievements.map((a,i) => (
              <div key={i} style={{ fontFamily:RESUME_FONT, display:"flex", justifyContent:"space-between", gap:"12px", marginTop:"4px", fontSize:"11px" }}>
                <span>
                  {a.description ? <strong>{a.title}</strong> : a.title}
                  {a.description && <span style={{ color:"#222" }}> — {a.description}</span>}
                </span>
                {a.date && <span style={{ color:"#333", whiteSpace:"nowrap" }}>{a.date}</span>}
              </div>
            ))}
          </div>
        );
        if (sec==="additionalInfo" && !isRichTextEmpty(data.additionalInfo)) return (
          <div key={sec} style={{ marginBottom:"12px" }}>
            {heading("Additional Information")}
            <div className="rich-text" style={{ fontFamily:RESUME_FONT, fontSize:"11px", color:"#222", marginTop:"4px" }}
              dangerouslySetInnerHTML={{ __html: toRichHtml(data.additionalInfo) }} />
          </div>
        );
        if (sec.startsWith(CUSTOM_SECTION_PREFIX)) {
          const cs = customSections.find(c => CUSTOM_SECTION_PREFIX+c.id === sec);
          if (!cs || isRichTextEmpty(cs.content)) return null;
          return (
            <div key={sec} style={{ marginBottom:"12px" }}>
              {heading(cs.title || "Custom Section")}
              <div className="rich-text" style={{ fontFamily:RESUME_FONT, fontSize:"11px", color:"#222", marginTop:"4px" }}
                dangerouslySetInnerHTML={{ __html: toRichHtml(cs.content) }} />
            </div>
          );
        }
        return null;
      })}
    </div>
  );
}
