const express=require("express");
const{protect}=require("../middleware/auth");
const{upload,handleUploadError}=require("../middleware/upload");
const c=require("../controllers/resumeController");
const{getSuggestions}=require("../controllers/suggestionController");
const router=express.Router();
router.post("/upload-anon",upload.single("resume"),handleUploadError,c.uploadResumeAnon);
// Like upload-anon, usable from the editor without an account: it only reads the resume
// data sent in the request and stores nothing. Rate-limited in server.js.
router.post("/suggestions",getSuggestions);
router.use(protect);
router.post("/upload",upload.single("resume"),handleUploadError,c.uploadResume);
router.get("/",c.listResumes);
router.get("/:id",c.getResume);
router.put("/:id",c.updateResume);
router.delete("/:id",c.deleteResume);
router.post("/:id/version",c.saveVersion);
module.exports=router;
