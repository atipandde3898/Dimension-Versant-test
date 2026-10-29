import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { supabase, isSupabaseConfigured } from '../lib/supabase';
import type { Question, QuestionScript } from '../types/database';
import {
  HelpCircle,
  ArrowLeft,
  Plus,
  Volume2,
  Edit2,
  Trash2,
  Check,
  X,
  Upload,
  Play,
  RotateCcw,
  Loader2,
  AlertCircle,
  Clock,
  ArrowUp,
  ArrowDown,
  BookOpen,
  FileText,
  ToggleLeft,
  ToggleRight,
} from 'lucide-react';

interface QuestionWithScript extends Question {
  script_text?: string;
  previewAudioUrl?: string;
}

export const AdminQuestionsPage: React.FC = () => {
  const [questions, setQuestions] = useState<QuestionWithScript[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Modal states for Add / Edit
  const [modalMode, setModalMode] = useState<'add' | 'edit' | null>(null);
  const [activeQuestion, setActiveQuestion] = useState<Partial<QuestionWithScript> | null>(null);
  const [savingQuestion, setSavingQuestion] = useState<boolean>(false);
  const [modalError, setModalError] = useState<string | null>(null);

  // Audio upload state in modal
  const [audioFile, setAudioFile] = useState<File | null>(null);
  const [uploadingAudio, setUploadingAudio] = useState<boolean>(false);

  // Fetch all questions and scripts
  const fetchQuestions = useCallback(async () => {
    if (!isSupabaseConfigured) {
      setLoading(false);
      return;
    }

    setLoading(true);
    setErrorMessage(null);

    try {
      // 1. Fetch questions ordered by order_number
      const { data: qData, error: qError } = await supabase
        .from('questions')
        .select('*')
        .order('order_number', { ascending: true });

      if (qError) throw qError;
      const qList = (qData as Question[]) || [];

      // 2. Fetch question scripts
      const { data: sData } = await supabase
        .from('question_scripts')
        .select('*');

      const scriptMap = new Map<string, string>(
        (sData as QuestionScript[] || []).map((s) => [s.question_id, s.script_text])
      );

      // 3. Generate signed URLs for previewing audio
      const combined: QuestionWithScript[] = await Promise.all(
        qList.map(async (q) => {
          let previewUrl = '';
          if (q.audio_path) {
            try {
              const { data: urlData } = await supabase.storage
                .from('question-audio')
                .createSignedUrl(q.audio_path, 3600);
              previewUrl = urlData?.signedUrl || '';
            } catch (e) {
              console.warn(`Could not get signed URL for ${q.audio_path}:`, e);
            }
          }

          return {
            ...q,
            script_text: scriptMap.get(q.id) || '',
            previewAudioUrl: previewUrl,
          };
        })
      );

      setQuestions(combined);
    } catch (err: any) {
      console.error('Error fetching questions:', err);
      setErrorMessage(err.message || 'Failed to load questions.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchQuestions();
  }, [fetchQuestions]);

  // Group by Section
  const groupedSections = useMemo(() => {
    const groups: Record<string, QuestionWithScript[]> = {};
    questions.forEach((q) => {
      const sec = q.section || 'General';
      if (!groups[sec]) groups[sec] = [];
      groups[sec].push(q);
    });
    return groups;
  }, [questions]);

  // Toggle active status
  const handleToggleActive = async (q: QuestionWithScript) => {
    try {
      const newActive = !q.active;
      const { error } = await supabase
        .from('questions')
        .update({ active: newActive })
        .eq('id', q.id);

      if (error) throw error;
      setQuestions((prev) =>
        prev.map((item) => (item.id === q.id ? { ...item, active: newActive } : item))
      );
    } catch (err: any) {
      console.error('Error toggling active status:', err);
      alert(`Failed to update question: ${err.message}`);
    }
  };

  // Reordering: swap order_number with neighbor
  const handleMoveOrder = async (index: number, direction: 'up' | 'down') => {
    const targetIndex = direction === 'up' ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= questions.length) return;

    const qCurrent = questions[index];
    const qTarget = questions[targetIndex];

    try {
      // Use temporary order number to avoid unique constraint collision
      const tempOrder = 999999;
      await supabase.from('questions').update({ order_number: tempOrder }).eq('id', qCurrent.id);
      await supabase.from('questions').update({ order_number: qCurrent.order_number }).eq('id', qTarget.id);
      await supabase.from('questions').update({ order_number: qTarget.order_number }).eq('id', qCurrent.id);

      await fetchQuestions();
    } catch (err: any) {
      console.error('Reorder error:', err);
      alert(`Failed to reorder question: ${err.message}`);
    }
  };

  // Open modal for adding
  const handleOpenAddModal = () => {
    const nextOrder = questions.length > 0 ? Math.max(...questions.map((q) => q.order_number)) + 1 : 1;
    setActiveQuestion({
      section: 'A',
      order_number: nextOrder,
      type: 'read_aloud',
      display_text: '',
      script_text: '',
      time_limit_seconds: 20,
      active: true,
      audio_path: null,
    });
    setAudioFile(null);
    setModalError(null);
    setModalMode('add');
  };

  // Open modal for editing
  const handleOpenEditModal = (q: QuestionWithScript) => {
    setActiveQuestion({ ...q });
    setAudioFile(null);
    setModalError(null);
    setModalMode('edit');
  };

  // Close modal
  const handleCloseModal = () => {
    setModalMode(null);
    setActiveQuestion(null);
    setAudioFile(null);
    setModalError(null);
  };

  // Save question (Add or Edit)
  const handleSaveQuestion = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeQuestion) return;

    setSavingQuestion(true);
    setModalError(null);

    try {
      let finalAudioPath = activeQuestion.audio_path || null;

      // 1. If an audio file was selected, upload to question-audio bucket
      if (audioFile) {
        setUploadingAudio(true);
        const fileExt = audioFile.name.split('.').pop() || 'mp3';
        const cleanName = `q_${activeQuestion.order_number}_${Date.now()}.${fileExt}`;

        const { error: uploadError } = await supabase.storage
          .from('question-audio')
          .upload(cleanName, audioFile, {
            contentType: audioFile.type || 'audio/mpeg',
            upsert: true,
          });

        if (uploadError) {
          throw new Error(`Audio upload failed: ${uploadError.message}`);
        }

        finalAudioPath = cleanName;
        setUploadingAudio(false);
      }

      if (modalMode === 'add') {
        // Insert question
        const { data: newQ, error: insertError } = await supabase
          .from('questions')
          .insert({
            section: (activeQuestion.section || 'A').toUpperCase().trim(),
            order_number: Number(activeQuestion.order_number),
            type: activeQuestion.type || 'read_aloud',
            display_text: activeQuestion.display_text?.trim() || null,
            audio_path: finalAudioPath,
            time_limit_seconds: Number(activeQuestion.time_limit_seconds) || 20,
            active: activeQuestion.active ?? true,
          })
          .select()
          .single();

        if (insertError) throw insertError;

        // Insert script if provided
        if (newQ && activeQuestion.script_text?.trim()) {
          await supabase.from('question_scripts').insert({
            question_id: newQ.id,
            script_text: activeQuestion.script_text.trim(),
          });
        }
      } else if (modalMode === 'edit' && activeQuestion.id) {
        // Update question
        const { error: updateError } = await supabase
          .from('questions')
          .update({
            section: (activeQuestion.section || 'A').toUpperCase().trim(),
            order_number: Number(activeQuestion.order_number),
            type: activeQuestion.type || 'read_aloud',
            display_text: activeQuestion.display_text?.trim() || null,
            audio_path: finalAudioPath,
            time_limit_seconds: Number(activeQuestion.time_limit_seconds) || 20,
            active: activeQuestion.active ?? true,
          })
          .eq('id', activeQuestion.id);

        if (updateError) throw updateError;

        // Upsert or delete script
        if (activeQuestion.script_text?.trim()) {
          await supabase.from('question_scripts').upsert(
            {
              question_id: activeQuestion.id,
              script_text: activeQuestion.script_text.trim(),
            },
            { onConflict: 'question_id' }
          );
        } else {
          await supabase.from('question_scripts').delete().eq('question_id', activeQuestion.id);
        }
      }

      handleCloseModal();
      await fetchQuestions();
    } catch (err: any) {
      console.error('Error saving question:', err);
      setModalError(err.message || 'Failed to save question.');
    } finally {
      setSavingQuestion(false);
      setUploadingAudio(false);
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

  return (
    <div className="flex-1 max-w-6xl w-full mx-auto p-4 sm:p-8">
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
              <HelpCircle className="w-6 h-6 text-blue-700" />
              <h1 className="text-xl sm:text-2xl font-bold text-slate-900">Questions & Audio Prompts</h1>
            </div>
            <p className="text-slate-500 text-xs sm:text-sm mt-0.5">
              Manage test sections A through F, timing rules, display prompts, and audio files
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={fetchQuestions}
            disabled={loading}
            className="inline-flex items-center gap-1.5 px-3 py-2 bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 rounded-lg text-xs font-medium transition-colors shadow-xs"
          >
            <RotateCcw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            <span>Refresh</span>
          </button>
          <button
            type="button"
            onClick={handleOpenAddModal}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-blue-700 hover:bg-blue-800 text-white rounded-lg text-xs font-semibold shadow-xs transition-colors"
          >
            <Plus className="w-4 h-4" />
            <span>Add New Question</span>
          </button>
        </div>
      </div>

      {errorMessage && (
        <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-xl text-red-800 text-xs flex items-center gap-2">
          <AlertCircle className="w-4 h-4 text-red-600 flex-shrink-0" />
          <span>{errorMessage}</span>
        </div>
      )}

      {loading ? (
        <div className="bg-white rounded-2xl border border-slate-200 p-12 text-center shadow-xs">
          <Loader2 className="w-8 h-8 text-blue-700 animate-spin mx-auto mb-2" />
          <p className="text-xs text-slate-500">Loading questions & prompt audio...</p>
        </div>
      ) : questions.length === 0 ? (
        <div className="bg-white rounded-2xl border border-slate-200 p-12 text-center text-slate-400 shadow-xs">
          <HelpCircle className="w-10 h-10 text-slate-300 mx-auto mb-2" />
          <p className="font-semibold text-slate-700">No questions configured</p>
          <p className="text-xs text-slate-400 mt-1">Click "Add New Question" above to create your first assessment item.</p>
        </div>
      ) : (
        <div className="space-y-6">
          {Object.entries(groupedSections).map(([sec, items]) => (
            <div key={sec} className="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-xs">
              <div className="bg-slate-50 border-b border-slate-200 px-6 py-3.5 flex items-center justify-between">
                <div>
                  <h2 className="text-sm font-bold text-slate-900">{getSectionTitle(sec)}</h2>
                  <span className="text-[11px] text-slate-500">{items.length} question{items.length === 1 ? '' : 's'}</span>
                </div>
              </div>

              <div className="divide-y divide-slate-100">
                {items.map((q, idx) => {
                  const globalIndex = questions.findIndex((item) => item.id === q.id);

                  return (
                    <div
                      key={q.id}
                      className={`p-5 flex flex-col md:flex-row md:items-center justify-between gap-4 transition-colors ${
                        !q.active ? 'bg-slate-50/50 opacity-75' : 'hover:bg-slate-50/40'
                      }`}
                    >
                      {/* Left Question Info */}
                      <div className="flex items-start gap-3.5 flex-1">
                        <div className="flex flex-col items-center gap-1">
                          <span className="w-7 h-7 rounded-full bg-blue-100 text-blue-800 text-xs font-bold flex items-center justify-center">
                            {q.order_number}
                          </span>
                          <div className="flex items-center gap-0.5">
                            <button
                              type="button"
                              onClick={() => handleMoveOrder(globalIndex, 'up')}
                              disabled={globalIndex === 0}
                              className="p-1 text-slate-400 hover:text-slate-700 disabled:opacity-20 rounded"
                              title="Move Up"
                            >
                              <ArrowUp className="w-3 h-3" />
                            </button>
                            <button
                              type="button"
                              onClick={() => handleMoveOrder(globalIndex, 'down')}
                              disabled={globalIndex === questions.length - 1}
                              className="p-1 text-slate-400 hover:text-slate-700 disabled:opacity-20 rounded"
                              title="Move Down"
                            >
                              <ArrowDown className="w-3 h-3" />
                            </button>
                          </div>
                        </div>

                        <div className="space-y-1.5 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-slate-100 text-slate-700">
                              {q.type.replace('_', ' ')}
                            </span>
                            <span className="text-xs text-slate-400 font-mono flex items-center gap-1">
                              <Clock className="w-3 h-3" />
                              <span>{q.time_limit_seconds}s limit</span>
                            </span>
                            {!q.active && (
                              <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-slate-200 text-slate-600">
                                Inactive
                              </span>
                            )}
                          </div>

                          {/* Display prompt text */}
                          {q.display_text ? (
                            <p className="text-sm font-medium text-slate-900 leading-snug">
                              "{q.display_text}"
                            </p>
                          ) : (
                            <p className="text-xs italic text-slate-400">
                              No on-screen display text (Audio-only question)
                            </p>
                          )}

                          {/* Admin Script */}
                          {q.script_text && (
                            <div className="flex items-start gap-1.5 text-xs text-blue-900 bg-blue-50/60 p-2 rounded border border-blue-100 font-mono">
                              <BookOpen className="w-3.5 h-3.5 text-blue-600 mt-0.5 flex-shrink-0" />
                              <span>{q.script_text}</span>
                            </div>
                          )}
                        </div>
                      </div>

                      {/* Right Audio Player & Actions */}
                      <div className="flex flex-wrap items-center gap-3 md:justify-end">
                        {/* Audio Preview Player */}
                        {q.previewAudioUrl ? (
                          <div className="flex items-center gap-2 bg-slate-50 border border-slate-200 px-2 py-1 rounded-lg">
                            <Volume2 className="w-3.5 h-3.5 text-blue-700 flex-shrink-0" />
                            <audio controls src={q.previewAudioUrl} className="h-7 w-48" preload="none" />
                          </div>
                        ) : q.audio_path ? (
                          <span className="text-xs text-slate-400 font-mono">Audio: {q.audio_path}</span>
                        ) : (
                          <span className="text-xs text-slate-400 italic">No audio prompt</span>
                        )}

                        {/* Active toggle button */}
                        <button
                          type="button"
                          onClick={() => handleToggleActive(q)}
                          className={`p-1.5 rounded-lg border text-xs font-medium transition-colors ${
                            q.active
                              ? 'bg-green-50 border-green-200 text-green-700 hover:bg-green-100'
                              : 'bg-slate-100 border-slate-200 text-slate-500 hover:bg-slate-200'
                          }`}
                          title={q.active ? 'Active: click to deactivate' : 'Inactive: click to activate'}
                        >
                          {q.active ? (
                            <span className="flex items-center gap-1 font-semibold text-[11px]">
                              <Check className="w-3 h-3 text-green-600" />
                              <span>Active</span>
                            </span>
                          ) : (
                            <span className="flex items-center gap-1 text-[11px]">
                              <X className="w-3 h-3 text-slate-400" />
                              <span>Inactive</span>
                            </span>
                          )}
                        </button>

                        {/* Edit button */}
                        <button
                          type="button"
                          onClick={() => handleOpenEditModal(q)}
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 rounded-lg text-xs font-semibold transition-colors shadow-2xs"
                        >
                          <Edit2 className="w-3.5 h-3.5 text-blue-700" />
                          <span>Edit</span>
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Add / Edit Question Modal */}
      {modalMode && activeQuestion && (
        <div className="fixed inset-0 z-50 bg-slate-950/70 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 max-w-xl w-full p-6 my-8 animate-in zoom-in-95">
            <div className="flex items-center justify-between pb-4 border-b border-slate-100 mb-5">
              <h2 className="text-lg font-bold text-slate-900">
                {modalMode === 'add' ? 'Add New Question' : `Edit Question #${activeQuestion.order_number}`}
              </h2>
              <button
                type="button"
                onClick={handleCloseModal}
                className="p-1 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {modalError && (
              <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-xs text-red-800 flex items-start gap-2">
                <AlertCircle className="w-4 h-4 text-red-600 mt-0.5 flex-shrink-0" />
                <span>{modalError}</span>
              </div>
            )}

            <form onSubmit={handleSaveQuestion} className="space-y-4">
              <div className="grid grid-cols-3 gap-3">
                {/* Section */}
                <div>
                  <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1">
                    Section
                  </label>
                  <select
                    value={activeQuestion.section || 'A'}
                    onChange={(e) => setActiveQuestion({ ...activeQuestion, section: e.target.value })}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg text-xs font-bold text-slate-800 outline-none"
                  >
                    <option value="A">Section A (Read Aloud)</option>
                    <option value="B">Section B (Repeat)</option>
                    <option value="C">Section C (Short Answer)</option>
                    <option value="D">Section D (Sentence Build)</option>
                    <option value="E">Section E (Story Retell)</option>
                    <option value="F">Section F (Open Question)</option>
                  </select>
                </div>

                {/* Order Number */}
                <div>
                  <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1">
                    Order #
                  </label>
                  <input
                    type="number"
                    min={1}
                    required
                    value={activeQuestion.order_number || 1}
                    onChange={(e) => setActiveQuestion({ ...activeQuestion, order_number: Number(e.target.value) })}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg text-xs font-bold font-mono text-slate-800 outline-none"
                  />
                </div>

                {/* Time Limit (seconds) */}
                <div>
                  <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1">
                    Time Limit (sec)
                  </label>
                  <input
                    type="number"
                    min={5}
                    max={180}
                    required
                    value={activeQuestion.time_limit_seconds || 20}
                    onChange={(e) => setActiveQuestion({ ...activeQuestion, time_limit_seconds: Number(e.target.value) })}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg text-xs font-bold font-mono text-slate-800 outline-none"
                  />
                </div>
              </div>

              {/* Type */}
              <div>
                <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1">
                  Question Type
                </label>
                <select
                  value={activeQuestion.type || 'read_aloud'}
                  onChange={(e) => setActiveQuestion({ ...activeQuestion, type: e.target.value })}
                  className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-xs text-slate-800 outline-none"
                >
                  <option value="read_aloud">read_aloud</option>
                  <option value="repeat">repeat</option>
                  <option value="short_answer">short_answer</option>
                  <option value="sentence_build">sentence_build</option>
                  <option value="retell">retell</option>
                  <option value="open">open</option>
                </select>
              </div>

              {/* Display Text */}
              <div>
                <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1">
                  On-Screen Display Text (Optional)
                </label>
                <textarea
                  rows={2}
                  value={activeQuestion.display_text || ''}
                  onChange={(e) => setActiveQuestion({ ...activeQuestion, display_text: e.target.value })}
                  placeholder="Sentence for read_aloud or prompt prompt for open section..."
                  className="w-full p-2.5 bg-white border border-slate-300 rounded-lg text-xs text-slate-800 placeholder:text-slate-400 outline-none"
                />
              </div>

              {/* Admin-only Reference Script */}
              <div>
                <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1">
                  Admin Reference Script (question_scripts)
                </label>
                <textarea
                  rows={2}
                  value={activeQuestion.script_text || ''}
                  onChange={(e) => setActiveQuestion({ ...activeQuestion, script_text: e.target.value })}
                  placeholder="Expected answer script or sentence reference for scoring (candidates never see this)..."
                  className="w-full p-2.5 bg-blue-50/50 border border-blue-200 rounded-lg text-xs font-mono text-blue-950 placeholder:text-blue-300 outline-none"
                />
              </div>

              {/* Audio Upload */}
              <div>
                <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1">
                  Upload MP3 Prompt Audio (question-audio bucket)
                </label>
                <div className="flex items-center gap-3">
                  <label className="cursor-pointer inline-flex items-center gap-1.5 px-3 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-xs font-medium transition-colors border border-slate-300">
                    <Upload className="w-3.5 h-3.5" />
                    <span>Choose MP3 File</span>
                    <input
                      type="file"
                      accept="audio/mp3,audio/mpeg,audio/wav,audio/webm"
                      onChange={(e) => setAudioFile(e.target.files?.[0] || null)}
                      className="hidden"
                    />
                  </label>
                  <span className="text-xs text-slate-500 truncate max-w-xs">
                    {audioFile ? audioFile.name : activeQuestion.audio_path ? `Current: ${activeQuestion.audio_path}` : 'No audio file selected'}
                  </span>
                </div>
              </div>

              {/* Active Toggle */}
              <div className="pt-2 flex items-center justify-between border-t border-slate-100">
                <label className="flex items-center gap-2 cursor-pointer select-none text-xs font-medium text-slate-800">
                  <input
                    type="checkbox"
                    checked={activeQuestion.active ?? true}
                    onChange={(e) => setActiveQuestion({ ...activeQuestion, active: e.target.checked })}
                    className="w-4 h-4 text-blue-600 rounded border-slate-300 focus:ring-blue-500"
                  />
                  <span>Active in candidate assessments</span>
                </label>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={handleCloseModal}
                    className="px-4 py-2 border border-slate-300 text-slate-600 hover:bg-slate-50 rounded-lg text-xs font-medium"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={savingQuestion || uploadingAudio}
                    className="inline-flex items-center gap-1.5 px-5 py-2 bg-blue-700 hover:bg-blue-800 disabled:bg-blue-400 text-white rounded-lg text-xs font-semibold shadow-xs"
                  >
                    {savingQuestion ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <Check className="w-3.5 h-3.5" />
                    )}
                    <span>{savingQuestion ? 'Saving...' : 'Save Question'}</span>
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
