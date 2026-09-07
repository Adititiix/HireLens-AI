const User=require("../models/User");const{generateToken}=require("../middleware/auth");
const register=async(req,res)=>{
  try{
    const{name,email,password}=req.body;
    if(await User.findOne({email}))return res.status(409).json({error:"An account with this email already exists."});
    const user=await User.create({name,email,password});const token=generateToken(user._id);
    res.status(201).json({message:"Account created",token,user:user.toJSON()});
  }catch(err){console.error("Register:",err);res.status(500).json({error:"Registration failed."});}
};
const login=async(req,res)=>{
  try{
    const{email,password}=req.body;
    const user=await User.findOne({email}).select("+password");
    if(!user||!(await user.comparePassword(password)))return res.status(401).json({error:"Invalid email or password."});
    user.lastActive=Date.now();await user.save({validateBeforeSave:false});
    const token=generateToken(user._id);
    res.json({message:"Login successful",token,user:user.toJSON()});
  }catch(err){console.error("Login:",err);res.status(500).json({error:"Login failed."});}
};
const getMe=(req,res)=>res.json({user:req.user});
module.exports={register,login,getMe};
