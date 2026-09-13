import React,{useState,useEffect}from"react";
import{Link,useNavigate}from"react-router-dom";
import{motion}from"framer-motion";
import{Clock,Target,Bot,ArrowRight,TrendingUp,FileText}from"lucide-react";
import{analysisAPI}from"../services/api";
import{useAuth}from"../context/AuthContext";
import{useAnalysis}from"../context/AnalysisContext";
import{Spinner}from"../components/ui";

function ScoreBadge({score}){
  const c=score>=80?"bg-green-50 text-green-700 dark:bg-green-900/20 dark:text-green-400":score>=60?"bg-amber-50 text-amber-700 dark:bg-amber-900/20 dark:text-amber-400":"bg-red-50 text-red-700 dark:bg-red-900/20 dark:text-red-400";
  return<span className={`text-sm font-bold tabular-nums px-2 py-0.5 rounded-lg ${c}`}>{score}%</span>;
}

function ComparePanel({a,b,onClose}){
  if(!a||!b)return null;
  const metrics=[
    ["Overall Match",a.scores?.overall||0,b.scores?.overall||0],
    ["ATS Score",a.scores?.ats||0,b.scores?.ats||0],
    ["Skill Match",a.scores?.skillMatch||0,b.scores?.skillMatch||0],
    ["Semantic",a.scores?.semanticScore||0,b.scores?.semanticScore||0],
  ];
  return(
    <motion.div initial={{opacity:0,y:12}} animate={{opacity:1,y:0}} className="card p-6 mb-6">
      <div className="flex items-center justify-between mb-5">
        <h3 className="text-base font-semibold text-gray-900 dark:text-white flex items-center gap-2"><TrendingUp className="w-4 h-4 text-brand-500"/>Score Comparison</h3>
        <button onClick={onClose} className="text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-200">Clear</button>
      </div>
      <div className="grid grid-cols-3 gap-4 mb-4 text-center">
        <div className="text-xs text-gray-400 truncate">{a.resume?.fileName||"Analysis A"}</div>
        <div className="text-xs font-semibold text-gray-500">vs</div>
        <div className="text-xs text-gray-400 truncate">{b.resume?.fileName||"Analysis B"}</div>
      </div>
      {metrics.map(([label,va,vb])=>{
        const diff=vb-va;
        const dc=diff>0?"text-green-600 dark:text-green-400":diff<0?"text-red-600 dark:text-red-400":"text-gray-400";
        return(
          <div key={label} className="flex items-center gap-3 py-2.5 border-b border-gray-50 dark:border-gray-800 last:border-0">
            <span className="text-sm text-gray-600 dark:text-gray-400 w-32 flex-shrink-0">{label}</span>
            <div className="flex items-center gap-2 flex-1">
              <ScoreBadge score={va}/>
              <div className="flex-1 relative h-1.5 bg-gray-100 dark:bg-gray-800 rounded-full overflow-hidden">
                <div className="absolute h-full bg-gray-300 dark:bg-gray-700 rounded-full" style={{width:`${va}%`}}/>
                <div className="absolute h-full bg-brand-500 rounded-full opacity-70" style={{width:`${vb}%`}}/>
              </div>
              <ScoreBadge score={vb}/>
              {diff!==0&&<span className={`text-xs font-semibold tabular-nums w-10 text-right ${dc}`}>{diff>0?"+":""}{diff}%</span>}
            </div>
          </div>
        );
      })}
    </motion.div>
  );
}

export default function HistoryPage(){
  const{user}=useAuth();
  const{setCurrentAnalysis,setCurrentResume}=useAnalysis();
  const navigate=useNavigate();
  const[analyses,setAnalyses]=useState([]);
  const[loading,setLoading]=useState(true);
  const[selected,setSelected]=useState([]);
  const[error,setError]=useState("");
  const[viewingId,setViewingId]=useState(null);
  const[viewError,setViewError]=useState("");

  useEffect(()=>{
    if(!user){setLoading(false);return;}
    analysisAPI.list()
      .then(r=>setAnalyses(r.data.analyses||[]))
      .catch(e=>setError(e.userMessage||"Failed to load history"))
      .finally(()=>setLoading(false));
  },[user]);

  // TASK 8 FIX: previously this only called setCurrentAnalysis(a) with the
  // SUMMARY object from the list (missing improvements/atsExplanation/
  // atsBreakdown) and never navigated anywhere — so the button appeared to
  // do nothing. It now fetches the FULL, correct analysis by its own _id
  // (GET /api/analysis/detail/:id — read-only, does NOT call
  // POST /api/analysis/run, so no new analysis or history record is ever
  // created) and navigates to the Results page to display it.
  const handleView=async(analysisId)=>{
    setViewingId(analysisId);
    setViewError("");
    try{
      const res=await analysisAPI.getById(analysisId);
      const full=res.data.analysis;
      setCurrentAnalysis(full);
      if(full.resume && typeof full.resume==="object"){
        // resume was populated (fileName + parsedData) by the backend — makes
        // "Edit My Resume" on the Results page load the correct resume too.
        setCurrentResume(prev=>({ ...(prev||{}), _id: full.resume._id, parsedData: full.resume.parsedData, fileName: full.resume.fileName }));
      }
      navigate("/dashboard");
    }catch(e){
      setViewError(e.userMessage||"Failed to load this analysis.");
    }finally{
      setViewingId(null);
    }
  };

  const toggleSelect=(id)=>{
    setSelected(prev=>{
      if(prev.includes(id))return prev.filter(x=>x!==id);
      if(prev.length>=2)return[prev[1],id];
      return[...prev,id];
    });
  };

  const compareA=analyses.find(a=>a._id===selected[0]);
  const compareB=analyses.find(a=>a._id===selected[1]);

  if(!user)return(
    <main className="max-w-2xl mx-auto px-4 py-16 text-center">
      <div className="card p-12">
        <Clock className="w-10 h-10 text-gray-300 dark:text-gray-600 mx-auto mb-4"/>
        <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-3">Sign in to view history</h2>
        <p className="text-gray-500 dark:text-gray-400 mb-6">Your analysis history is saved when you're signed in.</p>
        <Link to="/login" className="btn-primary inline-flex mx-auto">Sign in<ArrowRight className="w-4 h-4"/></Link>
      </div>
    </main>
  );

  return(
    <main className="max-w-3xl mx-auto px-4 py-8">
      <div className="mb-6">
        <h1 className="page-header">Analysis History</h1>
        <p className="page-sub">Select two analyses to compare scores side by side.</p>
      </div>

      {selected.length===2&&<ComparePanel a={compareA} b={compareB} onClose={()=>setSelected([])}/>}

      {loading&&<div className="flex justify-center py-12"><Spinner size="lg"/></div>}
      {error&&<div className="card p-6 text-center text-red-600 dark:text-red-400">{error}</div>}
      {viewError&&<div className="mb-4 text-sm text-red-600 dark:text-red-400 text-center">{viewError}</div>}

      {!loading&&analyses.length===0&&(
        <div className="card p-12 text-center">
          <Clock className="w-10 h-10 text-gray-300 dark:text-gray-600 mx-auto mb-4"/>
          <h3 className="text-base font-medium text-gray-700 dark:text-gray-300 mb-2">No analyses yet</h3>
          <p className="text-sm text-gray-400 mb-6">Run your first analysis to see it here.</p>
          <Link to="/analyze" className="btn-primary inline-flex mx-auto">Analyze Resume<ArrowRight className="w-4 h-4"/></Link>
        </div>
      )}

      <div className="space-y-3">
        {analyses.map((a,i)=>{
          const sel=selected.includes(a._id);
          const selIdx=selected.indexOf(a._id);
          const score=a.scores?.overall||0;
          const date=new Date(a.createdAt).toLocaleDateString("en-US",{month:"short",day:"numeric",year:"numeric"});
          return(
            <motion.div key={a._id} initial={{opacity:0,y:8}} animate={{opacity:1,y:0}} transition={{delay:i*0.04}}
              className={`card p-4 transition-all cursor-pointer ${sel?"ring-2 ring-brand-500 dark:ring-brand-400":""}`}
            >
              <div className="flex items-center gap-4">
                <input type="checkbox" checked={sel} onChange={()=>toggleSelect(a._id)}
                  className="w-4 h-4 accent-brand-500 rounded flex-shrink-0"
                  title="Select for comparison"
                />
                {sel&&<span className={`text-xs font-bold px-2 py-0.5 rounded-full ${selIdx===0?"bg-brand-100 text-brand-700 dark:bg-brand-900/40 dark:text-brand-400":"bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-400"}`}>{selIdx===0?"A":"B"}</span>}
                <div className="w-9 h-9 bg-gray-50 dark:bg-gray-800 rounded-lg flex items-center justify-center flex-shrink-0">
                  <FileText className="w-5 h-5 text-gray-400"/>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-800 dark:text-gray-200 truncate">{a.resume?.fileName||"Resume"}</p>
                  <p className="text-xs text-gray-400 mt-0.5">{a.jobDescription?.title||"Position"} · {date}</p>
                </div>
                <div className="flex items-center gap-4 flex-shrink-0">
                  <div className="text-right hidden sm:block">
                    <p className="text-xs text-gray-400">Matched</p>
                    <p className="text-sm font-semibold text-gray-700 dark:text-gray-300">{a.skillGap?.matched?.length||0}/{(a.skillGap?.matched?.length||0)+(a.skillGap?.missing?.length||0)}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <ScoreBadge score={score}/>
                    <button onClick={()=>handleView(a._id)} disabled={viewingId===a._id}
                      className="btn-secondary text-xs py-1.5 px-3 disabled:opacity-60">
                      {viewingId===a._id?<Spinner size="sm"/>:<>View<ArrowRight className="w-3 h-3"/></>}
                    </button>
                  </div>
                </div>
              </div>
            </motion.div>
          );
        })}
      </div>
    </main>
  );
}
