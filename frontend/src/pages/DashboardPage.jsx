import React from "react";
import { Link } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { Edit3, Download, Target, Bot, Check, X, ArrowRight, AlertTriangle, Lightbulb, TrendingUp } from "lucide-react";
import { useAnalysis } from "../context/AnalysisContext";
import { ScoreCard, CollapsibleSection, ProgressBar } from "../components/ui";

/* ── ATSExplanationPanel ── */
function ATSExplanationPanel({ explanation, scores={}, skillGap={} }) {
  if (!explanation) return null;
  const { priorityMap={}, highMissing=[], mediumMissing=[], matched=[] } = skillGap;
  const score = scores.overall || 0;
  const color = score>=80?"text-green-600 dark:text-green-400":score>=60?"text-amber-600 dark:text-amber-400":"text-red-600 dark:text-red-400";

  return (
    <motion.div initial={{opacity:0,y:12}} animate={{opacity:1,y:0}}
      className="card p-5 border-l-4 border-l-brand-500">
      <div className="flex items-start gap-3">
        <div className="w-8 h-8 bg-brand-50 dark:bg-brand-900/30 rounded-lg flex items-center justify-center flex-shrink-0">
          <Lightbulb className="w-4 h-4 text-brand-500"/>
        </div>
        <div className="flex-1">
          <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-200 mb-2">ATS Analysis</h3>
          <p className="text-sm text-gray-600 dark:text-gray-400 leading-relaxed mb-4">{explanation}</p>
          {matched.length>0&&(
            <div className="mb-3">
              <p className="text-xs font-semibold text-green-600 dark:text-green-400 mb-2">✓ Strong areas</p>
              <div className="flex flex-wrap gap-1.5">{matched.slice(0,6).map(s=><span key={s} className="skill-tag-matched">{s}</span>)}</div>
            </div>
          )}
          {highMissing.length>0&&(
            <div>
              <p className="text-xs font-semibold text-red-600 dark:text-red-400 mb-2">⚠ Major gaps (High Priority)</p>
              <div className="flex flex-wrap gap-1.5">{highMissing.map(s=><span key={s} className="skill-tag-high">{s}</span>)}</div>
            </div>
          )}
        </div>
      </div>
    </motion.div>
  );
}

/* ── SkillGapPanel — shows only HIGH and MEDIUM missing (not LOW) ── */
function SkillGapPanel({ skillGap={} }) {
  const { matched=[], missing=[], partial=[], highMissing=[], mediumMissing=[], matchPercentage=0 } = skillGap;
  return (
    <CollapsibleSection title="Skill Gap Analysis" icon={TrendingUp} badge={`${matchPercentage}% match`}>
      <div className="grid grid-cols-3 gap-3 mb-5">
        {[["Matched",matched.length,"text-green-600 dark:text-green-400","bg-green-50 dark:bg-green-900/20"],
          ["Partial",partial.length,"text-amber-600 dark:text-amber-400","bg-amber-50 dark:bg-amber-900/20"],
          ["Missing",missing.length,"text-red-600 dark:text-red-400","bg-red-50 dark:bg-red-900/20"]
        ].map(([l,n,tc,bg])=>(
          <div key={l} className={`text-center p-3 ${bg} rounded-xl`}>
            <div className={`text-2xl font-bold tabular-nums ${tc}`}>{n}</div>
            <div className={`text-xs font-medium ${tc} mt-0.5`}>{l}</div>
          </div>
        ))}
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
        <div>
          <p className="text-xs font-semibold text-green-600 dark:text-green-400 uppercase tracking-wide mb-2 flex items-center gap-1"><Check className="w-3 h-3"/>Matched Skills</p>
          <div className="flex flex-wrap gap-1.5">
            {matched.length>0?matched.map(s=><span key={s} className="skill-tag-matched">{s}</span>):<p className="text-xs text-gray-400 italic">None matched</p>}
          </div>
        </div>
        <div>
          {/* Only show HIGH and MEDIUM missing — not LOW */}
          {highMissing.length>0&&(
            <div className="mb-3">
              <p className="text-xs font-semibold text-red-600 dark:text-red-400 uppercase tracking-wide mb-2 flex items-center gap-1"><AlertTriangle className="w-3 h-3"/>High Priority Missing</p>
              <div className="flex flex-wrap gap-1.5">{highMissing.map(s=><span key={s} className="skill-tag-high">{s}</span>)}</div>
            </div>
          )}
          {mediumMissing.length>0&&(
            <div>
              <p className="text-xs font-semibold text-amber-600 dark:text-amber-400 uppercase tracking-wide mb-2">Medium Priority Missing</p>
              <div className="flex flex-wrap gap-1.5">{mediumMissing.map(s=><span key={s} className="skill-tag-medium">{s}</span>)}</div>
            </div>
          )}
          {highMissing.length===0&&mediumMissing.length===0&&(
            <div>
              <p className="text-xs font-semibold text-green-600 dark:text-green-400 mb-2">No critical gaps!</p>
              <p className="text-xs text-gray-400">You cover all high and medium priority skills.</p>
            </div>
          )}
          {partial.length>0&&(
            <div className="mt-3">
              <p className="text-xs font-semibold text-amber-600 dark:text-amber-400 uppercase tracking-wide mb-2">Partial Match</p>
              <div className="flex flex-wrap gap-1.5">{partial.map(s=><span key={s} className="skill-tag-partial">{s}</span>)}</div>
            </div>
          )}
        </div>
      </div>
    </CollapsibleSection>
  );
}

/* ── ImprovementsPanel (Part 7: Section / Severity / side-by-side Original vs Suggested / Reason / Apply / Reject) ── */
function ImprovementsPanel({ improvements=[] }) {
  if(!improvements.length) return null;
  const [applied,  setApplied]  = React.useState(new Set());
  const [rejected, setRejected] = React.useState(new Set());
  return (
    <CollapsibleSection title="AI Improvement Suggestions" icon={Bot} badge={`${improvements.length}`}>
      <div className="space-y-3">
        {improvements.map((item,i)=>{
          if(rejected.has(i)) return null; // Part 7: rejected suggestions disappear
          const isApplied = applied.has(i);
          return(
            <motion.div key={i} initial={{opacity:0,y:6}} animate={{opacity:1,y:0}} transition={{delay:i*0.04}}
              className={`border rounded-xl p-4 transition-all ${isApplied?"border-green-200 dark:border-green-800 bg-green-50/30 dark:bg-green-900/10":"border-gray-100 dark:border-gray-800"}`}
            >
              <div className="flex items-center gap-2 mb-3 flex-wrap">
                <span className="text-xs font-semibold text-brand-600 dark:text-brand-400 uppercase tracking-wide">{item.section}</span>
                {/* Severity badge */}
                <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold uppercase tracking-wide ${item.priority==="high"?"bg-red-50 text-red-600 dark:bg-red-900/20 dark:text-red-400":item.priority==="low"?"bg-gray-50 text-gray-500 dark:bg-gray-800 dark:text-gray-400":"bg-amber-50 text-amber-600 dark:bg-amber-900/20 dark:text-amber-400"}`}>
                  {item.priority||"medium"} severity
                </span>
                {isApplied&&<span className="text-xs text-green-600 dark:text-green-400 font-medium ml-auto flex items-center gap-1"><Check className="w-3 h-3"/>Applied</span>}
              </div>

              {/* Side-by-side Original vs Suggested */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 mb-2">
                <div>
                  <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-1">Original</p>
                  <div className="text-xs text-gray-500 dark:text-gray-500 bg-gray-50 dark:bg-gray-800 rounded-lg px-3 py-2 h-full border-l-2 border-gray-200 dark:border-gray-700">
                    {item.original||<span className="italic text-gray-400">(none — new addition)</span>}
                  </div>
                </div>
                <div>
                  <p className="text-[10px] font-semibold text-green-500 uppercase tracking-wide mb-1">Suggested</p>
                  <div className="text-sm text-gray-800 dark:text-gray-200 bg-green-50 dark:bg-green-900/20 rounded-lg px-3 py-2 h-full border-l-2 border-green-400">
                    {item.suggestion}
                  </div>
                </div>
              </div>

              {item.reasoning&&<p className="text-xs text-gray-400 italic mb-1">{item.reasoning}</p>}

              {!isApplied&&(
                <div className="flex gap-2 mt-3">
                  <button onClick={()=>setApplied(s=>new Set([...s,i]))}
                    className="flex items-center gap-1.5 text-xs font-medium text-brand-600 dark:text-brand-400 bg-brand-50 dark:bg-brand-900/20 hover:bg-brand-100 dark:hover:bg-brand-900/40 px-3 py-1.5 rounded-lg transition-colors">
                    <Check className="w-3 h-3"/>Apply
                  </button>
                  <button onClick={()=>setRejected(s=>new Set([...s,i]))}
                    className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 px-3 py-1.5 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors">
                    <X className="w-3 h-3"/>Reject
                  </button>
                </div>
              )}
            </motion.div>
          );
        })}
      </div>
    </CollapsibleSection>
  );
}

/* ── ATSBreakdown ── */
function ATSBreakdown({ scores={}, atsBreakdown={} }) {
  const metrics=[
    ["Keyword coverage",scores.keywordScore||0],
    ["Formatting quality",scores.formattingScore||0],
    ["Section completeness",scores.sectionCompleteness||0],
    ["Action verb strength",scores.actionVerbStrength||0],
    ["Semantic alignment",scores.semanticScore||0],
  ];
  // Part 8: per-resume-section breakdown (Summary/Experience/Skills/Projects/Education)
  const sectionScores = scores.sectionScores || {};
  const sectionMetrics = [
    ["Summary",sectionScores.summary||0],
    ["Experience",sectionScores.experience||0],
    ["Skills",sectionScores.skills||0],
    ["Projects",sectionScores.projects||0],
    ["Education",sectionScores.education||0],
  ];
  const hasSectionScores = sectionMetrics.some(([,v])=>v>0);
  const{passedChecks=[],formattingIssues=[],missingRequiredSections=[]}=atsBreakdown;
  return (
    <CollapsibleSection title="ATS Compatibility Report" icon={Bot} badge={`${scores.ats||0}%`}>
      <div className="space-y-3 mb-5">
        {metrics.map(([l,v])=>{
          const pct=Math.min(100,Math.round(v));
          const c=pct>=80?"bg-green-500":pct>=60?"bg-amber-500":"bg-red-500";
          const tc=pct>=80?"text-green-600 dark:text-green-400":pct>=60?"text-amber-600 dark:text-amber-400":"text-red-600 dark:text-red-400";
          return(
            <div key={l} className="flex items-center gap-3">
              <span className="text-sm text-gray-600 dark:text-gray-400 w-44 flex-shrink-0">{l}</span>
              <div className="flex-1 h-1.5 bg-gray-100 dark:bg-gray-800 rounded-full overflow-hidden">
                <div className={`h-full ${c} rounded-full transition-all duration-700`} style={{width:`${pct}%`}}/>
              </div>
              <span className={`text-sm font-semibold w-8 text-right tabular-nums ${tc}`}>{pct}</span>
            </div>
          );
        })}
      </div>

      {hasSectionScores&&(
        <div className="mb-5">
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2.5">Section Scores</p>
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
            {sectionMetrics.map(([label,v])=>{
              const pct=Math.min(100,Math.round(v));
              const tc=pct>=80?"text-green-600 dark:text-green-400":pct>=60?"text-amber-600 dark:text-amber-400":"text-red-600 dark:text-red-400";
              const bg=pct>=80?"bg-green-50 dark:bg-green-900/20":pct>=60?"bg-amber-50 dark:bg-amber-900/20":"bg-red-50 dark:bg-red-900/20";
              return(
                <div key={label} className={`text-center p-2.5 rounded-lg ${bg}`}>
                  <div className={`text-lg font-bold tabular-nums ${tc}`}>{pct}</div>
                  <div className="text-[10px] text-gray-500 dark:text-gray-400 mt-0.5">{label}</div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {passedChecks.length>0&&(
          <div>
            <p className="text-xs font-semibold text-green-600 dark:text-green-400 uppercase tracking-wide mb-2">✓ Passed</p>
            <ul className="space-y-1.5">{passedChecks.map((c,i)=><li key={i} className="text-xs text-gray-600 dark:text-gray-400 flex items-start gap-1.5"><Check className="w-3 h-3 text-green-500 mt-0.5 flex-shrink-0"/>{c}</li>)}</ul>
          </div>
        )}
        {(formattingIssues.length>0||missingRequiredSections.length>0)&&(
          <div>
            <p className="text-xs font-semibold text-red-600 dark:text-red-400 uppercase tracking-wide mb-2">⚠ Issues</p>
            <ul className="space-y-1.5">{[...missingRequiredSections,...formattingIssues].map((c,i)=><li key={i} className="text-xs text-gray-600 dark:text-gray-400 flex items-start gap-1.5"><X className="w-3 h-3 text-red-400 mt-0.5 flex-shrink-0"/>{c}</li>)}</ul>
          </div>
        )}
      </div>
    </CollapsibleSection>
  );
}

/* ── Main Dashboard ── */
export default function DashboardPage() {
  const { currentAnalysis } = useAnalysis();
  if(!currentAnalysis) return (
    <main className="max-w-3xl mx-auto px-4 py-16 text-center">
      <div className="card p-12">
        <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-3">No analysis yet</h2>
        <p className="text-gray-500 dark:text-gray-400 mb-6">Upload your resume and a job description to see results here.</p>
        <Link to="/analyze" className="btn-primary inline-flex mx-auto">Go to Analyzer<ArrowRight className="w-4 h-4"/></Link>
      </div>
    </main>
  );

  const{scores={},skillGap={},improvements=[],atsBreakdown={},jobDescription={},atsExplanation=""}=currentAnalysis;

  return (
    <main className="max-w-3xl mx-auto px-4 py-8">
      <motion.div initial={{opacity:0,y:12}} animate={{opacity:1,y:0}} className="flex items-start justify-between mb-6 gap-4 flex-wrap">
        <div>
          <h1 className="page-header">Analysis Results</h1>
          <p className="page-sub">{jobDescription.title||"Target Position"} · Just now</p>
        </div>
        <div className="flex gap-2">
          <Link to="/editor" className="btn-secondary text-sm py-2 px-4"><Edit3 className="w-3.5 h-3.5"/>Edit Resume</Link>
          <button className="btn-primary text-sm py-2 px-4"><Download className="w-3.5 h-3.5"/>Export</button>
        </div>
      </motion.div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
        <ScoreCard label="Match Score"  score={scores.overall||0}    description={`${skillGap.highMissing?.length||0} high-priority gaps`} icon={Target} delay={0}/>
        <ScoreCard label="ATS Score"    score={scores.ats||0}        description="ATS compatibility" icon={Bot} delay={0.05}/>
        <motion.div initial={{opacity:0,y:12}} animate={{opacity:1,y:0}} transition={{delay:0.1}} className="card p-5">
          <p className="section-label mb-2">Matched</p>
          <p className="text-3xl font-bold tabular-nums text-green-600 dark:text-green-400">{skillGap.matched?.length||0}</p>
          <p className="text-xs text-gray-400 mt-1">skills aligned</p>
        </motion.div>
        <motion.div initial={{opacity:0,y:12}} animate={{opacity:1,y:0}} transition={{delay:0.15}} className="card p-5">
          <p className="section-label mb-2">Missing</p>
          <p className="text-3xl font-bold tabular-nums text-red-600 dark:text-red-400">{skillGap.missing?.length||0}</p>
          <p className="text-xs text-gray-400 mt-1">total gaps</p>
        </motion.div>
      </div>

      <div className="space-y-4">
        {atsExplanation&&<ATSExplanationPanel explanation={atsExplanation} scores={scores} skillGap={skillGap}/>}
        <SkillGapPanel skillGap={skillGap}/>
        <ImprovementsPanel improvements={improvements}/>
        <ATSBreakdown scores={scores} atsBreakdown={atsBreakdown}/>
      </div>

      <div className="card p-6 mt-5 text-center">
        <h3 className="text-base font-semibold text-gray-800 dark:text-gray-200 mb-2">Ready to update your resume?</h3>
        <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">Open the editor to apply AI suggestions and export.</p>
        <Link to="/editor" className="btn-primary inline-flex mx-auto">Open Resume Editor<ArrowRight className="w-4 h-4"/></Link>
      </div>
    </main>
  );
}
