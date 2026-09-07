import React, { useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { Zap, ArrowRight, AlertCircle, Upload, Type, FileText, X, CheckCircle } from "lucide-react";
import { useDropzone } from "react-dropzone";
import { resumeAPI, analysisAPI, jdAPI } from "../services/api";
import { useAnalysis } from "../context/AnalysisContext";
import { useAuth }     from "../context/AuthContext";
import { Spinner }     from "../components/ui";

const STEPS=["Parsing your resume…","Extracting JD keywords…","Running skill gap analysis…","Calculating ATS score…","Generating suggestions…","Finalizing report…"];
const ACCEPTED={"application/pdf":[".pdf"],"application/vnd.openxmlformats-officedocument.wordprocessingml.document":[".docx"],"text/plain":[".txt"]};

function ResumeUpload() {
  const { setCurrentResume } = useAnalysis();
  const { user } = useAuth();
  const [file,setFile]=useState(null);
  const [uploading,setUploading]=useState(false);
  const [progress,setProgress]=useState(0);
  const [error,setError]=useState("");
  const [uploaded,setUploaded]=useState(false);

  const onDrop=useCallback(async(accepted,rejected)=>{
    if(rejected.length>0){setError("Invalid file type. Use PDF, DOCX, or TXT.");return;}
    const f=accepted[0];if(!f)return;
    setFile(f);setError("");setUploading(true);setProgress(0);
    try{
      const fn=user?resumeAPI.upload:resumeAPI.uploadAnon;
      const res=await fn(f,e=>setProgress(Math.round((e.loaded*100)/(e.total||1))));
      const rd=res.data.resume||res.data;
      setCurrentResume({...rd,parsedData:res.data.parsedData||rd.parsedData,rawText:res.data.text||rd.rawText});
      setUploaded(true);
    }catch(err){setError(err.userMessage||"Upload failed.");setFile(null);}
    finally{setUploading(false);}
  },[setCurrentResume,user]);

  const{getRootProps,getInputProps,isDragActive}=useDropzone({onDrop,accept:ACCEPTED,maxSize:10*1024*1024,multiple:false,disabled:uploading});
  const reset=()=>{setFile(null);setUploaded(false);setError("");setCurrentResume(null);};

  if(uploaded&&file) return (
    <motion.div initial={{opacity:0,scale:0.98}} animate={{opacity:1,scale:1}}
      className="flex items-center gap-3 p-4 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-xl">
      <div className="w-9 h-9 bg-green-100 dark:bg-green-800/50 rounded-lg flex items-center justify-center flex-shrink-0">
        <CheckCircle className="w-5 h-5 text-green-600 dark:text-green-400"/>
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-green-800 dark:text-green-300 truncate">{file.name}</p>
        <p className="text-xs text-green-600 dark:text-green-500">{(file.size/1024).toFixed(0)} KB · Parsed</p>
      </div>
      <button onClick={reset} className="p-1.5 rounded-lg hover:bg-green-100 dark:hover:bg-green-800 text-green-600 dark:text-green-400"><X className="w-4 h-4"/></button>
    </motion.div>
  );

  if(uploading&&file) return (
    <div className="p-4 border border-gray-200 dark:border-gray-700 rounded-xl">
      <div className="flex items-center gap-3 mb-3">
        <div className="w-9 h-9 bg-brand-50 dark:bg-brand-900/30 rounded-lg flex items-center justify-center">
          <FileText className="w-5 h-5 text-brand-500"/>
        </div>
        <div className="flex-1"><p className="text-sm font-medium text-gray-700 dark:text-gray-300 truncate">{file.name}</p><p className="text-xs text-gray-400">Parsing…</p></div>
        <Spinner size="sm"/>
      </div>
      <div className="h-1 bg-gray-100 dark:bg-gray-800 rounded-full overflow-hidden">
        <motion.div className="h-full bg-brand-500 rounded-full" initial={{width:0}} animate={{width:`${progress}%`}} transition={{duration:0.3}}/>
      </div>
    </div>
  );

  return (
    <div>
      <div {...getRootProps()} className={`drop-zone ${isDragActive?"active":""}`}>
        <input {...getInputProps()}/>
        <div className="w-12 h-12 bg-brand-50 dark:bg-brand-900/30 rounded-xl flex items-center justify-center mx-auto mb-4">
          <Upload className="w-6 h-6 text-brand-400"/>
        </div>
        <p className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{isDragActive?"Drop your resume here":"Upload your resume"}</p>
        <p className="text-xs text-gray-400 mb-4">Drag & drop or click to browse</p>
        <div className="flex items-center justify-center gap-2">
          {["PDF","DOCX","TXT"].map(t=><span key={t} className="px-2.5 py-1 bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400 text-xs font-medium rounded-md">{t}</span>)}
        </div>
      </div>
      {error&&<div className="mt-3 flex items-center gap-2 text-red-600 dark:text-red-400 text-sm"><AlertCircle className="w-4 h-4 flex-shrink-0"/>{error}</div>}
    </div>
  );
}

function JDInput() {
  const{jdText,setJdText}=useAnalysis();
  const[tab,setTab]=useState("paste");
  const[jdFile,setJdFile]=useState(null);
  const[loading,setLoading]=useState(false);
  const[error,setError]=useState("");

  const onDrop=async(accepted)=>{
    const f=accepted[0];if(!f)return;
    setLoading(true);setError("");
    try{const r=await jdAPI.upload(f);setJdText(r.data.rawText);setJdFile(f);}
    catch(err){setError(err.userMessage||"Failed to parse file.");}
    finally{setLoading(false);}
  };
  const{getRootProps,getInputProps,isDragActive}=useDropzone({onDrop,accept:ACCEPTED,multiple:false});

  return (
    <div>
      <div className="flex gap-1 p-1 bg-gray-100 dark:bg-gray-800 rounded-lg w-fit mb-4">
        {[["paste","Paste text",Type],["upload","Upload file",Upload]].map(([id,lbl,Icon])=>(
          <button key={id} onClick={()=>setTab(id)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all
              ${tab===id?"bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100 shadow-sm":"text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"}`}
          ><Icon className="w-3.5 h-3.5"/>{lbl}</button>
        ))}
      </div>
      {tab==="paste"&&(
        <div>
          <textarea value={jdText} onChange={e=>setJdText(e.target.value)}
            className="form-input min-h-[160px] resize-y text-sm leading-relaxed"
            placeholder={"Paste the full job description here…\n\nExample:\nWe are looking for a Senior React Developer with 5+ years of experience in JavaScript, TypeScript, Node.js, REST APIs, and cloud platforms like AWS…"}/>
          <div className="flex items-center justify-between mt-2">
            <p className="text-xs text-gray-400">{jdText.length.toLocaleString()} chars{jdText.length>0&&jdText.length<200&&<span className="text-amber-500 ml-2">· Paste full JD for best results</span>}</p>
            {jdText.length>=200&&<span className="text-xs text-green-600 dark:text-green-400 font-medium">✓ Good length</span>}
          </div>
        </div>
      )}
      {tab==="upload"&&(
        <div>
          {jdFile?(
            <div className="flex items-center gap-3 p-3 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-xl">
              <CheckCircle className="w-5 h-5 text-green-600 dark:text-green-400 flex-shrink-0"/>
              <div className="flex-1"><p className="text-sm font-medium text-green-800 dark:text-green-300">{jdFile.name}</p><p className="text-xs text-green-600 dark:text-green-500">{jdText.length} chars extracted</p></div>
              <button onClick={()=>{setJdFile(null);setJdText("");}} className="text-xs text-green-600 dark:text-green-400 hover:underline">Remove</button>
            </div>
          ):loading?(
            <div className="flex items-center justify-center gap-2 p-8 border border-gray-200 dark:border-gray-700 rounded-xl"><Spinner size="sm"/><span className="text-sm text-gray-500 dark:text-gray-400">Parsing…</span></div>
          ):(
            <div {...getRootProps()} className={`drop-zone ${isDragActive?"active":""}`}>
              <input {...getInputProps()}/>
              <Upload className="w-8 h-8 text-gray-300 dark:text-gray-600 mx-auto mb-3"/>
              <p className="text-sm text-gray-600 dark:text-gray-400 mb-1">Upload job description file</p>
              <p className="text-xs text-gray-400">PDF, DOCX, or TXT</p>
            </div>
          )}
          {error&&<p className="text-xs text-red-500 mt-2">{error}</p>}
        </div>
      )}
    </div>
  );
}

export default function AnalyzerPage() {
  const{currentResume,jdText,setCurrentAnalysis,isAnalyzing,setIsAnalyzing}=useAnalysis();
  const navigate=useNavigate();
  const[error,setError]=useState("");
  const[step,setStep]=useState(0);
  const canAnalyze=currentResume&&jdText.trim().length>=100;

  const handleAnalyze=async()=>{
    if(!currentResume){setError("Please upload your resume first.");return;}
    if(jdText.trim().length<100){setError("Please provide a more complete job description (100+ chars).");return;}
    setError("");setIsAnalyzing(true);setStep(0);
    const interval=setInterval(()=>setStep(s=>Math.min(s+1,STEPS.length-1)),900);
    try{
      const resumeId=currentResume._id||currentResume.resumeId;
      if(!resumeId){setError("Resume not saved. Please sign in to run analysis.");clearInterval(interval);setIsAnalyzing(false);return;}
      const res=await analysisAPI.run(resumeId,jdText);
      setCurrentAnalysis(res.data.analysis);
      clearInterval(interval);navigate("/dashboard");
    }catch(err){
      clearInterval(interval);
      setError(err.userMessage||"Analysis failed. Ensure the Python NLP service is running on port 8000.");
    }finally{setIsAnalyzing(false);setStep(0);}
  };

  return (
    <main className="max-w-2xl mx-auto px-4 py-10">
      <motion.div initial={{opacity:0,y:16}} animate={{opacity:1,y:0}} transition={{duration:0.4}}>
        <div className="mb-8">
          <h1 className="page-header">Analyze your resume</h1>
          <p className="page-sub">Upload your resume and paste the job description to get your AI-powered analysis.</p>
        </div>

        <div className="card p-5 mb-4">
          <div className="flex items-center gap-2 mb-4">
            <div className="w-6 h-6 bg-brand-500 text-white rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0">1</div>
            <h2 className="text-sm font-semibold text-gray-800 dark:text-gray-200">Upload your resume</h2>
          </div>
          <ResumeUpload/>
        </div>

        <div className="card p-5 mb-4">
          <div className="flex items-center gap-2 mb-4">
            <div className="w-6 h-6 bg-brand-500 text-white rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0">2</div>
            <h2 className="text-sm font-semibold text-gray-800 dark:text-gray-200">Add job description</h2>
          </div>
          <JDInput/>
        </div>

        {error&&<motion.div initial={{opacity:0}} animate={{opacity:1}} className="flex items-start gap-2.5 p-3.5 bg-red-50 dark:bg-red-900/20 border border-red-100 dark:border-red-800 rounded-xl mb-4 text-sm text-red-700 dark:text-red-400"><AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5"/>{error}</motion.div>}

        {isAnalyzing?(
          <div className="card p-8 text-center">
            <div className="w-12 h-12 bg-brand-50 dark:bg-brand-900/30 rounded-2xl flex items-center justify-center mx-auto mb-5"><Spinner size="lg"/></div>
            <p className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{STEPS[step]}</p>
            <p className="text-xs text-gray-400">This usually takes 15–30 seconds</p>
            <div className="flex justify-center gap-1 mt-5">
              {STEPS.map((_,i)=><div key={i} className={`h-1 rounded-full transition-all duration-300 ${i<=step?"bg-brand-500 w-5":"bg-gray-200 dark:bg-gray-700 w-3"}`}/>)}
            </div>
          </div>
        ):(
          <button onClick={handleAnalyze} disabled={!canAnalyze}
            className={`w-full flex items-center justify-center gap-2.5 py-3.5 rounded-xl text-base font-semibold transition-all duration-150
              ${canAnalyze?"bg-brand-500 text-white hover:bg-brand-600 shadow-sm hover:shadow-md active:scale-[0.99]":"bg-gray-100 dark:bg-gray-800 text-gray-400 cursor-not-allowed"}`}
          ><Zap className="w-5 h-5"/>Analyze My Resume{canAnalyze&&<ArrowRight className="w-4 h-4"/>}</button>
        )}
        {!canAnalyze&&!isAnalyzing&&<p className="text-xs text-center text-gray-400 mt-3">{!currentResume?"Upload your resume to continue":"Add a job description (100+ chars) to continue"}</p>}
      </motion.div>
    </main>
  );
}
