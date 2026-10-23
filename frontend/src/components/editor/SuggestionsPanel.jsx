import React,{useReducer,useState}from"react";
import{motion,AnimatePresence}from"framer-motion";
import{Sparkles,Check,X,Copy,Pencil,EyeOff,ChevronDown,AlertCircle,HelpCircle,RotateCcw,ShieldCheck,Briefcase}from"lucide-react";
import{Spinner}from"../ui";
import{suggestionsAPI}from"../../services/api";
import{addSkills,applySuggestion,buildSuggestionRequest,describeChange,initialSuggestionsState,isOpen,suggestionsReducer}from"../../utils/suggestions";

/**
 * AI Suggestions — evidence-grounded resume improvements.
 * Engine: rule-based detection + retrieval over the user's own resume (python-nlp/recommendations/evidence).
 * Nothing is applied without the user clicking Accept / Save; each change touches only its own line.
 * "Applied" is shown only after the change is in the editor's resume data and (for a stored resume) saved —
 * see onCommit in EditorPage. Skill suggestions never add anything without the user's explicit confirmation.
 */
const CATEGORY_LABELS={
  responsibility_not_contribution:"Responsibility, not contribution",weak_opener:"Weak opening",
  repeated_verb:"Repeated verb",repeated_phrase:"Repeated wording",tech_list_only:"Lists tech without purpose",
  missing_action:"No clear action",vague_description:"Vague description",filler:"Filler words",too_long:"Too long",
  missing_outcome:"Missing outcome",metric_available:"Result found in your resume",
  missing_technical_context:"Missing technical detail",first_person:"First-person wording",
  missing_skill:"Job skill missing",skill_not_demonstrated:"Skill not demonstrated",ats_section:"ATS / sections",
};
const SEVERITY_STYLE={
  high:"bg-red-50 text-red-700 border-red-100 dark:bg-red-900/20 dark:text-red-400 dark:border-red-800",
  medium:"bg-amber-50 text-amber-700 border-amber-100 dark:bg-amber-900/20 dark:text-amber-400 dark:border-amber-800",
  low:"bg-gray-50 text-gray-600 border-gray-200 dark:bg-gray-800 dark:text-gray-400 dark:border-gray-700",
};
const SOURCE_LABEL={resume:"Your resume",job_description:"Job description",analysis:"Skill-gap analysis",guideline:"Writing guideline"};
const CONFIDENCE_STYLE={high:"text-green-600 dark:text-green-400",medium:"text-amber-600 dark:text-amber-400",low:"text-gray-500 dark:text-gray-400"};

export function SuggestionCard({s,dispatch,onAccept,onAddSkill}){
  const[showEvidence,setShowEvidence]=useState(false);
  const[copied,setCopied]=useState(false);
  const[confirmSkill,setConfirmSkill]=useState(false);
  const busy=s.status==="applying";
  const copyText=s.editing?s.draft:(s.suggested_text||"");
  const copy=async()=>{
    try{await navigator.clipboard.writeText(copyText);setCopied(true);setTimeout(()=>setCopied(false),1500);}
    catch{dispatch({type:"applyFailed",id:s.id,reason:"Couldn't access the clipboard — select the text and copy it manually."});}
  };
  return(
    <motion.div layout initial={{opacity:0,y:-4}} animate={{opacity:1,y:0}} exit={{opacity:0,height:0}}
      className="border border-gray-100 dark:border-gray-800 rounded-xl p-3.5 bg-white dark:bg-gray-900 space-y-2.5">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className={`text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded border ${SEVERITY_STYLE[s.severity]}`}>{s.severity}</span>
        <span className="text-xs font-semibold text-gray-800 dark:text-gray-200">{CATEGORY_LABELS[s.category]||s.category}</span>
        <span className="text-xs text-gray-400 truncate">· {s.section}{s.entry?` › ${s.entry}`:""}</span>
      </div>

      {s.original_text&&(
        <div>
          <p className="section-label mb-1">Current</p>
          <p className="text-xs text-gray-500 dark:text-gray-400 leading-relaxed">{s.original_text}</p>
        </div>
      )}

      {s.editing?(
        <div>
          <p className="section-label mb-1">Your version</p>
          <textarea value={s.draft} onChange={e=>dispatch({type:"draft",id:s.id,text:e.target.value})} rows={3}
            className="form-input text-xs leading-relaxed resize-y" placeholder="Write the improved bullet (one line per bullet)…"/>
        </div>
      ):s.suggested_text?(
        <div>
          <p className="section-label mb-1">Suggested</p>
          <p className="text-xs text-gray-800 dark:text-gray-200 leading-relaxed bg-green-50/60 dark:bg-green-900/10 border border-green-100 dark:border-green-900/40 rounded-lg px-2.5 py-2 whitespace-pre-line">{s.suggested_text}</p>
        </div>
      ):null}

      <p className="text-xs text-gray-600 dark:text-gray-400 leading-relaxed">{s.reason}</p>

      {s.follow_up_question&&(
        <div className="flex items-start gap-2 text-xs bg-brand-50/60 dark:bg-brand-900/10 border border-brand-100 dark:border-brand-800 rounded-lg px-2.5 py-2 text-brand-700 dark:text-brand-300">
          <HelpCircle className="w-3.5 h-3.5 flex-shrink-0 mt-px"/><span>{s.follow_up_question}</span>
        </div>
      )}

      {s.related_job_requirement&&(
        <div className="flex items-start gap-2 text-xs text-gray-500 dark:text-gray-400">
          <Briefcase className="w-3.5 h-3.5 flex-shrink-0 mt-px"/><span><span className="font-medium">Job requirement:</span> {s.related_job_requirement}</span>
        </div>
      )}

      <div className="flex items-center justify-between gap-2">
        <span className={`text-[11px] font-medium flex items-center gap-1 ${CONFIDENCE_STYLE[s.confidence?.level]}`} title={(s.confidence?.signals||[]).join("\n")}>
          <ShieldCheck className="w-3.5 h-3.5"/>{s.confidence?.level} confidence · {s.requires_user_input?"needs your input":"evidence-based"}
        </span>
        {s.supporting_evidence?.length>0&&(
          <button onClick={()=>setShowEvidence(v=>!v)} className="text-[11px] text-brand-500 hover:underline flex items-center gap-0.5">
            Evidence ({s.supporting_evidence.length})<ChevronDown className={`w-3 h-3 transition-transform ${showEvidence?"rotate-180":""}`}/>
          </button>
        )}
      </div>
      {showEvidence&&(
        <ul className="space-y-1.5 border-t border-gray-50 dark:border-gray-800 pt-2">
          {s.supporting_evidence.map((e,i)=>(
            <li key={i} className="text-[11px] leading-relaxed">
              <span className={`font-semibold ${e.source==="resume"?"text-green-700 dark:text-green-400":"text-gray-500 dark:text-gray-400"}`}>{e.label||SOURCE_LABEL[e.source]}:</span>{" "}
              <span className="text-gray-600 dark:text-gray-400">{e.text}</span>
            </li>
          ))}
          <li className="text-[10px] text-gray-400">Only text from your resume counts as evidence of what you did; job and guideline text never does.</li>
        </ul>
      )}

      {s.note&&<p className="text-[11px] text-red-600 dark:text-red-400 flex items-start gap-1"><AlertCircle className="w-3.5 h-3.5 flex-shrink-0"/>{s.note}</p>}

      {s.category==="missing_skill"&&s.skill&&confirmSkill&&(
        <label className="flex items-start gap-2 text-xs text-gray-700 dark:text-gray-300 bg-amber-50/60 dark:bg-amber-900/10 border border-amber-100 dark:border-amber-900/40 rounded-lg px-2.5 py-2">
          <input type="checkbox" className="mt-0.5" checked={s.confirmed||false} onChange={e=>dispatch({type:"confirm",id:s.id,value:e.target.checked})}/>
          <span>I have actually used <strong>{s.skill}</strong>. Add it to my Skills section. (No bullet or project is written for you — add where you used it yourself.)</span>
        </label>
      )}
      {s.category==="skill_not_demonstrated"&&(
        <p className="text-[11px] text-gray-500 dark:text-gray-400">Nothing is changed automatically: add a bullet to the role or project where you really used it.</p>
      )}

      <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
        {s.editing?(
          <>
            <button onClick={()=>onAccept(s,s.draft)} disabled={busy||!s.draft?.trim()} className="btn-primary text-xs py-1.5 px-3">{busy?<><Spinner size="sm"/>Applying…</>:<><Check className="w-3.5 h-3.5"/>Save &amp; apply</>}</button>
            <button onClick={()=>dispatch({type:"cancelEdit",id:s.id})} className="btn-ghost text-xs py-1.5 px-2.5">Cancel</button>
          </>
        ):(
          <>
            {s.applicable&&<button onClick={()=>onAccept(s,s.suggested_text)} disabled={busy} className="btn-primary text-xs py-1.5 px-3">
              {busy?<><Spinner size="sm"/>Applying…</>:<><Check className="w-3.5 h-3.5"/>{s.status==="failed"?"Retry":"Accept"}</>}</button>}
            {s.category==="missing_skill"&&s.skill&&(confirmSkill
              ?<button onClick={()=>onAddSkill(s)} disabled={busy||!s.confirmed} className="btn-primary text-xs py-1.5 px-3">
                {busy?<><Spinner size="sm"/>Adding…</>:<><Check className="w-3.5 h-3.5"/>{s.status==="failed"?"Retry":"Add to Skills"}</>}</button>
              :<button onClick={()=>setConfirmSkill(true)} className="btn-secondary text-xs py-1.5 px-3"><Check className="w-3.5 h-3.5"/>I have this skill…</button>)}
            {s.target&&<button onClick={()=>dispatch({type:"edit",id:s.id})} disabled={busy} className="btn-ghost text-xs py-1.5 px-2.5"><Pencil className="w-3.5 h-3.5"/>{s.suggested_text?"Edit":"Rewrite"}</button>}
          </>
        )}
        {copyText&&<button onClick={copy} className="btn-ghost text-xs py-1.5 px-2.5"><Copy className="w-3.5 h-3.5"/>{copied?"Copied":"Copy"}</button>}
        <button onClick={()=>dispatch({type:"reject",id:s.id})} disabled={busy} className="btn-ghost text-xs py-1.5 px-2.5"><X className="w-3.5 h-3.5"/>Reject</button>
        <button onClick={()=>dispatch({type:"dismiss",id:s.id})} disabled={busy} className="btn-ghost text-xs py-1.5 px-2.5 ml-auto" title="Hide this suggestion"><EyeOff className="w-3.5 h-3.5"/></button>
      </div>
    </motion.div>
  );
}

export default function SuggestionsPanel({data,setData,onCommit,defaultJobDescription="",analysis=null}){
  const[state,dispatch]=useReducer(suggestionsReducer,initialSuggestionsState);
  const[open,setOpen]=useState(true);
  const[jd,setJd]=useState(defaultJobDescription||"");
  const[showJd,setShowJd]=useState(false);
  const[showClosed,setShowClosed]=useState(false);

  const run=async()=>{
    dispatch({type:"request"});
    try{
      const{data:res}=await suggestionsAPI.generate(buildSuggestionRequest(data,{jobDescription:jd,analysis:jd.trim()===(defaultJobDescription||"").trim()?analysis:null}));
      dispatch({type:"success",suggestions:res.suggestions,summary:res.summary,engine:res.engine});
    }catch(err){dispatch({type:"failure",error:err.userMessage});}
  };
  // Commit a validated change: editor state (→ live preview) and, when the resume is stored, the save.
  // "Applied" only after that succeeds; a failed save is rolled back by onCommit and the card stays retryable.
  const commit=async(s,next)=>{
    dispatch({type:"applying",id:s.id});
    try{
      const r=onCommit?await onCommit(next,describeChange(data,next)):(setData(next),{saved:false});
      dispatch({type:"accepted",id:s.id,note:r?.note||""});
    }catch(err){dispatch({type:"commitFailed",id:s.id,reason:err?.message});}
  };
  // Accept / Save: apply to the editor only after the user acts, and only to the targeted line.
  const accept=(s,text)=>{
    if(s.status==="applying")return;
    const r=applySuggestion(data,s,text);
    if(r.ok)commit(s,r.data);
    else dispatch({type:"applyFailed",id:s.id,reason:r.reason});
  };
  // A job skill is added to Skills only after the user confirms they have it — nothing else is written.
  const addSkill=(s)=>{
    if(s.status==="applying"||!s.confirmed)return;
    const r=addSkills(data,[s.skill]);
    if(r.ok)commit(s,r.data);
    else dispatch({type:"applyFailed",id:s.id,reason:r.reason});
  };

  const pending=state.items.filter(isOpen);
  const closed=state.items.filter(s=>!isOpen(s));
  const count=k=>state.items.filter(s=>s.status===k).length;

  return(
    <div className="card overflow-hidden mb-3">
      <button onClick={()=>setOpen(o=>!o)} className="w-full flex items-center gap-2.5 px-4 py-3.5 text-left">
        <Sparkles className="w-4 h-4 text-brand-500 flex-shrink-0"/>
        <span className="text-sm font-semibold text-gray-800 dark:text-gray-200 flex-1">AI Suggestions</span>
        {state.status==="success"&&<span className="text-xs text-gray-400">{pending.length} open</span>}
        <ChevronDown className={`w-4 h-4 text-gray-300 dark:text-gray-600 transition-transform ${open?"rotate-180":""}`}/>
      </button>
      <AnimatePresence initial={false}>
        {open&&(
          <motion.div initial={{height:0,opacity:0}} animate={{height:"auto",opacity:1}} exit={{height:0,opacity:0}} transition={{duration:0.2}} style={{overflow:"hidden"}}>
            <div className="px-4 pb-4 pt-1 border-t border-gray-50 dark:border-gray-800 space-y-3">
              <p className="text-[11px] text-gray-400 leading-relaxed">
                Rule-based checks plus evidence retrieval over your own resume — not a generative AI. Runs locally; suggestions never invent numbers, tools or achievements, and nothing changes until you accept it.
              </p>
              <div>
                <button onClick={()=>setShowJd(v=>!v)} className="text-xs text-brand-500 hover:underline flex items-center gap-1">
                  <Briefcase className="w-3.5 h-3.5"/>{jd.trim()?"Target job description (added)":"Add a target job description (optional)"}
                </button>
                {showJd&&(
                  <textarea value={jd} onChange={e=>setJd(e.target.value)} rows={4} className="form-input text-xs mt-2 resize-y"
                    placeholder="Paste the job description to get job-specific suggestions…"/>
                )}
              </div>
              <button onClick={run} disabled={state.status==="loading"} className="btn-primary text-xs py-2 px-3 w-full justify-center">
                {state.status==="loading"?<><Spinner size="sm"/>Analyzing your resume…</>:<><Sparkles className="w-3.5 h-3.5"/>{state.status==="idle"?"Analyze my resume":"Re-analyze"}</>}
              </button>

              {state.status==="error"&&(
                <div role="alert" className="flex items-start gap-2 text-xs text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 border border-red-100 dark:border-red-800 rounded-lg px-3 py-2">
                  <AlertCircle className="w-4 h-4 flex-shrink-0"/>{state.error}
                </div>
              )}
              {state.status==="empty"&&(
                <p className="text-xs text-green-700 dark:text-green-400 bg-green-50 dark:bg-green-900/20 rounded-lg px-3 py-2">
                  No issues found — your bullets already read clearly. Add a job description to check job-specific gaps.
                </p>
              )}
              {state.status==="success"&&(
                <>
                  {(count("accepted")+count("rejected")+count("dismissed"))>0&&(
                    <div className="flex items-center gap-3 text-[11px] text-gray-400">
                      <span>{count("accepted")} accepted</span><span>{count("rejected")} rejected</span><span>{count("dismissed")} dismissed</span>
                      <button onClick={()=>setShowClosed(v=>!v)} className="ml-auto text-brand-500 hover:underline">{showClosed?"Hide":"Show"} closed</button>
                    </div>
                  )}
                  {pending.length===0&&<p className="text-xs text-gray-500 dark:text-gray-400">All suggestions reviewed. Re-analyze after editing to check again.</p>}
                  <AnimatePresence initial={false}>
                    {pending.map(s=><SuggestionCard key={s.id} s={s} dispatch={dispatch} onAccept={accept} onAddSkill={addSkill}/>)}
                  </AnimatePresence>
                  {showClosed&&closed.map(s=>(
                    <div key={s.id} className="flex items-center gap-2 text-xs text-gray-400 border border-dashed border-gray-200 dark:border-gray-700 rounded-lg px-3 py-2">
                      <span className="flex-1 truncate">{CATEGORY_LABELS[s.category]||s.category} — {s.original_text||s.reason}</span>
                      <span className="capitalize" title={s.note||""}>{s.status==="accepted"?"applied":s.status}</span>
                      {s.status!=="accepted"&&<button onClick={()=>dispatch({type:"restore",id:s.id})} title="Restore" className="hover:text-brand-500"><RotateCcw className="w-3.5 h-3.5"/></button>}
                    </div>
                  ))}
                </>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
