require("dotenv").config();
const express=require("express"),cors=require("cors"),helmet=require("helmet"),
  morgan=require("morgan"),mongoose=require("mongoose"),path=require("path"),
  fs=require("fs"),rateLimit=require("express-rate-limit");
const resumeRoutes=require("./routes/resume"),analysisRoutes=require("./routes/analysis"),
  authRoutes=require("./routes/auth"),jobDescRoutes=require("./routes/jobDescription");

const app=express(),PORT=process.env.PORT||5000;
const uploadsDir=path.join(__dirname,"uploads");
if(!fs.existsSync(uploadsDir))fs.mkdirSync(uploadsDir,{recursive:true});

app.use(helmet());
app.use(cors({origin:process.env.FRONTEND_URL||"*",credentials:true}));
app.use(morgan(process.env.NODE_ENV==="production"?"combined":"dev"));
app.use(express.json({limit:"10mb"}));
app.use(express.urlencoded({extended:true,limit:"10mb"}));
app.use("/uploads",express.static(uploadsDir));

const generalLimiter=rateLimit({windowMs:15*60*1000,max:100,standardHeaders:true,legacyHeaders:false,message:{error:"Too many requests. Please try again in 15 minutes."}});
app.use("/api/",generalLimiter);
const analysisLimiter=rateLimit({windowMs:60*60*1000,max:30,message:{error:"Analysis limit reached. Please try again in an hour."}});
app.use("/api/analysis/run",analysisLimiter);

app.get("/api/health",(req,res)=>res.json({status:"ok",service:"ResumeIQ v3",timestamp:new Date().toISOString(),mongo:mongoose.connection.readyState===1?"connected":"disconnected"}));
app.use("/api/auth",authRoutes);
app.use("/api/resume",resumeRoutes);
app.use("/api/analysis",analysisRoutes);
app.use("/api/jd",jobDescRoutes);

app.use((req,res)=>res.status(404).json({error:`Route not found: ${req.method} ${req.path}`}));
app.use((err,req,res,next)=>{
  console.error("❌ Unhandled error:",err.stack);
  res.status(err.status||500).json({error:process.env.NODE_ENV==="production"?"Internal server error":err.message||"Internal Server Error"});
});

const MONGO_URI=process.env.MONGODB_URI||"mongodb://127.0.0.1:27017/resumeiq";
mongoose.connect(MONGO_URI).then(()=>{
  console.log(`✅ MongoDB connected: ${MONGO_URI}`);
  app.listen(PORT,()=>{
    console.log(`🚀 ResumeIQ Backend v3 running on port ${PORT}`);
    console.log(`   NLP Service: ${process.env.NLP_SERVICE_URL||"http://localhost:8000"}`);
  });
}).catch(err=>{console.error("❌ MongoDB failed:",err.message);process.exit(1);});
module.exports=app;
