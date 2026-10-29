import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import type { Session, User } from '@supabase/supabase-js';
import { supabase, isSupabaseConfigured } from './supabase';
import type { Candidate } from '../types/database';

export interface AuthContextType {
  session: Session | null;
  user: User | null;
  isAdmin: boolean;
  candidate: Candidate | null;
  loading: boolean;
  isConfigured: boolean;
  refreshCandidate: () => Promise<Candidate | null>;
  refreshAuth: () => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({
  session: null,
  user: null,
  isAdmin: false,
  candidate: null,
  loading: true,
  isConfigured: false,
  refreshCandidate: async () => null,
  refreshAuth: async () => {},
  signOut: async () => {},
});

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [isAdmin, setIsAdmin] = useState<boolean>(false);
  const [candidate, setCandidate] = useState<Candidate | null>(null);
  const [loading, setLoading] = useState<boolean>(true);

  // Check if current user is admin via RPC
  const checkIsAdmin = useCallback(async (currentUserId?: string): Promise<boolean> => {
    if (!isSupabaseConfigured || !currentUserId) return false;
    try {
      const { data, error } = await supabase.rpc('is_admin');
      if (error) {
        console.warn('is_admin check error:', error.message);
        return false;
      }
      return Boolean(data);
    } catch (err) {
      console.warn('is_admin exception:', err);
      return false;
    }
  }, []);

  // Lookup candidate for current user
  const lookupCandidate = useCallback(async (currentUserId?: string): Promise<Candidate | null> => {
    if (!isSupabaseConfigured || !currentUserId) return null;
    try {
      const { data, error } = await supabase
        .from('candidates')
        .select('*')
        .eq('user_id', currentUserId)
        .order('started_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error) {
        console.warn('Candidate lookup error:', error.message);
        return null;
      }
      return data as Candidate | null;
    } catch (err) {
      console.warn('Candidate lookup exception:', err);
      return null;
    }
  }, []);

  const refreshCandidate = useCallback(async (): Promise<Candidate | null> => {
    if (!user) {
      setCandidate(null);
      return null;
    }
    const cand = await lookupCandidate(user.id);
    setCandidate(cand);
    return cand;
  }, [user, lookupCandidate]);

  const refreshAuth = useCallback(async () => {
    if (!isSupabaseConfigured) {
      setLoading(false);
      return;
    }

    try {
      const { data: { session: currentSession } } = await supabase.auth.getSession();
      setSession(currentSession);
      const currentUser = currentSession?.user ?? null;
      setUser(currentUser);

      if (currentUser) {
        const [adminResult, candidateResult] = await Promise.all([
          checkIsAdmin(currentUser.id),
          lookupCandidate(currentUser.id),
        ]);
        setIsAdmin(adminResult);
        setCandidate(candidateResult);
      } else {
        setIsAdmin(false);
        setCandidate(null);
      }
    } catch (err) {
      console.error('Error refreshing auth:', err);
    } finally {
      setLoading(false);
    }
  }, [checkIsAdmin, lookupCandidate]);

  useEffect(() => {
    if (!isSupabaseConfigured) {
      setLoading(false);
      return;
    }

    refreshAuth();

    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (_event, newSession) => {
      setSession(newSession);
      const newUser = newSession?.user ?? null;
      setUser(newUser);

      if (newUser) {
        const [adminResult, candidateResult] = await Promise.all([
          checkIsAdmin(newUser.id),
          lookupCandidate(newUser.id),
        ]);
        setIsAdmin(adminResult);
        setCandidate(candidateResult);
      } else {
        setIsAdmin(false);
        setCandidate(null);
      }
      setLoading(false);
    });

    return () => {
      subscription.unsubscribe();
    };
  }, [refreshAuth, checkIsAdmin, lookupCandidate]);

  const signOut = async () => {
    if (isSupabaseConfigured) {
      await supabase.auth.signOut();
    }
    setSession(null);
    setUser(null);
    setIsAdmin(false);
    setCandidate(null);
  };

  return (
    <AuthContext.Provider
      value={{
        session,
        user,
        isAdmin,
        candidate,
        loading,
        isConfigured: isSupabaseConfigured,
        refreshCandidate,
        refreshAuth,
        signOut,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);

// Standalone direct helper utilities
export async function getCurrentSession() {
  const { data } = await supabase.auth.getSession();
  return data.session;
}

export async function checkAdminRpc(): Promise<boolean> {
  const { data, error } = await supabase.rpc('is_admin');
  if (error) return false;
  return Boolean(data);
}

export async function getCandidateByUserId(userId: string): Promise<Candidate | null> {
  const { data, error } = await supabase
    .from('candidates')
    .select('*')
    .eq('user_id', userId)
    .order('started_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) return null;
  return data as Candidate | null;
}
