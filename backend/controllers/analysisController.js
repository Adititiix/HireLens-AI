const axios    = require("axios");
const Analysis = require("../models/Analysis");
const Resume   = require("../models/Resume");
const User     = require("../models/User");
const NLP = process.env.NLP_SERVICE_URL || "http://localhost:8000";

function mapNLP(nlp, jdText) {
  const priority = nlp.priority_map || {high:[],medium:[],low:[]};
  const allKw = [...new Set([...(nlp.matched_skills||[]),...(nlp.missing_skills||[]),...(nlp.partial_skills||[])])];
  const keywordOverlap = allKw.map(kw=>({
    keyword:kw, inResume:(nlp.matched_skills||[]).includes(kw)||(nlp.partial_skills||[]).includes(kw),
    inJD:true, relevanceScore:(nlp.matched_skills||[]).includes(kw)?1.0:0.5,
    category:"technical",
    priority:priority.high.includes(kw)?"high":priority.medium.includes(kw)?"medium":"low",
  }));
  const improvements=(nlp.suggestions||[]).map(s=>({
    section:s.section||"General",type:s.type||"bullet_rewrite",priority:"medium",
    original:s.original||"",suggestion:s.suggested||s.suggestion||"",reasoning:s.reason||"",applied:false,
  }));
  const atsIssues=nlp.ats_issues||[];
  return {
    scores:{overall:nlp.match_score||0,ats:nlp.ats_score||0,skillMatch:nlp.keyword_score||0,
            keywordScore:nlp.keyword_score||0,semanticScore:nlp.semantic_score||0,
            formattingScore:nlp.formatting_score||0,
            sectionCompleteness:nlp.section_scores?.skills||0,
            actionVerbStrength:nlp.section_scores?.experience||0,
            contentQuality:nlp.match_score||0,
            // Part 8: pass through the full per-section breakdown (additive, doesn't replace the above)
            sectionScores:{
              summary:nlp.section_scores?.summary||0,
              experience:nlp.section_scores?.experience||0,
              skills:nlp.section_scores?.skills||0,
              projects:nlp.section_scores?.projects||0,
              education:nlp.section_scores?.education||0,
            }},
    skillGap:{matched:nlp.matched_skills||[],missing:nlp.missing_skills||[],
              partial:nlp.partial_skills||[],resumeSkills:nlp.resume_skills||[],
              jdSkills:nlp.jd_skills||[],matchPercentage:nlp.match_score||0,
              priorityMap:priority,highMissing:nlp.high_missing||[],
              mediumMissing:nlp.medium_missing||[],lowMissing:nlp.low_missing||[]},
    atsExplanation:nlp.explanation||"",
    improvements,keywordOverlap,
    atsBreakdown:{
      missingRequiredSections:atsIssues.filter(i=>i.type==="missing_section").map(i=>i.message),
      formattingIssues:atsIssues.filter(i=>i.type!=="missing_section").map(i=>i.message),
      keywordOptimizationTips:[],passedChecks:nlp.passed_checks||[],
    },
    jobDescription:{rawText:jdText,keywords:nlp.jd_skills||[],requiredSkills:nlp.jd_skills||[]},
  };
}

exports.runAnalysis = async(req,res)=>{
  const{resumeId,jdText}=req.body;
  if(!resumeId||!jdText?.trim())return res.status(400).json({error:"resumeId and jdText are required."});
  if(jdText.trim().length<50)return res.status(400).json({error:"Job description too short."});
  const resume=await Resume.findOne({_id:resumeId,userId:req.user._id});
  if(!resume)return res.status(404).json({error:"Resume not found."});
  const analysis=await Analysis.create({user:req.user._id,resume:resume._id,
    jobDescription:{rawText:jdText},status:"running"});
  try{
    const{data:nlp}=await axios.post(`${NLP}/analyze`,
      {resume_text:resume.rawText,job_description:jdText},{timeout:60000});
    const mapped=mapNLP(nlp,jdText);
    Object.assign(analysis,mapped);analysis.status="completed";await analysis.save();
    await User.findByIdAndUpdate(req.user._id,{$inc:{analysisCount:1}});
    res.json({success:true,analysis});
  }catch(err){
    analysis.status="failed";analysis.error=err.message;await analysis.save();
    res.status(503).json({error:"Analysis failed. Ensure Python NLP service is running on port 8000.",detail:err.message});
  }
};

exports.getAnalysis=async(req,res)=>{
  try{
    const a=await Analysis.findOne({resume:req.params.resumeId,user:req.user._id,status:"completed"}).sort({createdAt:-1});
    if(!a)return res.status(404).json({error:"No completed analysis found."});
    res.json({success:true,analysis:a});
  }catch(err){res.status(500).json({error:"Failed to fetch analysis."});}
};

exports.listAnalyses=async(req,res)=>{
  try{
    const analyses=await Analysis.find({user:req.user._id,status:"completed"})
      .select("scores skillGap jobDescription createdAt resume")
      .populate("resume","fileName").sort({createdAt:-1}).limit(20);
    res.json({success:true,analyses});
  }catch(err){res.status(500).json({error:"Failed to list analyses."});}
};
