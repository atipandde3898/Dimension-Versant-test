import React, { useState, useEffect, useMemo } from 'react';
import { Link } from 'react-router-dom';
import JSZip from 'jszip';
import { supabase, isSupabaseConfigured } from '../lib/supabase';
import type { Candidate, CandidateStatus, Question, Response as CandidateResponse, Score } from '../types/database';
import { sanitizeFilename, downloadBlob, escapeCsvField } from '../lib/downloadHelpers';
import {
  Users,
  Search,
  Filter,
  Plus,
  Eye,
  RefreshCw,
  Loader2,
  Calendar,
  AlertTriangle,
  CheckCircle,
  Clock,
  ShieldAlert,
  Download,
  CheckSquare,
  Square,
  FileSpreadsheet,
  Package,
} from 'lucide-react';

export const AdminDashboardPage: React.FC = () => {
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Filters
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [dateRangeFilter, setDateRangeFilter] = useState<'all' | 'today' | '7days' | '30days'>('all');

  // Checkbox selection
  const [selectedCandidateIds, setSelectedCandidateIds] = useState<Set<string>>(new Set());

  // Bulk ZIP export states
  const [bulkExporting, setBulkExporting] = useState<boolean>(false);
  const [bulkProgressText, setBulkProgressText] = useState<string>('');
  const [bulkProgressPercent, setBulkProgressPercent] = useState<number>(0);

  // CSV report generation state
  const [generatingCsv, setGeneratingCsv] = useState<boolean>(false);

  const fetchCandidates = async () => {
    if (!isSupabaseConfigured) {
      setLoading(false);
      return;
    }

    setLoading(true);
    setErrorMessage(null);

    try {
      const { data, error } = await supabase
        .from('candidates')
        .select('*')
        .order('started_at', { ascending: false });

      if (error) throw error;
      setCandidates((data as Candidate[]) || []);
    } catch (err: any) {
      console.error('Error fetching candidates:', err);
      setErrorMessage(err.message || 'Failed to load candidates.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchCandidates();
  }, []);

  // Filtered and searched candidates
  const filteredCandidates = useMemo(() => {
    return candidates.filter((c) => {
      const q = searchQuery.toLowerCase().trim();
      const matchesSearch =
        !q ||
        c.full_name.toLowerCase().includes(q) ||
        c.test_code.toLowerCase().includes(q);

      const matchesStatus = statusFilter === 'all' || c.status === statusFilter;

      let matchesDate = true;
      if (dateRangeFilter !== 'all' && c.started_at) {
        const candidateTime = new Date(c.started_at).getTime();
        const now = Date.now();
        if (dateRangeFilter === 'today') {
          matchesDate = candidateTime >= now - 24 * 60 * 60 * 1000;
        } else if (dateRangeFilter === '7days') {
          matchesDate = candidateTime >= now - 7 * 24 * 60 * 60 * 1000;
        } else if (dateRangeFilter === '30days') {
          matchesDate = candidateTime >= now - 30 * 24 * 60 * 60 * 1000;
        }
      }

      return matchesSearch && matchesStatus && matchesDate;
    });
  }, [candidates, searchQuery, statusFilter, dateRangeFilter]);

  // Selection handlers
  const handleToggleSelectCandidate = (id: string) => {
    setSelectedCandidateIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const isAllSelected =
    filteredCandidates.length > 0 &&
    filteredCandidates.every((c) => selectedCandidateIds.has(c.id));

  const handleToggleSelectAll = () => {
    if (isAllSelected) {
      setSelectedCandidateIds(new Set());
    } else {
      setSelectedCandidateIds(new Set(filteredCandidates.map((c) => c.id)));
    }
  };

  // --------------------------------------------------------------------------
  // DOWNLOAD 3: Report CSV (respecting current filters)
  // --------------------------------------------------------------------------
  const handleDownloadReportCsv = async () => {
    if (filteredCandidates.length === 0) {
      alert('No candidates match the current filters to export.');
      return;
    }

    setGeneratingCsv(true);

    try {
      const candidateIds = filteredCandidates.map((c) => c.id);

      // Fetch responses for filtered candidates
      const { data: responsesData } = await supabase
        .from('responses')
        .select('id, candidate_id, question_id')
        .in('candidate_id', candidateIds);

      const responses = (responsesData as CandidateResponse[]) || [];
      const responseIds = responses.map((r) => r.id);

      // Fetch questions
      const { data: questionsData } = await supabase
        .from('questions')
        .select('id, section');

      const questions = (questionsData as Question[]) || [];
      const questionSectionMap = new Map<string, string>(questions.map((q) => [q.id, q.section]));

      // Fetch scores
      let scores: Score[] = [];
      if (responseIds.length > 0) {
        const { data: scoresData } = await supabase
          .from('scores')
          .select('response_id, pronunciation, fluency, accuracy, content')
          .in('response_id', responseIds);

        scores = (scoresData as Score[]) || [];
      }
      const scoreMap = new Map<string, Score>(scores.map((s) => [s.response_id, s]));

      // Map: candidate_id -> section -> scores array
      const candSectionScores: Record<string, Record<string, number[]>> = {};

      responses.forEach((r) => {
        const section = questionSectionMap.get(r.question_id);
        const sc = scoreMap.get(r.id);
        if (section && sc) {
          if (!candSectionScores[r.candidate_id]) {
            candSectionScores[r.candidate_id] = {};
          }
          if (!candSectionScores[r.candidate_id][section]) {
            candSectionScores[r.candidate_id][section] = [];
          }

          let itemSum = 0;
          let count = 0;
          if (sc.pronunciation !== null) { itemSum += sc.pronunciation; count++; }
          if (sc.fluency !== null) { itemSum += sc.fluency; count++; }
          if (sc.accuracy !== null) { itemSum += sc.accuracy; count++; }
          if (sc.content !== null) { itemSum += sc.content; count++; }

          if (count > 0) {
            candSectionScores[r.candidate_id][section].push(itemSum / count);
          }
        }
      });

      // Compute section average string (e.g. "4.2") or empty
      const getSecAvg = (candId: string, section: string): string => {
        const list = candSectionScores[candId]?.[section];
        if (!list || list.length === 0) return '';
        const avg = list.reduce((a, b) => a + b, 0) / list.length;
        return avg.toFixed(1);
      };

      // Construct CSV
      const headers = [
        'Candidate Name',
        'Test Code',
        'Started Date',
        'Status',
        'Warning Count',
        'Section A Avg',
        'Section B Avg',
        'Section C Avg',
        'Section D Avg',
        'Section E Avg',
        'Section F Avg',
        'Total Score (%)',
      ];

      const rows: string[] = [headers.join(',')];

      filteredCandidates.forEach((c) => {
        const row = [
          escapeCsvField(c.full_name),
          escapeCsvField(c.test_code),
          escapeCsvField(c.started_at ? new Date(c.started_at).toISOString() : ''),
          escapeCsvField(c.status),
          c.warning_count,
          getSecAvg(c.id, 'A'),
          getSecAvg(c.id, 'B'),
          getSecAvg(c.id, 'C'),
          getSecAvg(c.id, 'D'),
          getSecAvg(c.id, 'E'),
          getSecAvg(c.id, 'F'),
          escapeCsvField(c.total_score !== null ? `${c.total_score}%` : ''),
        ];
        rows.push(row.join(','));
      });

      const csvBlob = new Blob([rows.join('\n')], { type: 'text/csv;charset=utf-8;' });
      const filename = `Dimension_Education_Candidates_Report_${new Date().toISOString().slice(0, 10)}.csv`;
      downloadBlob(csvBlob, filename);
    } catch (err: any) {
      console.error('CSV generation error:', err);
      alert(`Failed to generate CSV report: ${err.message}`);
    } finally {
      setGeneratingCsv(false);
    }
  };

  // --------------------------------------------------------------------------
  // DOWNLOAD 4: Bulk Recordings for Selected Candidates (ZIP)
  // --------------------------------------------------------------------------
  const handleDownloadSelectedRecordingsZip = async () => {
    const selectedList = candidates.filter((c) => selectedCandidateIds.has(c.id));
    if (selectedList.length === 0) {
      alert('Please select at least one candidate using the checkboxes.');
      return;
    }

    setBulkExporting(true);
    setBulkProgressPercent(0);
    setBulkProgressText(`Preparing archive for ${selectedList.length} candidate(s)...`);

    try {
      const zip = new JSZip();

      // Fetch all questions to match order_number and section
      const { data: questionsData } = await supabase
        .from('questions')
        .select('*')
        .order('order_number', { ascending: true });

      const questions = (questionsData as Question[]) || [];
      const questionsMap = new Map<string, Question>(questions.map((q) => [q.id, q]));

      let processedCandidateCount = 0;

      for (const cand of selectedList) {
        processedCandidateCount++;
        const safeCandidateName = sanitizeFilename(cand.full_name);
        const folderName = `${safeCandidateName}_${cand.test_code}`;
        const candFolder = zip.folder(folderName);

        setBulkProgressText(
          `Processing candidate ${processedCandidateCount} of ${selectedList.length}: ${cand.full_name}...`
        );
        setBulkProgressPercent(Math.round(((processedCandidateCount - 1) / selectedList.length) * 80));

        // Fetch candidate responses
        const { data: respData } = await supabase
          .from('responses')
          .select('*')
          .eq('candidate_id', cand.id)
          .order('recorded_at', { ascending: true });

        const responses = (respData as CandidateResponse[]) || [];

        // Fetch scores for this candidate's responses
        let scoresMap = new Map<string, Score>();
        if (responses.length > 0) {
          const respIds = responses.map((r) => r.id);
          const { data: scData } = await supabase
            .from('scores')
            .select('*')
            .in('response_id', respIds);

          const scList = (scData as Score[]) || [];
          scoresMap = new Map<string, Score>(scList.map((s) => [s.response_id, s]));
        }

        // Add candidate scores.csv
        const candCsv: string[] = [
          `Candidate Name,Test Code,Status,Total Score,Started At`,
          [
            escapeCsvField(cand.full_name),
            escapeCsvField(cand.test_code),
            escapeCsvField(cand.status),
            escapeCsvField(cand.total_score !== null ? `${cand.total_score}%` : 'Pending'),
            escapeCsvField(cand.started_at),
          ].join(','),
          '',
          `Question Order,Section,Type,Duration (s),Pronunciation,Fluency,Accuracy,Content,Notes`,
        ];

        for (const r of responses) {
          const q = questionsMap.get(r.question_id);
          const sc = scoresMap.get(r.id);
          const qNum = q ? String(q.order_number).padStart(2, '0') : '00';
          const sec = q ? q.section : 'General';
          const filename = `${safeCandidateName}_Q${qNum}_${sec}.webm`;

          candCsv.push([
            q?.order_number || '',
            escapeCsvField(sec),
            escapeCsvField(q?.type || ''),
            r.duration_seconds || '',
            sc?.pronunciation ?? '',
            sc?.fluency ?? '',
            sc?.accuracy ?? '',
            sc?.content ?? '',
            escapeCsvField(sc?.notes || ''),
          ].join(','));

          // Download audio file from recordings bucket
          try {
            const { data: audioData, error: audioError } = await supabase.storage
              .from('recordings')
              .download(r.audio_path);

            if (!audioError && audioData && candFolder) {
              candFolder.file(filename, audioData);
            }
          } catch (fetchErr) {
            console.warn(`Failed to fetch audio for ${filename}:`, fetchErr);
          }
        }

        if (candFolder) {
          candFolder.file('scores.csv', candCsv.join('\n'));
        }
      }

      setBulkProgressText('Compressing all recordings into ZIP...');
      setBulkProgressPercent(90);

      const zipBlob = await zip.generateAsync({ type: 'blob' }, (metadata) => {
        setBulkProgressPercent(90 + Math.round(metadata.percent * 0.1));
      });

      downloadBlob(zipBlob, `Dimension_Education_Selected_Recordings_${selectedList.length}_candidates.zip`);

      setBulkProgressText('Download ready!');
      setBulkProgressPercent(100);

      setTimeout(() => {
        setBulkExporting(false);
        setBulkProgressText('');
        setBulkProgressPercent(0);
      }, 1500);
    } catch (err: any) {
      console.error('Bulk ZIP download error:', err);
      alert(`Failed to create bulk recordings package: ${err.message}`);
      setBulkExporting(false);
    }
  };

  const formatDate = (isoString?: string | null) => {
    if (!isoString) return '—';
    try {
      const d = new Date(isoString);
      return d.toLocaleDateString(undefined, {
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

  const getStatusBadge = (status: CandidateStatus) => {
    switch (status) {
      case 'submitted':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-green-50 text-green-700 border border-green-200">
            <CheckCircle className="w-3 h-3 text-green-600" />
            <span>Submitted</span>
          </span>
        );
      case 'auto_submitted':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-red-50 text-red-700 border border-red-200">
            <ShieldAlert className="w-3 h-3 text-red-600" />
            <span>Auto Submitted</span>
          </span>
        );
      case 'in_progress':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-blue-50 text-blue-700 border border-blue-200">
            <Clock className="w-3 h-3 text-blue-600" />
            <span>In Progress</span>
          </span>
        );
      case 'reset':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-slate-100 text-slate-600 border border-slate-200">
            <span>Reset</span>
          </span>
        );
      default:
        return (
          <span className="px-2 py-0.5 rounded-full text-[11px] font-semibold bg-slate-100 text-slate-700">
            {status}
          </span>
        );
    }
  };

  return (
    <div className="flex-1 max-w-6xl w-full mx-auto p-4 sm:p-8">
      {/* Top Banner */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <div>
          <div className="flex items-center gap-2">
            <Users className="w-6 h-6 text-blue-700" />
            <h1 className="text-2xl font-bold text-slate-900">Admin Dashboard: Candidates</h1>
          </div>
          <p className="text-slate-500 text-xs sm:text-sm mt-0.5">
            Review test submissions, warning audits, and export candidate performance
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Download Report (CSV) Button */}
          <button
            type="button"
            onClick={handleDownloadReportCsv}
            disabled={generatingCsv || filteredCandidates.length === 0}
            className="inline-flex items-center gap-1.5 px-3 py-2 bg-white border border-slate-300 hover:bg-slate-50 disabled:bg-slate-100 disabled:text-slate-400 text-slate-700 rounded-lg text-xs font-medium transition-colors shadow-xs"
            title="Download CSV report with section averages and total scores for currently filtered candidates"
          >
            {generatingCsv ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin text-blue-700" />
            ) : (
              <FileSpreadsheet className="w-3.5 h-3.5 text-blue-700" />
            )}
            <span>Download report (CSV)</span>
          </button>

          {/* Download Recordings for Selected Candidates (ZIP) */}
          <button
            type="button"
            onClick={handleDownloadSelectedRecordingsZip}
            disabled={bulkExporting || selectedCandidateIds.size === 0}
            className="inline-flex items-center gap-1.5 px-3 py-2 bg-white border border-slate-300 hover:bg-slate-50 disabled:bg-slate-100 disabled:text-slate-400 text-slate-700 rounded-lg text-xs font-medium transition-colors shadow-xs"
            title="Download all audio recordings for checked candidates as ZIP"
          >
            {bulkExporting ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin text-blue-700" />
            ) : (
              <Package className="w-3.5 h-3.5 text-blue-700" />
            )}
            <span>
              Download recordings ({selectedCandidateIds.size}) (ZIP)
            </span>
          </button>

          <Link
            to="/admin/codes"
            className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-blue-700 hover:bg-blue-800 text-white rounded-lg text-xs font-semibold shadow-xs transition-colors"
          >
            <Plus className="w-4 h-4" />
            <span>Manage Test Codes</span>
          </Link>
        </div>
      </div>

      {/* Bulk Export Progress Bar */}
      {bulkExporting && (
        <div className="mb-6 p-4 bg-blue-50 border border-blue-200 rounded-xl shadow-xs animate-in fade-in">
          <div className="flex items-center justify-between text-xs font-bold text-blue-900 mb-1.5">
            <span className="flex items-center gap-2">
              <Loader2 className="w-3.5 h-3.5 animate-spin text-blue-700" />
              <span>{bulkProgressText}</span>
            </span>
            <span>{bulkProgressPercent}%</span>
          </div>
          <div className="w-full bg-blue-200 h-2 rounded-full overflow-hidden">
            <div
              className="bg-blue-700 h-full rounded-full transition-all duration-300"
              style={{ width: `${bulkProgressPercent}%` }}
            />
          </div>
        </div>
      )}

      {/* Filter and Search Bar */}
      <div className="bg-white rounded-xl border border-slate-200 p-4 mb-6 shadow-xs flex flex-col md:flex-row gap-3 items-stretch md:items-center justify-between">
        <div className="relative flex-1 max-w-md">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search candidate name or code..."
            className="w-full pl-9 pr-3 py-1.5 text-xs bg-slate-50 border border-slate-200 focus:bg-white focus:border-blue-600 focus:ring-1 focus:ring-blue-100 rounded-lg text-slate-800 placeholder:text-slate-400 outline-none"
          />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1.5 text-xs text-slate-600 bg-slate-50 px-2.5 py-1.5 rounded-lg border border-slate-200">
            <Filter className="w-3.5 h-3.5 text-slate-400" />
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="bg-transparent text-xs font-medium text-slate-700 outline-none cursor-pointer"
            >
              <option value="all">All Statuses</option>
              <option value="in_progress">In Progress</option>
              <option value="submitted">Submitted</option>
              <option value="auto_submitted">Auto Submitted</option>
              <option value="reset">Reset</option>
            </select>
          </div>

          <div className="flex items-center gap-1.5 text-xs text-slate-600 bg-slate-50 px-2.5 py-1.5 rounded-lg border border-slate-200">
            <Calendar className="w-3.5 h-3.5 text-slate-400" />
            <select
              value={dateRangeFilter}
              onChange={(e) => setDateRangeFilter(e.target.value as any)}
              className="bg-transparent text-xs font-medium text-slate-700 outline-none cursor-pointer"
            >
              <option value="all">All Dates</option>
              <option value="today">Today (Last 24h)</option>
              <option value="7days">Last 7 Days</option>
              <option value="30days">Last 30 Days</option>
            </select>
          </div>

          <button
            onClick={fetchCandidates}
            disabled={loading}
            className="p-2 bg-slate-50 border border-slate-200 hover:bg-slate-100 text-slate-600 rounded-lg text-xs"
            title="Refresh"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {errorMessage && (
        <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-xl text-red-800 text-xs flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 text-red-600 flex-shrink-0" />
          <span>{errorMessage}</span>
        </div>
      )}

      {/* Candidates Table with Checkboxes */}
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-xs">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs text-slate-600">
            <thead className="bg-slate-50 border-b border-slate-200 text-slate-700 uppercase font-semibold text-[11px] tracking-wider">
              <tr>
                <th className="py-3 px-3 w-10 text-center">
                  <input
                    type="checkbox"
                    checked={isAllSelected}
                    onChange={handleToggleSelectAll}
                    className="w-4 h-4 text-blue-600 rounded border-slate-300 focus:ring-blue-500 cursor-pointer"
                    title="Select all"
                  />
                </th>
                <th className="py-3 px-4">Candidate Name</th>
                <th className="py-3 px-4">Test Code</th>
                <th className="py-3 px-4">Started Date</th>
                <th className="py-3 px-4">Status</th>
                <th className="py-3 px-4">Warnings</th>
                <th className="py-3 px-4">Total Score</th>
                <th className="py-3 px-4 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr>
                  <td colSpan={8} className="py-12 text-center">
                    <Loader2 className="w-6 h-6 text-blue-700 animate-spin mx-auto mb-2" />
                    <span className="text-xs text-slate-500">Loading candidates...</span>
                  </td>
                </tr>
              ) : filteredCandidates.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-12 text-center text-slate-400">
                    <Users className="w-8 h-8 text-slate-300 mx-auto mb-2" />
                    <p className="font-medium text-slate-600">No candidates found</p>
                    <p className="text-xs text-slate-400 mt-0.5">
                      {searchQuery || statusFilter !== 'all' || dateRangeFilter !== 'all'
                        ? 'Try adjusting your search criteria or filters.'
                        : 'No verbal tests have been started yet.'}
                    </p>
                  </td>
                </tr>
              ) : (
                filteredCandidates.map((c) => {
                  const isChecked = selectedCandidateIds.has(c.id);

                  return (
                    <tr
                      key={c.id}
                      className={`hover:bg-slate-50/80 transition-colors ${
                        isChecked ? 'bg-blue-50/40' : ''
                      }`}
                    >
                      <td className="py-3.5 px-3 text-center">
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={() => handleToggleSelectCandidate(c.id)}
                          className="w-4 h-4 text-blue-600 rounded border-slate-300 focus:ring-blue-500 cursor-pointer"
                        />
                      </td>
                      <td className="py-3.5 px-4 font-semibold text-slate-900">
                        {c.full_name}
                      </td>
                      <td className="py-3.5 px-4 font-mono font-bold text-blue-700">
                        {c.test_code}
                      </td>
                      <td className="py-3.5 px-4 text-slate-500 whitespace-nowrap">
                        {formatDate(c.started_at)}
                      </td>
                      <td className="py-3.5 px-4 whitespace-nowrap">
                        {getStatusBadge(c.status)}
                      </td>
                      <td className="py-3.5 px-4 font-mono whitespace-nowrap">
                        <span
                          className={`font-semibold ${
                            c.warning_count >= 2
                              ? 'text-red-600'
                              : c.warning_count === 1
                              ? 'text-amber-600'
                              : 'text-slate-600'
                          }`}
                        >
                          {c.warning_count} / 2
                        </span>
                      </td>
                      <td className="py-3.5 px-4 font-mono font-semibold text-slate-800">
                        {c.total_score !== null ? `${c.total_score}%` : '—'}
                      </td>
                      <td className="py-3.5 px-4 text-right whitespace-nowrap">
                        <Link
                          to={`/admin/candidates/${c.id}`}
                          className="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-blue-50 text-blue-700 hover:bg-blue-100 font-semibold text-xs transition-colors"
                        >
                          <Eye className="w-3.5 h-3.5" />
                          <span>View</span>
                        </Link>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Footer Summary */}
        <div className="p-4 bg-slate-50 border-t border-slate-200 flex flex-col sm:flex-row items-center justify-between gap-2 text-xs text-slate-500">
          <div>
            <span>
              Showing <strong>{filteredCandidates.length}</strong> of <strong>{candidates.length}</strong> candidate{candidates.length === 1 ? '' : 's'}
            </span>
            {selectedCandidateIds.size > 0 && (
              <span className="ml-3 font-semibold text-blue-700">
                ({selectedCandidateIds.size} selected)
              </span>
            )}
          </div>
          <span className="text-[11px] text-slate-400">
            Select candidates to download audio recordings as ZIP
          </span>
        </div>
      </div>
    </div>
  );
};
