const jwt=require("jsonwebtoken"),User=require("../models/User");
const protect=async(req,res,next)=>{
  try{
    const auth=req.headers.authorization;
    if(!auth||!auth.startsWith("Bearer "))return res.status(401).json({error:"No token provided."});
    let decoded;
    try{decoded=jwt.verify(auth.split(" ")[1],process.env.JWT_SECRET);}
    catch(e){return res.status(401).json({error:e.name==="TokenExpiredError"?"Session expired. Please log in again.":"Invalid token."});}
    const user=await User.findById(decoded.id);
    if(!user)return res.status(401).json({error:"User no longer exists."});
    req.user=user;next();
  }catch(e){res.status(500).json({error:"Authentication error."});}
};
const generateToken=(id)=>jwt.sign({id},process.env.JWT_SECRET,{expiresIn:process.env.JWT_EXPIRES_IN||"7d"});
module.exports={protect,generateToken};
