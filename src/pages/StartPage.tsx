import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { supabase, isSupabaseConfigured } from '../lib/supabase';
import type { Candidate } from '../types/database';
import { Mic, ArrowRight, Shield, Clock, AlertCircle, KeyRound, User, Loader2, RefreshCw } from 'lucide-react';

export const StartPage: React.FC = () => {
  const { session, candidate, loading: authLoading, refreshAuth, refreshCandidate, signOut } = useAuth();
  const navigate = useNavigate();

  const [fullName, setFullName] = useState('');
  const [testCode, setTestCode] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // We only show the Resume screen if an in_progress candidate was detected on initial page load
  const isStartedNewRef = useRef(false);
  const [initialCandidate, setInitialCandidate] = useState<Candidate | null>(null);
  const [initialized, setInitialized] = useState(false);

  useEffect(() => {
    // Lock in the existing candidate once auth finishes initial load
    if (!authLoading && !initialized && !isStartedNewRef.current) {
      if (candidate && candidate.status === 'in_progress') {
        setInitialCandidate(candidate);
      }
      setInitialized(true);
    }
  }, [authLoading, candidate, initialized]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);

    const trimmedName = fullName.trim();
    const formattedCode = testCode.trim().toUpperCase();

    if (trimmedName.length < 2) {
      setErrorMessage('Please enter your full name (at least 2 characters).');
      return;
    }

    if (!formattedCode || formattedCode.length < 4) {
      setErrorMessage('Please enter a valid test code (e.g. 8-character code).');
      return;
    }

    if (!isSupabaseConfigured) {
      setErrorMessage('Supabase is not configured. Please set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in your environment.');
      return;
    }

    isStartedNewRef.current = true;
    setInitialCandidate(null);
    setSubmitting(true);

    try {
      console.log('Initiating test start flow for candidate:', trimmedName, 'with code:', formattedCode);

      // 1. Ensure an authenticated session exists (anonymous sign-in for candidates)
      let currentSession = session;
      if (!currentSession) {
        console.log('No active session found, signing in anonymously...');
        const { data: anonData, error: anonError } = await supabase.auth.signInAnonymously();
        if (anonError) {
          throw new Error(`Session creation failed: ${anonError.message}`);
        }
        currentSession = anonData.session;
        console.log('Anonymous sign-in successful. User ID:', currentSession?.user?.id);
      }

      // 2. Call start_test RPC: start_test(p_code, p_full_name) returns candidate uuid
      console.log('Calling start_test RPC...');
      const { data: candidateId, error: rpcError } = await supabase.rpc('start_test', {
        p_code: formattedCode,
        p_full_name: trimmedName,
      });

      if (rpcError) {
        isStartedNewRef.current = false;
        console.error('start_test RPC failed with error:', rpcError);
        if (rpcError.message?.toLowerCase().includes('invalid or already used code')) {
          setErrorMessage('Invalid or already used test code. Please check your code or contact your test administrator.');
        } else if (rpcError.message?.toLowerCase().includes('name required')) {
          setErrorMessage('Your full name is required to start the test.');
        } else if (rpcError.message?.toLowerCase().includes('not signed in')) {
          setErrorMessage('Authentication session expired. Please reload and try again.');
        } else {
          setErrorMessage(rpcError.message || 'Failed to start test. Please verify your code.');
        }
        setSubmitting(false);
        return;
      }

      if (!candidateId) {
        isStartedNewRef.current = false;
        console.error('start_test RPC returned empty candidateId');
        throw new Error('No candidate ID returned from test registration.');
      }

      console.log('start_test succeeded with candidate ID:', candidateId);

      // (1) store the returned candidate id
      console.log('Step 1: Storing returned candidate id:', candidateId);
      localStorage.setItem('candidate_id', candidateId);

      // (2) await refreshCandidate() so the auth context has the new candidate row
      console.log('Step 2: Awaiting refreshCandidate()...');
      const refreshedCandidate = await refreshCandidate();
      console.log('Step 2 complete: Candidate row loaded in auth context:', refreshedCandidate);

      // (3) only then navigate to /instructions
      console.log('Step 3: Navigating to /instructions');
      navigate('/instructions', { replace: true });
    } catch (err: any) {
      console.error('Error in start flow:', err);
      isStartedNewRef.current = false;
      setErrorMessage(err.message || 'An unexpected error occurred while starting the test.');
      setSubmitting(false);
    }
  };

  // Resume must go to /instructions (not straight to /test), so the candidate clicks Start again
  // and fullscreen is re-entered from a user click.
  const handleResume = () => {
    navigate('/instructions');
  };

  const handleStartNewSession = async () => {
    await signOut();
    setInitialCandidate(null);
    isStartedNewRef.current = false;
    setFullName('');
    setTestCode('');
    setErrorMessage(null);
  };

  // Determine whether to display Resume card or Entry form
  // ONLY show Resume when page first loaded with an existing in_progress candidate and we didn't just submit
  const showResumeScreen = !isStartedNewRef.current && Boolean(initialCandidate && initialCandidate.status === 'in_progress');

  return (
    <div className="flex-1 flex flex-col items-center justify-center p-4 sm:p-8">
      <div className="max-w-xl w-full bg-white rounded-2xl shadow-sm border border-slate-200 p-6 sm:p-10">
        {/* Header Branding */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-blue-50 text-blue-700 mb-4 border border-blue-100 shadow-xs">
            <Mic className="w-7 h-7" />
          </div>
          <h1 className="text-2xl sm:text-3xl font-bold text-slate-900 tracking-tight">
            Dimension Education Verbal Test
          </h1>
          <p className="text-slate-600 mt-2 text-sm sm:text-base leading-relaxed">
            Spoken English communication assessment. Please enter your registered name and single-use test code.
          </p>
        </div>

        {/* Existing in_progress Candidate on Initial Load: Show Resume */}
        {showResumeScreen && initialCandidate ? (
          <div className="space-y-6">
            <div className="bg-blue-50/70 border border-blue-200 rounded-xl p-5 text-center">
              <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-blue-100 text-blue-800 uppercase tracking-wider">
                Active Test Session Found
              </span>
              <h2 className="text-lg font-bold text-slate-900 mt-2">{initialCandidate.full_name}</h2>
              <p className="text-xs text-slate-600 font-mono mt-1">
                Test Code: <span className="font-semibold text-blue-700">{initialCandidate.test_code}</span>
              </p>
              <p className="text-xs text-slate-500 mt-1">
                Progress: Question {initialCandidate.current_question + 1}
              </p>

              <button
                type="button"
                onClick={handleResume}
                className="mt-5 w-full inline-flex items-center justify-center gap-2 py-3 px-5 bg-blue-700 hover:bg-blue-800 text-white font-semibold rounded-lg text-sm transition-colors shadow-xs cursor-pointer"
              >
                <span>Resume Test</span>
                <ArrowRight className="w-4 h-4" />
              </button>
            </div>

            <div className="text-center">
              <button
                type="button"
                onClick={handleStartNewSession}
                className="text-xs text-slate-500 hover:text-slate-800 underline inline-flex items-center gap-1 cursor-pointer"
              >
                <RefreshCw className="w-3 h-3" />
                <span>Not {initialCandidate.full_name}? Use a different test code</span>
              </button>
            </div>
          </div>
        ) : (
          /* New Test Start Form */
          <form onSubmit={handleSubmit} className="space-y-5">
            {errorMessage && (
              <div
                role="alert"
                className="p-3.5 bg-red-50 border border-red-200 rounded-xl text-xs sm:text-sm text-red-800 flex items-start gap-2.5 animate-in fade-in"
              >
                <AlertCircle className="w-4 h-4 text-red-600 mt-0.5 flex-shrink-0" />
                <div className="flex-1 leading-normal">{errorMessage}</div>
              </div>
            )}

            <div>
              <label
                htmlFor="fullName"
                className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1.5"
              >
                Full Name <span className="text-red-500">*</span>
              </label>
              <div className="relative">
                <User className="w-4 h-4 text-slate-400 absolute left-3 top-3" />
                <input
                  id="fullName"
                  type="text"
                  required
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  placeholder="e.g. Maya Lin"
                  disabled={submitting}
                  className="w-full pl-9 pr-3 py-2.5 bg-white border border-slate-300 focus:border-blue-600 focus:ring-2 focus:ring-blue-100 rounded-lg text-sm text-slate-900 placeholder:text-slate-400 transition-all outline-none"
                />
              </div>
            </div>

            <div>
              <label
                htmlFor="testCode"
                className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1.5"
              >
                Test Code <span className="text-red-500">*</span>
              </label>
              <div className="relative">
                <KeyRound className="w-4 h-4 text-slate-400 absolute left-3 top-3" />
                <input
                  id="testCode"
                  type="text"
                  required
                  maxLength={16}
                  value={testCode}
                  onChange={(e) => setTestCode(e.target.value.toUpperCase())}
                  placeholder="e.g. 8-character test code"
                  disabled={submitting}
                  className="w-full pl-9 pr-3 py-2.5 bg-white border border-slate-300 focus:border-blue-600 focus:ring-2 focus:ring-blue-100 rounded-lg text-sm font-mono tracking-wider uppercase text-slate-900 placeholder:text-slate-400 transition-all outline-none"
                />
              </div>
              <p className="text-[11px] text-slate-500 mt-1">
                Enter the one-time code provided by Dimension Education.
              </p>
            </div>

            <button
              type="submit"
              disabled={submitting}
              className="w-full inline-flex items-center justify-center gap-2 py-3 px-5 bg-blue-700 hover:bg-blue-800 disabled:bg-blue-400 text-white font-semibold rounded-lg text-sm transition-colors shadow-xs mt-2 cursor-pointer"
            >
              {submitting ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Starting...</span>
                </>
              ) : (
                <>
                  <span>Start Verbal Assessment</span>
                  <ArrowRight className="w-4 h-4" />
                </>
              )}
            </button>
          </form>
        )}

        {/* Informational footer badges */}
        <div className="mt-8 pt-6 border-t border-slate-100 grid grid-cols-2 gap-4 text-xs text-slate-600">
          <div className="flex items-center gap-2">
            <Clock className="w-4 h-4 text-blue-600 flex-shrink-0" />
            <span>Duration: ~15-20 Minutes</span>
          </div>
          <div className="flex items-center gap-2">
            <Shield className="w-4 h-4 text-blue-600 flex-shrink-0" />
            <span>Proctored Single Session</span>
          </div>
        </div>
      </div>
    </div>
  );
};
