import React,{useState}from"react";
import{Link,useNavigate}from"react-router-dom";
import{motion}from"framer-motion";
import{Zap,AlertCircle}from"lucide-react";
import{useAuth}from"../context/AuthContext";
import{Spinner}from"../components/ui";
import { signInWithGoogle } from "../services/firebase";
import axios from "axios";

function GoogleButton({label}){
  return(
    <button type="button" onClick={handleGoogleLogin}
      className="w-full flex items-center justify-center gap-2.5 py-2.5 border border-gray-200 dark:border-gray-700 rounded-lg text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors">
      <svg className="w-4 h-4" viewBox="0 0 24 24">
        <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
        <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
        <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
        <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
      </svg>
      {label}
    </button>
  );
}
async function handleGoogleLogin() {
  try {
    const result = await signInWithGoogle();

    const firebaseUser = result.user;

    const idToken = await firebaseUser.getIdToken();

    const response = await axios.post(
      "/api/auth/google-login",
      {
        idToken,
      }
    );

    const { token } = response.data;

    localStorage.setItem("riq_token", token);

    window.location.href = "/";
  } catch (error) {
    console.error("Google Sign-In Error:", error);

    const message =
      error?.response?.data?.error ||
      error?.message ||
      "Google Sign-In failed.";

    alert(message);
  }
}
function AuthCard({title,subtitle,children}){
  return(
    <main className="min-h-[calc(100vh-56px)] flex items-center justify-center px-4 py-12">
      <motion.div initial={{opacity:0,y:20}} animate={{opacity:1,y:0}} className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="w-10 h-10 bg-brand-500 rounded-xl flex items-center justify-center mx-auto mb-4 shadow-sm"><Zap className="w-5 h-5 text-white"/></div>
          <h1 className="text-xl font-bold text-gray-900 dark:text-white mb-1">{title}</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">{subtitle}</p>
        </div>
        <div className="card p-6">{children}</div>
      </motion.div>
    </main>
  );
}

export function LoginPage(){
  const{login}=useAuth();const navigate=useNavigate();
  const[form,setForm]=useState({email:"",password:""});
  const[loading,setLoading]=useState(false);const[error,setError]=useState("");
  const handleSubmit=async(e)=>{
    e.preventDefault();setLoading(true);setError("");
    try{await login(form.email,form.password);navigate("/analyze");}
    catch(err){setError(err.userMessage||"Login failed.");}
    finally{setLoading(false);}
  };
  return(
    <AuthCard title="Welcome back" subtitle="Sign in to your ResumeIQ account">
      <form onSubmit={handleSubmit} className="space-y-4">
        <div><label className="section-label">Email</label><input type="email" value={form.email} onChange={e=>setForm(f=>({...f,email:e.target.value}))} className="form-input mt-1" placeholder="you@example.com" required/></div>
        <div><label className="section-label">Password</label><input type="password" value={form.password} onChange={e=>setForm(f=>({...f,password:e.target.value}))} className="form-input mt-1" placeholder="••••••••" required/></div>
        {error&&<div className="flex items-center gap-2 text-red-600 dark:text-red-400 text-sm"><AlertCircle className="w-4 h-4 flex-shrink-0"/>{error}</div>}
        <button type="submit" disabled={loading} className="btn-primary w-full justify-center py-2.5">{loading?<Spinner size="sm"/>:"Sign in"}</button>
        <div className="relative text-center text-xs text-gray-400 before:absolute before:inset-0 before:top-1/2 before:border-t before:border-gray-200 dark:before:border-gray-700"><span className="relative bg-white dark:bg-gray-900 px-2">or</span></div>
        <GoogleButton label="Sign in with Google"/>
        <p className="text-center text-sm text-gray-500 dark:text-gray-400">Don't have an account? <Link to="/register" className="text-brand-600 font-medium hover:underline">Create one</Link></p>
        <p className="text-center text-xs text-gray-400"><Link to="/analyze" className="text-brand-500 hover:underline">Continue without account →</Link></p>
      </form>
    </AuthCard>
  );
}

export function RegisterPage(){
  const{register}=useAuth();const navigate=useNavigate();
  const[form,setForm]=useState({name:"",email:"",password:""});
  const[loading,setLoading]=useState(false);const[error,setError]=useState("");
  const handleSubmit=async(e)=>{
    e.preventDefault();
    if(form.password.length<8){setError("Password must be at least 8 characters.");return;}
    setLoading(true);setError("");
    try{await register(form.name,form.email,form.password);navigate("/analyze");}
    catch(err){setError(err.userMessage||"Registration failed.");}
    finally{setLoading(false);}
  };
  return(
    <AuthCard title="Create your account" subtitle="Start optimizing your resume for free">
      <form onSubmit={handleSubmit} className="space-y-4">
        <div><label className="section-label">Full Name</label><input type="text" value={form.name} onChange={e=>setForm(f=>({...f,name:e.target.value}))} className="form-input mt-1" placeholder="Jane Smith" required/></div>
        <div><label className="section-label">Email</label><input type="email" value={form.email} onChange={e=>setForm(f=>({...f,email:e.target.value}))} className="form-input mt-1" placeholder="you@example.com" required/></div>
        <div><label className="section-label">Password</label><input type="password" value={form.password} onChange={e=>setForm(f=>({...f,password:e.target.value}))} className="form-input mt-1" placeholder="Min. 8 characters" required/></div>
        {error&&<div className="flex items-center gap-2 text-red-600 dark:text-red-400 text-sm"><AlertCircle className="w-4 h-4 flex-shrink-0"/>{error}</div>}
        <button type="submit" disabled={loading} className="btn-primary w-full justify-center py-2.5">{loading?<Spinner size="sm"/>:"Create account"}</button>
        <div className="relative text-center text-xs text-gray-400 before:absolute before:inset-0 before:top-1/2 before:border-t before:border-gray-200 dark:before:border-gray-700"><span className="relative bg-white dark:bg-gray-900 px-2">or</span></div>
        <GoogleButton label="Sign up with Google"/>
        <p className="text-center text-sm text-gray-500 dark:text-gray-400">Already have an account? <Link to="/login" className="text-brand-600 font-medium hover:underline">Sign in</Link></p>
      </form>
    </AuthCard>
  );
}

export default LoginPage;
