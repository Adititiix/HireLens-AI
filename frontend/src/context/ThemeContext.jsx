import React,{createContext,useContext,useState,useEffect}from"react";
const ThemeContext=createContext(null);
export function ThemeProvider({children}){
  const[theme,setTheme]=useState(()=>{try{return localStorage.getItem("riq_theme")||"light";}catch{return"light";}});
  useEffect(()=>{
    if(theme==="dark")document.documentElement.classList.add("dark");
    else document.documentElement.classList.remove("dark");
    try{localStorage.setItem("riq_theme",theme);}catch{}
  },[theme]);
  const toggleTheme=()=>setTheme(t=>t==="light"?"dark":"light");
  return<ThemeContext.Provider value={{theme,toggleTheme,isDark:theme==="dark"}}>{children}</ThemeContext.Provider>;
}
export const useTheme=()=>{const c=useContext(ThemeContext);if(!c)throw new Error("useTheme outside ThemeProvider");return c;};
