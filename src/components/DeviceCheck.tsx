import React, { useState, useEffect } from 'react';
import { Laptop, Chrome, AlertTriangle, ArrowRight } from 'lucide-react';

interface DeviceCheckProps {
  children: React.ReactNode;
}

export const DeviceCheck: React.FC<DeviceCheckProps> = ({ children }) => {
  const [isMobileOrTablet, setIsMobileOrTablet] = useState<boolean>(false);
  const [dismissed, setDismissed] = useState<boolean>(false);

  useEffect(() => {
    const checkDevice = () => {
      const ua = navigator.userAgent || '';
      const isMobileUA = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini|Mobile|Tablet/i.test(ua);
      const isTouchSmallScreen = window.innerWidth < 768 && navigator.maxTouchPoints > 0;
      setIsMobileOrTablet(isMobileUA || isTouchSmallScreen);
    };

    checkDevice();
    window.addEventListener('resize', checkDevice);
    return () => window.removeEventListener('resize', checkDevice);
  }, []);

  if (isMobileOrTablet && !dismissed) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-6 text-center bg-slate-50 min-h-[70vh]">
        <div className="bg-white rounded-2xl shadow-lg border border-slate-200 max-w-md w-full p-8 animate-in zoom-in-95">
          <div className="w-16 h-16 rounded-2xl bg-blue-50 text-blue-700 flex items-center justify-center mx-auto mb-5 border border-blue-100 shadow-xs">
            <Laptop className="w-8 h-8" />
          </div>

          <span className="px-3 py-1 rounded-full text-[11px] font-bold uppercase tracking-wider bg-amber-100 text-amber-800">
            Device Notice
          </span>

          <h2 className="text-xl sm:text-2xl font-bold text-slate-900 mt-3">
            Please use a laptop or desktop with Chrome
          </h2>

          <p className="text-slate-600 text-sm mt-3 leading-relaxed">
            The <strong>Dimension Education Verbal Test</strong> requires a computer running <strong>Google Chrome</strong> or Microsoft Edge with microphone access and fullscreen proctoring enabled.
          </p>

          <div className="mt-6 p-4 rounded-xl bg-slate-50 border border-slate-200 text-left text-xs text-slate-600 space-y-2">
            <div className="flex items-center gap-2">
              <Chrome className="w-4 h-4 text-blue-600 flex-shrink-0" />
              <span>Recommended: Google Chrome on Windows, macOS, or ChromeOS</span>
            </div>
            <div className="flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-amber-600 flex-shrink-0" />
              <span>Phones and tablets cannot reliably support the audio proctoring safeguards.</span>
            </div>
          </div>

          <div className="mt-8 pt-5 border-t border-slate-100 flex flex-col gap-2">
            <button
              type="button"
              onClick={() => setDismissed(true)}
              className="text-xs text-slate-400 hover:text-slate-700 underline py-1"
            >
              Continue anyway (Testing / Preview mode)
            </button>
          </div>
        </div>
      </div>
    );
  }

  return <>{children}</>;
};
