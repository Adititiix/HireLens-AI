const express = require("express");
const {protect}=require("../middleware/auth");
const{runAnalysis,getAnalysis,listAnalyses}=require("../controllers/analysisController");
const router=express.Router();
router.use(protect);
router.post("/run",runAnalysis);
router.get("/history",listAnalyses);
router.get("/:resumeId",getAnalysis);
module.exports=router;
