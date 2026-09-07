import React from"react";
import{Link}from"react-router-dom";
import{motion}from"framer-motion";
import{Zap,BarChart3,Wand2,FileSearch,Tags,Clock,ArrowRight,Check,TrendingUp}from"lucide-react";

const FEATURES=[
  {icon:FileSearch,title:"Skill Gap Analysis",desc:"Instantly identify missing skills vs what the job requires, using semantic NLP + fuzzy matching.",color:"text-violet-500",bg:"bg-violet-50 dark:bg-violet-900/20"},
  {icon:BarChart3,title:"Priority ATS Scoring",desc:"Skills ranked HIGH / MEDIUM / LOW. Missing critical skills penalise your score more heavily.",color:"text-blue-500",bg:"bg-blue-50 dark:bg-blue-900/20"},
  {icon:Wand2,title:"AI Rewrites",desc:"Transform weak bullets into impact-driven statements with quantifiable results and action verbs.",color:"text-brand-500",bg:"bg-brand-50 dark:bg-brand-900/20"},
  {icon:Tags,title:"Keyword Extraction",desc:"Extract languages, frameworks, tools, and domain keywords from any job description.",color:"text-orange-500",bg:"bg-orange-50 dark:bg-orange-900/20"},
  {icon:Clock,title:"Analysis History",desc:"Store and compare all previous analyses. See score improvements over time side by side.",color:"text-pink-500",bg:"bg-pink-50 dark:bg-pink-900/20"},
  {icon:TrendingUp,title:"Resume Editor",desc:"Section-based editor with drag-and-drop ordering, AI suggestions, and live preview.",color:"text-green-500",bg:"bg-green-50 dark:bg-green-900/20"},
];

const STEPS=[
  {num:"1",title:"Upload your resume",desc:"PDF, DOCX, or TXT. Parser extracts all sections — skills, experience, education, and contact info automatically."},
  {num:"2",title:"Add the job description",desc:"Paste or upload a JD. NLP engine extracts required skills and ranks them HIGH / MEDIUM / LOW priority."},
  {num:"3",title:"Get priority-aware results",desc:"Match score weighted by skill priority, ATS breakdown, and AI-generated improvement suggestions."},
];

function FadeUp({children,delay=0}){
  return<motion.div initial={{opacity:0,y:20}} whileInView={{opacity:1,y:0}} viewport={{once:true}} transition={{duration:0.5,delay}}>{children}</motion.div>;
}

export default function LandingPage(){
  return(
    <main>
      <section className="bg-white dark:bg-gray-900 border-b border-gray-100 dark:border-gray-800">
        <div className="max-w-4xl mx-auto px-6 py-20 text-center">
          <motion.div initial={{opacity:0,y:16}} animate={{opacity:1,y:0}} transition={{duration:0.5}}>
            <div className="inline-flex items-center gap-2 bg-brand-50 dark:bg-brand-900/30 text-brand-600 dark:text-brand-400 text-xs font-semibold px-3.5 py-1.5 rounded-full mb-8 border border-brand-100 dark:border-brand-800">
              <Zap className="w-3.5 h-3.5"/>Python NLP · Semantic Embeddings · Priority ATS Scoring
            </div>
            <h1 className="text-5xl sm:text-6xl font-bold text-gray-900 dark:text-white mb-6 leading-tight tracking-tight">
              Land your dream job with a <span className="text-brand-500">smarter resume</span>
            </h1>
            <p className="text-lg text-gray-500 dark:text-gray-400 max-w-2xl mx-auto mb-10 leading-relaxed">
              Upload your resume, paste a job description, and receive priority-ranked skill gap analysis, ATS scoring, and AI-rewritten bullet points in under 30 seconds.
            </p>
            <div className="flex flex-wrap items-center justify-center gap-3">
              <Link to="/analyze" className="btn-primary text-base px-7 py-3">Analyze my resume<ArrowRight className="w-4 h-4"/></Link>
              <Link to="/register" className="btn-secondary text-base px-7 py-3">Create free account</Link>
            </div>
            <div className="flex items-center justify-center gap-6 mt-8 text-sm text-gray-400 flex-wrap">
              {["No signup required","Priority skill ranking","History & comparison"].map(item=>(
                <span key={item} className="flex items-center gap-1.5"><Check className="w-3.5 h-3.5 text-green-500"/>{item}</span>
              ))}
            </div>
          </motion.div>
        </div>
        <div className="border-t border-gray-100 dark:border-gray-800">
          <div className="max-w-3xl mx-auto grid grid-cols-3 divide-x divide-gray-100 dark:divide-gray-800">
            {[["94%","ATS pass rate improvement"],["3×","More interview callbacks"],["< 30s","Full analysis time"]].map(([v,l])=>(
              <div key={l} className="py-6 text-center">
                <p className="text-3xl font-bold text-gray-900 dark:text-white">{v}</p>
                <p className="text-xs text-gray-400 mt-1">{l}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="py-20 px-6">
        <div className="max-w-5xl mx-auto">
          <FadeUp><div className="text-center mb-14"><h2 className="text-3xl font-bold text-gray-900 dark:text-white mb-4">Everything you need to get hired</h2><p className="text-gray-500 dark:text-gray-400 max-w-lg mx-auto">Real AI — priority-ranked skill gaps, semantic matching, and dynamic ATS explanation.</p></div></FadeUp>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {FEATURES.map((f,i)=>{const Icon=f.icon;return(
              <FadeUp key={f.title} delay={i*0.07}>
                <div className="card p-5 hover:shadow-card-hover transition-all duration-200 hover:-translate-y-0.5 h-full">
                  <div className={`w-10 h-10 ${f.bg} rounded-xl flex items-center justify-center mb-4`}><Icon className={`w-5 h-5 ${f.color}`}/></div>
                  <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-200 mb-2">{f.title}</h3>
                  <p className="text-sm text-gray-500 dark:text-gray-400 leading-relaxed">{f.desc}</p>
                </div>
              </FadeUp>
            );})}
          </div>
        </div>
      </section>

      <section className="py-20 px-6 bg-white dark:bg-gray-900 border-t border-b border-gray-100 dark:border-gray-800">
        <div className="max-w-3xl mx-auto">
          <FadeUp><div className="text-center mb-14"><h2 className="text-3xl font-bold text-gray-900 dark:text-white mb-4">How it works</h2><p className="text-gray-500 dark:text-gray-400">Three steps to a priority-optimized resume</p></div></FadeUp>
          {STEPS.map((step,i)=>(
            <FadeUp key={step.num} delay={i*0.1}>
              <div className={`flex gap-6 py-8 ${i<STEPS.length-1?"border-b border-gray-100 dark:border-gray-800":""}`}>
                <div className="w-10 h-10 bg-brand-500 text-white rounded-xl flex items-center justify-center text-sm font-bold flex-shrink-0">{i+1}</div>
                <div><h3 className="text-base font-semibold text-gray-800 dark:text-gray-200 mb-2">{step.title}</h3><p className="text-sm text-gray-500 dark:text-gray-400 leading-relaxed">{step.desc}</p></div>
              </div>
            </FadeUp>
          ))}
        </div>
      </section>

      <section className="py-20 px-6">
        <FadeUp>
          <div className="max-w-2xl mx-auto text-center">
            <div className="card p-10">
              <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-3">Ready to optimize your resume?</h2>
              <p className="text-gray-500 dark:text-gray-400 mb-8">Priority-ranked skill gaps, ATS analysis, and AI improvements — free.</p>
              <Link to="/analyze" className="btn-primary inline-flex text-base px-8 py-3 mx-auto">Get started free<ArrowRight className="w-4 h-4"/></Link>
              <p className="text-xs text-gray-400 mt-4">No account required · No credit card</p>
            </div>
          </div>
        </FadeUp>
      </section>
      <div className="text-center pb-8 text-xs text-gray-300 dark:text-gray-700">Future: Interview AI Coach · Chrome Extension · Job Recommendations · Recruiter Dashboard</div>
    </main>
  );
}
