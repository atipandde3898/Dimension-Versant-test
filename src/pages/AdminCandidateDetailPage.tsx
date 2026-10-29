import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import JSZip from 'jszip';
import { supabase, isSupabaseConfigured } from '../lib/supabase';
import type { Candidate, Question, QuestionScript, Response as CandidateResponse, Score, ProctorEvent } from '../types/database';
import { sanitizeFilename, downloadBlob, escapeCsvField } from '../lib/downloadHelpers';
import {
  ArrowLeft,
  RotateCcw,
  ShieldAlert,
  Award,
  Loader2,
  Calendar,
  KeyRound,
  User,
  Clock,
  CheckCircle,
  AlertTriangle,
  FileText,
  Volume2,
  Save,
  Check,
  Headphones,
  BookOpen,
  Download,
  Trash2,
} from 'lucide-react';

interface ResponseItemData {
  response: CandidateResponse;
  question: Question;
  script?: QuestionScript;
  score?: Score;
  audioSignedUrl?: string;
}

export const AdminCandidateDetailPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const [candidate, setCandidate] = useState<Candidate | null>(null);
  const [proctorEvents, setProctorEvents] = useState<ProctorEvent[]>([]);
  const [responseItems, setResponseItems] = useState<ResponseItemData[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Form states for overall notes, code resetting, and candidate deletion
  const [overallNotes, setOverallNotes] = useState<string>('');
  const [savingNotes, setSavingNotes] = useState<boolean>(false);
  const [notesSaveSuccess, setNotesSaveSuccess] = useState<boolean>(false);
  const [resetting, setResetting] = useState<boolean>(false);
  const [resetSuccess, setResetSuccess] = useState<boolean>(false);
  const [deletingCandidate, setDeletingCandidate] = useState<boolean>(false);

  // ZIP download states
  const [downloadingZip, setDownloadingZip] = useState<boolean>(false);
  const [zipProgressText, setZipProgressText] = useState<string>('');
  const [zipProgressPercent, setZipProgressPercent] = useState<number>(0);
  const [downloadingSingleId, setDownloadingSingleId] = useState<string | null>(null);

  // Local state for edits in progress to rubric scores: response_id -> Partial<Score>
  const [scoresState, setScoresState] = useState<Record<string, {
    pronunciation: number | null;
    fluency: number | null;
    accuracy: number | null;
    content: number | null;
    notes: string;
    isSaving?: boolean;
    isSaved?: boolean;
  }>>({});

  const fetchCandidateDetails = useCallback(async () => {
    if (!isSupabaseConfigured || !id) {
      setLoading(false);
      return;
    }

    setLoading(true);
    setErrorMessage(null);

    try {
      // 1. Fetch candidate
      const { data: candData, error: candError } = await supabase
        .from('candidates')
        .select('*')
        .eq('id', id)
        .single();

      if (candError) throw candError;
      const cand = candData as Candidate;
      setCandidate(cand);
      setOverallNotes(cand.overall_notes || '');

      // 2. Fetch proctor events
      const { data: eventsData } = await supabase
        .from('proctor_events')
        .select('*')
        .eq('candidate_id', id)
        .order('created_at', { ascending: true });

      setProctorEvents((eventsData as ProctorEvent[]) || []);

      // 3. Fetch candidate's responses
      const { data: responsesData, error: respError } = await supabase
        .from('responses')
        .select('*')
        .eq('candidate_id', id)
        .order('recorded_at', { ascending: true });

      if (respError) throw respError;
      const responses = (responsesData as CandidateResponse[]) || [];

      // 4. Fetch all questions
      const { data: questionsData, error: qError } = await supabase
        .from('questions')
        .select('*')
        .order('order_number', { ascending: true });

      if (qError) throw qError;
      const questions = (questionsData as Question[]) || [];
      const questionsMap = new Map<string, Question>(questions.map((q) => [q.id, q]));

      // 5. Fetch question scripts (admin only)
      const { data: scriptsData } = await supabase
        .from('question_scripts')
        .select('*');

      const scriptsMap = new Map<string, QuestionScript>(
        (scriptsData as QuestionScript[] || []).map((s) => [s.question_id, s])
      );

      // 6. Fetch scores for these responses
      const responseIds = responses.map((r) => r.id);
      let scoresList: Score[] = [];
      if (responseIds.length > 0) {
        const { data: scoresData } = await supabase
          .from('scores')
          .select('*')
          .in('response_id', responseIds);

        scoresList = (scoresData as Score[]) || [];
      }
      const scoresMap = new Map<string, Score>(scoresList.map((s) => [s.response_id, s]));

      // 7. Generate signed URLs for recordings and build ResponseItemData
      const items: ResponseItemData[] = await Promise.all(
        responses.map(async (r) => {
          let signedUrl = '';
          if (r.audio_path) {
            const { data: urlData } = await supabase.storage
              .from('recordings')
              .createSignedUrl(r.audio_path, 3600);
            signedUrl = urlData?.signedUrl || '';
          }

          const q = questionsMap.get(r.question_id) || {
            id: r.question_id,
            section: 'Unknown',
            order_number: 0,
            type: 'unknown',
            display_text: null,
            audio_path: null,
            time_limit_seconds: 20,
            active: true,
          };

          return {
            response: r,
            question: q,
            script: scriptsMap.get(r.question_id),
            score: scoresMap.get(r.id),
            audioSignedUrl: signedUrl,
          };
        })
      );

      items.sort((a, b) => a.question.order_number - b.question.order_number);
      setResponseItems(items);

      // Populate local score state
      const initialScoresState: Record<string, any> = {};
      items.forEach((item) => {
        const sc = item.score;
        initialScoresState[item.response.id] = {
          pronunciation: sc?.pronunciation ?? null,
          fluency: sc?.fluency ?? null,
          accuracy: sc?.accuracy ?? null,
          content: sc?.content ?? null,
          notes: sc?.notes ?? '',
          isSaving: false,
          isSaved: false,
        };
      });
      setScoresState(initialScoresState);
    } catch (err: any) {
      console.error('Error fetching candidate details:', err);
      setErrorMessage(err.message || 'Failed to load candidate information.');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    fetchCandidateDetails();
  }, [fetchCandidateDetails]);

  const handleScoreChange = (
    responseId: string,
    field: 'pronunciation' | 'fluency' | 'accuracy' | 'content',
    value: number
  ) => {
    setScoresState((prev) => ({
      ...prev,
      [responseId]: {
        ...prev[responseId],
        [field]: prev[responseId]?.[field] === value ? null : value,
        isSaved: false,
      },
    }));
  };

  const handleNotesChange = (responseId: string, value: string) => {
    setScoresState((prev) => ({
      ...prev,
      [responseId]: {
        ...prev[responseId],
        notes: value,
        isSaved: false,
      },
    }));
  };

  const handleSaveScore = async (responseId: string) => {
    const scoreData = scoresState[responseId];
    if (!scoreData) return;

    setScoresState((prev) => ({
      ...prev,
      [responseId]: { ...prev[responseId], isSaving: true },
    }));

    try {
      const { error } = await supabase.from('scores').upsert(
        {
          response_id: responseId,
          pronunciation: scoreData.pronunciation,
          fluency: scoreData.fluency,
          accuracy: scoreData.accuracy,
          content: scoreData.content,
          notes: scoreData.notes?.trim() || null,
        },
        { onConflict: 'response_id' }
      );

      if (error) throw error;

      setScoresState((prev) => ({
        ...prev,
        [responseId]: { ...prev[responseId], isSaving: false, isSaved: true },
      }));

      await calculateAndUpdateTotalScore();
    } catch (err: any) {
      console.error('Error saving score:', err);
      alert(`Failed to save score: ${err.message}`);
      setScoresState((prev) => ({
        ...prev,
        [responseId]: { ...prev[responseId], isSaving: false },
      }));
    }
  };

  const groupedResponses = useMemo(() => {
    const groups: Record<string, ResponseItemData[]> = {};
    responseItems.forEach((item) => {
      const sec = item.question.section || 'General';
      if (!groups[sec]) groups[sec] = [];
      groups[sec].push(item);
    });
    return groups;
  }, [responseItems]);

  const { sectionAverages, overallScorePercentage, totalQuestionsScored, totalResponsesCount } = useMemo(() => {
    const secAvg: Record<string, { average: number; count: number }> = {};
    let totalPoints = 0;
    let totalMaxPoints = 0;
    let scoredCount = 0;

    Object.entries(groupedResponses).forEach(([sec, items]) => {
      let secPoints = 0;
      let secMax = 0;

      items.forEach((item) => {
        const sc = scoresState[item.response.id];
        if (!sc) return;

        let itemPoints = 0;
        let itemMax = 0;

        if (sc.pronunciation !== null) { itemPoints += sc.pronunciation; itemMax += 5; }
        if (sc.fluency !== null) { itemPoints += sc.fluency; itemMax += 5; }
        if (sc.accuracy !== null) { itemPoints += sc.accuracy; itemMax += 5; }
        if (sc.content !== null) { itemPoints += sc.content; itemMax += 5; }

        if (itemMax > 0) {
          secPoints += itemPoints;
          secMax += itemMax;
          totalPoints += itemPoints;
          totalMaxPoints += itemMax;
          scoredCount += 1;
        }
      });

      if (secMax > 0) {
        const avgOn5 = (secPoints / secMax) * 5;
        secAvg[sec] = { average: Number(avgOn5.toFixed(1)), count: items.length };
      }
    });

    const overallPct = totalMaxPoints > 0 ? Math.round((totalPoints / totalMaxPoints) * 100) : null;

    return {
      sectionAverages: secAvg,
      overallScorePercentage: overallPct,
      totalQuestionsScored: scoredCount,
      totalResponsesCount: responseItems.length,
    };
  }, [groupedResponses, scoresState, responseItems.length]);

  const calculateAndUpdateTotalScore = async () => {
    if (!candidate || overallScorePercentage === null) return;
    try {
      await supabase
        .from('candidates')
        .update({ total_score: overallScorePercentage })
        .eq('id', candidate.id);

      setCandidate((prev) => (prev ? { ...prev, total_score: overallScorePercentage } : null));
    } catch (err) {
      console.warn('Failed to update candidates.total_score:', err);
    }
  };

  const handleSaveOverallNotes = async () => {
    if (!candidate) return;
    setSavingNotes(true);
    setNotesSaveSuccess(false);

    try {
      const { error } = await supabase
        .from('candidates')
        .update({
          overall_notes: overallNotes.trim() || null,
          total_score: overallScorePercentage,
        })
        .eq('id', candidate.id);

      if (error) throw error;

      setNotesSaveSuccess(true);
      setCandidate((prev) => (prev ? { ...prev, overall_notes: overallNotes, total_score: overallScorePercentage } : null));
      setTimeout(() => setNotesSaveSuccess(false), 2500);
    } catch (err: any) {
      console.error('Error saving overall notes:', err);
      alert(`Failed to save overall notes: ${err.message}`);
    } finally {
      setSavingNotes(false);
    }
  };

  const handleResetCode = async () => {
    if (!candidate) return;

    const confirmed = window.confirm(
      `Are you sure you want to reset the test code "${candidate.test_code}" for ${candidate.full_name}?\n\nThis will allow the candidate to use their test code again from the beginning while preserving their existing recordings.`
    );
    if (!confirmed) return;

    setResetting(true);
    setResetSuccess(false);

    try {
      const { error } = await supabase.rpc('reset_code', {
        p_candidate_id: candidate.id,
      });

      if (error) throw error;

      setResetSuccess(true);
      await fetchCandidateDetails();
    } catch (err: any) {
      console.error('Error resetting code:', err);
      alert(`Failed to reset test code: ${err.message}`);
    } finally {
      setResetting(false);
    }
  };

  const handleDeleteCandidateData = async () => {
    if (!candidate) return;

    const confirmed = window.confirm(
      `Are you sure you want to permanently delete all data for candidate "${candidate.full_name}" (Code: ${candidate.test_code})?\n\nThis will remove all recordings from the recordings storage bucket and delete the candidate from the database. Related responses, scores, and proctor events will be permanently removed. This action cannot be undone.`
    );
    if (!confirmed) return;

    setDeletingCandidate(true);
    try {
      // 1. Delete all audio recordings from storage
      const audioPaths = responseItems
        .map((item) => item.response.audio_path)
        .filter(Boolean);

      if (audioPaths.length > 0) {
        const { error: storageError } = await supabase.storage
          .from('recordings')
          .remove(audioPaths);

        if (storageError) {
          console.warn('Storage deletion warning:', storageError.message);
        }
      }

      // 2. Delete candidate row (responses, scores, proctor_events cascade automatically)
      const { error: dbError } = await supabase
        .from('candidates')
        .delete()
        .eq('id', candidate.id);

      if (dbError) throw dbError;

      alert(`Candidate data for "${candidate.full_name}" has been permanently deleted.`);
      navigate('/admin');
    } catch (err: any) {
      console.error('Error deleting candidate data:', err);
      alert(`Failed to delete candidate data: ${err.message}`);
      setDeletingCandidate(false);
    }
  };

  // --------------------------------------------------------------------------
  // DOWNLOAD 1: Individual Recording (.webm)
  // --------------------------------------------------------------------------
  const handleDownloadSingleRecording = async (item: ResponseItemData) => {
    if (!candidate) return;
    setDownloadingSingleId(item.response.id);

    try {
      const safeCandidateName = sanitizeFilename(candidate.full_name);
      const qNum = String(item.question.order_number).padStart(2, '0');
      const filename = `${safeCandidateName}_Q${qNum}_${item.question.section}.webm`;

      // Download from private recordings bucket
      const { data, error } = await supabase.storage
        .from('recordings')
        .download(item.response.audio_path);

      if (error || !data) {
        throw new Error(error?.message || 'Failed to download recording file.');
      }

      downloadBlob(data, filename);
    } catch (err: any) {
      console.error('Single download error:', err);
      alert(`Could not download recording: ${err.message}`);
    } finally {
      setDownloadingSingleId(null);
    }
  };

  // --------------------------------------------------------------------------
  // DOWNLOAD 2: All Recordings (ZIP) with scores.csv
  // --------------------------------------------------------------------------
  const handleDownloadAllRecordingsZip = async () => {
    if (!candidate || responseItems.length === 0) return;

    setDownloadingZip(true);
    setZipProgressPercent(0);
    setZipProgressText('Preparing recordings archive...');

    try {
      const zip = new JSZip();
      const safeName = sanitizeFilename(candidate.full_name);

      // 1. Build scores.csv
      const csvLines: string[] = [
        `Candidate Name,Test Code,Status,Total Score,Started At,Submitted At`,
        [
          escapeCsvField(candidate.full_name),
          escapeCsvField(candidate.test_code),
          escapeCsvField(candidate.status),
          escapeCsvField(overallScorePercentage !== null ? `${overallScorePercentage}%` : 'Pending'),
          escapeCsvField(candidate.started_at),
          escapeCsvField(candidate.submitted_at),
        ].join(','),
        '',
        `Question Order,Section,Type,Duration (s),Pronunciation,Fluency,Accuracy,Content,Average (/5),Notes`,
      ];

      responseItems.forEach((item) => {
        const sc = scoresState[item.response.id];
        let itemScoreSum = 0;
        let itemCriteriaCount = 0;
        if (sc?.pronunciation !== null && sc?.pronunciation !== undefined) { itemScoreSum += sc.pronunciation; itemCriteriaCount++; }
        if (sc?.fluency !== null && sc?.fluency !== undefined) { itemScoreSum += sc.fluency; itemCriteriaCount++; }
        if (sc?.accuracy !== null && sc?.accuracy !== undefined) { itemScoreSum += sc.accuracy; itemCriteriaCount++; }
        if (sc?.content !== null && sc?.content !== undefined) { itemScoreSum += sc.content; itemCriteriaCount++; }

        const avgScore = itemCriteriaCount > 0 ? (itemScoreSum / itemCriteriaCount).toFixed(1) : '';

        csvLines.push([
          item.question.order_number,
          escapeCsvField(item.question.section),
          escapeCsvField(item.question.type),
          item.response.duration_seconds || '',
          sc?.pronunciation ?? '',
          sc?.fluency ?? '',
          sc?.accuracy ?? '',
          sc?.content ?? '',
          avgScore,
          escapeCsvField(sc?.notes || ''),
        ].join(','));
      });

      // Add scores.csv into the zip root
      zip.file('scores.csv', csvLines.join('\n'));

      // 2. Download and package each recording
      for (let i = 0; i < responseItems.length; i++) {
        const item = responseItems[i];
        const qNum = String(item.question.order_number).padStart(2, '0');
        const filename = `${safeName}_Q${qNum}_${item.question.section}.webm`;

        setZipProgressText(`Downloading audio ${i + 1} of ${responseItems.length} (${filename})...`);
        setZipProgressPercent(Math.round(((i) / responseItems.length) * 80));

        try {
          const { data, error } = await supabase.storage
            .from('recordings')
            .download(item.response.audio_path);

          if (!error && data) {
            zip.file(filename, data);
          } else {
            console.warn(`Could not fetch audio for ${filename}:`, error?.message);
          }
        } catch (fetchErr) {
          console.warn(`Error fetching recording ${filename}:`, fetchErr);
        }
      }

      // 3. Compress ZIP
      setZipProgressText('Compressing audio files into ZIP archive...');
      setZipProgressPercent(90);

      const zipBlob = await zip.generateAsync({ type: 'blob' }, (metadata) => {
        setZipProgressPercent(90 + Math.round(metadata.percent * 0.1));
      });

      // 4. Trigger download
      setZipProgressText('Download ready!');
      setZipProgressPercent(100);
      downloadBlob(zipBlob, `${safeName}_Recordings.zip`);

      setTimeout(() => {
        setDownloadingZip(false);
        setZipProgressText('');
        setZipProgressPercent(0);
      }, 1500);
    } catch (err: any) {
      console.error('ZIP generation error:', err);
      alert(`Failed to create ZIP package: ${err.message}`);
      setDownloadingZip(false);
    }
  };

  const formatDate = (isoString?: string | null) => {
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

  const getSectionTitle = (sec: string) => {
    const titles: Record<string, string> = {
      A: 'Section A: Read Aloud',
      B: 'Section B: Repeat',
      C: 'Section C: Short Answer',
      D: 'Section D: Sentence Builds',
      E: 'Section E: Story Retelling',
      F: 'Section F: Open Question',
    };
    return titles[sec] || `Section ${sec}`;
  };

  if (loading) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center min-h-[50vh] p-6">
        <Loader2 className="w-8 h-8 text-blue-700 animate-spin" />
        <p className="text-sm font-medium text-slate-600 mt-3">Loading candidate assessment & recordings...</p>
      </div>
    );
  }

  if (errorMessage || !candidate) {
    return (
      <div className="flex-1 max-w-xl w-full mx-auto p-4 sm:p-8 flex flex-col justify-center">
        <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-8 text-center">
          <AlertTriangle className="w-10 h-10 text-red-500 mx-auto mb-3" />
          <h2 className="text-lg font-bold text-slate-900">Candidate Not Found</h2>
          <p className="text-xs text-slate-600 mt-1">{errorMessage || 'Unable to locate candidate record.'}</p>
          <Link
            to="/admin"
            className="mt-6 inline-flex items-center gap-1.5 px-4 py-2 bg-blue-700 text-white rounded-lg text-xs font-semibold"
          >
            <ArrowLeft className="w-4 h-4" />
            <span>Return to Dashboard</span>
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 max-w-6xl w-full mx-auto p-4 sm:p-8">
      {/* Top action bar */}
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
              <h1 className="text-xl sm:text-2xl font-bold text-slate-900">{candidate.full_name}</h1>
              <span className="font-mono text-xs bg-blue-50 border border-blue-200 text-blue-700 font-bold px-2.5 py-0.5 rounded">
                {candidate.test_code}
              </span>
            </div>
            <p className="text-slate-500 text-xs mt-0.5">
              Candidate ID: <span className="font-mono text-slate-600">{candidate.id}</span>
            </p>
          </div>
        </div>

        {/* Action Buttons: Reset Code & Download ZIP */}
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleDownloadAllRecordingsZip}
            disabled={downloadingZip || responseItems.length === 0}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-blue-700 hover:bg-blue-800 disabled:bg-blue-400 text-white rounded-lg text-xs font-semibold transition-colors shadow-xs"
            title="Download all recordings and scores as ZIP"
          >
            {downloadingZip ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Download className="w-3.5 h-3.5" />
            )}
            <span>{downloadingZip ? 'Generating ZIP...' : 'Download all recordings (ZIP)'}</span>
          </button>

          <button
            type="button"
            onClick={handleResetCode}
            disabled={resetting || candidate.status === 'reset'}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-white border border-slate-300 hover:bg-slate-50 disabled:bg-slate-100 disabled:text-slate-400 text-slate-700 rounded-lg text-xs font-semibold transition-colors shadow-xs"
            title="Reset code so candidate can restart test"
          >
            {resetting ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <RotateCcw className="w-3.5 h-3.5 text-blue-600" />
            )}
            <span>{candidate.status === 'reset' ? 'Code Already Reset' : 'Reset Code'}</span>
          </button>

          <button
            type="button"
            onClick={handleDeleteCandidateData}
            disabled={deletingCandidate}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-white border border-red-200 hover:bg-red-50 text-red-700 rounded-lg text-xs font-semibold transition-colors shadow-xs"
            title="Permanently delete candidate recordings and database record"
          >
            {deletingCandidate ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Trash2 className="w-3.5 h-3.5 text-red-600" />
            )}
            <span>Delete candidate data</span>
          </button>
        </div>
      </div>

      {/* ZIP Download Progress Overlay / Banner */}
      {downloadingZip && (
        <div className="mb-6 p-4 bg-blue-50 border border-blue-200 rounded-xl shadow-xs animate-in fade-in">
          <div className="flex items-center justify-between text-xs font-bold text-blue-900 mb-1.5">
            <span className="flex items-center gap-2">
              <Loader2 className="w-3.5 h-3.5 animate-spin text-blue-700" />
              <span>{zipProgressText}</span>
            </span>
            <span>{zipProgressPercent}%</span>
          </div>
          <div className="w-full bg-blue-200 h-2 rounded-full overflow-hidden">
            <div
              className="bg-blue-700 h-full rounded-full transition-all duration-300"
              style={{ width: `${zipProgressPercent}%` }}
            />
          </div>
        </div>
      )}

      {resetSuccess && (
        <div className="mb-6 p-4 bg-green-50 border border-green-200 rounded-xl text-green-800 text-xs flex items-center gap-2 animate-in fade-in">
          <CheckCircle className="w-4 h-4 text-green-600 flex-shrink-0" />
          <span>
            Test code <strong>{candidate.test_code}</strong> has been reset. The candidate can now start again from the beginning while existing responses remain preserved.
          </span>
        </div>
      )}

      {/* Overview Metric Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs">
          <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
            <User className="w-3.5 h-3.5 text-blue-600" />
            <span>Candidate</span>
          </span>
          <p className="text-base font-bold text-slate-900 mt-1">{candidate.full_name}</p>
          <p className="text-xs text-slate-500 font-mono mt-0.5">Code: {candidate.test_code}</p>
        </div>

        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs">
          <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
            <Clock className="w-3.5 h-3.5 text-blue-600" />
            <span>Dates & Status</span>
          </span>
          <div className="mt-1 flex items-center gap-2">
            <span className="capitalize font-bold text-slate-900 text-sm">
              {candidate.status.replace('_', ' ')}
            </span>
          </div>
          <p className="text-xs text-slate-500 mt-0.5">
            Started: {formatDate(candidate.started_at)}
          </p>
          {candidate.submitted_at && (
            <p className="text-xs text-slate-500">
              Submitted: {formatDate(candidate.submitted_at)}
            </p>
          )}
        </div>

        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs">
          <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
            <ShieldAlert className="w-3.5 h-3.5 text-amber-600" />
            <span>Proctor Warnings</span>
          </span>
          <p
            className={`text-base font-bold mt-1 ${
              candidate.warning_count >= 2 ? 'text-red-600' : candidate.warning_count === 1 ? 'text-amber-600' : 'text-slate-800'
            }`}
          >
            {candidate.warning_count} / 2
          </p>
          <p className="text-xs text-slate-500 mt-0.5">
            {proctorEvents.length === 0 ? 'No proctoring violations' : `${proctorEvents.length} security events logged`}
          </p>
        </div>

        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs">
          <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
            <Award className="w-3.5 h-3.5 text-blue-600" />
            <span>Overall Score</span>
          </span>
          <p className="text-2xl font-bold text-blue-700 mt-0.5">
            {overallScorePercentage !== null ? `${overallScorePercentage}%` : '—'}
          </p>
          <p className="text-xs text-slate-500 mt-0.5">
            {totalQuestionsScored} of {totalResponsesCount} responses scored
          </p>
        </div>
      </div>

      {/* Proctor Events Timeline */}
      {proctorEvents.length > 0 && (
        <div className="bg-white rounded-xl border border-amber-200 p-5 mb-6 shadow-xs">
          <div className="flex items-center gap-2 mb-3">
            <ShieldAlert className="w-4 h-4 text-amber-600" />
            <h3 className="text-xs font-bold text-amber-900 uppercase tracking-wider">
              Security Timeline ({proctorEvents.length} Proctor Events)
            </h3>
          </div>
          <div className="space-y-2">
            {proctorEvents.map((ev, idx) => (
              <div
                key={ev.id || idx}
                className="flex items-center justify-between p-2.5 rounded-lg bg-amber-50/60 text-xs text-amber-900 border border-amber-100"
              >
                <div className="flex items-center gap-2">
                  <span className="font-bold">Event {idx + 1}:</span>
                  <span className="capitalize">{ev.event_type.replace('_', ' ')}</span>
                  {ev.question_id && (
                    <span className="text-[11px] text-amber-700 font-mono">
                      (Question ID: {ev.question_id.slice(0, 8)}...)
                    </span>
                  )}
                </div>
                <span className="text-slate-500 text-[11px] font-mono">{formatDate(ev.created_at)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Section Performance Averages Bar */}
      {Object.keys(sectionAverages).length > 0 && (
        <div className="bg-blue-50/70 border border-blue-200 rounded-xl p-5 mb-8 shadow-xs">
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-bold text-blue-800 uppercase tracking-wider">
              Section Averages (1 - 5 Scale)
            </span>
            <span className="text-xs font-semibold text-blue-900">
              Overall Total: {overallScorePercentage !== null ? `${overallScorePercentage}%` : 'Pending'}
            </span>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-3">
            {Object.entries(sectionAverages).map(([sec, data]) => (
              <div key={sec} className="bg-white p-3 rounded-lg border border-blue-100 shadow-2xs text-center">
                <span className="text-[11px] font-bold text-slate-500 uppercase">Section {sec}</span>
                <p className="text-lg font-bold text-blue-700 mt-0.5">{data.average} / 5</p>
                <span className="text-[10px] text-slate-400">{data.count} items</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Candidate Responses & Scoring Grouped by Section */}
      <div className="space-y-8 mb-8">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <h2 className="text-lg font-bold text-slate-900">
            Recorded Responses & Rubric Scoring ({responseItems.length} recordings)
          </h2>
          <span className="text-xs text-slate-500">
            Scoring criteria: Pronunciation, Fluency, Accuracy, Content (1 to 5)
          </span>
        </div>

        {responseItems.length === 0 ? (
          <div className="bg-white rounded-xl border border-slate-200 p-12 text-center text-slate-400">
            <Headphones className="w-10 h-10 text-slate-300 mx-auto mb-2" />
            <p className="font-semibold text-slate-700">No responses recorded yet</p>
            <p className="text-xs text-slate-400 mt-1">
              Candidate responses will appear here as they complete test questions.
            </p>
          </div>
        ) : (
          Object.entries(groupedResponses).map(([sec, items]) => (
            <div key={sec} className="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-xs">
              {/* Section Header */}
              <div className="bg-slate-50 border-b border-slate-200 px-6 py-4 flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-bold text-slate-900">{getSectionTitle(sec)}</h3>
                  <p className="text-xs text-slate-500">{items.length} question response{items.length === 1 ? '' : 's'}</p>
                </div>
                {sectionAverages[sec] && (
                  <div className="bg-white border border-blue-200 px-3 py-1 rounded-lg text-xs font-bold text-blue-700 shadow-2xs">
                    Section Average: {sectionAverages[sec].average} / 5.0
                  </div>
                )}
              </div>

              {/* Section Question Items */}
              <div className="divide-y divide-slate-100 p-6 space-y-8">
                {items.map((item) => {
                  const r = item.response;
                  const q = item.question;
                  const script = item.script;
                  const sc = scoresState[r.id] || {
                    pronunciation: null,
                    fluency: null,
                    accuracy: null,
                    content: null,
                    notes: '',
                    isSaving: false,
                    isSaved: false,
                  };

                  return (
                    <div key={r.id} className="pt-6 first:pt-0">
                      {/* Question Header & Order */}
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-3">
                        <div className="flex items-center gap-2">
                          <span className="w-6 h-6 rounded-full bg-blue-100 text-blue-800 text-xs font-bold flex items-center justify-center">
                            {q.order_number}
                          </span>
                          <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                            Type: {q.type.replace('_', ' ')}
                          </span>
                        </div>
                        <div className="flex items-center gap-3 text-xs text-slate-500">
                          {r.duration_seconds && <span>Duration: <strong className="text-slate-700">{r.duration_seconds}s</strong></span>}
                          <span>Recorded: {formatDate(r.recorded_at)}</span>
                        </div>
                      </div>

                      {/* Prompt display text */}
                      {q.display_text && (
                        <div className="mb-3 p-3 bg-slate-50 rounded-lg border border-slate-200 text-xs text-slate-800">
                          <span className="font-semibold text-slate-500 uppercase text-[10px] block mb-0.5">Prompt Text:</span>
                          <p className="text-sm font-medium italic">"{q.display_text}"</p>
                        </div>
                      )}

                      {/* Admin-only Reference Script */}
                      {script?.script_text && (
                        <div className="mb-4 p-3 bg-blue-50/70 border border-blue-200 rounded-lg text-xs text-blue-950">
                          <div className="flex items-center gap-1.5 font-bold uppercase text-[10px] text-blue-700 mb-1">
                            <BookOpen className="w-3.5 h-3.5" />
                            <span>Admin Reference Script / Expected Answer:</span>
                          </div>
                          <p className="font-mono text-xs leading-relaxed font-medium">
                            {script.script_text}
                          </p>
                        </div>
                      )}

                      {/* Audio Player with Download Button beside it */}
                      <div className="mb-4 p-3 bg-slate-50 rounded-xl border border-slate-200 flex flex-col sm:flex-row items-center justify-between gap-3">
                        <div className="flex items-center gap-2 w-full sm:w-auto">
                          <Volume2 className="w-4 h-4 text-blue-700 flex-shrink-0" />
                          <span className="text-xs font-semibold text-slate-700">Candidate Audio Recording:</span>
                        </div>

                        <div className="flex items-center gap-2 w-full sm:w-auto justify-end">
                          {item.audioSignedUrl ? (
                            <>
                              <audio
                                controls
                                src={item.audioSignedUrl}
                                className="w-full sm:w-72 h-9"
                                preload="none"
                              />
                              <button
                                type="button"
                                onClick={() => handleDownloadSingleRecording(item)}
                                disabled={downloadingSingleId === r.id}
                                className="inline-flex items-center gap-1 p-2 rounded-lg border border-slate-300 hover:bg-slate-100 text-slate-700 text-xs font-medium transition-colors shadow-2xs flex-shrink-0"
                                title="Download this audio recording (.webm)"
                              >
                                {downloadingSingleId === r.id ? (
                                  <Loader2 className="w-4 h-4 animate-spin text-blue-700" />
                                ) : (
                                  <Download className="w-4 h-4 text-blue-700" />
                                )}
                              </button>
                            </>
                          ) : (
                            <span className="text-xs text-slate-400 italic">Audio recording unavailable</span>
                          )}
                        </div>
                      </div>

                      {/* Rubric Score Inputs (1 to 5) */}
                      <div className="bg-slate-50/80 p-4 rounded-xl border border-slate-200 space-y-4">
                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                          <div>
                            <div className="flex justify-between items-center mb-1.5">
                              <label className="text-xs font-bold text-slate-700">Pronunciation</label>
                              <span className="text-xs font-mono font-bold text-blue-700">
                                {sc.pronunciation !== null ? `${sc.pronunciation}/5` : '—'}
                              </span>
                            </div>
                            <div className="flex items-center gap-1">
                              {[1, 2, 3, 4, 5].map((val) => (
                                <button
                                  key={val}
                                  type="button"
                                  onClick={() => handleScoreChange(r.id, 'pronunciation', val)}
                                  className={`flex-1 py-1 rounded text-xs font-bold transition-all ${
                                    sc.pronunciation === val
                                      ? 'bg-blue-700 text-white shadow-xs'
                                      : 'bg-white border border-slate-200 text-slate-700 hover:bg-slate-100'
                                  }`}
                                >
                                  {val}
                                </button>
                              ))}
                            </div>
                          </div>

                          <div>
                            <div className="flex justify-between items-center mb-1.5">
                              <label className="text-xs font-bold text-slate-700">Fluency</label>
                              <span className="text-xs font-mono font-bold text-blue-700">
                                {sc.fluency !== null ? `${sc.fluency}/5` : '—'}
                              </span>
                            </div>
                            <div className="flex items-center gap-1">
                              {[1, 2, 3, 4, 5].map((val) => (
                                <button
                                  key={val}
                                  type="button"
                                  onClick={() => handleScoreChange(r.id, 'fluency', val)}
                                  className={`flex-1 py-1 rounded text-xs font-bold transition-all ${
                                    sc.fluency === val
                                      ? 'bg-blue-700 text-white shadow-xs'
                                      : 'bg-white border border-slate-200 text-slate-700 hover:bg-slate-100'
                                  }`}
                                >
                                  {val}
                                </button>
                              ))}
                            </div>
                          </div>

                          <div>
                            <div className="flex justify-between items-center mb-1.5">
                              <label className="text-xs font-bold text-slate-700">Accuracy</label>
                              <span className="text-xs font-mono font-bold text-blue-700">
                                {sc.accuracy !== null ? `${sc.accuracy}/5` : '—'}
                              </span>
                            </div>
                            <div className="flex items-center gap-1">
                              {[1, 2, 3, 4, 5].map((val) => (
                                <button
                                  key={val}
                                  type="button"
                                  onClick={() => handleScoreChange(r.id, 'accuracy', val)}
                                  className={`flex-1 py-1 rounded text-xs font-bold transition-all ${
                                    sc.accuracy === val
                                      ? 'bg-blue-700 text-white shadow-xs'
                                      : 'bg-white border border-slate-200 text-slate-700 hover:bg-slate-100'
                                  }`}
                                >
                                  {val}
                                </button>
                              ))}
                            </div>
                          </div>

                          <div>
                            <div className="flex justify-between items-center mb-1.5">
                              <label className="text-xs font-bold text-slate-700">Content</label>
                              <span className="text-xs font-mono font-bold text-blue-700">
                                {sc.content !== null ? `${sc.content}/5` : '—'}
                              </span>
                            </div>
                            <div className="flex items-center gap-1">
                              {[1, 2, 3, 4, 5].map((val) => (
                                <button
                                  key={val}
                                  type="button"
                                  onClick={() => handleScoreChange(r.id, 'content', val)}
                                  className={`flex-1 py-1 rounded text-xs font-bold transition-all ${
                                    sc.content === val
                                      ? 'bg-blue-700 text-white shadow-xs'
                                      : 'bg-white border border-slate-200 text-slate-700 hover:bg-slate-100'
                                  }`}
                                >
                                  {val}
                                </button>
                              ))}
                            </div>
                          </div>
                        </div>

                        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 pt-2">
                          <input
                            type="text"
                            value={sc.notes || ''}
                            onChange={(e) => handleNotesChange(r.id, e.target.value)}
                            placeholder="Response notes (e.g., clear diction, slight hesitation on syllable)..."
                            className="flex-1 px-3 py-1.5 bg-white border border-slate-200 rounded-lg text-xs text-slate-800 placeholder:text-slate-400 outline-none focus:border-blue-600"
                          />

                          <button
                            type="button"
                            onClick={() => handleSaveScore(r.id)}
                            disabled={sc.isSaving}
                            className={`inline-flex items-center justify-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-colors shadow-2xs ${
                              sc.isSaved
                                ? 'bg-green-600 hover:bg-green-700 text-white'
                                : 'bg-blue-700 hover:bg-blue-800 text-white'
                            }`}
                          >
                            {sc.isSaving ? (
                              <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            ) : sc.isSaved ? (
                              <Check className="w-3.5 h-3.5" />
                            ) : (
                              <Save className="w-3.5 h-3.5" />
                            )}
                            <span>{sc.isSaving ? 'Saving...' : sc.isSaved ? 'Score Saved' : 'Save Score'}</span>
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))
        )}
      </div>

      {/* Overall Assessment Notes Box */}
      <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-xs">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <FileText className="w-5 h-5 text-blue-700" />
            <h3 className="text-base font-bold text-slate-900">Overall Assessment Feedback & Notes</h3>
          </div>
          {notesSaveSuccess && (
            <span className="text-xs font-semibold text-green-700 flex items-center gap-1">
              <Check className="w-3.5 h-3.5 text-green-600" />
              <span>Overall notes saved!</span>
            </span>
          )}
        </div>

        <textarea
          rows={4}
          value={overallNotes}
          onChange={(e) => setOverallNotes(e.target.value)}
          placeholder="Enter overall candidate evaluation, CEFR spoken proficiency level, communication strengths, areas for improvement..."
          className="w-full p-3 bg-slate-50 border border-slate-300 focus:bg-white focus:border-blue-600 focus:ring-1 focus:ring-blue-100 rounded-xl text-xs sm:text-sm text-slate-900 placeholder:text-slate-400 outline-none leading-relaxed"
        />

        <div className="mt-4 flex flex-col sm:flex-row items-center justify-between gap-3">
          <span className="text-xs text-slate-500">
            Total Score: <strong>{overallScorePercentage !== null ? `${overallScorePercentage}%` : 'Pending Scoring'}</strong> (saved to candidate record)
          </span>

          <button
            type="button"
            onClick={handleSaveOverallNotes}
            disabled={savingNotes}
            className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-5 py-2.5 bg-blue-700 hover:bg-blue-800 disabled:bg-blue-400 text-white font-semibold rounded-lg text-xs transition-colors shadow-xs"
          >
            {savingNotes ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>Saving Notes...</span>
              </>
            ) : (
              <>
                <Save className="w-4 h-4" />
                <span>Save Overall Notes & Score</span>
              </>
            )}
          </button>
        </div>
      </div>

      {/* Danger Zone: Permanent Candidate Data Deletion */}
      <div className="mt-8 bg-red-50/50 rounded-2xl border border-red-200 p-6 shadow-xs">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <Trash2 className="w-5 h-5 text-red-600" />
              <h3 className="text-sm font-bold text-red-950">Danger Zone: Delete Candidate Data</h3>
            </div>
            <p className="text-xs text-red-700 mt-1 max-w-xl">
              Permanently delete all audio files for this candidate from the recordings bucket and erase the candidate record. This action cannot be undone.
            </p>
          </div>

          <button
            type="button"
            onClick={handleDeleteCandidateData}
            disabled={deletingCandidate}
            className="inline-flex items-center justify-center gap-2 px-4 py-2.5 bg-red-600 hover:bg-red-700 disabled:bg-red-400 text-white rounded-lg text-xs font-semibold transition-colors shadow-xs flex-shrink-0"
          >
            {deletingCandidate ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Trash2 className="w-4 h-4" />
            )}
            <span>Delete candidate data</span>
          </button>
        </div>
      </div>
    </div>
  );
};
