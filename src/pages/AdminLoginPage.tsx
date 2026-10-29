import React, { useState } from 'react';
import { useNavigate, useLocation, Link } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { supabase, isSupabaseConfigured } from '../lib/supabase';
import { ShieldCheck, Lock, Mail, ArrowRight, AlertCircle, Loader2, LogOut } from 'lucide-react';

export const AdminLoginPage: React.FC = () => {
  const { session, isAdmin, signOut, refreshAuth } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const from = (location.state as any)?.from || '/admin';

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);

    if (!isSupabaseConfigured) {
      setErrorMessage('Supabase is not configured. Please set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in your environment.');
      return;
    }

    if (!email.trim() || !password) {
      setErrorMessage('Please enter both email and password.');
      return;
    }

    setLoading(true);

    try {
      // 1. Sign in with email + password
      const { data: authData, error: signInError } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });

      if (signInError) {
        throw new Error(signInError.message || 'Invalid email or password.');
      }

      if (!authData.user) {
        throw new Error('Authentication succeeded but no user was returned.');
      }

      // 2. Verify admin role via is_admin() RPC
      const { data: isAdminRole, error: rpcError } = await supabase.rpc('is_admin');

      if (rpcError || !isAdminRole) {
        // Not authorised -> sign out immediately
        await supabase.auth.signOut();
        throw new Error('Not authorised. This account does not have administrator privileges.');
      }

      // 3. Refresh context and redirect to target admin route
      await refreshAuth();
      navigate(from, { replace: true });
    } catch (err: any) {
      console.error('Admin login error:', err);
      setErrorMessage(err.message || 'Login failed.');
      setLoading(false);
    }
  };

  return (
    <div className="flex-1 max-w-md w-full mx-auto p-4 sm:p-8 flex flex-col justify-center">
      <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6 sm:p-8">
        <div className="text-center mb-6">
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-xl bg-blue-50 text-blue-700 mb-3 border border-blue-100 shadow-xs">
            <ShieldCheck className="w-6 h-6" />
          </div>
          <h1 className="text-xl sm:text-2xl font-bold text-slate-900">
            Admin Portal Login
          </h1>
          <p className="text-slate-500 text-xs sm:text-sm mt-1">
            Dimension Education assessment administration
          </p>
        </div>

        {session && isAdmin ? (
          <div className="bg-blue-50 border border-blue-200 rounded-xl p-5 text-center">
            <span className="px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-blue-100 text-blue-800 uppercase tracking-wider">
              Signed In as Administrator
            </span>
            <p className="text-sm font-bold text-slate-900 mt-2 truncate">{session.user.email}</p>
            <div className="mt-4 flex flex-col gap-2">
              <Link
                to="/admin"
                className="w-full py-2.5 bg-blue-700 hover:bg-blue-800 text-white rounded-lg text-xs font-semibold shadow-xs"
              >
                Go to Admin Dashboard
              </Link>
              <button
                type="button"
                onClick={() => signOut()}
                className="w-full py-2 bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 rounded-lg text-xs font-medium inline-flex items-center justify-center gap-1.5"
              >
                <LogOut className="w-3.5 h-3.5 text-slate-500" />
                <span>Sign Out</span>
              </button>
            </div>
          </div>
        ) : (
          <form onSubmit={handleLogin} className="space-y-4">
            {errorMessage && (
              <div
                role="alert"
                className="p-3 bg-red-50 border border-red-200 rounded-lg text-xs text-red-800 flex items-start gap-2 animate-in fade-in"
              >
                <AlertCircle className="w-4 h-4 text-red-600 mt-0.5 flex-shrink-0" />
                <span className="leading-relaxed">{errorMessage}</span>
              </div>
            )}

            <div>
              <label
                htmlFor="adminEmail"
                className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1.5"
              >
                Administrator Email
              </label>
              <div className="relative">
                <Mail className="w-4 h-4 text-slate-400 absolute left-3 top-3" />
                <input
                  id="adminEmail"
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="admin@dimensioneducation.com"
                  disabled={loading}
                  className="w-full pl-9 pr-3 py-2 bg-white border border-slate-300 focus:border-blue-600 focus:ring-2 focus:ring-blue-100 rounded-lg text-sm text-slate-900 placeholder:text-slate-400 outline-none transition-all"
                />
              </div>
            </div>

            <div>
              <label
                htmlFor="adminPassword"
                className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1.5"
              >
                Password
              </label>
              <div className="relative">
                <Lock className="w-4 h-4 text-slate-400 absolute left-3 top-3" />
                <input
                  id="adminPassword"
                  type="password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••••••"
                  disabled={loading}
                  className="w-full pl-9 pr-3 py-2 bg-white border border-slate-300 focus:border-blue-600 focus:ring-2 focus:ring-blue-100 rounded-lg text-sm text-slate-900 placeholder:text-slate-400 outline-none transition-all"
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full inline-flex items-center justify-center gap-2 py-2.5 bg-blue-700 hover:bg-blue-800 disabled:bg-blue-400 text-white rounded-lg text-sm font-semibold transition-colors shadow-xs mt-2"
            >
              {loading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Verifying Credentials...</span>
                </>
              ) : (
                <>
                  <span>Sign In</span>
                  <ArrowRight className="w-4 h-4" />
                </>
              )}
            </button>
          </form>
        )}

        <div className="mt-6 pt-4 border-t border-slate-100 flex items-center justify-between text-xs text-slate-500">
          <Link to="/" className="hover:text-slate-800">
            ← Candidate Portal
          </Link>
          {session && (
            <button
              onClick={() => signOut()}
              className="hover:text-red-700 inline-flex items-center gap-1"
            >
              <LogOut className="w-3.5 h-3.5" />
              <span>Log out</span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
