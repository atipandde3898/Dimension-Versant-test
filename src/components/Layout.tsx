import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { Award, LogOut, ShieldCheck, UserCheck, AlertCircle } from 'lucide-react';

export const Layout: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { session, isAdmin, candidate, isConfigured, signOut } = useAuth();
  const location = useLocation();

  const isAdminRoute = location.pathname.startsWith('/admin');

  return (
    <div className="min-h-screen flex flex-col bg-slate-50 text-slate-800 font-sans selection:bg-blue-100 selection:text-blue-900">
      {/* Config alert if env variables are not populated */}
      {!isConfigured && (
        <aside aria-label="Configuration notice" className="bg-amber-50 border-b border-amber-200 text-amber-900 px-4 py-2.5 text-xs sm:text-sm">
          <div className="max-w-6xl mx-auto flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <AlertCircle className="w-4 h-4 text-amber-600 flex-shrink-0" />
              <span>
                <strong>Supabase Setup:</strong> Set <code className="bg-amber-100 px-1.5 py-0.5 rounded font-mono text-xs">VITE_SUPABASE_URL</code> and <code className="bg-amber-100 px-1.5 py-0.5 rounded font-mono text-xs">VITE_SUPABASE_ANON_KEY</code> in environment settings to enable live database queries.
              </span>
            </div>
          </div>
        </aside>
      )}

      {/* Header */}
      <header className="bg-white border-b border-slate-200 sticky top-0 z-30 shadow-xs">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between">
          <Link to="/" className="flex items-center gap-3 group focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 rounded">
            <div className="w-9 h-9 rounded-lg bg-blue-700 flex items-center justify-center text-white font-bold text-lg shadow-sm group-hover:bg-blue-800 transition-colors">
              D
            </div>
            <div className="flex flex-col">
              <span className="text-lg sm:text-xl font-bold tracking-tight text-slate-900 leading-none">
                Dimension Education
              </span>
              <span className="text-[11px] font-semibold text-blue-700 tracking-wider uppercase mt-1">
                Verbal Communication Test
              </span>
            </div>
          </Link>

          {/* Header navigation / status */}
          <nav aria-label="Main Navigation" className="flex items-center gap-2 sm:gap-4">
            {isAdminRoute ? (
              <div className="flex items-center gap-2 sm:gap-3 text-sm">
                <Link
                  to="/admin"
                  className={`px-3 py-1.5 rounded-md font-medium text-xs sm:text-sm transition-colors ${
                    location.pathname === '/admin' ? 'bg-blue-50 text-blue-700 font-semibold' : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
                  }`}
                >
                  Candidates
                </Link>
                <Link
                  to="/admin/codes"
                  className={`px-3 py-1.5 rounded-md font-medium text-xs sm:text-sm transition-colors ${
                    location.pathname === '/admin/codes' ? 'bg-blue-50 text-blue-700 font-semibold' : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
                  }`}
                >
                  Test Codes
                </Link>
                <Link
                  to="/admin/questions"
                  className={`px-3 py-1.5 rounded-md font-medium text-xs sm:text-sm transition-colors ${
                    location.pathname === '/admin/questions' ? 'bg-blue-50 text-blue-700 font-semibold' : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
                  }`}
                >
                  Questions
                </Link>
                {session && (
                  <button
                    onClick={() => signOut()}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs sm:text-sm text-slate-600 hover:text-red-700 hover:bg-red-50 transition-colors"
                    title="Sign Out"
                  >
                    <LogOut className="w-4 h-4" />
                    <span className="hidden sm:inline">Sign out</span>
                  </button>
                )}
              </div>
            ) : (
              <div className="flex items-center gap-3">
                {candidate && (
                  <div className="hidden sm:flex items-center gap-2 text-xs bg-blue-50 text-blue-800 px-3 py-1.5 rounded-full border border-blue-200">
                    <UserCheck className="w-3.5 h-3.5 text-blue-600" />
                    <span className="font-medium truncate max-w-[140px]">{candidate.full_name}</span>
                    <span className="text-blue-400">|</span>
                    <span className="font-mono text-blue-700 font-semibold">{candidate.test_code}</span>
                  </div>
                )}
                {isAdmin ? (
                  <Link
                    to="/admin"
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs sm:text-sm font-medium text-blue-700 bg-blue-50 hover:bg-blue-100 border border-blue-200 transition-colors"
                  >
                    <ShieldCheck className="w-4 h-4 text-blue-600" />
                    <span>Admin Portal</span>
                  </Link>
                ) : (
                  <Link
                    to="/admin/login"
                    className="text-xs sm:text-sm text-slate-500 hover:text-slate-900 transition-colors px-2 py-1"
                  >
                    Admin Login
                  </Link>
                )}
              </div>
            )}
          </nav>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 flex flex-col">
        {children}
      </main>

      {/* Footer */}
      <footer className="bg-white border-t border-slate-200 py-6 text-slate-500 text-sm">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <Award className="w-4 h-4 text-blue-600" />
            <span className="font-semibold text-slate-700">© Dimension Education</span>
            <span className="text-slate-400">·</span>
            <span>All rights reserved</span>
          </div>
          <div className="flex items-center gap-4 text-xs text-slate-400">
            <span>Verbal Communication Assessment Platform</span>
            <span>·</span>
            <span>Prompt 1: Foundation & Branding</span>
          </div>
        </div>
      </footer>
    </div>
  );
};
