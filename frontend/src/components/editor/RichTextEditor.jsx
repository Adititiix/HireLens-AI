import React,{useRef,useEffect,useState}from"react";
import{Bold,Italic,Underline,List,ListOrdered,Undo2,Redo2}from"lucide-react";

/**
 * Lightweight rich-text editor — browser contenteditable + document.execCommand,
 * no editor framework. Stores a small, sanitized HTML subset (b/i/u, ul/ol/li,
 * div/p/br, line-height on blocks) that ResumePreview renders as-is, so the
 * formatting is identical in Editor → Preview → Print / Save as PDF.
 *
 * Backward compatible: plain-text values saved before this editor existed
 * (newline-separated) are converted to one <div> per line on load/render.
 */

const ALLOWED_TAGS=new Set(["B","STRONG","I","EM","U","UL","OL","LI","P","DIV","BR","SPAN"]);
const DROP_TAGS=new Set(["SCRIPT","STYLE","IFRAME","OBJECT","EMBED","LINK","META","TEMPLATE"]);
export const LINE_SPACING_OPTIONS=[{value:"",label:"Default"},{value:"1",label:"1.0"},{value:"1.15",label:"1.15"},{value:"1.5",label:"1.5"},{value:"2",label:"2.0"}];

const escapeHtml=s=>String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
const looksLikeHtml=s=>/<\/?(b|strong|i|em|u|ul|ol|li|p|div|br|span)\b[^>]*>/i.test(s);

/** Whitelist sanitizer: keeps only formatting tags + numeric line-height. */
export function sanitizeRichText(html){
  if(!html)return"";
  const doc=new DOMParser().parseFromString(`<div>${html}</div>`,"text/html"); // inert document — nothing executes or loads
  const root=doc.body.firstChild;
  const clean=(node)=>{
    for(const child of [...node.childNodes]){
      if(child.nodeType===Node.TEXT_NODE)continue;
      if(child.nodeType!==Node.ELEMENT_NODE||DROP_TAGS.has(child.tagName)){child.remove();continue;}
      clean(child);
      if(!ALLOWED_TAGS.has(child.tagName)){child.replaceWith(...child.childNodes);continue;}
      const lh=child.style.lineHeight;
      for(const attr of [...child.attributes])child.removeAttribute(attr.name);
      if(/^\d+(\.\d+)?$/.test(lh)&&child.tagName!=="SPAN")child.style.lineHeight=lh;
    }
  };
  clean(root);
  return root.innerHTML;
}

/** Any stored value (legacy plain text or rich HTML) → safe HTML for rendering. */
export function toRichHtml(value){
  if(!value)return"";
  if(looksLikeHtml(value))return sanitizeRichText(value);
  return value.split(/\r?\n/).map(l=>`<div>${escapeHtml(l)||"<br>"}</div>`).join("");
}

export function isRichTextEmpty(value){
  if(!value)return true;
  if(/<li\b/i.test(value))return false;
  return value.replace(/<[^>]*>/g,"").replace(/&nbsp;/g," ").trim()==="";
}

function ToolbarButton({title,active,onClick,children}){
  return(
    <button type="button" title={title} onMouseDown={e=>{e.preventDefault();onClick();}}
      className={`p-1.5 rounded-md transition-colors ${active?"bg-brand-50 text-brand-600 dark:bg-brand-900/30 dark:text-brand-400":"text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800"}`}>
      {children}
    </button>
  );
}
const Divider=()=><span className="w-px h-4 bg-gray-200 dark:bg-gray-700 mx-1"/>;

export default function RichTextEditor({label,value,onChange,placeholder="",hint}){
  const ref=useRef(null);
  const lastEmitted=useRef(null);
  const savedRange=useRef(null);
  const[active,setActive]=useState({});
  const[lineHeight,setLineHeight]=useState("");

  // External value → DOM, only when it isn't the value we just emitted (avoids caret jumps).
  useEffect(()=>{
    const el=ref.current;if(!el||value===lastEmitted.current)return;
    el.innerHTML=toRichHtml(value||"");
    lastEmitted.current=value;
  },[value]);

  // Track selection inside the editor: toolbar active states, current line spacing,
  // and a saved range so the line-spacing <select> can act after it steals focus.
  useEffect(()=>{
    const onSel=()=>{
      const el=ref.current;const sel=document.getSelection();
      if(!el||!sel||!sel.rangeCount)return;
      const r=sel.getRangeAt(0);
      if(!el.contains(r.commonAncestorContainer))return;
      savedRange.current=r.cloneRange();
      setActive({
        bold:document.queryCommandState("bold"),italic:document.queryCommandState("italic"),
        underline:document.queryCommandState("underline"),
        ul:document.queryCommandState("insertUnorderedList"),ol:document.queryCommandState("insertOrderedList"),
      });
      let n=r.startContainer;
      while(n&&n!==el&&n.parentNode!==el)n=n.parentNode;
      setLineHeight(n&&n!==el&&n.nodeType===Node.ELEMENT_NODE?(n.style.lineHeight||""):"");
    };
    document.addEventListener("selectionchange",onSel);
    return()=>document.removeEventListener("selectionchange",onSel);
  },[]);

  const emit=()=>{
    const el=ref.current;if(!el)return;
    const html=isRichTextEmpty(el.innerHTML)?"":sanitizeRichText(el.innerHTML);
    lastEmitted.current=html;
    onChange(html);
  };

  const exec=(cmd)=>{
    ref.current?.focus();
    document.execCommand("styleWithCSS",false,false); // emit <b>/<i>/<u> tags, not inline styles
    document.execCommand(cmd,false,null);
    emit();
  };

  // Line spacing applies to the top-level blocks touched by the selection
  // (all blocks if there is no selection in the editor yet).
  const applyLineSpacing=(lh)=>{
    const el=ref.current;if(!el)return;
    setLineHeight(lh);
    const range=savedRange.current&&el.contains(savedRange.current.commonAncestorContainer)?savedRange.current:null;
    const tops=[...el.childNodes];
    let hit=new Set(range?tops.filter(n=>range.intersectsNode(n)):tops);
    if(!hit.size)hit=new Set(tops);
    const targets=[];let run=null;
    for(const n of tops){
      if(n.nodeType===Node.ELEMENT_NODE&&/^(DIV|P|UL|OL)$/.test(n.tagName)){run=null;if(hit.has(n))targets.push(n);continue;}
      if(!run){run=document.createElement("div");el.insertBefore(run,n);} // wrap loose inline content so it can carry line-height
      if(hit.has(n)&&!targets.includes(run))targets.push(run);
      run.appendChild(n);
    }
    targets.forEach(b=>{b.style.lineHeight=lh;});
    emit();
  };

  // The editor's section cards are draggable (section reordering); suspend that while
  // the mouse is down in here so drag-to-select text doesn't start a section drag.
  const onMouseDown=(e)=>{
    const card=e.currentTarget.closest('[draggable="true"]');
    if(!card)return;
    card.draggable=false;
    document.addEventListener("mouseup",()=>{card.draggable=true;},{once:true});
  };

  const onPaste=(e)=>{
    // Paste as plain text so foreign fonts/styles (e.g. Calibri from Word) never enter the resume.
    e.preventDefault();
    document.execCommand("insertText",false,e.clipboardData.getData("text/plain"));
  };

  return(
    <div className="space-y-1">
      {label&&<label className="section-label">{label}</label>}
      <div className="border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden bg-white dark:bg-gray-800 focus-within:border-brand-500 focus-within:ring-2 focus-within:ring-brand-500/10 transition-colors">
        <div className="flex flex-wrap items-center gap-0.5 px-1.5 py-1 border-b border-gray-100 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/40">
          <ToolbarButton title="Bold (Ctrl+B)" active={active.bold} onClick={()=>exec("bold")}><Bold className="w-3.5 h-3.5"/></ToolbarButton>
          <ToolbarButton title="Italic (Ctrl+I)" active={active.italic} onClick={()=>exec("italic")}><Italic className="w-3.5 h-3.5"/></ToolbarButton>
          <ToolbarButton title="Underline (Ctrl+U)" active={active.underline} onClick={()=>exec("underline")}><Underline className="w-3.5 h-3.5"/></ToolbarButton>
          <Divider/>
          <ToolbarButton title="Bulleted list" active={active.ul} onClick={()=>exec("insertUnorderedList")}><List className="w-3.5 h-3.5"/></ToolbarButton>
          <ToolbarButton title="Numbered list" active={active.ol} onClick={()=>exec("insertOrderedList")}><ListOrdered className="w-3.5 h-3.5"/></ToolbarButton>
          <Divider/>
          <label className="flex items-center gap-1 text-xs text-gray-500 dark:text-gray-400 pl-1" title="Line spacing">
            Spacing
            <select value={lineHeight} onChange={e=>applyLineSpacing(e.target.value)}
              className="bg-transparent text-xs border border-gray-200 dark:border-gray-700 rounded px-1 py-0.5 outline-none dark:text-gray-200">
              {LINE_SPACING_OPTIONS.map(o=><option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </label>
          <Divider/>
          <ToolbarButton title="Undo (Ctrl+Z)" onClick={()=>exec("undo")}><Undo2 className="w-3.5 h-3.5"/></ToolbarButton>
          <ToolbarButton title="Redo (Ctrl+Y)" onClick={()=>exec("redo")}><Redo2 className="w-3.5 h-3.5"/></ToolbarButton>
        </div>
        <div ref={ref} contentEditable suppressContentEditableWarning role="textbox" aria-multiline="true"
          data-placeholder={placeholder} onInput={emit} onPaste={onPaste} onMouseDown={onMouseDown}
          className="rich-text rich-text-editor min-h-[120px] px-3 py-2.5 text-sm leading-relaxed outline-none text-gray-900 dark:text-gray-100"/>
      </div>
      {hint&&<p className="text-xs text-gray-400">{hint}</p>}
    </div>
  );
}
