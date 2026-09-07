const mongoose = require("mongoose");

const improvementSchema = new mongoose.Schema({
  section:String,type:String,
  priority:{type:String,enum:["high","medium","low"],default:"medium"},
  original:String,suggestion:String,reasoning:String,
  applied:{type:Boolean,default:false},
},{_id:false});

const kwSchema = new mongoose.Schema({
  keyword:String,inResume:Boolean,inJD:Boolean,
  relevanceScore:Number,category:String,
  priority:{type:String,enum:["high","medium","low"],default:"low"},
},{_id:false});

const analysisSchema = new mongoose.Schema({
  user:{type:mongoose.Schema.Types.ObjectId,ref:"User",required:true,index:true},
  resume:{type:mongoose.Schema.Types.ObjectId,ref:"Resume",required:true},
  jobDescription:{rawText:{type:String,required:true},title:String,keywords:[String],requiredSkills:[String],preferredSkills:[String]},
  scores:{overall:Number,ats:Number,skillMatch:Number,keywordScore:Number,semanticScore:Number,
          formattingScore:Number,sectionCompleteness:Number,actionVerbStrength:Number,contentQuality:Number,
          // Part 8: full per-resume-section ATS breakdown (summary/experience/skills/projects/education).
          // Additive field — existing scalar fields above are unchanged and still populated.
          sectionScores:{summary:Number,experience:Number,skills:Number,projects:Number,education:Number}},
  skillGap:{
    matched:[String],missing:[String],partial:[String],resumeSkills:[String],jdSkills:[String],
    matchPercentage:Number,
    priorityMap:{high:[String],medium:[String],low:[String]},
    highMissing:[String],mediumMissing:[String],lowMissing:[String],
  },
  atsExplanation:String,
  improvements:[improvementSchema],
  keywordOverlap:[kwSchema],
  atsBreakdown:{missingRequiredSections:[String],formattingIssues:[String],keywordOptimizationTips:[String],passedChecks:[String]},
  status:{type:String,enum:["pending","running","completed","failed"],default:"pending"},
  error:String,
},{timestamps:true});

analysisSchema.index({resume:1,createdAt:-1});
analysisSchema.index({user:1,createdAt:-1});
module.exports = mongoose.model("Analysis",analysisSchema);
