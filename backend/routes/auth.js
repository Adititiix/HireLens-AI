const express=require("express");const{body}=require("express-validator");
const{register,login,getMe}=require("../controllers/authController");
const{protect}=require("../middleware/auth");const{validateRequest}=require("../middleware/validation");
const router=express.Router();
router.post("/register",[body("name").trim().notEmpty().withMessage("Name is required"),body("email").isEmail().normalizeEmail(),body("password").isLength({min:8}).withMessage("Password must be at least 8 characters")],validateRequest,register);
router.post("/login",[body("email").isEmail().normalizeEmail(),body("password").notEmpty()],validateRequest,login);
router.get("/me",protect,getMe);
module.exports=router;
