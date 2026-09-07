import React, { useState } from "react";
import { useDropzone } from "react-dropzone";
import { FileText, Type, Upload, CheckCircle } from "lucide-react";
import { jdAPI } from "../../services/api";
import { useAnalysis } from "../../context/AnalysisContext";
import { Spinner } from "../ui";

export default function JobDescriptionInput() {
  const { jdText, setJdText } = useAnalysis();
  const [tab,     setTab]     = useState("paste");
  const [jdFile,  setJdFile]  = useState(null);
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState("");

  const onDrop = async (accepted) => {
    const f = accepted[0];
    if (!f) return;
    setLoading(true);
    setError("");
    try {
      const res = await jdAPI.upload(f);
      setJdText(res.data.rawText);
      setJdFile(f);
    } catch (err) {
      setError(err.userMessage || "Failed to parse file.");
    } finally {
      setLoading(false);
    }
  };

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop, accept: {
      "application/pdf": [".pdf"],
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document": [".docx"],
      "text/plain": [".txt"],
    }, multiple: false,
  });

  const charCount   = jdText.length;
  const isGoodLength = charCount >= 200;

  return (
    <div>
      <div className="flex gap-1 p-1 bg-gray-100 dark:bg-gray-800 rounded-lg w-fit mb-4">
        {[["paste","Paste text",Type],["upload","Upload file",Upload]].map(([id,lbl,Icon]) => (
          <button key={id} onClick={() => setTab(id)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all
              ${tab === id
                ? "bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100 shadow-sm"
                : "text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
              }`}
          >
            <Icon className="w-3.5 h-3.5" /> {lbl}
          </button>
        ))}
      </div>

      {tab === "paste" && (
        <div>
          <textarea value={jdText} onChange={(e) => setJdText(e.target.value)}
            className="form-input min-h-[180px] resize-y text-sm leading-relaxed"
            placeholder={`Paste the full job description here...\n\nExample:\nWe are looking for a Senior React Developer with 5+ years of experience in JavaScript, TypeScript, Node.js, REST APIs, and cloud platforms like AWS...`}
          />
          <div className="flex items-center justify-between mt-2">
            <p className="text-xs text-gray-400">{charCount.toLocaleString()} characters
              {charCount > 0 && !isGoodLength && <span className="text-amber-500 ml-2">· Paste the full JD for best results</span>}
            </p>
            {isGoodLength && <span className="text-xs text-green-600 dark:text-green-400 font-medium">✓ Good length</span>}
          </div>
        </div>
      )}

      {tab === "upload" && (
        <div>
          {jdFile ? (
            <div className="flex items-center gap-3 p-3 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-xl">
              <CheckCircle className="w-5 h-5 text-green-600 dark:text-green-400 flex-shrink-0" />
              <div className="flex-1">
                <p className="text-sm font-medium text-green-800 dark:text-green-300">{jdFile.name}</p>
                <p className="text-xs text-green-600 dark:text-green-500">Extracted {charCount} chars</p>
              </div>
              <button onClick={() => { setJdFile(null); setJdText(""); }} className="text-xs text-green-600 dark:text-green-400 hover:underline">Remove</button>
            </div>
          ) : loading ? (
            <div className="flex items-center justify-center gap-2 p-8 border border-gray-200 dark:border-gray-700 rounded-xl">
              <Spinner size="sm" />
              <span className="text-sm text-gray-500 dark:text-gray-400">Parsing file…</span>
            </div>
          ) : (
            <div {...getRootProps()} className={`drop-zone ${isDragActive ? "active" : ""}`}>
              <input {...getInputProps()} />
              <Upload className="w-8 h-8 text-gray-300 dark:text-gray-600 mx-auto mb-3" />
              <p className="text-sm text-gray-600 dark:text-gray-400 mb-1">Upload job description file</p>
              <p className="text-xs text-gray-400">PDF, DOCX, or TXT</p>
            </div>
          )}
          {error && <p className="text-xs text-red-500 mt-2">{error}</p>}
        </div>
      )}
    </div>
  );
}
