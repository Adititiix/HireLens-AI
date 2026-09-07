import React from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider }     from "./context/AuthContext";
import { AnalysisProvider } from "./context/AnalysisContext";
import { ThemeProvider }    from "./context/ThemeContext";
import Navbar        from "./components/ui/Navbar";
import LandingPage   from "./pages/LandingPage";
import AnalyzerPage  from "./pages/AnalyzerPage";
import DashboardPage from "./pages/DashboardPage";
import EditorPage    from "./pages/EditorPage";
import HistoryPage   from "./pages/HistoryPage";
import LoginPage     from "./pages/LoginPage";
import RegisterPage  from "./pages/RegisterPage";

export default function App() {
  return (
    <BrowserRouter>
      <ThemeProvider>
        <AuthProvider>
          <AnalysisProvider>
            <div className="min-h-screen bg-gray-50 dark:bg-[#0a0a0f] transition-colors duration-200">
              <Navbar />
              <Routes>
                <Route path="/"          element={<LandingPage />} />
                <Route path="/analyze"   element={<AnalyzerPage />} />
                <Route path="/dashboard" element={<DashboardPage />} />
                <Route path="/editor"    element={<EditorPage />} />
                <Route path="/history"   element={<HistoryPage />} />
                <Route path="/login"     element={<LoginPage />} />
                <Route path="/register"  element={<RegisterPage />} />
                <Route path="*"          element={<Navigate to="/" replace />} />
              </Routes>
            </div>
          </AnalysisProvider>
        </AuthProvider>
      </ThemeProvider>
    </BrowserRouter>
  );
}
