import React,{createContext,useContext,useState,useEffect}from"react";
import api from"../services/api";
const AuthContext=createContext(null);
export function AuthProvider({children}){
  const[user,setUser]=useState(null);
  const[loading,setLoading]=useState(true);
  useEffect(()=>{
    const token=localStorage.getItem("riq_token");
    if(token){
      api.defaults.headers.common["Authorization"]=`Bearer ${token}`;
      api.get("/auth/me").then(r=>setUser(r.data.user)).catch(()=>{localStorage.removeItem("riq_token");delete api.defaults.headers.common["Authorization"];}).finally(()=>setLoading(false));
    }else{setLoading(false);}
  },[]);
  const login=async(email,password)=>{
    const r=await api.post("/auth/login",{email,password});
    localStorage.setItem("riq_token",r.data.token);
    api.defaults.headers.common["Authorization"]=`Bearer ${r.data.token}`;
    setUser(r.data.user);return r.data;
  };
  const register=async(name,email,password)=>{
    const r=await api.post("/auth/register",{name,email,password});
    localStorage.setItem("riq_token",r.data.token);
    api.defaults.headers.common["Authorization"]=`Bearer ${r.data.token}`;
    setUser(r.data.user);return r.data;
  };
  const logout=()=>{localStorage.removeItem("riq_token");delete api.defaults.headers.common["Authorization"];setUser(null);};
  return<AuthContext.Provider value={{user,loading,login,register,logout}}>{children}</AuthContext.Provider>;
}
export const useAuth=()=>{const c=useContext(AuthContext);if(!c)throw new Error("useAuth outside AuthProvider");return c;};
