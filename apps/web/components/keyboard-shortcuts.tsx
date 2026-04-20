'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';

const SHORTCUTS = [
  { keys: ['g', 'd'], label: 'Go to Dashboard', action: '/dashboard' },
  { keys: ['g', 'c'], label: 'Go to Clients', action: '/clients' },
  { keys: ['g', 'l'], label: 'Go to Leads', action: '/leads' },
  { keys: ['g', 'i'], label: 'Go to Invoices', action: '/invoices' },
  { keys: ['g', 'p'], label: 'Go to Projects', action: '/projects' },
  { keys: ['g', 't'], label: 'Go to Tickets', action: '/tickets' },
  { keys: ['g', 'r'], label: 'Go to Reports', action: '/reports' },
  { keys: ['g', 's'], label: 'Go to Settings', action: '/settings' },
  { keys: ['n', 'c'], label: 'New Client', action: '/clients/new' },
  { keys: ['n', 'l'], label: 'New Lead', action: '/leads/new' },
  { keys: ['n', 'i'], label: 'New Invoice', action: '/invoices/new' },
  { keys: ['n', 't'], label: 'New Ticket', action: '/tickets/new' },
  { keys: ['?'], label: 'Show shortcuts help', action: 'help' },
];

function isTyping(): boolean {
  const el = document.activeElement;
  if (!el) return false;
  const tag = el.tagName.toLowerCase();
  if (tag === 'input' || tag === 'textarea' || tag === 'select') return true;
  if ((el as HTMLElement).isContentEditable) return true;
  return false;
}

export function KeyboardShortcuts() {
  const router = useRouter();
  const [showHelp, setShowHelp] = useState(false);
  const bufferRef = useRef<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const clearBuffer = useCallback(() => {
    bufferRef.current = null;
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      // Don't trigger when typing in inputs
      if (isTyping()) return;

      // Don't trigger with modifier keys (except shift for ?)
      if (e.ctrlKey || e.metaKey || e.altKey) return;

      const key = e.key;

      // Handle Escape to close help modal
      if (key === 'Escape' && showHelp) {
        setShowHelp(false);
        return;
      }

      // Single-key shortcut: ?
      if (key === '?') {
        e.preventDefault();
        setShowHelp((prev) => !prev);
        clearBuffer();
        return;
      }

      // If we have a buffered first key, check for chord completion
      if (bufferRef.current !== null) {
        const firstKey = bufferRef.current;
        clearBuffer();

        const match = SHORTCUTS.find(
          (s) => s.keys.length === 2 && s.keys[0] === firstKey && s.keys[1] === key,
        );
        if (match) {
          e.preventDefault();
          if (match.action === 'help') {
            setShowHelp((prev) => !prev);
          } else {
            router.push(match.action);
          }
          return;
        }
      }

      // Start a chord if this key is a chord starter
      const isStarter = SHORTCUTS.some((s) => s.keys.length === 2 && s.keys[0] === key);
      if (isStarter) {
        bufferRef.current = key;
        timerRef.current = setTimeout(() => {
          bufferRef.current = null;
        }, 500);
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [router, showHelp, clearBuffer]);

  // Focus trap + scroll lock + focus restore for the help dialog.
  // ESC is already handled in the main handler above, so we don't duplicate it here.
  useEffect(() => {
    if (!showHelp) return;
    const prev = document.activeElement as HTMLElement | null;
    const selectors =
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';
    const first = panelRef.current?.querySelector<HTMLElement>(selectors);
    first?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return;
      const focusables =
        panelRef.current?.querySelectorAll<HTMLElement>(selectors);
      if (!focusables || focusables.length === 0) return;
      const firstEl = focusables[0];
      const lastEl = focusables[focusables.length - 1];
      if (e.shiftKey && document.activeElement === firstEl) {
        lastEl.focus();
        e.preventDefault();
      } else if (!e.shiftKey && document.activeElement === lastEl) {
        firstEl.focus();
        e.preventDefault();
      }
    };
    document.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
      prev?.focus?.();
    };
  }, [showHelp]);

  if (!showHelp) return null;

  // Group shortcuts by first key
  const goShortcuts = SHORTCUTS.filter((s) => s.keys[0] === 'g');
  const newShortcuts = SHORTCUTS.filter((s) => s.keys[0] === 'n');
  const otherShortcuts = SHORTCUTS.filter((s) => s.keys[0] !== 'g' && s.keys[0] !== 'n');

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-[100] p-4"
      onClick={() => setShowHelp(false)}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="keyboard-shortcuts-title"
        className="bg-white rounded-xl shadow-2xl w-full max-w-lg max-h-[80vh] overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
          <h2 id="keyboard-shortcuts-title" className="text-lg font-semibold text-gray-900">Keyboard Shortcuts</h2>
          <button
            onClick={() => setShowHelp(false)}
            aria-label="Close"
            className="p-1 rounded hover:bg-gray-100 text-gray-400 hover:text-gray-600"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="px-6 py-4 overflow-y-auto max-h-[60vh] space-y-6">
          {/* Navigation */}
          <div>
            <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">
              Navigation
            </h3>
            <div className="grid grid-cols-2 gap-2">
              {goShortcuts.map((s) => (
                <div key={s.label} className="flex items-center justify-between py-1.5">
                  <span className="text-sm text-gray-700">{s.label}</span>
                  <span className="flex gap-1">
                    {s.keys.map((k) => (
                      <kbd
                        key={k}
                        className="inline-flex items-center justify-center min-w-[24px] h-6 px-1.5 bg-gray-100 border border-gray-200 rounded text-xs font-mono text-gray-600"
                      >
                        {k}
                      </kbd>
                    ))}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Create */}
          <div>
            <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">
              Create
            </h3>
            <div className="grid grid-cols-2 gap-2">
              {newShortcuts.map((s) => (
                <div key={s.label} className="flex items-center justify-between py-1.5">
                  <span className="text-sm text-gray-700">{s.label}</span>
                  <span className="flex gap-1">
                    {s.keys.map((k) => (
                      <kbd
                        key={k}
                        className="inline-flex items-center justify-center min-w-[24px] h-6 px-1.5 bg-gray-100 border border-gray-200 rounded text-xs font-mono text-gray-600"
                      >
                        {k}
                      </kbd>
                    ))}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Other */}
          <div>
            <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">
              General
            </h3>
            <div className="grid grid-cols-2 gap-2">
              {otherShortcuts.map((s) => (
                <div key={s.label} className="flex items-center justify-between py-1.5">
                  <span className="text-sm text-gray-700">{s.label}</span>
                  <span className="flex gap-1">
                    {s.keys.map((k) => (
                      <kbd
                        key={k}
                        className="inline-flex items-center justify-center min-w-[24px] h-6 px-1.5 bg-gray-100 border border-gray-200 rounded text-xs font-mono text-gray-600"
                      >
                        {k}
                      </kbd>
                    ))}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="px-6 py-3 border-t border-gray-200 text-center">
          <p className="text-xs text-gray-400">
            Press <kbd className="px-1.5 py-0.5 bg-gray-100 border border-gray-200 rounded text-xs font-mono">?</kbd> to toggle this dialog
          </p>
        </div>
      </div>
    </div>
  );
}
