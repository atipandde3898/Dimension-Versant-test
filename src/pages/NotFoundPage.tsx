import React from 'react';
import { Link } from 'react-router-dom';
import { FileQuestion, ArrowRight } from 'lucide-react';

export const NotFoundPage: React.FC = () => {
  return (
    <div className="flex-1 max-w-md w-full mx-auto p-4 sm:p-8 flex flex-col justify-center text-center">
      <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6 sm:p-10">
        <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-slate-100 text-slate-600 mb-4">
          <FileQuestion className="w-7 h-7" />
        </div>
        <h1 className="text-2xl font-bold text-slate-900">404 - Page Not Found</h1>
        <p className="text-slate-500 text-sm mt-2">
          The requested page does not exist or has been moved.
        </p>

        <div className="mt-8 pt-6 border-t border-slate-100">
          <Link
            to="/"
            className="inline-flex items-center justify-center gap-2 w-full py-2.5 px-4 bg-blue-700 hover:bg-blue-800 text-white font-medium rounded-lg text-sm transition-colors shadow-xs"
          >
            <span>Return to Start Page</span>
            <ArrowRight className="w-4 h-4" />
          </Link>
        </div>
      </div>
    </div>
  );
};
