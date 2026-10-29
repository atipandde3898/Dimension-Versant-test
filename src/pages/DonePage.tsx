import React from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { CheckCircle2, ShieldCheck, ArrowRight, UserCheck } from 'lucide-react';

export const DonePage: React.FC = () => {
  const { candidate } = useAuth();

  return (
    <div className="flex-1 max-w-2xl w-full mx-auto p-4 sm:p-8 flex flex-col justify-center">
      <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6 sm:p-10 text-center">
        <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-green-50 text-green-600 mb-6 border border-green-100">
          <CheckCircle2 className="w-8 h-8" />
        </div>

        <h1 className="text-2xl sm:text-3xl font-bold text-slate-900 tracking-tight">
          Test Completed
        </h1>

        <p className="text-slate-600 mt-3 text-base leading-relaxed">
          Thank you. Your test has been submitted. Dimension Education will contact you with next steps.
        </p>

        {candidate && (
          <div className="mt-6 p-4 rounded-xl bg-slate-50 border border-slate-200 text-center">
            <div className="flex items-center justify-center gap-1.5 text-xs text-slate-500 uppercase tracking-wider mb-1">
              <UserCheck className="w-3.5 h-3.5 text-blue-600" />
              <span>Submission Record</span>
            </div>
            <p className="text-sm font-bold text-slate-800">{candidate.full_name}</p>
            <p className="text-xs text-slate-600 font-mono mt-0.5">Code: {candidate.test_code}</p>
            <span className="inline-block mt-2 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-green-100 text-green-800">
              Status: {candidate.status === 'auto_submitted' ? 'Auto Submitted' : 'Submitted'}
            </span>
          </div>
        )}

        <div className="mt-6 p-4 rounded-xl bg-blue-50/60 border border-blue-200 text-left text-xs text-slate-600 flex items-start gap-3">
          <ShieldCheck className="w-4 h-4 text-blue-600 mt-0.5 flex-shrink-0" />
          <div>
            <p className="font-semibold text-slate-800">Recordings Vault</p>
            <p className="mt-0.5 text-slate-600 leading-relaxed">
              All audio recordings have been securely stored in the private recordings vault and queued for administrator review and scoring.
            </p>
          </div>
        </div>

        <div className="mt-8 pt-6 border-t border-slate-100 flex justify-center">
          <Link
            to="/"
            className="inline-flex items-center gap-2 text-sm text-blue-700 font-semibold hover:text-blue-800"
          >
            <span>Return to Portal</span>
            <ArrowRight className="w-4 h-4" />
          </Link>
        </div>
      </div>
    </div>
  );
};
