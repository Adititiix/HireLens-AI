import React, { useCallback, useState } from "react";
import { useDropzone } from "react-dropzone";
import { motion } from "framer-motion";
import { Upload, FileText, X, CheckCircle, AlertCircle } from "lucide-react";
import { resumeAPI } from "../../services/api";
import { useAnalysis } from "../../context/AnalysisContext";
import { Spinner } from "../ui";

const ACCEPTED = {
  "application/pdf": [".pdf"],
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": [".docx"],
  "text/plain": [".txt"],
};

export default function ResumeUpload() {
  const { setCurrentResume } = useAnalysis();
  const [file,     setFile]     = useState(null);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress]  = useState(0);
  const [error,    setError]     = useState("");
  const [uploaded, setUploaded]  = useState(false);

  const onDrop = useCallback(async (accepted, rejected) => {
    if (rejected.length > 0) {
      setError("Invalid file type. Use PDF, DOCX, or TXT.");
      return;
    }
    const f = accepted[0];
    if (!f) return;
    setFile(f);
    setError("");
    setUploading(true);
    setProgress(0);
    try {
      const res = await resumeAPI.upload(f, (e) => {
        setProgress(Math.round((e.loaded * 100) / (e.total || 1)));
      });
      // Support both response shapes: { resume } or { _id, structured }
      const resumeData = res.data.resume || res.data;
      setCurrentResume(resumeData);
      setUploaded(true);
    } catch (err) {
      setError(err.userMessage || "Upload failed.");
      setFile(null);
    } finally {
      setUploading(false);
    }
  }, [setCurrentResume]);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop, accept: ACCEPTED, maxSize: 10 * 1024 * 1024, multiple: false, disabled: uploading,
  });

  const reset = () => { setFile(null); setUploaded(false); setError(""); setCurrentResume(null); };

  if (uploaded && file) {
    return (
      <motion.div initial={{ opacity: 0, scale: 0.98 }} animate={{ opacity: 1, scale: 1 }}
        className="flex items-center gap-3 p-4 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-xl"
      >
        <div className="w-9 h-9 bg-green-100 dark:bg-green-800 rounded-lg flex items-center justify-center flex-shrink-0">
          <CheckCircle className="w-5 h-5 text-green-600 dark:text-green-400" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-green-800 dark:text-green-300 truncate">{file.name}</p>
          <p className="text-xs text-green-600 dark:text-green-500">{(file.size/1024).toFixed(0)} KB · Parsed successfully</p>
        </div>
        <button onClick={reset} className="p-1.5 rounded-lg hover:bg-green-100 dark:hover:bg-green-800 text-green-600 dark:text-green-400">
          <X className="w-4 h-4" />
        </button>
      </motion.div>
    );
  }

  if (uploading && file) {
    return (
      <div className="p-4 border border-gray-200 dark:border-gray-700 rounded-xl">
        <div className="flex items-center gap-3 mb-3">
          <div className="w-9 h-9 bg-brand-50 dark:bg-brand-900/30 rounded-lg flex items-center justify-center">
            <FileText className="w-5 h-5 text-brand-500" />
          </div>
          <div className="flex-1">
            <p className="text-sm font-medium text-gray-700 dark:text-gray-300 truncate">{file.name}</p>
            <p className="text-xs text-gray-400">Parsing resume…</p>
          </div>
          <Spinner size="sm" />
        </div>
        <div className="h-1 bg-gray-100 dark:bg-gray-800 rounded-full overflow-hidden">
          <motion.div className="h-full bg-brand-500 rounded-full"
            initial={{ width: 0 }} animate={{ width: `${progress}%` }} transition={{ duration: 0.3 }}
          />
        </div>
      </div>
    );
  }

  return (
    <div>
      <div {...getRootProps()} className={`drop-zone ${isDragActive ? "active" : ""}`}>
        <input {...getInputProps()} />
        <div className="w-12 h-12 bg-brand-50 dark:bg-brand-900/30 rounded-xl flex items-center justify-center mx-auto mb-4">
          <Upload className="w-6 h-6 text-brand-400" />
        </div>
        <p className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
          {isDragActive ? "Drop your resume here" : "Upload your resume"}
        </p>
        <p className="text-xs text-gray-400 mb-4">Drag and drop or click to browse</p>
        <div className="flex items-center justify-center gap-2">
          {["PDF","DOCX","TXT"].map((t) => (
            <span key={t} className="px-2.5 py-1 bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400 text-xs font-medium rounded-md">{t}</span>
          ))}
        </div>
      </div>
      {error && (
        <div className="mt-3 flex items-center gap-2 text-red-600 dark:text-red-400 text-sm">
          <AlertCircle className="w-4 h-4 flex-shrink-0" /> {error}
        </div>
      )}
    </div>
  );
}
