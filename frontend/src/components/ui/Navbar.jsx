import React, { useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { Zap, LogOut, Menu, X, Sun, Moon, History } from "lucide-react";
import { useAuth }     from "../../context/AuthContext";
import { useAnalysis } from "../../context/AnalysisContext";
import { useTheme }    from "../../context/ThemeContext";

export default function Navbar() {
  const { user, logout }        = useAuth();
  const { currentAnalysis }     = useAnalysis();
  const { isDark, toggleTheme } = useTheme();
  const location = useLocation();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);

  const isActive = (p) => location.pathname === p;
  const navLinks = [
    { path:"/analyze",   label:"Analyze",  always:true },
    { path:"/dashboard", label:"Results",  show:!!currentAnalysis },
    { path:"/editor",    label:"Editor",   show:!!currentAnalysis },
    { path:"/history",   label:"History",  show:!!user },
  ];

  return (
    <nav className="sticky top-0 z-50 bg-white/80 dark:bg-gray-950/80 backdrop-blur-md border-b border-gray-100 dark:border-gray-800">
      <div className="max-w-7xl mx-auto px-4 sm:px-6">
        <div className="flex items-center justify-between h-14">
          <Link to="/" className="flex items-center gap-2 flex-shrink-0">
            <div className="w-7 h-7 bg-brand-500 rounded-lg flex items-center justify-center shadow-sm">
              <Zap className="w-4 h-4 text-white" strokeWidth={2.5} />
            </div>
            <span className="font-semibold text-gray-900 dark:text-white text-[15px] tracking-tight">
              ResumeIQ <span className="text-brand-500">AI</span>
            </span>
          </Link>

          <div className="hidden sm:flex items-center gap-0.5">
            {navLinks.map(l=>(l.always||l.show)&&(
              <Link key={l.path} to={l.path}
                className={`px-3.5 py-1.5 rounded-lg text-sm font-medium transition-colors
                  ${isActive(l.path)
                    ? "bg-brand-50 text-brand-600 dark:bg-brand-900/40 dark:text-brand-400"
                    : "text-gray-500 hover:text-gray-800 hover:bg-gray-50 dark:text-gray-400 dark:hover:text-gray-200 dark:hover:bg-gray-800/60"}`}
              >{l.label}</Link>
            ))}
          </div>

          <div className="hidden sm:flex items-center gap-2">
            <button onClick={toggleTheme}
              className="w-8 h-8 rounded-lg flex items-center justify-center text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800 dark:text-gray-400 transition-colors"
            >{isDark ? <Sun className="w-4 h-4"/> : <Moon className="w-4 h-4"/>}</button>
            {user ? (
              <div className="flex items-center gap-2">
                <span className="text-sm text-gray-500 dark:text-gray-400 max-w-[120px] truncate">{user.name}</span>
                <button onClick={()=>{logout();navigate("/");}}
                  className="flex items-center gap-1.5 text-sm text-gray-500 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200 px-3 py-1.5 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
                ><LogOut className="w-3.5 h-3.5"/>Sign out</button>
              </div>
            ):(
              <div className="flex items-center gap-2">
                <Link to="/login" className="text-sm text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white px-3 py-1.5 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors font-medium">Sign in</Link>
                <Link to="/register" className="text-sm bg-brand-500 text-white px-3.5 py-1.5 rounded-lg hover:bg-brand-600 transition-colors font-medium shadow-sm">Get started</Link>
              </div>
            )}
          </div>

          <div className="sm:hidden flex items-center gap-1">
            <button onClick={toggleTheme} className="p-2 rounded-lg text-gray-500 dark:text-gray-400">
              {isDark?<Sun className="w-4 h-4"/>:<Moon className="w-4 h-4"/>}
            </button>
            <button onClick={()=>setOpen(o=>!o)} className="p-2 rounded-lg text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800">
              {open?<X className="w-5 h-5"/>:<Menu className="w-5 h-5"/>}
            </button>
          </div>
        </div>
      </div>
      {open&&(
        <motion.div initial={{opacity:0,y:-8}} animate={{opacity:1,y:0}}
          className="sm:hidden bg-white dark:bg-gray-900 border-t border-gray-100 dark:border-gray-800 px-4 py-3 space-y-1"
        >
          {navLinks.map(l=>(l.always||l.show)&&(
            <Link key={l.path} to={l.path} onClick={()=>setOpen(false)}
              className={`block px-3 py-2 rounded-lg text-sm font-medium
                ${isActive(l.path)?"bg-brand-50 text-brand-600 dark:bg-brand-900/30 dark:text-brand-400":"text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800"}`}
            >{l.label}</Link>
          ))}
          <div className="pt-2 border-t border-gray-100 dark:border-gray-800">
            {user
              ?<button onClick={()=>{logout();navigate("/");setOpen(false);}} className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400 px-3 py-2"><LogOut className="w-4 h-4"/>Sign out</button>
              :<Link to="/login" onClick={()=>setOpen(false)} className="block text-sm text-gray-600 dark:text-gray-400 px-3 py-2">Sign in</Link>
            }
          </div>
        </motion.div>
      )}
    </nav>
  );
}
