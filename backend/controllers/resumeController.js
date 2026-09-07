const path     = require("path");
const pdfParse = require("pdf-parse");
const mammoth  = require("mammoth");
const axios    = require("axios");
const Resume   = require("../models/Resume");
const {getFileType}=require("../middleware/upload");
const NLP = process.env.NLP_SERVICE_URL||"http://localhost:8000";

async function parseFile(file){
  const ext=path.extname(file.originalname).toLowerCase();
  if(ext===".pdf"||file.mimetype==="application/pdf"){
    const d=await pdfParse(file.buffer);
    if(!d.text||d.text.trim().length<20)throw new Error("PDF appears image-based. Use a text-based PDF.");
    return d.text;
  }
  if(ext===".docx"||file.mimetype==="application/vnd.openxmlformats-officedocument.wordprocessingml.document"){
    const r=await mammoth.extractRawText({buffer:file.buffer});return r.value;
  }
  return file.buffer.toString("utf-8");
}

function uid(){return Date.now().toString(36)+Math.random().toString(36).slice(2);}

// ── FIX (requirement #1): recursive deep merge ────────────────────────────
// Replaces the old shallow spread `{...old,...new}` which silently wiped
// sibling keys inside nested objects (skills, experience entries, etc.)
// whenever a PUT only included a partial nested object. Arrays are treated
// as atomic values (the incoming array fully replaces the old one — this
// matches how the editor always sends complete arrays for lists like
// bullets/technologies/otherLinks, so no data is lost), while plain nested
// objects are merged key-by-key recursively so partial updates never
// clobber sibling fields they didn't intend to touch.
function isPlainObject(v){
  return v!==null && typeof v==="object" && !Array.isArray(v) && !(v instanceof Date);
}
function deepMerge(target, source){
  if(!isPlainObject(target)) target = {};
  const out = {...target};
  for(const key of Object.keys(source||{})){
    const sVal = source[key];
    const tVal = out[key];
    if(isPlainObject(sVal) && isPlainObject(tVal)){
      out[key] = deepMerge(tVal, sVal);
    } else {
      out[key] = sVal; // arrays, primitives, or new keys — assign directly
    }
  }
  return out;
}

function parseResumeText(text){
  const lines=text.split("\n").map(l=>l.trim()).filter(Boolean);
  const emailMatch=text.match(/[\w.\-]+@[\w.\-]+\.\w+/);
  const phoneMatch=text.match(/[\+]?[\d][\d\s\-\(\)]{7,}/);
  const linkedinMatch=text.match(/linkedin\.com\/in\/[\w\-]+/i);
  const githubMatch=text.match(/github\.com\/[\w\-]+/i);
  const nameLine=lines.find(l=>l.length>2&&l.length<60&&!l.includes("@")&&!/^\+?\d/.test(l)&&!l.startsWith("http"));

  const bullets=[];
  const exp=[];let curExp=null;
  const edu=[];let curEdu=null;
  const projs=[];let curProj=null;
  const certs=[];let curCert=null;

  const isExp=l=>/^(experience|work|employment|career)/i.test(l);
  const isEdu=l=>/^(education|academic|degree|qualification)/i.test(l);
  const isProj=l=>/^(project|portfolio)/i.test(l);
  const isCert=l=>/^(certification|certificate|credential|license)/i.test(l);
  const isSection=l=>isExp(l)||isEdu(l)||isProj(l)||isCert(l)||/^(skill|summary|objective|achievement|additional)/i.test(l);
  const isBullet=l=>/^[•\-*–]\s/.test(l)||/^\d+\.\s/.test(l);
  const isDate=l=>/(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec|\d{4})/i.test(l);

  let section="none";
  for(const line of lines){
    const ul=line.toLowerCase();
    if(isSection(line)){
      if(isExp(line))section="exp";
      else if(isEdu(line))section="edu";
      else if(isProj(line))section="proj";
      else if(isCert(line))section="cert";
      else section="other";
      if(curExp)exp.push(curExp);curExp=null;
      if(curEdu)edu.push(curEdu);curEdu=null;
      if(curProj)projs.push(curProj);curProj=null;
      continue;
    }
    if(section==="exp"){
      if(!isBullet(line)&&!isDate(line)&&line.length>3&&line.length<100){
        if(curExp)exp.push(curExp);
        curExp={id:uid(),title:line,company:"",location:"",startDate:"",endDate:"",current:false,description:"",bullets:[]};
      } else if(isBullet(line)&&curExp){
        curExp.bullets.push(line.replace(/^[•\-*–]\s*/,"").trim());
      } else if(isDate(line)&&curExp){
        const parts=line.split(/[-–—to]+/i).map(s=>s.trim());
        curExp.startDate=parts[0]||"";curExp.endDate=parts[1]||"Present";
      }
    } else if(section==="edu"){
      if(/b\.?s\.?|b\.?a\.?|m\.?s\.?|ph\.?d\.?|bachelor|master|associate|mba/i.test(line)){
        if(curEdu)edu.push(curEdu);
        curEdu={id:uid(),degree:line,institution:"",location:"",startDate:"",endDate:"",gpa:"",honors:""};
      } else if(curEdu){
        if(/gpa/i.test(line)){const m=line.match(/(\d+\.\d+)/);if(m)curEdu.gpa=m[1];}
        else if(isDate(line)){const p=line.split(/[-–]+/).map(s=>s.trim());curEdu.startDate=p[0];curEdu.endDate=p[1]||"";}
        else if(!curEdu.institution)curEdu.institution=line;
      }
    } else if(section==="proj"){
      if(!isBullet(line)&&line.length>2&&line.length<100){
        if(curProj)projs.push(curProj);
        curProj={id:uid(),name:line,description:"",technologies:[],githubUrl:"",liveDemoUrl:"",additionalUrl:""};
      } else if(curProj){
        if(/github\.com/i.test(line))curProj.githubUrl=line.trim();
        else if(isBullet(line))curProj.description+=(curProj.description?" ":"")+line.replace(/^[•\-*–]\s*/,"").trim();
      }
    } else if(section==="cert"){
      if(line.length>3){
        const yr=line.match(/\d{4}/);
        certs.push({id:uid(),name:line.replace(/\d{4}/,"").trim(),provider:"",issueDate:yr?yr[0]:"",credentialId:"",credentialUrl:""});
      }
    }
  }
  if(curExp)exp.push(curExp);
  if(curEdu)edu.push(curEdu);
  if(curProj)projs.push(curProj);

  const SKILL_KW=["python","javascript","typescript","java","react","node.js","aws","docker",
    "kubernetes","mongodb","postgresql","mysql","redis","git","agile","rest api","graphql",
    "machine learning","deep learning","tensorflow","pytorch","css","html","linux","sql","ci/cd"];
  const tl=text.toLowerCase();
  const technical=SKILL_KW.filter(s=>new RegExp("\\b"+s.replace(/\./g,"\\.")+"\\b").test(tl));

  return {
    name:nameLine||"",email:emailMatch?emailMatch[0]:"",phone:phoneMatch?phoneMatch[0]:"",
    location:"",linkedin:linkedinMatch?linkedinMatch[0]:"",github:githubMatch?githubMatch[0]:"",
    portfolio:"",leetcode:"",hackerrank:"",otherLinks:[],
    summary:"",
    skills:{
      // Seed the new "Programming Languages" category with the same detected list as a sensible
      // default landing spot (requirement #2). The other new categories start empty — the user
      // can move entries between chip groups manually. Legacy fields kept in sync for compatibility.
      programmingLanguages:technical,frameworks:[],libraries:[],databases:[],cloud:[],developerTools:[],soft:[],
      technical,tools:[],languages:[],
    },
    experience:exp,education:edu,projects:projs,certifications:certs,achievements:[],additionalInfo:"",
  };
}

exports.uploadResume=async(req,res,next)=>{
  try{
    if(!req.file)return res.status(400).json({error:"No file uploaded."});
    const text=await parseFile(req.file);
    let structured={resume_skills:[],jd_skills:[]};
    try{
      const r=await axios.post(`${NLP}/extract`,{resume_text:text,job_description:""},{timeout:15000});
      structured=r.data;
    }catch(e){console.warn("[resumeController] NLP /extract failed:",e.message);}
    const parsed=parseResumeText(text);
    const nlpSkills=structured.resume_skills||[];
    parsed.skills.technical=[...new Set([...parsed.skills.technical,...nlpSkills])];
    parsed.skills.programmingLanguages=[...new Set([...parsed.skills.programmingLanguages,...nlpSkills])];
    console.log("\n[ResumeUpload] Extracted Skills:");console.log(parsed.skills.technical);
    let doc=null;
    if(req.user){
      doc=await Resume.create({
        userId:req.user._id,rawText:text,parsedData:parsed,
        extractedKeywords:structured.resume_skills||[],
        fileName:req.file.originalname,fileType:getFileType(req.file.mimetype),
      });
    }
    res.json({success:true,text,structured,parsedData:parsed,resumeId:doc?._id||null,_id:doc?._id||null,resume:doc});
  }catch(err){next(err);}
};

exports.uploadResumeAnon=async(req,res,next)=>{
  try{
    if(!req.file)return res.status(400).json({error:"No file uploaded."});
    const text=await parseFile(req.file);
    let structured={resume_skills:[]};
    try{
      const r=await axios.post(`${NLP}/extract`,{resume_text:text,job_description:""},{timeout:15000});
      structured=r.data;
    }catch(e){}
    const parsed=parseResumeText(text);
    const nlpSkills=structured.resume_skills||[];
    parsed.skills.technical=[...new Set([...parsed.skills.technical,...nlpSkills])];
    parsed.skills.programmingLanguages=[...new Set([...parsed.skills.programmingLanguages,...nlpSkills])];
    res.json({success:true,text,parsedData:parsed,structured,resumeId:null,_id:null,resume:null});
  }catch(err){next(err);}
};

exports.listResumes=async(req,res,next)=>{
  try{
    const resumes=await Resume.find({userId:req.user._id})
      .select("fileName fileType parsedData.name extractedKeywords createdAt").sort({createdAt:-1});
    res.json({success:true,resumes});
  }catch(err){next(err);}
};

exports.getResume=async(req,res,next)=>{
  try{
    const r=await Resume.findOne({_id:req.params.id,userId:req.user._id});
    if(!r)return res.status(404).json({error:"Resume not found."});
    res.json({success:true,resume:r});
  }catch(err){next(err);}
};

exports.updateResume=async(req,res,next)=>{
  try{
    const r=await Resume.findOne({_id:req.params.id,userId:req.user._id});
    if(!r)return res.status(404).json({error:"Resume not found."});
    // FIX (requirement #1): recursive deep merge instead of shallow spread —
    // preserves sibling nested fields (skills categories, etc.) that a partial
    // save didn't include. API contract unchanged: still `req.body.parsedData`.
    if(req.body.parsedData)r.parsedData=deepMerge(r.parsedData.toObject(),req.body.parsedData);
    if(req.body.sectionOrder)r.sectionOrder=req.body.sectionOrder;
    if(req.body.hiddenSections)r.hiddenSections=req.body.hiddenSections; // Part 9: show/hide persistence
    if(req.body.template)r.template=req.body.template; // requirement #12: persisted template choice
    await r.save();res.json({success:true,resume:r});
  }catch(err){next(err);}
};

exports.deleteResume=async(req,res,next)=>{
  try{
    await Resume.findOneAndDelete({_id:req.params.id,userId:req.user._id});
    res.json({success:true,message:"Resume deleted."});
  }catch(err){next(err);}
};

exports.saveVersion=async(req,res,next)=>{
  try{
    const r=await Resume.findOne({_id:req.params.id,userId:req.user._id});
    if(!r)return res.status(404).json({error:"Resume not found."});
    r.versions.push({savedAt:new Date(),label:req.body.label||`Version ${r.versions.length+1}`,snapshot:r.parsedData});
    if(r.versions.length>10)r.versions=r.versions.slice(-10);
    await r.save();res.json({success:true,versions:r.versions});
  }catch(err){next(err);}
};

exports.uploadJobDescription=async(req,res,next)=>{
  try{
    if(!req.file)return res.status(400).json({error:"No file uploaded."});
    const text=await parseFile(req.file);
    let keywords=[];
    try{
      const r=await axios.post(`${NLP}/extract`,{resume_text:"",job_description:text},{timeout:15000});
      keywords=r.data.jd_skills||[];
    }catch(e){}
    console.log("\n[JD Upload] JD Skills:");console.log(keywords);
    res.json({success:true,rawText:text,keywords,wordCount:text.split(/\s+/).length});
  }catch(err){next(err);}
};
