const multer=require("multer");
const MAX=parseInt(process.env.MAX_FILE_SIZE_MB||"10");
const TYPES={"application/pdf":"pdf","application/vnd.openxmlformats-officedocument.wordprocessingml.document":"docx","application/msword":"docx","text/plain":"txt"};
const upload=multer({storage:multer.memoryStorage(),fileFilter:(req,file,cb)=>TYPES[file.mimetype]?cb(null,true):cb(new Error(`Unsupported type: ${file.mimetype}. Use PDF, DOCX, or TXT.`),false),limits:{fileSize:MAX*1024*1024}});
const handleUploadError=(err,req,res,next)=>{
  if(err instanceof multer.MulterError)return res.status(400).json({error:err.code==="LIMIT_FILE_SIZE"?`File too large. Max ${MAX}MB.`:`Upload error: ${err.message}`});
  if(err)return res.status(400).json({error:err.message});
  next();
};
const getFileType=(mimetype)=>TYPES[mimetype]||"txt";
module.exports={upload,handleUploadError,getFileType};
