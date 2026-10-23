import React from"react";
import{motion}from"framer-motion";
import{applyImprovement,describeChange,improvementKind,improvementSkills}from"../../utils/suggestions";
import{collectTechnicalSkills,hasSkill}from"../../utils/skillCategories";

/* ── Analysis tip inside an editor section (legacy /analyze improvement) ──
   Controlled: everything it shows comes from ITS OWN item in the tips reducer (`tip.status`, `tip.note`,
   `tip.confirmed`), so applying one tip can never change another tip's actions.
   "Applied" means the resume data changed (and, for a stored resume, was saved) — never just a clicked button.
   Lifecycle: pending → applying → accepted | failed (rolled back, retryable); rejected leaves the resume unchanged. */

/** Accept `tip`: validate against the current resume, then commit; every transition is dispatched for this id only. */
export async function acceptTip(tip,data,dispatch,onCommit){
  const kind=improvementKind(tip);
  if(tip.status==="applying"||tip.status==="accepted")return;                // no double submission
  // Replacing the user's own summary needs an explicit second click.
  if(kind==="summary"&&data.summary?.trim()&&!tip.confirmed){dispatch({type:"confirm",id:tip.id,value:true});return;}
  if(kind==="skills"&&!tip.confirmed){dispatch({type:"applyFailed",id:tip.id,reason:"Confirm that you have actually used this skill."});return;}
  const r=applyImprovement(data,tip,{skills:improvementSkills(tip)});
  if(!r.ok){dispatch({type:"applyFailed",id:tip.id,reason:r.reason});return;}
  dispatch({type:"applying",id:tip.id});
  try{const c=await onCommit(r.data,describeChange(data,r.data));dispatch({type:"accepted",id:tip.id,note:c?.note||""});}
  catch(err){dispatch({type:"commitFailed",id:tip.id,reason:err?.message||"Could not apply the change."});}
}

export default function AnalysisTip({tip,data,dispatch,onCommit}){
  const kind=improvementKind(tip);
  const status=tip.status;
  const busy=status==="applying";
  const skill=kind==="skills"?improvementSkills(tip)[0]:null;
  const alreadyHave=skill&&hasSkill(collectTechnicalSkills(data.skills),skill);
  if(status==="rejected"||status==="dismissed")return(
    <div className="flex items-center gap-2 text-xs text-gray-400 border border-dashed border-gray-200 dark:border-gray-700 rounded-xl px-3 py-2 mb-3">
      <span className="flex-1">Suggestion rejected — your resume was not changed.</span>
      <button onClick={()=>dispatch({type:"restore",id:tip.id})} className="text-brand-500 hover:underline">Undo</button>
    </div>
  );
  const label=busy?"Applying…":status==="failed"?"Retry":kind==="skills"?"Add to Skills →":kind==="summary"&&tip.confirmed?"Replace summary →":"Apply suggestion →";
  return(
    <motion.div initial={{opacity:0,y:-4}} animate={{opacity:1,y:0}} data-tip-id={tip.id} data-status={status}
      className="flex items-start gap-2.5 p-3 bg-brand-50 dark:bg-brand-900/20 border border-brand-100 dark:border-brand-800 rounded-xl mb-3">
      <span className="text-base flex-shrink-0 mt-0.5">✨</span>
      <div className="flex-1 min-w-0">
        <p className="text-xs text-brand-700 dark:text-brand-300 leading-relaxed">AI: {tip.suggestion}</p>
        {kind==="skills"&&status!=="accepted"&&!alreadyHave&&(
          <label className="flex items-center gap-2 text-xs text-gray-700 dark:text-gray-300 mt-2">
            <input type="checkbox" disabled={busy} checked={!!tip.confirmed} onChange={e=>dispatch({type:"confirm",id:tip.id,value:e.target.checked})}/>
            I have actually used {skill}
          </label>
        )}
        {kind==="summary"&&tip.confirmed&&status==="pending"&&<p className="text-[11px] text-amber-600 dark:text-amber-400 mt-1.5">This replaces your current summary. Click again to confirm.</p>}
        {tip.note&&<p className={`text-[11px] mt-1.5 ${status==="accepted"?"text-gray-500 dark:text-gray-400":"text-red-600 dark:text-red-400"}`}>{tip.note}</p>}
        {status==="accepted"?(
          <span className="text-xs text-green-600 dark:text-green-400 font-medium mt-1.5 block">✓ Applied{kind==="skills"?" to Skills":""}</span>
        ):alreadyHave?(
          <p className="text-[11px] text-gray-400 mt-1.5">{skill} is already in your Skills.</p>
        ):kind?(
          <div className="flex items-center gap-3 mt-1.5">
            <button data-action="apply" onClick={()=>acceptTip(tip,data,dispatch,onCommit)} disabled={busy||(kind==="skills"&&!tip.confirmed)}
              className="text-xs text-brand-600 font-semibold hover:underline disabled:opacity-40 disabled:no-underline">{label}</button>
            <button data-action="reject" onClick={()=>dispatch({type:"reject",id:tip.id})} disabled={busy} className="text-xs text-gray-400 hover:text-gray-600">Reject</button>
          </div>
        ):(
          <p className="text-[11px] text-gray-400 mt-1.5">Tip only — edit this section yourself.</p>
        )}
      </div>
    </motion.div>
  );
}
