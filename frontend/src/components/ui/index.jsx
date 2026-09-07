import React from "react";
import { motion } from "framer-motion";
import { Loader2, Check, X, AlertCircle } from "lucide-react";

export function Spinner({ size="md", className="" }) {
  const s={sm:"w-4 h-4",md:"w-5 h-5",lg:"w-7 h-7"};
  return <Loader2 className={`animate-spin text-brand-500 ${s[size]} ${className}`}/>;
}

export function ProgressBar({ value, max=100, color="bg-brand-500", className="" }) {
  const pct=Math.min(100,Math.round((value/max)*100));
  return (
    <div className={`h-1.5 bg-gray-100 dark:bg-gray-800 rounded-full overflow-hidden ${className}`}>
      <motion.div className={`h-full rounded-full ${color}`}
        initial={{width:0}} animate={{width:`${pct}%`}} transition={{duration:0.8,ease:"easeOut"}}/>
    </div>
  );
}

export function ScoreRing({ score, size=80, strokeWidth=6, color="#4f46e5" }) {
  const r=(size-strokeWidth)/2, circ=r*2*Math.PI, offset=circ-(score/100)*circ;
  return (
    <svg width={size} height={size} className="transform -rotate-90">
      <circle cx={size/2} cy={size/2} r={r} fill="none" stroke="currentColor" strokeWidth={strokeWidth} className="text-gray-100 dark:text-gray-800"/>
      <motion.circle cx={size/2} cy={size/2} r={r} fill="none" stroke={color}
        strokeWidth={strokeWidth} strokeLinecap="round"
        strokeDasharray={circ} initial={{strokeDashoffset:circ}}
        animate={{strokeDashoffset:offset}} transition={{duration:1.2,ease:"easeOut"}}/>
    </svg>
  );
}

export function Badge({ type="default", children }) {
  const s={
    success:"bg-green-50 text-green-700 border-green-100 dark:bg-green-900/20 dark:text-green-400 dark:border-green-800",
    warning:"bg-amber-50 text-amber-700 border-amber-100 dark:bg-amber-900/20 dark:text-amber-400 dark:border-amber-800",
    danger:"bg-red-50 text-red-700 border-red-100 dark:bg-red-900/20 dark:text-red-400 dark:border-red-800",
    info:"bg-brand-50 text-brand-700 border-brand-100 dark:bg-brand-900/20 dark:text-brand-400 dark:border-brand-800",
    default:"bg-gray-50 text-gray-600 border-gray-100 dark:bg-gray-800 dark:text-gray-400 dark:border-gray-700",
  };
  return <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-medium border ${s[type]}`}>{children}</span>;
}

export function ScoreCard({ label, score, description, icon:Icon, delay=0 }) {
  const sc=score>=80?"text-green-600 dark:text-green-400":score>=60?"text-amber-600 dark:text-amber-400":"text-red-600 dark:text-red-400";
  const bc=score>=80?"bg-green-500":score>=60?"bg-amber-500":"bg-red-500";
  return (
    <motion.div initial={{opacity:0,y:12}} animate={{opacity:1,y:0}} transition={{delay}} className="card p-5">
      <div className="flex items-center justify-between mb-3">
        <span className="section-label">{label}</span>
        {Icon&&<Icon className="w-4 h-4 text-gray-300 dark:text-gray-600"/>}
      </div>
      <div className={`text-3xl font-bold mb-1 tabular-nums ${sc}`}>{score}<span className="text-base font-medium">%</span></div>
      <p className="text-xs text-gray-400 mb-3">{description}</p>
      <ProgressBar value={score} color={bc}/>
    </motion.div>
  );
}

export function CollapsibleSection({ title, icon:Icon, children, defaultOpen=true, badge, action }) {
  const [open,setOpen]=React.useState(defaultOpen);
  return (
    <div className="card overflow-hidden">
      <button onClick={()=>setOpen(o=>!o)}
        className="w-full flex items-center gap-2.5 px-5 py-4 text-left hover:bg-gray-50/50 dark:hover:bg-gray-800/30 transition-colors border-b border-transparent"
      >
        {Icon&&<Icon className="w-4 h-4 text-brand-500 flex-shrink-0"/>}
        <span className="text-sm font-semibold text-gray-800 dark:text-gray-200 flex-1">{title}</span>
        {badge&&<span className="text-xs text-gray-400 mr-1">{badge}</span>}
        {action&&<span onClick={e=>e.stopPropagation()}>{action}</span>}
        <motion.span animate={{rotate:open?180:0}} transition={{duration:0.2}} className="text-gray-300 dark:text-gray-600 text-xs">▾</motion.span>
      </button>
      <motion.div initial={false} animate={{height:open?"auto":0,opacity:open?1:0}}
        transition={{duration:0.2}} style={{overflow:"hidden"}}>
        <div className="p-5">{children}</div>
      </motion.div>
    </div>
  );
}

export function EmptyState({ icon:Icon, title, description, action }) {
  return (
    <div className="text-center py-16 px-4">
      <div className="w-12 h-12 bg-gray-100 dark:bg-gray-800 rounded-xl flex items-center justify-center mx-auto mb-4">
        {Icon&&<Icon className="w-6 h-6 text-gray-400"/>}
      </div>
      <h3 className="text-base font-medium text-gray-700 dark:text-gray-300 mb-1">{title}</h3>
      <p className="text-sm text-gray-400 mb-6 max-w-xs mx-auto">{description}</p>
      {action}
    </div>
  );
}

export function Toast({ message, type="success", visible }) {
  if(!visible) return null;
  const bg=type==="error"?"bg-red-600":type==="warning"?"bg-amber-500":"bg-gray-900";
  return (
    <motion.div initial={{opacity:0,y:20}} animate={{opacity:1,y:0}} exit={{opacity:0,y:20}}
      className={`fixed bottom-6 right-6 z-50 ${bg} text-white text-sm px-4 py-3 rounded-xl shadow-lg flex items-center gap-2 max-w-xs`}
    >{message}</motion.div>
  );
}
