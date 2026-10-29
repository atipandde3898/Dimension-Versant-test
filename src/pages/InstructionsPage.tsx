import React, { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import {
  Monitor,
  Headphones,
  ShieldAlert,
  ArrowRight,
  RotateCcw,
  Volume2,
  Mic,
  CheckCircle2,
  AlertCircle,
  Play,
  Square,
  Lock,
} from 'lucide-react';

export const InstructionsPage: React.FC = () => {
  const { candidate } = useAuth();
  const navigate = useNavigate();

  // Mic test states
  const [micStatus, setMicStatus] = useState<'idle' | 'recording' | 'recorded' | 'playing' | 'error'>('idle');
  const [micCountdown, setMicCountdown] = useState<number>(3);
  const [micAudioUrl, setMicAudioUrl] = useState<string | null>(null);
  const [isHeardClearly, setIsHeardClearly] = useState<boolean>(false);
  const [micErrorMessage, setMicErrorMessage] = useState<string | null>(null);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const audioPlayerRef = useRef<HTMLAudioElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const countdownIntervalRef = useRef<any>(null);

  // Clean up media streams and object URLs on unmount
  useEffect(() => {
    return () => {
      if (countdownIntervalRef.current) clearInterval(countdownIntervalRef.current);
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop());
      }
      if (micAudioUrl) {
        URL.revokeObjectURL(micAudioUrl);
      }
    };
  }, [micAudioUrl]);

  const startMicCheck = async () => {
    setMicErrorMessage(null);
    setMicStatus('recording');
    setMicCountdown(3);
    setIsHeardClearly(false);
    audioChunksRef.current = [];

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : MediaRecorder.isTypeSupported('audio/webm')
        ? 'audio/webm'
        : '';

      const options = mimeType ? { mimeType } : undefined;
      const mediaRecorder = new MediaRecorder(stream, options);
      mediaRecorderRef.current = mediaRecorder;

      mediaRecorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onstop = () => {
        const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
        if (micAudioUrl) {
          URL.revokeObjectURL(micAudioUrl);
        }
        const url = URL.createObjectURL(audioBlob);
        setMicAudioUrl(url);
        setMicStatus('recorded');

        // Stop stream tracks after sample recording
        if (streamRef.current) {
          streamRef.current.getTracks().forEach((track) => track.stop());
          streamRef.current = null;
        }
      };

      mediaRecorder.start();

      let timeLeft = 3;
      countdownIntervalRef.current = setInterval(() => {
        timeLeft -= 1;
        setMicCountdown(timeLeft);
        if (timeLeft <= 0) {
          clearInterval(countdownIntervalRef.current);
          if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
            mediaRecorderRef.current.stop();
          }
        }
      }, 1000);
    } catch (err: any) {
      console.error('Microphone access error:', err);
      setMicStatus('error');
      setMicErrorMessage(
        err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError'
          ? 'Microphone permission was denied. Please allow microphone access in your browser settings to continue.'
          : 'Unable to access your microphone. Please check your audio input device and try again.'
      );
    }
  };

  const playRecordedSample = () => {
    if (!micAudioUrl) return;
    if (audioPlayerRef.current) {
      audioPlayerRef.current.pause();
    }
    const audio = new Audio(micAudioUrl);
    audioPlayerRef.current = audio;
    setMicStatus('playing');

    audio.onended = () => {
      setMicStatus('recorded');
    };
    audio.onerror = () => {
      setMicStatus('recorded');
    };
    audio.play().catch((err) => {
      console.warn('Playback error:', err);
      setMicStatus('recorded');
    });
  };

  const handleStartTest = async () => {
    // Attempt fullscreen mode per instructions
    try {
      if (document.documentElement.requestFullscreen) {
        await document.documentElement.requestFullscreen();
      } else if ((document.documentElement as any).webkitRequestFullscreen) {
        await (document.documentElement as any).webkitRequestFullscreen();
      }
    } catch (err) {
      // Fullscreen might be restricted by browser policy or iframe, proceed anyway
      console.warn('Fullscreen entry declined or unavailable:', err);
    }

    navigate('/test');
  };

  const isCheckSuccessful = micStatus === 'recorded' && isHeardClearly;

  return (
    <div className="flex-1 max-w-4xl w-full mx-auto p-4 sm:p-8">
      <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6 sm:p-10">
        {/* Header */}
        <div className="border-b border-slate-200 pb-6 mb-6">
          <div className="flex items-center justify-between gap-4">
            <div>
              <span className="text-xs font-semibold text-blue-700 uppercase tracking-wider">
                Verbal Assessment Protocol
              </span>
              <h1 className="text-2xl sm:text-3xl font-bold text-slate-900 mt-1">
                Instructions & Microphone Verification
              </h1>
            </div>
            {candidate && (
              <div className="text-right hidden sm:block">
                <span className="text-xs text-slate-400">Candidate</span>
                <p className="text-sm font-semibold text-slate-800">{candidate.full_name}</p>
                <p className="text-xs font-mono text-blue-700">{candidate.test_code}</p>
              </div>
            )}
          </div>
          <p className="text-slate-600 mt-2 text-sm sm:text-base leading-relaxed">
            Please read these instructions thoroughly. You must verify your audio input before proceeding to the test screen.
          </p>
        </div>

        {/* Rules Grid */}
        <div className="grid sm:grid-cols-2 gap-4 mb-8">
          <div className="flex items-start gap-3 p-4 rounded-xl bg-slate-50 border border-slate-200">
            <Monitor className="w-5 h-5 text-blue-600 mt-0.5 flex-shrink-0" />
            <div>
              <h2 className="text-sm font-semibold text-slate-900">Chrome on Laptop or Desktop</h2>
              <p className="text-xs text-slate-600 mt-1 leading-relaxed">
                Use Google Chrome or Edge on a computer. Do not use mobile phones or tablets.
              </p>
            </div>
          </div>

          <div className="flex items-start gap-3 p-4 rounded-xl bg-slate-50 border border-slate-200">
            <Volume2 className="w-5 h-5 text-blue-600 mt-0.5 flex-shrink-0" />
            <div>
              <h2 className="text-sm font-semibold text-slate-900">Quiet Environment</h2>
              <p className="text-xs text-slate-600 mt-1 leading-relaxed">
                Take the assessment in a quiet room with headphones or a headset for best clarity.
              </p>
            </div>
          </div>

          <div className="flex items-start gap-3 p-4 rounded-xl bg-slate-50 border border-slate-200">
            <Headphones className="w-5 h-5 text-blue-600 mt-0.5 flex-shrink-0" />
            <div>
              <h2 className="text-sm font-semibold text-slate-900">Prompts Play Exactly Once</h2>
              <p className="text-xs text-slate-600 mt-1 leading-relaxed">
                Audio questions will play once automatically. There are no pause, rewind, or repeat controls.
              </p>
            </div>
          </div>

          <div className="flex items-start gap-3 p-4 rounded-xl bg-slate-50 border border-slate-200">
            <RotateCcw className="w-5 h-5 text-blue-600 mt-0.5 flex-shrink-0" />
            <div>
              <h2 className="text-sm font-semibold text-slate-900">No Going Back</h2>
              <p className="text-xs text-slate-600 mt-1 leading-relaxed">
                Once an answer is recorded, the test automatically progresses to the next question.
              </p>
            </div>
          </div>

          <div className="sm:col-span-2 flex items-start gap-3 p-4 rounded-xl bg-amber-50 border border-amber-200">
            <ShieldAlert className="w-5 h-5 text-amber-700 mt-0.5 flex-shrink-0" />
            <div>
              <h2 className="text-sm font-semibold text-amber-900">Proctored Fullscreen Session & Warnings</h2>
              <p className="text-xs text-amber-800 mt-1 leading-relaxed">
                Do not switch browser tabs, minimize your window, or exit fullscreen mode.
                Exiting will trigger a security warning. <strong>After 2 warnings, your test will be automatically submitted immediately.</strong>
              </p>
            </div>
          </div>
        </div>

        {/* 3-Second Microphone Check Box */}
        <div className="mb-8 p-6 rounded-2xl bg-slate-50 border border-slate-300">
          <div className="flex items-center gap-2 mb-4">
            <div className="w-8 h-8 rounded-lg bg-blue-100 text-blue-700 flex items-center justify-center">
              <Mic className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-slate-900">Step: 3-Second Microphone Check</h2>
              <p className="text-xs text-slate-500">Record a brief 3-second sample and verify you can hear your voice clearly.</p>
            </div>
          </div>

          {micErrorMessage && (
            <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-xs text-red-800 flex items-start gap-2">
              <AlertCircle className="w-4 h-4 text-red-600 mt-0.5 flex-shrink-0" />
              <span>{micErrorMessage}</span>
            </div>
          )}

          <div className="flex flex-col sm:flex-row items-center justify-between gap-4 bg-white p-4 rounded-xl border border-slate-200">
            {/* Left action / status */}
            <div className="flex items-center gap-3 w-full sm:w-auto">
              {micStatus === 'idle' && (
                <button
                  type="button"
                  onClick={startMicCheck}
                  className="inline-flex items-center gap-2 px-4 py-2 bg-blue-700 hover:bg-blue-800 text-white rounded-lg text-xs font-semibold transition-colors shadow-xs"
                >
                  <Mic className="w-4 h-4" />
                  <span>Start 3-Sec Mic Check</span>
                </button>
              )}

              {micStatus === 'recording' && (
                <div className="flex items-center gap-3">
                  <div className="w-4 h-4 rounded-full bg-red-600 animate-ping" />
                  <span className="text-xs font-bold text-red-600 uppercase tracking-wider">
                    Recording: Speak now ({micCountdown}s)
                  </span>
                </div>
              )}

              {(micStatus === 'recorded' || micStatus === 'playing') && (
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={playRecordedSample}
                    disabled={micStatus === 'playing'}
                    className="inline-flex items-center gap-1.5 px-3 py-2 bg-slate-100 hover:bg-slate-200 text-slate-800 rounded-lg text-xs font-medium transition-colors"
                  >
                    <Play className="w-3.5 h-3.5 text-blue-700 fill-blue-700" />
                    <span>{micStatus === 'playing' ? 'Playing Sample...' : 'Listen to Sample'}</span>
                  </button>
                  <button
                    type="button"
                    onClick={startMicCheck}
                    className="px-3 py-2 text-xs text-slate-500 hover:text-slate-800 underline"
                  >
                    Record Again
                  </button>
                </div>
              )}

              {micStatus === 'error' && (
                <button
                  type="button"
                  onClick={startMicCheck}
                  className="inline-flex items-center gap-1.5 px-3 py-2 bg-red-100 text-red-800 hover:bg-red-200 rounded-lg text-xs font-medium transition-colors"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  <span>Retry Microphone</span>
                </button>
              )}
            </div>

            {/* Right confirmation checkbox */}
            {micStatus === 'recorded' && (
              <label className="flex items-center gap-2 text-xs font-medium text-slate-800 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={isHeardClearly}
                  onChange={(e) => setIsHeardClearly(e.target.checked)}
                  className="w-4 h-4 text-blue-600 rounded border-slate-300 focus:ring-blue-500"
                />
                <span>I can hear my voice clearly in the playback</span>
              </label>
            )}
          </div>
        </div>

        {/* Consent Notice */}
        <div className="mb-8 p-4 rounded-xl bg-slate-50 border border-slate-200 text-xs text-slate-600 flex items-start gap-3">
          <Lock className="w-4 h-4 text-slate-500 mt-0.5 flex-shrink-0" />
          <p className="leading-relaxed">
            <strong>Recording Notice:</strong> Voice recordings are stored by <strong>Dimension Education</strong> for assessment, pronunciation scoring, and internal verification purposes.
          </p>
        </div>

        {/* Action Button */}
        <div className="pt-6 border-t border-slate-100 flex flex-col sm:flex-row items-center justify-between gap-4">
          <span className="text-xs text-slate-500">
            {isCheckSuccessful
              ? '✓ Microphone check passed. Ready to begin.'
              : 'Complete and verify your 3-second microphone check to enable the test.'}
          </span>

          <button
            type="button"
            onClick={handleStartTest}
            disabled={!isCheckSuccessful}
            className={`w-full sm:w-auto inline-flex items-center justify-center gap-2 px-8 py-3 rounded-lg text-sm font-semibold transition-all shadow-xs ${
              isCheckSuccessful
                ? 'bg-blue-700 hover:bg-blue-800 text-white cursor-pointer'
                : 'bg-slate-200 text-slate-400 cursor-not-allowed'
            }`}
          >
            <span>Start Test (Enters Fullscreen)</span>
            <ArrowRight className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
};
