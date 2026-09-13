import React,{useState,useEffect,useCallback}from"react";
import{motion,AnimatePresence}from"framer-motion";
import{X,Eye,EyeOff,Save,Plus,Trash2,GripVertical,Upload,FileText,User,Briefcase,GraduationCap,Wrench,Code2,Award,Star,Info,ArrowRight,ChevronDown,Pencil,ZoomIn,ZoomOut,Maximize2,Download}from"lucide-react";
import{useDropzone}from"react-dropzone";
import{resumeAPI}from"../services/api";
import{useAnalysis}from"../context/AnalysisContext";
import{useAuth}from"../context/AuthContext";
import{Spinner}from"../components/ui";
import ResumePreview,{DEFAULT_SECTION_ORDER as SHARED_SECTION_ORDER}from"../components/editor/ResumePreview";

const uid=()=>Date.now().toString(36)+Math.random().toString(36).slice(2);

// Preserved exactly — same shape as before, `jobTitle` now also persists (Resume schema updated).
const DEFAULT={
  name:"",jobTitle:"",email:"",phone:"",location:"",
  linkedin:"",github:"",portfolio:"",leetcode:"",hackerrank:"",otherLinks:[],
  summary:"",
  skills:{technical:[],tools:[],cloud:[],soft:[],languages:[]},
  experience:[],education:[],projects:[],certifications:[],achievements:[],additionalInfo:"",
};

const DEFAULT_SECTION_ORDER=["header","summary","skills","experience","projects","certifications","education","achievements","additionalInfo"];

const SECTION_META={
  header:{label:"Header",icon:User},summary:{label:"Professional Summary",icon:User},
  skills:{label:"Skills",icon:Wrench},experience:{label:"Experience",icon:Briefcase},
  projects:{label:"Projects",icon:Code2},certifications:{label:"Certifications",icon:Award},
  education:{label:"Education",icon:GraduationCap},
  achievements:{label:"Achievements",icon:Star},additionalInfo:{label:"Additional Info",icon:Info},
};

/* ── Field primitives (unchanged) ── */
function Field({label,value,onChange,type="text",placeholder="",hint,className=""}){
  return(
    <div className={`space-y-1 ${className}`}>
      <label className="section-label">{label}</label>
      <input type={type} value={value||""} onChange={e=>onChange(e.target.value)} placeholder={placeholder} className="form-input"/>
      {hint&&<p className="text-xs text-gray-400">{hint}</p>}
    </div>
  );
}
function TextareaField({label,value,onChange,placeholder="",rows=4,hint}){
  return(
    <div className="space-y-1">
      <label className="section-label">{label}</label>
      <textarea value={value||""} onChange={e=>onChange(e.target.value)} placeholder={placeholder} rows={rows} className="form-input resize-y leading-relaxed"/>
      {hint&&<p className="text-xs text-gray-400">{hint}</p>}
    </div>
  );
}
function TwoCol({children}){return<div className="grid grid-cols-1 sm:grid-cols-2 gap-4">{children}</div>;}
function AddBtn({label,onClick}){
  return(
    <button onClick={onClick} className="w-full flex items-center justify-center gap-2 py-2.5 border border-dashed border-gray-200 dark:border-gray-700 rounded-xl text-sm text-gray-400 hover:text-brand-500 hover:border-brand-300 hover:bg-brand-50/30 dark:hover:border-brand-700 dark:hover:bg-brand-900/10 transition-all mt-3">
      <Plus className="w-4 h-4"/>{label}
    </button>
  );
}

/* ── Part 4: Tag / chip editor for Skills — "Tag editor, Searchable chips" ── */
function ChipInput({label,values=[],onChange,placeholder,hint}){
  const[input,setInput]=useState("");
  const commit=(raw)=>{
    const v=raw.trim().replace(/,$/,"");
    if(!v)return;
    if(!values.some(x=>x.toLowerCase()===v.toLowerCase()))onChange([...values,v]);
    setInput("");
  };
  const remove=(idx)=>onChange(values.filter((_,i)=>i!==idx));
  return(
    <div className="space-y-1.5">
      <label className="section-label">{label}</label>
      <div className="form-input flex flex-wrap gap-1.5 items-center min-h-[42px] py-2">
        {values.map((v,i)=>(
          <span key={v+i} className="inline-flex items-center gap-1 bg-brand-50 dark:bg-brand-900/30 text-brand-700 dark:text-brand-400 text-xs font-medium pl-2 pr-1 py-1 rounded-md">
            {v}
            <button type="button" onClick={()=>remove(i)} className="hover:bg-brand-100 dark:hover:bg-brand-800 rounded p-0.5"><X className="w-3 h-3"/></button>
          </span>
        ))}
        <input
          value={input}
          onChange={e=>{
            if(e.target.value.endsWith(",")){commit(e.target.value);}
            else setInput(e.target.value);
          }}
          onKeyDown={e=>{
            if(e.key==="Enter"||e.key===","){e.preventDefault();commit(input);}
            if(e.key==="Backspace"&&!input&&values.length)remove(values.length-1);
          }}
          placeholder={values.length?"":placeholder}
          className="flex-1 min-w-[100px] bg-transparent outline-none text-sm placeholder-gray-400"
        />
      </div>
      {hint&&<p className="text-xs text-gray-400">{hint}</p>}
    </div>
  );
}

function AITip({text,onApply}){
  const[d,setD]=useState(false);const[a,setA]=useState(false);
  if(d)return null;
  return(
    <motion.div initial={{opacity:0,y:-4}} animate={{opacity:1,y:0}} className="flex items-start gap-2.5 p-3 bg-brand-50 dark:bg-brand-900/20 border border-brand-100 dark:border-brand-800 rounded-xl mb-3">
      <span className="text-base flex-shrink-0 mt-0.5">✨</span>
      <div className="flex-1 min-w-0">
        <p className="text-xs text-brand-700 dark:text-brand-300 leading-relaxed">{text}</p>
        {onApply&&!a&&<button onClick={()=>{onApply();setA(true);}} className="text-xs text-brand-600 font-semibold mt-1.5 hover:underline">Apply suggestion →</button>}
        {a&&<span className="text-xs text-green-600 dark:text-green-400 font-medium mt-1.5 block">✓ Applied</span>}
      </div>
      <button onClick={()=>setD(true)} className="text-brand-300 hover:text-brand-500 text-xs">✕</button>
    </motion.div>
  );
}

/* ── Import Modal (unchanged — Create New / Import Existing) ── */
function ImportModal({onClose,onNew,onImportData}){
  const[phase,setPhase]=useState("choice");
  const[uploading,setUploading]=useState(false);
  const[err,setErr]=useState("");

  const onDrop=useCallback(async(accepted)=>{
    const f=accepted[0];if(!f)return;
    setUploading(true);setErr("");
    try{
      const res=await resumeAPI.uploadAnon(f);
      const pd=res.data.parsedData||{};
      onImportData(pd,res.data.text||"");
      onClose();
    }catch(e){setErr(e.userMessage||"Failed to parse file.");}
    finally{setUploading(false);}
  },[onImportData,onClose]);

  const{getRootProps,getInputProps,isDragActive}=useDropzone({onDrop,accept:{"application/pdf":[".pdf"],"application/vnd.openxmlformats-officedocument.wordprocessingml.document":[".docx"]},multiple:false});

  return(
    <motion.div initial={{opacity:0}} animate={{opacity:1}} exit={{opacity:0}} className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center px-4" onClick={onClose}>
      <motion.div initial={{scale:0.95,opacity:0}} animate={{scale:1,opacity:1}} exit={{scale:0.95,opacity:0}} className="bg-white dark:bg-gray-900 rounded-2xl p-6 w-full max-w-md shadow-2xl" onClick={e=>e.stopPropagation()}>
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-lg font-bold text-gray-900 dark:text-white">Resume Editor</h2>
          <button onClick={onClose} className="btn-ghost p-1.5 rounded-lg"><X className="w-4 h-4"/></button>
        </div>
        {phase==="choice"&&(
          <div className="space-y-3">
            <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">How would you like to start?</p>
            <button onClick={onNew} className="w-full flex items-center gap-3 p-4 border border-gray-200 dark:border-gray-700 rounded-xl hover:border-brand-300 hover:bg-brand-50/30 dark:hover:border-brand-700 dark:hover:bg-brand-900/10 transition-all text-left">
              <div className="w-10 h-10 bg-brand-50 dark:bg-brand-900/30 rounded-lg flex items-center justify-center flex-shrink-0"><FileText className="w-5 h-5 text-brand-500"/></div>
              <div><p className="text-sm font-semibold text-gray-800 dark:text-gray-200">Create New Resume</p><p className="text-xs text-gray-400 mt-0.5">Start with an empty template</p></div>
              <ArrowRight className="w-4 h-4 text-gray-400 ml-auto"/>
            </button>
            <button onClick={()=>setPhase("import")} className="w-full flex items-center gap-3 p-4 border border-gray-200 dark:border-gray-700 rounded-xl hover:border-brand-300 hover:bg-brand-50/30 dark:hover:border-brand-700 dark:hover:bg-brand-900/10 transition-all text-left">
              <div className="w-10 h-10 bg-green-50 dark:bg-green-900/20 rounded-lg flex items-center justify-center flex-shrink-0"><Upload className="w-5 h-5 text-green-600 dark:text-green-400"/></div>
              <div><p className="text-sm font-semibold text-gray-800 dark:text-gray-200">Import Existing Resume</p><p className="text-xs text-gray-400 mt-0.5">Upload PDF or DOCX to auto-populate</p></div>
              <ArrowRight className="w-4 h-4 text-gray-400 ml-auto"/>
            </button>
          </div>
        )}
        {phase==="import"&&(
          <div>
            <button onClick={()=>setPhase("choice")} className="text-xs text-brand-500 hover:underline mb-4 block">← Back</button>
            {uploading?<div className="flex items-center justify-center gap-2 p-8"><Spinner size="md"/><span className="text-sm text-gray-500 dark:text-gray-400">Parsing your resume…</span></div>:(
              <div>
                <div {...getRootProps()} className={`drop-zone ${isDragActive?"active":""}`}>
                  <input {...getInputProps()}/>
                  <Upload className="w-8 h-8 text-gray-300 dark:text-gray-600 mx-auto mb-3"/>
                  <p className="text-sm text-gray-600 dark:text-gray-400 mb-1">Upload your resume</p>
                  <p className="text-xs text-gray-400">PDF or DOCX — content will be extracted and filled in automatically</p>
                </div>
                {err&&<p className="text-xs text-red-500 mt-2">{err}</p>}
              </div>
            )}
          </div>
        )}
      </motion.div>
    </motion.div>
  );
}

function EntryRow({title,subtitle,onEdit,onDelete,editing,children}){
  if(editing){
    return(
      <div className="border border-brand-200 dark:border-brand-800 rounded-xl p-4 bg-brand-50/20 dark:bg-brand-900/10">
        {children}
        <div className="flex justify-end mt-3">
          <button onClick={onEdit} className="btn-primary text-xs py-1.5 px-4">Save</button>
        </div>
      </div>
    );
  }
  return(
    <div className="flex items-center gap-3 border border-gray-100 dark:border-gray-800 rounded-xl p-3.5 bg-white dark:bg-gray-900 hover:border-gray-200 dark:hover:border-gray-700 transition-all">
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-gray-800 dark:text-gray-200 truncate">{title||"Untitled"}</p>
        {subtitle&&<p className="text-xs text-gray-400 truncate">{subtitle}</p>}
      </div>
      <button onClick={onEdit} className="btn-ghost text-xs py-1.5 px-2.5 flex-shrink-0"><Pencil className="w-3.5 h-3.5"/>Edit</button>
      <button onClick={onDelete} className="p-1.5 rounded-lg text-gray-300 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors flex-shrink-0"><Trash2 className="w-3.5 h-3.5"/></button>
    </div>
  );
}

/* ── Part 3: Accordion section wrapper — collapsible, draggable, with visibility (eye) toggle ── */
function AccordionSection({id,meta,open,onToggle,hidden,onToggleVisibility,badge,draggableProps,children}){
  const Icon=meta.icon;
  return(
    <div {...draggableProps} className={`card overflow-hidden mb-3 ${hidden?"opacity-50":""}`}>
      <div className="w-full flex items-center gap-2.5 px-4 py-3.5 cursor-grab active:cursor-grabbing">
        <GripVertical className="w-3.5 h-3.5 text-gray-300 dark:text-gray-600 flex-shrink-0"/>
        <button onClick={onToggle} className="flex items-center gap-2.5 flex-1 min-w-0 text-left">
          <Icon className="w-4 h-4 text-brand-500 flex-shrink-0"/>
          <span className="text-sm font-semibold text-gray-800 dark:text-gray-200 truncate">{meta.label}</span>
          {badge&&<span className="text-xs text-gray-400 flex-shrink-0">{badge}</span>}
        </button>
        {/* Part 9: hide / show */}
        <button onClick={()=>onToggleVisibility(id)} title={hidden?"Show in preview":"Hide from preview"}
          className="p-1.5 rounded-lg text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors flex-shrink-0">
          {hidden?<EyeOff className="w-4 h-4"/>:<Eye className="w-4 h-4"/>}
        </button>
        <button onClick={onToggle} className="p-1 flex-shrink-0">
          <motion.span animate={{rotate:open?180:0}} transition={{duration:0.2}} className="block text-gray-300 dark:text-gray-600">
            <ChevronDown className="w-4 h-4"/>
          </motion.span>
        </button>
      </div>
      <AnimatePresence initial={false}>
        {open&&(
          <motion.div key="body" initial={{height:0,opacity:0}} animate={{height:"auto",opacity:1}} exit={{height:0,opacity:0}} transition={{duration:0.2}} style={{overflow:"hidden"}}>
            <div className="px-4 pb-4 pt-1 border-t border-gray-50 dark:border-gray-800 space-y-3">{children}</div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/* ── Main Editor Page ── */
export default function EditorPage(){
  const{currentResume,setCurrentResume,currentAnalysis}=useAnalysis();
  const{user}=useAuth();
  const[showModal,setShowModal]=useState(true);
  const[data,setData]=useState({...DEFAULT});
  const[sectionOrder,setSectionOrder]=useState([...DEFAULT_SECTION_ORDER]);
  const[hiddenSections,setHiddenSections]=useState([]); // Part 9
  const[openSections,setOpenSections]=useState(new Set(DEFAULT_SECTION_ORDER)); // Part 3: accordion state
  const[editingKey,setEditingKey]=useState(null); // `${section}:${index}` currently in edit mode
  const[saving,setSaving]=useState(false);
  const[dragOver,setDragOver]=useState(null);
  const[zoom,setZoom]=useState(0.62); // Part 6: zoom support
  const[fullPreview,setFullPreview]=useState(false);

  useEffect(()=>{
    if(currentResume?.parsedData){
      setData(prev=>({...prev,...currentResume.parsedData}));
      if(currentResume.sectionOrder)setSectionOrder(currentResume.sectionOrder);
      if(currentResume.hiddenSections)setHiddenSections(currentResume.hiddenSections);
      setShowModal(false);
    }
  },[currentResume]);

  const upd=(path,val)=>setData(prev=>{
    const next={...prev};const parts=path.split(".");let obj=next;
    for(let i=0;i<parts.length-1;i++){obj[parts[i]]=Array.isArray(obj[parts[i]])?[...obj[parts[i]]]:{...obj[parts[i]]};obj=obj[parts[i]];}
    obj[parts[parts.length-1]]=val;return next;
  });
  const updList=(list,idx,field,val)=>setData(p=>{const a=[...(p[list]||[])];a[idx]={...a[idx],[field]:val};return{...p,[list]:a};});
  const removeItem=(list,idx)=>setData(p=>{const a=[...(p[list]||[])];a.splice(idx,1);return{...p,[list]:a};});
  const addItem=(list,tmpl)=>{
    setData(p=>{
      const arr=[...(p[list]||[]),{...tmpl,id:uid()}];
      setEditingKey(`${list}:${arr.length-1}`); // auto-open the new entry for editing
      return{...p,[list]:arr};
    });
  };

  const handleNew=()=>{setData({...DEFAULT});setSectionOrder([...DEFAULT_SECTION_ORDER]);setHiddenSections([]);setShowModal(false);};
  const handleImportData=(pd)=>{setData(prev=>({...prev,...pd}));};

  const handleSave=async()=>{
    if(!currentResume?._id)return;
    setSaving(true);
    try{await resumeAPI.update(currentResume._id,{parsedData:data,sectionOrder,hiddenSections});}
    catch{}finally{setSaving(false);}
  };

  /* Part 10: drag-and-drop section ordering — same technique as before */
  const handleDragStart=(e,id)=>{e.dataTransfer.setData("sectionId",id);};
  const handleDrop=(e,targetId)=>{
    e.preventDefault();
    const dragId=e.dataTransfer.getData("sectionId");
    if(dragId===targetId)return;
    setSectionOrder(prev=>{
      const arr=[...prev];
      const fi=arr.indexOf(dragId);const ti=arr.indexOf(targetId);
      arr.splice(fi,1);arr.splice(ti,0,dragId);return arr;
    });
    setDragOver(null);
  };

  /* Part 9 */
  const toggleVisibility=(id)=>setHiddenSections(prev=>prev.includes(id)?prev.filter(x=>x!==id):[...prev,id]);
  const toggleOpen=(id)=>setOpenSections(prev=>{const n=new Set(prev);n.has(id)?n.delete(id):n.add(id);return n;});

  const improvements=currentAnalysis?.improvements||[];
  const suggestionsFor=(id)=>improvements.filter(s=>s.section?.toLowerCase().includes(id.toLowerCase()));

  if(showModal) return(
    <AnimatePresence>
      <ImportModal onClose={()=>setShowModal(false)} onNew={handleNew} onImportData={handleImportData}/>
    </AnimatePresence>
  );

  return(
    <div className="flex h-[calc(100vh-56px)] overflow-hidden bg-gray-50 dark:bg-gray-950">

      {/* ── LEFT PANEL — 40% — accordion editor (Parts 2, 3, 4, 9, 10) ── */}
      <div className="w-full lg:w-[40%] flex-shrink-0 overflow-y-auto border-r border-gray-100 dark:border-gray-800 p-5">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h1 className="text-base font-bold text-gray-900 dark:text-white">Resume Editor</h1>
            <p className="text-xs text-gray-400 mt-0.5">Drag sections to reorder · click the eye to hide from preview</p>
          </div>
          {user&&(
            <button onClick={handleSave} disabled={saving} className="btn-primary text-xs py-2 px-3 flex-shrink-0">
              {saving?<Spinner size="sm"/>:<><Save className="w-3.5 h-3.5"/>Save</>}
            </button>
          )}
        </div>

        {sectionOrder.map(id=>{
          const meta=SECTION_META[id];if(!meta)return null;
          const isOpen=openSections.has(id);
          const isHidden=hiddenSections.includes(id);
          const sugg=suggestionsFor(id);
          const draggableProps={
            draggable:true,
            onDragStart:e=>handleDragStart(e,id),
            onDragOver:e=>{e.preventDefault();setDragOver(id);},
            onDrop:e=>handleDrop(e,id),
            onDragLeave:()=>setDragOver(null),
            style:dragOver===id?{outline:"2px solid var(--tw-color-brand-400,#8878ec)",outlineOffset:"2px"}:undefined,
          };

          let badge=null;
          if(id==="experience")badge=`${data.experience?.length||0}`;
          else if(id==="projects")badge=`${data.projects?.length||0}`;
          else if(id==="education")badge=`${data.education?.length||0}`;
          else if(id==="certifications")badge=`${data.certifications?.length||0}`;
          else if(id==="achievements")badge=`${data.achievements?.length||0}`;

          return(
            <AccordionSection key={id} id={id} meta={meta} open={isOpen} onToggle={()=>toggleOpen(id)}
              hidden={isHidden} onToggleVisibility={toggleVisibility} badge={badge} draggableProps={draggableProps}
            >
              {sugg.map((s,i)=><AITip key={i} text={`AI: ${s.suggestion}`} onApply={()=>{if(id==="summary")upd("summary",s.suggestion);}}/>)}

              {id==="header"&&(
                <>
                  <TwoCol>
                    <Field label="Full Name"  value={data.name}      onChange={v=>upd("name",v)}/>
                    <Field label="Role / Title" value={data.jobTitle} onChange={v=>upd("jobTitle",v)} placeholder="Senior Developer"/>
                    <Field label="Email"      value={data.email}     onChange={v=>upd("email",v)} type="email"/>
                    <Field label="Phone"      value={data.phone}     onChange={v=>upd("phone",v)} type="tel"/>
                    <Field label="Location"   value={data.location}  onChange={v=>upd("location",v)} placeholder="City, State"/>
                  </TwoCol>
                  <div className="pt-1">
                    <p className="section-label mb-2">Professional Links</p>
                    <TwoCol>
                      <Field label="LinkedIn"   value={data.linkedin}   onChange={v=>upd("linkedin",v)} placeholder="linkedin.com/in/…"/>
                      <Field label="GitHub"     value={data.github}     onChange={v=>upd("github",v)} placeholder="github.com/…"/>
                      <Field label="Portfolio"  value={data.portfolio}  onChange={v=>upd("portfolio",v)} placeholder="yoursite.com"/>
                      <Field label="LeetCode"   value={data.leetcode}   onChange={v=>upd("leetcode",v)} placeholder="leetcode.com/u/…"/>
                      <Field label="HackerRank" value={data.hackerrank} onChange={v=>upd("hackerrank",v)} placeholder="hackerrank.com/…"/>
                    </TwoCol>
                    <div className="mt-3">
                      <p className="section-label mb-2">Other Links</p>
                      {(data.otherLinks||[]).map((l,i)=>(
                        <div key={i} className="flex gap-2 mb-2">
                          <input className="form-input w-28" placeholder="Label" value={l.label||""} onChange={e=>{const a=[...(data.otherLinks||[])];a[i]={...a[i],label:e.target.value};upd("otherLinks",a);}}/>
                          <input className="form-input flex-1" placeholder="URL" value={l.url||""} onChange={e=>{const a=[...(data.otherLinks||[])];a[i]={...a[i],url:e.target.value};upd("otherLinks",a);}}/>
                          <button onClick={()=>{const a=[...(data.otherLinks||[])];a.splice(i,1);upd("otherLinks",a);}} className="p-2 text-gray-400 hover:text-red-500 transition-colors"><X className="w-4 h-4"/></button>
                        </div>
                      ))}
                      <button onClick={()=>upd("otherLinks",[...(data.otherLinks||[]),{label:"",url:""}])} className="text-xs text-brand-500 hover:underline flex items-center gap-1"><Plus className="w-3 h-3"/>Add link</button>
                    </div>
                  </div>
                </>
              )}

              {id==="summary"&&(
                <TextareaField label="Summary" value={data.summary} onChange={v=>upd("summary",v)} rows={5}
                  placeholder="Results-driven engineer with X years…" hint="3–4 sentences. Include top skills and a quantifiable achievement."/>
              )}

              {id==="skills"&&(
                <>
                  <ChipInput label="Technical Skills" values={data.skills?.technical||[]} onChange={v=>upd("skills.technical",v)} placeholder="Type a skill, press Enter…"/>
                  <ChipInput label="Tools & Platforms" values={data.skills?.tools||[]} onChange={v=>upd("skills.tools",v)} placeholder="Docker, Jira, Figma…"/>
                  <ChipInput label="Cloud" values={data.skills?.cloud||[]} onChange={v=>upd("skills.cloud",v)} placeholder="AWS, Azure, GCP…"/>
                  <ChipInput label="Soft Skills" values={data.skills?.soft||[]} onChange={v=>upd("skills.soft",v)} placeholder="Leadership, Communication…"/>
                  <ChipInput label="Languages (Programming)" values={data.skills?.languages||[]} onChange={v=>upd("skills.languages",v)} placeholder="Python, TypeScript…"/>
                </>
              )}

              {id==="experience"&&(
                <>
                  {(data.experience||[]).map((exp,i)=>{
                    const key=`experience:${i}`;
                    return(
                      <EntryRow key={exp.id||i} title={exp.title} subtitle={exp.company} editing={editingKey===key}
                        onEdit={()=>setEditingKey(editingKey===key?null:key)} onDelete={()=>removeItem("experience",i)}
                      >
                        <TwoCol>
                          <Field label="Job Title"  value={exp.title}     onChange={v=>updList("experience",i,"title",v)}/>
                          <Field label="Company"    value={exp.company}   onChange={v=>updList("experience",i,"company",v)}/>
                          <Field label="Start Date" value={exp.startDate} onChange={v=>updList("experience",i,"startDate",v)} placeholder="Jan 2022"/>
                          <Field label="End Date"   value={exp.endDate}   onChange={v=>updList("experience",i,"endDate",v)} placeholder="Present"/>
                          <Field label="Location"   value={exp.location}  onChange={v=>updList("experience",i,"location",v)} placeholder="City or Remote"/>
                        </TwoCol>
                        <TextareaField label="Description (one bullet per line)" value={(exp.bullets||[]).join("\n")} onChange={v=>updList("experience",i,"bullets",v.split("\n"))} rows={4}
                          placeholder="Developed REST APIs with Node.js…" hint="Start each bullet with a strong past-tense action verb."/>
                      </EntryRow>
                    );
                  })}
                  <AddBtn label="Add Experience" onClick={()=>addItem("experience",{title:"",company:"",location:"",startDate:"",endDate:"",current:false,bullets:[""]})}/>
                </>
              )}

              {id==="education"&&(
                <>
                  {(data.education||[]).map((edu,i)=>{
                    const key=`education:${i}`;
                    return(
                      <EntryRow key={edu.id||i} title={edu.degree} subtitle={edu.institution} editing={editingKey===key}
                        onEdit={()=>setEditingKey(editingKey===key?null:key)} onDelete={()=>removeItem("education",i)}
                      >
                        <TwoCol>
                          <Field label="School"     value={edu.institution} onChange={v=>updList("education",i,"institution",v)}/>
                          <Field label="Degree"     value={edu.degree}      onChange={v=>updList("education",i,"degree",v)} placeholder="B.S. Computer Science"/>
                          <Field label="Start Date" value={edu.startDate}   onChange={v=>updList("education",i,"startDate",v)} placeholder="2017"/>
                          <Field label="End Date"   value={edu.endDate}     onChange={v=>updList("education",i,"endDate",v)} placeholder="2021"/>
                          <Field label="Location"   value={edu.location}    onChange={v=>updList("education",i,"location",v)}/>
                          <Field label="GPA"        value={edu.gpa}         onChange={v=>updList("education",i,"gpa",v)} placeholder="3.8"/>
                        </TwoCol>
                        <TextareaField label="Description" value={edu.honors} onChange={v=>updList("education",i,"honors",v)} rows={2} placeholder="Honors, relevant coursework, activities…"/>
                      </EntryRow>
                    );
                  })}
                  <AddBtn label="Add Education" onClick={()=>addItem("education",{degree:"",institution:"",location:"",startDate:"",endDate:"",gpa:"",honors:""})}/>
                </>
              )}

              {id==="projects"&&(
                <>
                  {(data.projects||[]).map((p,i)=>{
                    const key=`projects:${i}`;
                    return(
                      <EntryRow key={p.id||i} title={p.name} subtitle={(p.technologies||[]).join(", ")} editing={editingKey===key}
                        onEdit={()=>setEditingKey(editingKey===key?null:key)} onDelete={()=>removeItem("projects",i)}
                      >
                        <TwoCol>
                          <Field label="Project Name"    value={p.name}        onChange={v=>updList("projects",i,"name",v)}/>
                          <Field label="Tech Stack"       value={(p.technologies||[]).join(", ")} onChange={v=>updList("projects",i,"technologies",v.split(",").map(s=>s.trim()))} placeholder="React, Node.js"/>
                          <Field label="GitHub"           value={p.githubUrl}   onChange={v=>updList("projects",i,"githubUrl",v)} placeholder="github.com/…"/>
                          <Field label="Live Demo"         value={p.liveDemoUrl} onChange={v=>updList("projects",i,"liveDemoUrl",v)} placeholder="https://…"/>
                        </TwoCol>
                        <TextareaField label="Description" value={p.description} onChange={v=>updList("projects",i,"description",v)} rows={3} placeholder="Describe the project, your role, and the impact…"/>
                      </EntryRow>
                    );
                  })}
                  <AddBtn label="Add Project" onClick={()=>addItem("projects",{name:"",description:"",technologies:[],githubUrl:"",liveDemoUrl:"",additionalUrl:""})}/>
                </>
              )}

              {id==="certifications"&&(
                <>
                  {(data.certifications||[]).map((c,i)=>{
                    const key=`certifications:${i}`;
                    return(
                      <EntryRow key={c.id||i} title={c.name} subtitle={c.provider} editing={editingKey===key}
                        onEdit={()=>setEditingKey(editingKey===key?null:key)} onDelete={()=>removeItem("certifications",i)}
                      >
                        <TwoCol>
                          <Field label="Certification Name" value={c.name}          onChange={v=>updList("certifications",i,"name",v)} placeholder="AWS Solutions Architect"/>
                          <Field label="Provider"           value={c.provider}       onChange={v=>updList("certifications",i,"provider",v)} placeholder="Amazon Web Services"/>
                          <Field label="Issue Date"         value={c.issueDate}      onChange={v=>updList("certifications",i,"issueDate",v)} placeholder="Jan 2024"/>
                          <Field label="Credential ID"      value={c.credentialId}   onChange={v=>updList("certifications",i,"credentialId",v)} placeholder="Optional"/>
                          <Field label="Credential URL"     value={c.credentialUrl}  onChange={v=>updList("certifications",i,"credentialUrl",v)} placeholder="https://…" className="sm:col-span-2"/>
                        </TwoCol>
                      </EntryRow>
                    );
                  })}
                  <AddBtn label="Add Certification" onClick={()=>addItem("certifications",{name:"",provider:"",issueDate:"",credentialId:"",credentialUrl:""})}/>
                </>
              )}

              {id==="achievements"&&(
                <>
                  {(data.achievements||[]).map((a,i)=>{
                    const key=`achievements:${i}`;
                    return(
                      <EntryRow key={a.id||i} title={a.title} subtitle={a.date} editing={editingKey===key}
                        onEdit={()=>setEditingKey(editingKey===key?null:key)} onDelete={()=>removeItem("achievements",i)}
                      >
                        <TwoCol>
                          <Field label="Title" value={a.title} onChange={v=>updList("achievements",i,"title",v)} placeholder="Best Project Award"/>
                          <Field label="Date"  value={a.date}  onChange={v=>updList("achievements",i,"date",v)} placeholder="2023"/>
                        </TwoCol>
                        <TextareaField label="Description" value={a.description} onChange={v=>updList("achievements",i,"description",v)} rows={2} placeholder="Brief description of the achievement…"/>
                      </EntryRow>
                    );
                  })}
                  <AddBtn label="Add Achievement" onClick={()=>addItem("achievements",{title:"",description:"",date:""})}/>
                </>
              )}

              {id==="additionalInfo"&&(
                <TextareaField label="Additional Information" value={data.additionalInfo} onChange={v=>upd("additionalInfo",v)} rows={5}
                  placeholder="Languages spoken, interests, volunteer work, publications…"/>
              )}
            </AccordionSection>
          );
        })}
      </div>

      {/* ── RIGHT PANEL — 60% — always-visible live preview (Parts 2, 6) ── */}
      <div className="hidden lg:flex flex-col flex-1 bg-gray-100 dark:bg-gray-900/40 overflow-hidden">
        <div className="flex items-center justify-between px-5 py-3 border-b border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 flex-shrink-0">
          <span className="text-xs font-semibold text-gray-500 dark:text-gray-400">Live Preview</span>
          <div className="flex items-center gap-1">
            <button onClick={()=>setZoom(z=>Math.max(0.35,+(z-0.08).toFixed(2)))} className="btn-ghost p-1.5 rounded-lg" title="Zoom out"><ZoomOut className="w-3.5 h-3.5"/></button>
            <span className="text-xs text-gray-400 w-10 text-center tabular-nums">{Math.round(zoom*100)}%</span>
            <button onClick={()=>setZoom(z=>Math.min(1.2,+(z+0.08).toFixed(2)))} className="btn-ghost p-1.5 rounded-lg" title="Zoom in"><ZoomIn className="w-3.5 h-3.5"/></button>
            <button onClick={()=>setFullPreview(true)} className="btn-ghost p-1.5 rounded-lg" title="Fullscreen preview"><Maximize2 className="w-3.5 h-3.5"/></button>
            <button onClick={()=>window.print()} className="btn-primary text-xs py-1.5 px-3 ml-1" title="Export as PDF">
              <Download className="w-3.5 h-3.5"/>Export
            </button>
          </div>
        </div>
        <div className="flex-1 overflow-auto flex justify-center py-8">
          <div style={{transform:`scale(${zoom})`,transformOrigin:"top center",transition:"transform 0.15s ease"}}>
            <ResumePreview data={data} sectionOrder={sectionOrder} hiddenSections={hiddenSections}/>
          </div>
        </div>
      </div>

      {/* TASK 4 FIX: hidden print target — always mounted with the CURRENT (possibly
          edited) resume data. index.css's @media print rules hide everything else
          and show only this node at true 100% scale, so Export always downloads
          what's on screen right now, edits included — never the original upload. */}
      <div id="print-resume-root">
        <ResumePreview data={data} sectionOrder={sectionOrder} hiddenSections={hiddenSections}/>
      </div>

      {/* Mobile-only preview trigger (right panel hidden below lg breakpoint) */}
      <button onClick={()=>setFullPreview(true)}
        className="lg:hidden fixed bottom-5 right-5 z-40 btn-primary rounded-full shadow-lg px-5 py-3">
        <Eye className="w-4 h-4"/>Preview
      </button>

      {/* Fullscreen / mobile preview modal */}
      <AnimatePresence>
        {fullPreview&&(
          <motion.div initial={{opacity:0}} animate={{opacity:1}} exit={{opacity:0}} className="fixed inset-0 z-50 bg-black/70 flex items-start justify-center overflow-y-auto py-8 px-4" onClick={()=>setFullPreview(false)}>
            <motion.div initial={{scale:0.96,opacity:0}} animate={{scale:1,opacity:1}} exit={{scale:0.96,opacity:0}} className="relative" onClick={e=>e.stopPropagation()}>
              <button onClick={()=>setFullPreview(false)} className="absolute -top-10 right-0 text-white/70 hover:text-white flex items-center gap-1.5 text-sm"><X className="w-4 h-4"/>Close preview</button>
              <ResumePreview data={data} sectionOrder={sectionOrder} hiddenSections={hiddenSections}/>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
