import React,{createContext,useContext,useState}from"react";
const AnalysisContext=createContext(null);
export function AnalysisProvider({children}){
  const[currentResume,setCurrentResume]=useState(null);
  const[currentAnalysis,setCurrentAnalysis]=useState(null);
  const[jdText,setJdText]=useState("");
  const[isAnalyzing,setIsAnalyzing]=useState(false);
  const clearAll=()=>{setCurrentResume(null);setCurrentAnalysis(null);setJdText("");};
  return<AnalysisContext.Provider value={{currentResume,setCurrentResume,currentAnalysis,setCurrentAnalysis,jdText,setJdText,isAnalyzing,setIsAnalyzing,clearAll}}>{children}</AnalysisContext.Provider>;
}
export const useAnalysis=()=>{const c=useContext(AnalysisContext);if(!c)throw new Error("useAnalysis outside AnalysisProvider");return c;};
