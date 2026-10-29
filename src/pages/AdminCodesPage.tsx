import React, { useState, useEffect, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { supabase, isSupabaseConfigured } from '../lib/supabase';
import type { TestCode } from '../types/database';
import {
  KeyRound,
  Plus,
  Trash2,
  ArrowLeft,
  Copy,
  Check,
  RefreshCw,
  Search,
  Loader2,
  AlertCircle,
  Sparkles,
} from 'lucide-react';

const CODE_CHARSET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function generateRandomCode(): string {
  const array = new Uint8Array(8);
  window.crypto.getRandomValues(array);
  return Array.from(array)
    .map((byte) => CODE_CHARSET[byte % CODE_CHARSET.length])
    .join('');
}

export const AdminCodesPage: React.FC = () => {
  const [codes, setCodes] = useState<TestCode[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Form states
  const [newCode, setNewCode] = useState<string>(() => generateRandomCode());
  const [candidateName, setCandidateName] = useState<string>('');
  const [creating, setCreating] = useState<boolean>(false);
  const [createSuccess, setCreateSuccess] = useState<boolean>(false);

  // Table filters & copy state
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'unused' | 'used'>('all');
  const [copiedCodeId, setCopiedCodeId] = useState<string | null>(null);

  const fetchCodes = async () => {
    if (!isSupabaseConfigured) {
      setLoading(false);
      return;
    }

    setLoading(true);
    setErrorMessage(null);

    try {
      const { data, error } = await supabase
        .from('test_codes')
        .select('*')
        .order('created_at', { ascending: false });

      if (error) throw error;
      setCodes((data as TestCode[]) || []);
    } catch (err: any) {
      console.error('Error fetching test codes:', err);
      setErrorMessage(err.message || 'Failed to load test codes.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchCodes();
  }, []);

  const handleRegenerateCode = () => {
    setNewCode(generateRandomCode());
  };

  const handleCreateCode = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);
    setCreateSuccess(false);

    const formattedCode = newCode.trim().toUpperCase();
    if (!formattedCode || formattedCode.length < 4) {
      setErrorMessage('Test code must be at least 4 characters long.');
      return;
    }

    setCreating(true);

    try {
      const { error } = await supabase.from('test_codes').insert({
        code: formattedCode,
        candidate_name: candidateName.trim() || null,
        used: false,
      });

      if (error) {
        if (error.message?.includes('duplicate key') || error.code === '23505') {
          throw new Error('This code already exists. Please generate a new code.');
        }
        throw error;
      }

      setCreateSuccess(true);
      setCandidateName('');
      setNewCode(generateRandomCode());
      await fetchCodes();

      setTimeout(() => setCreateSuccess(false), 3000);
    } catch (err: any) {
      console.error('Error inserting test code:', err);
      setErrorMessage(err.message || 'Failed to save test code.');
    } finally {
      setCreating(false);
    }
  };

  const handleDeleteCode = async (id: string, code: string) => {
    const confirmed = window.confirm(`Are you sure you want to delete unused code "${code}"?`);
    if (!confirmed) return;

    try {
      const { error } = await supabase.from('test_codes').delete().eq('id', id);
      if (error) throw error;
      setCodes((prev) => prev.filter((item) => item.id !== id));
    } catch (err: any) {
      console.error('Error deleting test code:', err);
      alert(`Failed to delete code: ${err.message}`);
    }
  };

  const handleCopyCode = (id: string, code: string) => {
    navigator.clipboard.writeText(code);
    setCopiedCodeId(id);
    setTimeout(() => setCopiedCodeId(null), 2000);
  };

  const filteredCodes = useMemo(() => {
    return codes.filter((item) => {
      const q = searchQuery.toLowerCase().trim();
      const matchesSearch =
        !q ||
        item.code.toLowerCase().includes(q) ||
        (item.candidate_name && item.candidate_name.toLowerCase().includes(q));

      const matchesStatus =
        statusFilter === 'all' ||
        (statusFilter === 'unused' && !item.used) ||
        (statusFilter === 'used' && item.used);

      return matchesSearch && matchesStatus;
    });
  }, [codes, searchQuery, statusFilter]);

  const formatDate = (isoString?: string) => {
    if (!isoString) return '—';
    try {
      return new Date(isoString).toLocaleDateString(undefined, {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch {
      return isoString;
    }
  };

  return (
    <div className="flex-1 max-w-5xl w-full mx-auto p-4 sm:p-8">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <div className="flex items-center gap-3">
          <Link
            to="/admin"
            className="p-2 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-600 transition-colors shadow-xs"
            title="Return to Candidates Dashboard"
          >
            <ArrowLeft className="w-4 h-4" />
          </Link>
          <div>
            <div className="flex items-center gap-2">
              <KeyRound className="w-6 h-6 text-blue-700" />
              <h1 className="text-xl sm:text-2xl font-bold text-slate-900">Test Codes Manager</h1>
            </div>
            <p className="text-slate-500 text-xs sm:text-sm mt-0.5">
              Create and manage one-time 8-character test codes for candidates
            </p>
          </div>
        </div>

        <button
          onClick={fetchCodes}
          disabled={loading}
          className="inline-flex items-center gap-1.5 px-3 py-2 bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 rounded-lg text-xs font-medium transition-colors shadow-xs"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          <span>Refresh</span>
        </button>
      </div>

      {/* Code Generation Card */}
      <div className="bg-white rounded-2xl border border-slate-200 p-6 mb-8 shadow-xs">
        <div className="flex items-center gap-2 mb-4">
          <Sparkles className="w-5 h-5 text-blue-600" />
          <h2 className="text-base font-bold text-slate-900">Generate Single-Use Test Code</h2>
        </div>

        {errorMessage && (
          <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-xs text-red-800 flex items-start gap-2">
            <AlertCircle className="w-4 h-4 text-red-600 mt-0.5 flex-shrink-0" />
            <span>{errorMessage}</span>
          </div>
        )}

        {createSuccess && (
          <div className="mb-4 p-3 bg-green-50 border border-green-200 rounded-lg text-xs text-green-800 flex items-center gap-2">
            <Check className="w-4 h-4 text-green-600 flex-shrink-0" />
            <span>Test code created and registered successfully!</span>
          </div>
        )}

        <form onSubmit={handleCreateCode} className="grid sm:grid-cols-12 gap-3 items-end">
          <div className="sm:col-span-5">
            <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1.5">
              8-Character Code
            </label>
            <div className="flex items-center gap-2">
              <input
                type="text"
                required
                maxLength={16}
                value={newCode}
                onChange={(e) => setNewCode(e.target.value.toUpperCase())}
                placeholder="ABCDEFGH"
                className="w-full px-3 py-2 bg-slate-50 border border-slate-300 focus:bg-white focus:border-blue-600 focus:ring-1 focus:ring-blue-100 rounded-lg text-sm font-mono tracking-widest font-bold text-blue-900 uppercase outline-none"
              />
              <button
                type="button"
                onClick={handleRegenerateCode}
                className="px-3 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-xs font-medium transition-colors"
                title="Regenerate random code"
              >
                <RefreshCw className="w-4 h-4" />
              </button>
            </div>
          </div>

          <div className="sm:col-span-5">
            <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1.5">
              Candidate Name (Optional)
            </label>
            <input
              type="text"
              value={candidateName}
              onChange={(e) => setCandidateName(e.target.value)}
              placeholder="e.g. John Doe"
              className="w-full px-3 py-2 bg-white border border-slate-300 focus:border-blue-600 focus:ring-1 focus:ring-blue-100 rounded-lg text-sm text-slate-900 placeholder:text-slate-400 outline-none"
            />
          </div>

          <div className="sm:col-span-2">
            <button
              type="submit"
              disabled={creating}
              className="w-full py-2 px-4 bg-blue-700 hover:bg-blue-800 disabled:bg-blue-400 text-white rounded-lg text-xs font-semibold transition-colors shadow-xs inline-flex items-center justify-center gap-1.5"
            >
              {creating ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <>
                  <Plus className="w-4 h-4" />
                  <span>Save Code</span>
                </>
              )}
            </button>
          </div>
        </form>
      </div>

      {/* Codes Table List */}
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-xs">
        {/* Search & Filter Header */}
        <div className="p-4 border-b border-slate-200 bg-slate-50/50 flex flex-col sm:flex-row gap-3 items-stretch sm:items-center justify-between">
          <div className="relative flex-1 max-w-xs">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search code or candidate..."
              className="w-full pl-9 pr-3 py-1.5 text-xs bg-white border border-slate-200 focus:border-blue-600 rounded-lg text-slate-800 placeholder:text-slate-400 outline-none"
            />
          </div>

          <div className="flex items-center gap-2">
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as any)}
              className="bg-white border border-slate-200 text-xs font-medium text-slate-700 rounded-lg px-2.5 py-1.5 outline-none cursor-pointer"
            >
              <option value="all">All Codes</option>
              <option value="unused">Unused / Available</option>
              <option value="used">Used</option>
            </select>
          </div>
        </div>

        {/* Table */}
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs text-slate-600">
            <thead className="bg-slate-50 border-b border-slate-200 text-slate-700 uppercase font-semibold text-[11px] tracking-wider">
              <tr>
                <th className="py-3 px-4">Test Code</th>
                <th className="py-3 px-4">Assigned Candidate</th>
                <th className="py-3 px-4">Status</th>
                <th className="py-3 px-4">Created Date</th>
                <th className="py-3 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr>
                  <td colSpan={5} className="py-12 text-center">
                    <Loader2 className="w-6 h-6 text-blue-700 animate-spin mx-auto mb-2" />
                    <span className="text-xs text-slate-500">Loading test codes...</span>
                  </td>
                </tr>
              ) : filteredCodes.length === 0 ? (
                <tr>
                  <td colSpan={5} className="py-12 text-center text-slate-400">
                    <KeyRound className="w-8 h-8 text-slate-300 mx-auto mb-2" />
                    <p className="font-medium text-slate-600">No test codes found</p>
                    <p className="text-xs text-slate-400 mt-0.5">Generate a test code above to get started.</p>
                  </td>
                </tr>
              ) : (
                filteredCodes.map((item) => (
                  <tr key={item.id} className="hover:bg-slate-50/80 transition-colors">
                    <td className="py-3 px-4 font-mono font-bold text-slate-900">
                      <div className="flex items-center gap-2">
                        <span className="text-blue-700 text-sm">{item.code}</span>
                        <button
                          type="button"
                          onClick={() => handleCopyCode(item.id, item.code)}
                          className="p-1 text-slate-400 hover:text-slate-700 rounded transition-colors"
                          title="Copy test code"
                        >
                          {copiedCodeId === item.id ? (
                            <Check className="w-3.5 h-3.5 text-green-600" />
                          ) : (
                            <Copy className="w-3.5 h-3.5" />
                          )}
                        </button>
                      </div>
                    </td>
                    <td className="py-3 px-4 text-slate-800 font-medium">
                      {item.candidate_name || <span className="text-slate-400">—</span>}
                    </td>
                    <td className="py-3 px-4">
                      {item.used ? (
                        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-amber-50 text-amber-700 border border-amber-200">
                          Used
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-green-50 text-green-700 border border-green-200">
                          Unused / Available
                        </span>
                      )}
                    </td>
                    <td className="py-3 px-4 text-slate-500 whitespace-nowrap">
                      {formatDate(item.created_at)}
                    </td>
                    <td className="py-3 px-4 text-right">
                      {!item.used && (
                        <button
                          type="button"
                          onClick={() => handleDeleteCode(item.id, item.code)}
                          className="inline-flex items-center gap-1 px-2 py-1 text-red-600 hover:text-red-800 hover:bg-red-50 rounded text-xs font-medium transition-colors"
                          title="Delete unused code"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                          <span>Delete</span>
                        </button>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <div className="p-4 bg-slate-50 border-t border-slate-200 flex items-center justify-between text-xs text-slate-500">
          <span>
            Total: <strong>{filteredCodes.length}</strong> code{filteredCodes.length === 1 ? '' : 's'}
          </span>
          <span className="text-[11px] text-slate-400">
            Unused codes can be deleted anytime.
          </span>
        </div>
      </div>
    </div>
  );
};
