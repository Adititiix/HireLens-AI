import axios from "axios";
const api = axios.create({ baseURL: import.meta.env.VITE_API_URL || "/api", timeout: 60000 });
api.interceptors.response.use(r=>r, err=>{
  err.userMessage = err.response?.data?.error || err.response?.data?.message || err.message || "An error occurred";
  return Promise.reject(err);
});
export default api;
export const resumeAPI = {
  upload:(file,onProgress)=>{
    const f=new FormData();f.append("resume",file);
    return api.post("/resume/upload",f,{headers:{"Content-Type":"multipart/form-data"},onUploadProgress:e=>onProgress&&onProgress(e)});
  },
  uploadAnon:(file,onProgress)=>{
    const f=new FormData();f.append("resume",file);
    return api.post("/resume/upload-anon",f,{headers:{"Content-Type":"multipart/form-data"},onUploadProgress:e=>onProgress&&onProgress(e)});
  },
  list:()=>api.get("/resume"),
  get:(id)=>api.get(`/resume/${id}`),
  update:(id,data)=>api.put(`/resume/${id}`,data),
  delete:(id)=>api.delete(`/resume/${id}`),
  saveVersion:(id,lbl)=>api.post(`/resume/${id}/version`,{label:lbl}),
};
export const analysisAPI = {
  run:(resumeId,jdText)=>api.post("/analysis/run",{resumeId,jdText}),
  get:(resumeId)=>api.get(`/analysis/${resumeId}`),
  list:()=>api.get("/analysis/history"),
};
export const jdAPI = {
  upload:(file)=>{const f=new FormData();f.append("file",file);return api.post("/jd/upload",f,{headers:{"Content-Type":"multipart/form-data"}});},
  parse:(text)=>api.post("/jd/parse",{text}),
};
