const express=require("express");
const axios=require("axios");
const{protect}=require("../middleware/auth");
const{upload,handleUploadError}=require("../middleware/upload");
const{uploadJobDescription}=require("../controllers/resumeController");
const NLP=process.env.NLP_SERVICE_URL||"http://localhost:8000";
const router=express.Router();
router.use(protect);
router.post("/upload",upload.single("file"),handleUploadError,uploadJobDescription);
router.post("/parse",async(req,res)=>{
  try{
    const{text}=req.body;
    if(!text?.trim())return res.status(400).json({error:"text is required."});
    let keywords=[];
    try{
      const r=await axios.post(`${NLP}/extract`,{resume_text:"",job_description:text},{timeout:15000});
      keywords=r.data.jd_skills||[];
    }catch{
      const SKILLS=["python","javascript","typescript","java","react","node.js","express","django","flask",
        "aws","azure","gcp","docker","kubernetes","terraform","mongodb","postgresql","redis","graphql","rest api",
        "git","github","ci/cd","machine learning","deep learning","sql"];
      const lower=text.toLowerCase();
      keywords=SKILLS.filter(s=>new RegExp("\\b"+s.replace(".","\\.")+"\\b").test(lower));
    }
    console.log("\n[JD Parse] JD Skills:");console.log(keywords);
    res.json({success:true,rawText:text,keywords,wordCount:text.split(/\s+/).length});
  }catch(err){res.status(500).json({error:"Failed to parse JD."});}
});
module.exports=router;
