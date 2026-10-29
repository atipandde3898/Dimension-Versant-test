import React from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { Loader2 } from 'lucide-react';

export const LoadingSpinner: React.FC<{ message?: string }> = ({ message = 'Verifying authorization...' }) => (
  <div className="flex-1 flex flex-col items-center justify-center min-h-[50vh] p-6">
    <div className="flex flex-col items-center gap-3">
      <Loader2 className="w-8 h-8 text-blue-700 animate-spin" />
      <p className="text-sm font-medium text-slate-600">{message}</p>
    </div>
  </div>
);

/**
 * Route guard for Admin pages (/admin, /admin/candidates/:id, /admin/codes, /admin/questions).
 * Requires:
 * 1. Active signed-in session
 * 2. is_admin() === true
 * Non-admins and anonymous candidate sessions are redirected to /admin/login.
 */
export const AdminRouteGuard: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { session, isAdmin, loading } = useAuth();
  const location = useLocation();

  if (loading) {
    return <LoadingSpinner message="Checking administrator privileges..." />;
  }

  // Not signed in or not an admin -> redirect to /admin/login
  if (!session || !isAdmin) {
    return <Navigate to="/admin/login" replace state={{ from: location.pathname }} />;
  }

  return <>{children}</>;
};

/**
 * Route guard for Candidate pages (/instructions, /test, /done).
 * Rules:
 * - Requires a candidate row for current user. If none, redirect to "/".
 * - For /test: requires status === 'in_progress'. If submitted/auto_submitted, redirect to /done.
 * - For /instructions: requires status === 'in_progress'. If submitted/auto_submitted, redirect to /done.
 * - For /done: requires status === 'submitted' || status === 'auto_submitted'. If in_progress, redirect to /test.
 */
interface CandidateRouteGuardProps {
  children: React.ReactNode;
  mode: 'instructions' | 'test' | 'done';
}

export const CandidateRouteGuard: React.FC<CandidateRouteGuardProps> = ({ children, mode }) => {
  const { session, candidate, loading } = useAuth();
  const location = useLocation();

  if (loading) {
    return <LoadingSpinner message="Loading candidate profile..." />;
  }

  // If no active session or no candidate record for current user, redirect to start page
  if (!session || !candidate) {
    return <Navigate to="/" replace state={{ from: location.pathname }} />;
  }

  // Check candidate status requirements per mode
  if (mode === 'instructions') {
    if (candidate.status === 'submitted' || candidate.status === 'auto_submitted') {
      return <Navigate to="/done" replace />;
    }
    if (candidate.status !== 'in_progress') {
      return <Navigate to="/" replace />;
    }
  }

  if (mode === 'test') {
    if (candidate.status === 'submitted' || candidate.status === 'auto_submitted') {
      return <Navigate to="/done" replace />;
    }
    if (candidate.status !== 'in_progress') {
      return <Navigate to="/" replace />;
    }
  }

  if (mode === 'done') {
    if (candidate.status === 'in_progress') {
      return <Navigate to="/test" replace />;
    }
    if (candidate.status !== 'submitted' && candidate.status !== 'auto_submitted') {
      return <Navigate to="/" replace />;
    }
  }

  return <>{children}</>;
};
