import React, { useEffect, useState } from 'react';
import { WifiOff } from 'lucide-react';

interface OfflineIndicatorProps {
  label?: string;
}

export const OfflineIndicator: React.FC<OfflineIndicatorProps> = ({ label = 'Modalità Offline' }) => {
  const [isOnline, setIsOnline] = useState(
    typeof navigator !== 'undefined' ? navigator.onLine : true,
  );

  useEffect(() => {
    const onOnline = () => setIsOnline(true);
    const onOffline = () => setIsOnline(false);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, []);

  if (isOnline) return null;

  return (
    <div className="fixed top-14 left-1/2 -translate-x-1/2 z-40 flex items-center gap-2 rounded-lg border border-amber-400/30 bg-slate-950/90 px-3 py-1.5 text-xs font-medium text-amber-300 shadow-lg whitespace-nowrap">
      <WifiOff className="w-3.5 h-3.5" />
      <span>{label}</span>
    </div>
  );
};
