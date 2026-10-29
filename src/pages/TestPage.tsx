import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { supabase, isSupabaseConfigured } from '../lib/supabase';
import type { Question } from '../types/database';
import {
  Mic,
  Volume2,
  Clock,
  AlertCircle,
  RotateCcw,
  Square,
  Loader2,
  Headphones,
  ShieldAlert,
  Maximize2,
  AlertTriangle,
} from 'lucide-react';

type QuestionStep = 'loading' | 'listening' | 'countdown' | 'recording' | 'uploading' | 'error';

export const TestPage: React.FC = () => {
  const { candidate, refreshCandidate } = useAuth();
  const navigate = useNavigate();

  // Test questions state
  const [questions, setQuestions] = useState<Question[]>([]);
  const [loadingQuestions, setLoadingQuestions] = useState<boolean>(true);
  const [currentIndex, setCurrentIndex] = useState<number>(0);
  const [step, setStep] = useState<QuestionStep>('loading');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Timers & countdowns
  const [readyCountdown, setReadyCountdown] = useState<number>(3);
  const [recordTimeLeft, setRecordTimeLeft] = useState<number>(20);

  // Proctoring states
  const [warningCount, setWarningCount] = useState<number>(candidate?.warning_count ?? 0);
  const [warningModalOpen, setWarningModalOpen] = useState<boolean>(false);
  const [autoSubmitting, setAutoSubmitting] = useState<boolean>(false);
  const lastWarningTimeRef = useRef<number>(0);
  const isHandlingWarningRef = useRef<boolean>(false);

  // Audio & media recording refs
  const audioPlayerRef = useRef<HTMLAudioElement | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const recordingStartTimeRef = useRef<number>(0);
  const timerIntervalRef = useRef<any>(null);
  const readyIntervalRef = useRef<any>(null);

  // Keep track of audio prompts played in this session to prevent replay
  const playedAudioQuestionsRef = useRef<Set<string>>(new Set());

  // 1. Load active questions from database
  useEffect(() => {
    let isMounted = true;

    async function fetchQuestions() {
      if (!isSupabaseConfigured) {
        setErrorMessage('Supabase is not configured. Unable to fetch questions.');
        setLoadingQuestions(false);
        return;
      }

      try {
        const { data, error } = await supabase
          .from('questions')
          .select('*')
          .eq('active', true)
          .order('order_number', { ascending: true });

        if (error) {
          throw error;
        }

        if (!isMounted) return;

        if (!data || data.length === 0) {
          setErrorMessage('No active questions found for the assessment. Please contact your test administrator.');
          setLoadingQuestions(false);
          return;
        }

        setQuestions(data as Question[]);

        // Position candidate at current_question
        const startPos = candidate?.current_question ?? 0;
        if (startPos >= data.length) {
          navigate('/done');
          return;
        }

        setCurrentIndex(startPos);
        setLoadingQuestions(false);
      } catch (err: any) {
        console.error('Error fetching questions:', err);
        if (isMounted) {
          setErrorMessage(err.message || 'Failed to load test questions.');
          setLoadingQuestions(false);
        }
      }
    }

    fetchQuestions();

    return () => {
      isMounted = false;
    };
  }, [candidate, navigate]);

  // Clean up timers and audio on unmount
  useEffect(() => {
    return () => {
      if (timerIntervalRef.current) clearInterval(timerIntervalRef.current);
      if (readyIntervalRef.current) clearInterval(readyIntervalRef.current);
      if (audioPlayerRef.current) {
        audioPlayerRef.current.pause();
        audioPlayerRef.current = null;
      }
      if (mediaStreamRef.current) {
        mediaStreamRef.current.getTracks().forEach((t) => t.stop());
      }
    };
  }, []);

  const currentQuestion = questions[currentIndex];

  // Helper to map section code to display title
  const getSectionTitle = (section: string, type: string) => {
    const sectionMap: Record<string, string> = {
      A: 'Section A: Read Aloud',
      B: 'Section B: Repeat',
      C: 'Section C: Short Answer',
      D: 'Section D: Sentence Builds',
      E: 'Section E: Story Retelling',
      F: 'Section F: Open Question',
    };
    return sectionMap[section] || `Section ${section} (${type.replace('_', ' ')})`;
  };

  const getSectionGuidance = (type: string) => {
    switch (type) {
      case 'read_aloud':
        return 'Please read the text aloud clearly and naturally.';
      case 'repeat':
        return 'Please repeat the sentence exactly as you hear it.';
      case 'short_answer':
        return 'Please answer the question with a simple word or short phrase.';
      case 'sentence_build':
        return 'Please rearrange the word groups into a correct and meaningful sentence.';
      case 'retell':
        return 'Please retell the story in your own words with as much detail as you can.';
      case 'open':
        return 'Please speak freely on the topic given until the timer ends.';
      default:
        return 'Please speak your answer clearly into the microphone.';
    }
  };

  // --------------------------------------------------------------------------
  // PROCTORING: Trigger Security Warning & Auto-Submit
  // --------------------------------------------------------------------------
  const handleSecurityEvent = useCallback(
    async (eventType: 'tab_switch' | 'fullscreen_exit') => {
      // Avoid firing if test is still loading, already auto-submitting, or if warning fired < 4s ago
      const now = Date.now();
      if (
        loadingQuestions ||
        autoSubmitting ||
        isHandlingWarningRef.current ||
        warningModalOpen ||
        now - lastWarningTimeRef.current < 4000
      ) {
        return;
      }

      lastWarningTimeRef.current = now;
      isHandlingWarningRef.current = true;

      try {
        // Record warning via database RPC: returns the updated warning_count
        const { data: newWarningCount, error } = await supabase.rpc('record_warning', {
          p_event_type: eventType,
          p_question_id: currentQuestion?.id || null,
        });

        if (error) {
          console.warn('record_warning RPC error:', error.message);
        }

        const updatedCount = typeof newWarningCount === 'number' ? newWarningCount : warningCount + 1;
        setWarningCount(updatedCount);

        // Check if limit reached: 2 warnings -> immediate auto-submit
        if (updatedCount >= 2) {
          setAutoSubmitting(true);
          setWarningModalOpen(false);

          // Stop active recording and try to save whatever exists
          if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
            try {
              mediaRecorderRef.current.stop();
            } catch (e) {
              console.warn('Error stopping recorder on auto-submit:', e);
            }
          }

          // If there is audio collected, attempt best-effort upload
          if (audioChunksRef.current.length > 0 && candidate && currentQuestion) {
            try {
              const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
              const recordingPath = `${candidate.id}/${currentQuestion.order_number}.webm`;
              await supabase.storage.from('recordings').upload(recordingPath, audioBlob, {
                contentType: 'audio/webm',
                upsert: true,
              });
              await supabase.from('responses').upsert(
                {
                  candidate_id: candidate.id,
                  question_id: currentQuestion.id,
                  audio_path: recordingPath,
                  duration_seconds: Math.max(1, Math.round((Date.now() - recordingStartTimeRef.current) / 1000)),
                },
                { onConflict: 'candidate_id,question_id' }
              );
            } catch (e) {
              console.warn('Best-effort upload on auto-submit failed:', e);
            }
          }

          // Call finish_test('auto_submitted')
          await supabase.rpc('finish_test', { p_status: 'auto_submitted' });
          await refreshCandidate();
          navigate('/done');
          return;
        } else {
          // Warning 1 of 2: show full-screen modal
          setWarningModalOpen(true);
        }
      } catch (err) {
        console.error('Security event recording error:', err);
      } finally {
        isHandlingWarningRef.current = false;
      }
    },
    [
      loadingQuestions,
      autoSubmitting,
      warningModalOpen,
      currentQuestion,
      candidate,
      warningCount,
      refreshCandidate,
      navigate,
    ]
  );

  // Attach event listeners for proctoring & disable copy/paste/contextmenu
  useEffect(() => {
    if (loadingQuestions || autoSubmitting) return;

    // 1. Tab switch or minimize (visibilitychange & blur)
    const handleVisibilityChange = () => {
      if (document.hidden || document.visibilityState === 'hidden') {
        handleSecurityEvent('tab_switch');
      }
    };

    const handleWindowBlur = () => {
      handleSecurityEvent('tab_switch');
    };

    // 2. Fullscreen exit detection
    const handleFullscreenChange = () => {
      const isFullscreen = Boolean(
        document.fullscreenElement || (document as any).webkitFullscreenElement
      );
      if (!isFullscreen && !warningModalOpen && !autoSubmitting) {
        handleSecurityEvent('fullscreen_exit');
      }
    };

    // 3. Disable right-click context menu, text selection, and copy/paste
    const preventAction = (e: Event) => {
      e.preventDefault();
      return false;
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      // Prevent Ctrl+C, Ctrl+V, Ctrl+U, F12, PrintScreen
      if (
        (e.ctrlKey || e.metaKey) &&
        (e.key === 'c' || e.key === 'v' || e.key === 'u' || e.key === 'p' || e.key === 'a')
      ) {
        e.preventDefault();
      }
      if (e.key === 'F12') {
        e.preventDefault();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('blur', handleWindowBlur);
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    document.addEventListener('webkitfullscreenchange', handleFullscreenChange);
    document.addEventListener('contextmenu', preventAction);
    document.addEventListener('copy', preventAction);
    document.addEventListener('cut', preventAction);
    document.addEventListener('paste', preventAction);
    document.addEventListener('selectstart', preventAction);
    window.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('blur', handleWindowBlur);
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
      document.removeEventListener('webkitfullscreenchange', handleFullscreenChange);
      document.removeEventListener('contextmenu', preventAction);
      document.removeEventListener('copy', preventAction);
      document.removeEventListener('cut', preventAction);
      document.removeEventListener('paste', preventAction);
      document.removeEventListener('selectstart', preventAction);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [loadingQuestions, autoSubmitting, warningModalOpen, handleSecurityEvent]);

  // Return to test and re-enter fullscreen from warning modal
  const handleAcknowledgeWarning = async () => {
    try {
      if (document.documentElement.requestFullscreen) {
        await document.documentElement.requestFullscreen();
      } else if ((document.documentElement as any).webkitRequestFullscreen) {
        await (document.documentElement as any).webkitRequestFullscreen();
      }
    } catch (e) {
      console.warn('Fullscreen re-entry failed:', e);
    }
    setWarningModalOpen(false);
  };

  // --------------------------------------------------------------------------
  // QUESTION FLOW CONTROLLER
  // --------------------------------------------------------------------------
  const handleStartRecording = useCallback(async (question: Question) => {
    setStep('recording');
    setRecordTimeLeft(question.time_limit_seconds || 20);
    audioChunksRef.current = [];
    recordingStartTimeRef.current = Date.now();

    try {
      let stream = mediaStreamRef.current;
      if (!stream || !stream.active) {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        mediaStreamRef.current = stream;
      }

      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : MediaRecorder.isTypeSupported('audio/webm')
        ? 'audio/webm'
        : '';

      const options = {
        ...(mimeType ? { mimeType } : {}),
        audioBitsPerSecond: 64000,
      };

      const recorder = new MediaRecorder(stream, options);
      mediaRecorderRef.current = recorder;

      recorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      recorder.onstop = async () => {
        const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
        const durationSeconds = Math.max(1, Math.round((Date.now() - recordingStartTimeRef.current) / 1000));
        await handleUploadResponse(question, audioBlob, durationSeconds);
      };

      recorder.start(500);

      let timeLeft = question.time_limit_seconds || 20;
      if (timerIntervalRef.current) clearInterval(timerIntervalRef.current);

      timerIntervalRef.current = setInterval(() => {
        timeLeft -= 1;
        setRecordTimeLeft(timeLeft);
        if (timeLeft <= 0) {
          clearInterval(timerIntervalRef.current);
          if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
            mediaRecorderRef.current.stop();
          }
        }
      }, 1000);
    } catch (err: any) {
      console.error('Microphone error during test:', err);
      setStep('error');
      setErrorMessage(
        err.name === 'NotAllowedError'
          ? 'Microphone permission was denied. Please allow microphone access in your browser settings to continue.'
          : 'Could not access microphone. Please check your audio input device and click Retry.'
      );
    }
  }, []);

  const startCountdown = useCallback(
    (question: Question) => {
      setStep('countdown');
      setReadyCountdown(3);

      let count = 3;
      if (readyIntervalRef.current) clearInterval(readyIntervalRef.current);

      readyIntervalRef.current = setInterval(() => {
        count -= 1;
        setReadyCountdown(count);
        if (count <= 0) {
          clearInterval(readyIntervalRef.current);
          handleStartRecording(question);
        }
      }, 1000);
    },
    [handleStartRecording]
  );

  const handleUploadResponse = async (question: Question, audioBlob: Blob, durationSeconds: number) => {
    if (!candidate) return;
    setStep('uploading');
    setErrorMessage(null);

    const recordingPath = `${candidate.id}/${question.order_number}.webm`;

    try {
      const { error: uploadError } = await supabase.storage.from('recordings').upload(recordingPath, audioBlob, {
        contentType: 'audio/webm',
        upsert: true,
      });

      if (uploadError) {
        throw new Error(`Recording upload failed: ${uploadError.message}`);
      }

      const { error: responseError } = await supabase.from('responses').upsert(
        {
          candidate_id: candidate.id,
          question_id: question.id,
          audio_path: recordingPath,
          duration_seconds: durationSeconds,
        },
        { onConflict: 'candidate_id,question_id' }
      );

      if (responseError) {
        throw new Error(`Failed to save response data: ${responseError.message}`);
      }

      const nextIdx = currentIndex + 1;
      await supabase.rpc('set_progress', { p_current: nextIdx });

      if (nextIdx >= questions.length) {
        await supabase.rpc('finish_test', { p_status: 'submitted' });
        await refreshCandidate();
        navigate('/done');
      } else {
        setCurrentIndex(nextIdx);
      }
    } catch (err: any) {
      console.error('Upload error:', err);
      setStep('error');
      setErrorMessage(err.message || 'Failed to upload response. Please click Retry to submit again.');
    }
  };

  useEffect(() => {
    if (loadingQuestions || !currentQuestion || autoSubmitting) return;

    let isCancelled = false;

    async function runQuestionLifecycle() {
      setErrorMessage(null);

      if (currentQuestion.audio_path && !playedAudioQuestionsRef.current.has(currentQuestion.id)) {
        setStep('listening');
        playedAudioQuestionsRef.current.add(currentQuestion.id);

        try {
          const { data, error } = await supabase.storage
            .from('question-audio')
            .createSignedUrl(currentQuestion.audio_path, 300);

          if (isCancelled) return;

          if (error || !data?.signedUrl) {
            startCountdown(currentQuestion);
            return;
          }

          const audio = new Audio(data.signedUrl);
          audioPlayerRef.current = audio;

          audio.onended = () => {
            if (!isCancelled) startCountdown(currentQuestion);
          };

          audio.onerror = () => {
            if (!isCancelled) startCountdown(currentQuestion);
          };

          await audio.play().catch(() => {
            if (!isCancelled) startCountdown(currentQuestion);
          });
        } catch {
          if (!isCancelled) startCountdown(currentQuestion);
        }
      } else {
        startCountdown(currentQuestion);
      }
    }

    runQuestionLifecycle();

    return () => {
      isCancelled = true;
      if (audioPlayerRef.current) {
        audioPlayerRef.current.pause();
        audioPlayerRef.current = null;
      }
    };
  }, [currentIndex, currentQuestion, loadingQuestions, autoSubmitting, startCountdown]);

  const handleStopRecordingEarly = () => {
    if (timerIntervalRef.current) clearInterval(timerIntervalRef.current);
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
      mediaRecorderRef.current.stop();
    }
  };

  const handleRetryCurrentQuestion = () => {
    setErrorMessage(null);
    if (currentQuestion) {
      startCountdown(currentQuestion);
    }
  };

  if (loadingQuestions) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center min-h-[50vh] p-6">
        <Loader2 className="w-8 h-8 text-blue-700 animate-spin" />
        <p className="text-sm font-medium text-slate-600 mt-3">Loading assessment questions...</p>
      </div>
    );
  }

  if (autoSubmitting) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center min-h-[50vh] p-6">
        <div className="bg-white rounded-2xl shadow-lg border border-red-200 p-8 max-w-md w-full text-center">
          <ShieldAlert className="w-12 h-12 text-red-600 mx-auto mb-3 animate-pulse" />
          <h2 className="text-xl font-bold text-slate-900">Security Limit Exceeded</h2>
          <p className="text-xs sm:text-sm text-slate-600 mt-2">
            You have received 2 proctoring warnings. Your assessment is being automatically submitted to Dimension Education.
          </p>
          <div className="mt-5 flex items-center justify-center gap-2 text-xs font-semibold text-slate-500">
            <Loader2 className="w-4 h-4 animate-spin text-blue-700" />
            <span>Finalizing test record...</span>
          </div>
        </div>
      </div>
    );
  }

  const progressPercent = Math.round((currentIndex / questions.length) * 100);

  return (
    <div className="flex-1 max-w-4xl w-full mx-auto p-4 sm:p-8 flex flex-col justify-center select-none">
      {/* Full-Screen Security Warning Modal (Warning 1 of 2) */}
      {warningModalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl border border-amber-300 max-w-md w-full p-6 sm:p-8 text-center animate-in zoom-in-95 duration-150">
            <div className="w-14 h-14 rounded-2xl bg-amber-100 text-amber-700 flex items-center justify-center mx-auto mb-4 border border-amber-200">
              <ShieldAlert className="w-8 h-8" />
            </div>

            <span className="px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider bg-amber-100 text-amber-800">
              Warning {warningCount} of 2
            </span>

            <h2 className="text-xl font-bold text-slate-900 mt-3">Security Warning</h2>

            <p className="text-slate-700 mt-2 text-sm leading-relaxed font-medium">
              Please do not leave the test screen. Leaving again will submit your test.
            </p>

            <p className="text-xs text-slate-500 mt-2">
              Tab switches, minimizing your window, and exiting fullscreen are logged and strictly monitored.
            </p>

            <button
              type="button"
              onClick={handleAcknowledgeWarning}
              className="mt-6 w-full inline-flex items-center justify-center gap-2 py-3 px-5 bg-blue-700 hover:bg-blue-800 text-white font-semibold rounded-lg text-sm transition-colors shadow-xs"
            >
              <Maximize2 className="w-4 h-4" />
              <span>Return to Test & Re-enter Fullscreen</span>
            </button>
          </div>
        </div>
      )}

      {/* Main Test Card */}
      <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6 sm:p-10 relative overflow-hidden">
        {/* Progress Header */}
        <div className="border-b border-slate-200 pb-5 mb-6">
          <div className="flex items-center justify-between gap-4 mb-2">
            <div>
              <span className="text-xs font-bold text-blue-700 uppercase tracking-wider">
                {currentQuestion ? getSectionTitle(currentQuestion.section, currentQuestion.type) : 'Verbal Assessment'}
              </span>
              <h1 className="text-xl sm:text-2xl font-bold text-slate-900 mt-0.5">
                Question {currentIndex + 1} of {questions.length}
              </h1>
            </div>

            {/* Timers & Warning Indicator */}
            <div className="flex items-center gap-2">
              {warningCount > 0 && (
                <div className="flex items-center gap-1.5 bg-amber-50 border border-amber-200 text-amber-800 px-2.5 py-1 rounded-md text-xs font-semibold">
                  <AlertTriangle className="w-3.5 h-3.5 text-amber-600" />
                  <span>Warning: {warningCount}/2</span>
                </div>
              )}

              {step === 'recording' && (
                <div className="flex items-center gap-2 bg-red-50 border border-red-200 text-red-700 px-3 py-1.5 rounded-lg text-sm font-mono font-bold">
                  <div className="w-2.5 h-2.5 rounded-full bg-red-600 animate-pulse" />
                  <span>00:{recordTimeLeft.toString().padStart(2, '0')}</span>
                </div>
              )}

              {step === 'listening' && (
                <div className="flex items-center gap-2 bg-blue-50 border border-blue-200 text-blue-700 px-3 py-1.5 rounded-lg text-xs font-semibold">
                  <Volume2 className="w-4 h-4 animate-bounce" />
                  <span>Listening to Prompt...</span>
                </div>
              )}

              {step === 'countdown' && (
                <div className="flex items-center gap-2 bg-amber-50 border border-amber-200 text-amber-700 px-3 py-1.5 rounded-lg text-xs font-semibold">
                  <Clock className="w-4 h-4" />
                  <span>Get Ready: {readyCountdown}s</span>
                </div>
              )}

              {step === 'uploading' && (
                <div className="flex items-center gap-2 bg-slate-100 text-slate-700 px-3 py-1.5 rounded-lg text-xs font-semibold">
                  <Loader2 className="w-3.5 h-3.5 animate-spin text-blue-700" />
                  <span>Uploading Recording...</span>
                </div>
              )}
            </div>
          </div>

          {/* Progress Bar */}
          <div className="w-full bg-slate-100 h-2 rounded-full overflow-hidden mt-3">
            <div
              className="bg-blue-600 h-full rounded-full transition-all duration-500 ease-out"
              style={{ width: `${Math.max(4, progressPercent)}%` }}
            />
          </div>
          <div className="flex justify-between items-center text-[11px] text-slate-400 mt-1">
            <span>Progress: {progressPercent}%</span>
            <span>Do not exit fullscreen or switch tabs</span>
          </div>
        </div>

        {/* Section Instructions Banner */}
        {currentQuestion && (
          <div className="mb-6 p-3 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-600 flex items-center gap-2.5">
            <Headphones className="w-4 h-4 text-blue-600 flex-shrink-0" />
            <span>{getSectionGuidance(currentQuestion.type)}</span>
          </div>
        )}

        {/* Error State Banner */}
        {step === 'error' && errorMessage && (
          <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-xl text-red-800 flex items-start justify-between gap-3 animate-in fade-in">
            <div className="flex items-start gap-2.5">
              <AlertCircle className="w-5 h-5 text-red-600 mt-0.5 flex-shrink-0" />
              <div>
                <p className="text-xs font-bold uppercase tracking-wider">Assessment Action Required</p>
                <p className="text-xs sm:text-sm mt-0.5 leading-relaxed">{errorMessage}</p>
              </div>
            </div>
            <button
              onClick={handleRetryCurrentQuestion}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-red-600 hover:bg-red-700 text-white rounded-lg text-xs font-semibold flex-shrink-0 shadow-xs cursor-pointer"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>Retry Question</span>
            </button>
          </div>
        )}

        {/* Question Content Display */}
        <div className="min-h-[160px] flex flex-col items-center justify-center my-6 py-8 px-6 bg-slate-50/70 rounded-2xl border border-slate-200 text-center select-none">
          {currentQuestion?.display_text ? (
            <div className="max-w-2xl mx-auto">
              <span className="text-[11px] font-bold text-slate-400 uppercase tracking-widest mb-2 block">
                Prompt Text
              </span>
              <p className="text-xl sm:text-2xl font-medium text-slate-900 leading-relaxed">
                "{currentQuestion.display_text}"
              </p>
            </div>
          ) : (
            <div className="text-center py-4">
              <div className="w-12 h-12 rounded-full bg-blue-50 text-blue-700 flex items-center justify-center mx-auto mb-3">
                <Volume2 className="w-6 h-6" />
              </div>
              <p className="text-slate-600 text-sm font-medium">
                Listen carefully to the audio prompt.
              </p>
              <p className="text-xs text-slate-400 mt-1">
                No text is displayed for this auditory section.
              </p>
            </div>
          )}
        </div>

        {/* Dynamic Action Interaction Area */}
        <div className="pt-4 pb-2 flex flex-col items-center justify-center">
          {step === 'listening' && (
            <div className="flex flex-col items-center gap-3 py-4">
              <div className="w-16 h-16 rounded-full bg-blue-100 text-blue-700 flex items-center justify-center shadow-xs">
                <Volume2 className="w-8 h-8 animate-pulse" />
              </div>
              <span className="text-sm font-bold text-blue-900">Audio Prompt Playing...</span>
              <span className="text-xs text-slate-500">Audio plays only once. The countdown will begin immediately after.</span>
            </div>
          )}

          {step === 'countdown' && (
            <div className="flex flex-col items-center gap-3 py-4">
              <div className="w-16 h-16 rounded-full bg-amber-100 text-amber-700 flex items-center justify-center font-bold text-2xl shadow-xs animate-bounce">
                {readyCountdown}
              </div>
              <span className="text-sm font-bold text-amber-900">Get Ready to Speak...</span>
              <span className="text-xs text-slate-500">Microphone will open automatically when countdown hits zero.</span>
            </div>
          )}

          {step === 'recording' && (
            <div className="flex flex-col items-center gap-4 py-2 w-full max-w-md">
              <div className="flex items-center gap-3">
                <div className="relative">
                  <div className="w-16 h-16 rounded-full bg-red-100 text-red-600 flex items-center justify-center">
                    <Mic className="w-8 h-8 animate-pulse" />
                  </div>
                  <div className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-red-600 border-2 border-white animate-ping" />
                </div>
                <div className="text-left">
                  <p className="text-sm font-bold text-red-600 uppercase tracking-wide">Recording Voice Answer</p>
                  <p className="text-xs text-slate-500 font-mono">
                    Time remaining: <span className="font-bold text-slate-800">{recordTimeLeft}s</span> of {currentQuestion?.time_limit_seconds || 20}s
                  </p>
                </div>
              </div>

              <button
                type="button"
                onClick={handleStopRecordingEarly}
                className="mt-2 inline-flex items-center justify-center gap-2 px-6 py-2.5 bg-slate-900 hover:bg-slate-800 text-white rounded-lg text-xs font-semibold transition-colors shadow-xs cursor-pointer"
              >
                <Square className="w-3.5 h-3.5 fill-white" />
                <span>Finish Speaking & Next</span>
              </button>
            </div>
          )}

          {step === 'uploading' && (
            <div className="flex flex-col items-center gap-3 py-4">
              <Loader2 className="w-10 h-10 text-blue-700 animate-spin" />
              <span className="text-sm font-bold text-slate-800">Saving & Progressing...</span>
              <span className="text-xs text-slate-500">Uploading answer to private recordings vault.</span>
            </div>
          )}
        </div>

        {/* Footer candidate identifier */}
        {candidate && (
          <div className="mt-8 pt-4 border-t border-slate-100 flex items-center justify-between text-xs text-slate-400">
            <span>Candidate: <strong className="text-slate-600">{candidate.full_name}</strong></span>
            <span>Code: <code className="font-mono text-blue-700 font-semibold">{candidate.test_code}</code></span>
          </div>
        )}
      </div>
    </div>
  );
};
