'use client';

import { createContext, useContext, useState, useEffect } from 'react';
import { getSocket } from '@/lib/socket';

interface Toast {
  id: string;
  title: string;
  body?: string;
  type: 'info' | 'success' | 'warning' | 'error';
}

const ToastContext = createContext<{
  show: (toast: Omit<Toast, 'id'>) => void;
} | null>(null);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  function show(toast: Omit<Toast, 'id'>) {
    const id = Math.random().toString(36).slice(2);
    setToasts((t) => [...t, { ...toast, id }]);
    setTimeout(() => {
      setToasts((t) => t.filter((x) => x.id !== id));
    }, 5000);
  }

  useEffect(() => {
    const socket = getSocket();
    if (!socket) return;
    const handler = (notif: any) => {
      show({
        title: notif.title,
        body: notif.body ?? notif.description,
        type: 'info',
      });
    };
    socket.on('notification', handler);
    return () => {
      socket.off('notification', handler);
    };
  }, []);

  return (
    <ToastContext.Provider value={{ show }}>
      {children}
      <div className="fixed bottom-4 right-4 z-50 space-y-2">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`px-4 py-3 rounded-lg shadow-lg border max-w-sm ${
              t.type === 'success'
                ? 'bg-green-50 border-green-200 text-green-900'
                : t.type === 'error'
                ? 'bg-red-50 border-red-200 text-red-900'
                : t.type === 'warning'
                ? 'bg-yellow-50 border-yellow-200 text-yellow-900'
                : 'bg-blue-50 border-blue-200 text-blue-900'
            }`}
          >
            <div className="font-semibold text-sm">{t.title}</div>
            {t.body && <div className="text-xs mt-1 opacity-90">{t.body}</div>}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used within ToastProvider');
  return ctx;
}
