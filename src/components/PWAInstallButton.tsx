import React, { useState } from 'react';
import { Download, X } from 'lucide-react';
import { usePWAInstall } from '../hooks/usePWAInstall';

export interface PWAInstallLabels {
  installApp: string;
  installShort: string;
  installTitle: string;
  iosTitle: string;
  iosStep1: string;
  iosStep2: string;
  understood: string;
  close: string;
}

const DEFAULT_LABELS: PWAInstallLabels = {
  installApp: 'Installa App',
  installShort: 'Installa',
  installTitle: 'Installa sul telefono Android',
  iosTitle: 'Installa su iPhone / iPad',
  iosStep1: '1. Tocca il pulsante Condividi nella barra di Safari.',
  iosStep2: '2. Scorri e tocca Aggiungi alla schermata Home.',
  understood: 'Ho capito',
  close: 'Chiudi',
};

export const PWAInstallButton: React.FC<{ labels?: PWAInstallLabels }> = ({
  labels = DEFAULT_LABELS,
}) => {
  const { isInstallable, isInstalled, isIOS, install } = usePWAInstall();
  const [showIOSGuide, setShowIOSGuide] = useState(false);

  if (isInstalled) return null;

  if (isInstallable) {
    return (
      <button
        type="button"
        onClick={install}
        title={labels.installTitle}
        className="flex items-center gap-1.5 min-h-[36px] px-3 py-1.5 rounded-lg bg-sky-500 hover:bg-sky-400 active:scale-95 text-slate-950 font-semibold text-xs whitespace-nowrap shrink-0 transition"
      >
        <Download className="w-3.5 h-3.5" />
        <span>{labels.installApp}</span>
      </button>
    );
  }

  if (isIOS) {
    return (
      <>
        <button
          type="button"
          onClick={() => setShowIOSGuide(true)}
          className="flex items-center gap-1.5 min-h-[36px] px-3 py-1.5 rounded-lg border border-white/15 bg-slate-900/90 text-slate-100 text-xs font-medium whitespace-nowrap shrink-0 hover:bg-slate-800 transition"
        >
          <Download className="w-3.5 h-3.5" />
          <span>{labels.installShort}</span>
        </button>

        {showIOSGuide && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4">
            <div className="w-full max-w-sm rounded-2xl border border-white/10 bg-slate-900 p-5 text-slate-100 shadow-2xl">
              <div className="flex items-center justify-between">
                <h3 className="font-display text-lg font-semibold">{labels.iosTitle}</h3>
                <button
                  type="button"
                  onClick={() => setShowIOSGuide(false)}
                  className="min-h-[40px] min-w-[40px] flex items-center justify-center rounded-lg text-slate-400 hover:text-white"
                  aria-label={labels.close}
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
              <p className="mt-2 text-sm text-slate-300 leading-relaxed space-y-1">
                <span className="block">{labels.iosStep1}</span>
                <span className="block">{labels.iosStep2}</span>
              </p>
              <button
                type="button"
                onClick={() => setShowIOSGuide(false)}
                className="mt-4 w-full min-h-[44px] rounded-xl bg-sky-500 text-slate-950 font-semibold text-sm hover:bg-sky-400 transition"
              >
                {labels.understood}
              </button>
            </div>
          </div>
        )}
      </>
    );
  }

  return null;
};
