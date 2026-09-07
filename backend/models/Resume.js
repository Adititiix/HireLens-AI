const mongoose = require("mongoose");

const expSchema = new mongoose.Schema({id:String,title:String,company:String,location:String,
  startDate:String,endDate:String,current:{type:Boolean,default:false},description:String,bullets:[String]},{_id:false});
const eduSchema = new mongoose.Schema({id:String,degree:String,institution:String,location:String,
  startDate:String,endDate:String,gpa:String,honors:String},{_id:false});
const projSchema = new mongoose.Schema({id:String,name:String,description:String,technologies:[String],
  githubUrl:String,liveDemoUrl:String,additionalUrl:String},{_id:false});
const certSchema = new mongoose.Schema({id:String,name:String,provider:String,issueDate:String,
  credentialId:String,credentialUrl:String},{_id:false});
const achSchema = new mongoose.Schema({id:String,title:String,description:String,date:String},{_id:false});
// ADDITIVE (requirement #6): each link now optionally carries a `type` (LinkedIn/GitHub/Portfolio/
// LeetCode/Codeforces/HackerRank/Medium/Behance/Custom). Existing `label`/`url` keys are untouched
// so previously saved documents remain fully valid — this is purely additive, nothing renamed.
const linkSchema = new mongoose.Schema({type:String,label:String,url:String},{_id:false});

const resumeSchema = new mongoose.Schema({
  userId:{type:mongoose.Schema.Types.ObjectId,ref:"User",required:true,index:true},
  fileName:String,fileType:{type:String,enum:["pdf","docx","txt"]},
  rawText:{type:String,required:true},
  parsedData:{
    name:String,jobTitle:String,email:String,phone:String,location:String,
    linkedin:String,github:String,portfolio:String,leetcode:String,hackerrank:String,
    otherLinks:[linkSchema],
    summary:String,
    skills:{
      // ADDITIVE (requirement #2): new category set used by the redesigned Skills editor.
      programmingLanguages:[String],frameworks:[String],libraries:[String],databases:[String],
      cloud:[String],developerTools:[String],soft:[String],
      // LEGACY — preserved untouched for backward compatibility with previously saved resumes
      // and the NLP-extraction pipeline in resumeController.js. Nothing is renamed or removed.
      technical:[String],tools:[String],languages:[String],
    },
    experience:[expSchema],education:[eduSchema],projects:[projSchema],
    certifications:[certSchema],achievements:[achSchema],additionalInfo:String,
  },
  sectionOrder:{type:[String],default:["header","summary","skills","experience","projects",
    "certifications","education","achievements","additionalInfo"]},
  // Part 9 (prior revision): sections toggled off via the editor's eye icon — excluded from live preview/export
  hiddenSections:{type:[String],default:[]},
  // ADDITIVE (requirement #12): selected preview/print template. Only affects appearance — never
  // read by any content-parsing logic, so this cannot alter user content in any way.
  template:{type:String,default:"ats-classic"},
  extractedKeywords:[String],
  versions:[{savedAt:{type:Date,default:Date.now},label:String,snapshot:mongoose.Schema.Types.Mixed}],
},{timestamps:true});

resumeSchema.index({userId:1,createdAt:-1});
module.exports = mongoose.model("Resume",resumeSchema);
