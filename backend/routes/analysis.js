const express = require("express");
const {protect}=require("../middleware/auth");
const{runAnalysis,getAnalysis,getAnalysisById,listAnalyses}=require("../controllers/analysisController");
const router=express.Router();
router.use(protect);
router.post("/run",runAnalysis);
router.get("/history",listAnalyses);
// TASK 8 FIX: must be registered BEFORE the "/:resumeId" wildcard below —
// otherwise Express would match "/detail/<id>" as resumeId="detail" and
// never reach this handler at all.
router.get("/detail/:id",getAnalysisById);
router.get("/:resumeId",getAnalysis);
module.exports=router;
