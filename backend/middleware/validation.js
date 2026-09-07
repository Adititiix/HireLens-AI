const{validationResult}=require("express-validator");
const validateRequest=(req,res,next)=>{
  const errors=validationResult(req);
  if(!errors.isEmpty())return res.status(422).json({error:"Validation failed",details:errors.array().map(e=>({field:e.path,message:e.msg}))});
  next();
};
module.exports={validateRequest};
