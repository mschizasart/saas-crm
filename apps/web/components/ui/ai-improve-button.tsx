'use client';

/**
 * Reusable AI text-tone enhancement button.
 *
 * Renders a small "✨ Improve" trigger next to a long-form text field. Clicking
 * opens an inline panel where the user picks a tone, then runs the rewrite via
 * `POST /api/v1/ai/improve-text`. The result is shown side-by-side with the
 * original; the user accepts ("Use this") or rejects ("Keep original").
 *
 * Usage:
 *   <AiImproveButton text={value} onAccept={(improved) => setValue(improved)} />
 *
 * Notes:
 *   - Stateless on the server; the API only returns `{ improved }`.
 *   - Errors from Anthropic are surfaced as a generic toast — never raw.
 *   - Disabled when text is too short for tone to matter.
 */

import { useEffect, useRef, useState } from 'react';
import { Sparkles, Loader2, Check, X } from 'lucide-react';
import { apiFetch } from '@/lib/api';

export type ImproveTone =
  | 'friendly'
  | 'professional'
  | 'concise'
  | 'persuasive'
  | 'expand'
  | 'shorten';

const TONES: { value: ImproveTone; label: string; hint: string }[] = [
  { value: 'professional', label: 'Professional', hint: 'Polished, business-appropriate' },
  { value: 'friendly', label: 'Friendly', hint: 'Warm and approachable' },
  { value: 'concise', label: 'Concise', hint: 'Trim filler, keep the point' },
  { value: 'persuasive', label: 'Persuasive', hint: 'Confident, action-oriented' },
  { value: 'expand', label: 'Expand', hint: 'Add helpful detail' },
  { value: 'shorten', label: 'Shorten', hint: 'Cut to the essentials' },
];

const MIN_LEN = 20; // below this, tone rewriting isn't useful

export interface AiImproveButtonProps {
  /** Current text in the field. */
  text: string;
  /** Called with the improved text when the user accepts. */
  onAccept: (improved: string) => void;
  /**
   * If true, the source is HTML (e.g. RichTextEditor). The component will
   * pass the text to the API as-is and return improved text as-is. The API
   * preserves structure, so existing tags survive in most cases.
   */
  isHtml?: boolean;
  /** Optional cap on output length (chars). */
  maxLength?: number;
  /** Visual size. */
  size?: 'xs' | 'sm';
  /** Override label, defaults to "Improve". */
  label?: string;
  /** Extra wrapper classes. */
  className?: string;
}

type Phase = 'idle' | 'picking' | 'loading' | 'review' | 'error';

export function AiImproveButton({
  text,
  onAccept,
  isHtml = false,
  maxLength,
  size = 'sm',
  label = 'Improve',
  className = '',
}: AiImproveButtonProps) {
  const [phase, setPhase] = useState<Phase>('idle');
  const [tone, setTone] = useState<ImproveTone>('professional');
  const [improved, setImproved] = useState<string>('');
  const [errorMsg, setErrorMsg] = useState<string>('');
  const wrapperRef = useRef<HTMLDivElement>(null);

  const tooShort = (text ?? '').trim().length < MIN_LEN;

  // Close on outside click / Escape.
  useEffect(() => {
    if (phase === 'idle') return;
    function onDocClick(e: MouseEvent) {
      if (!wrapperRef.current) return;
      if (!wrapperRef.current.contains(e.target as Node)) close();
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') close();
    }
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [phase]);

  function close() {
    setPhase('idle');
    setImproved('');
    setErrorMsg('');
  }

  async function run() {
    setPhase('loading');
    setErrorMsg('');
    try {
      const res = await apiFetch('/api/v1/ai/improve-text', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, tone, maxLength }),
      });
      if (!res.ok) {
        // Special-case 503 (not configured) so admins see something actionable.
        if (res.status === 503) {
          setErrorMsg("AI features aren't configured. Contact your administrator.");
        } else if (res.status === 429) {
          setErrorMsg('Too many requests — please wait a minute.');
        } else {
          setErrorMsg("Couldn't improve text — try again");
        }
        setPhase('error');
        return;
      }
      const json = (await res.json()) as { improved?: string };
      if (!json?.improved) {
        setErrorMsg("Couldn't improve text — try again");
        setPhase('error');
        return;
      }
      setImproved(json.improved);
      setPhase('review');
    } catch {
      setErrorMsg("Couldn't improve text — try again");
      setPhase('error');
    }
  }

  function accept() {
    onAccept(improved);
    close();
  }

  const triggerSize =
    size === 'xs' ? 'px-2 py-1 text-[11px]' : 'px-2.5 py-1 text-xs';

  return (
    <div ref={wrapperRef} className={`relative inline-block ${className}`}>
      <button
        type="button"
        onClick={() => (phase === 'idle' ? setPhase('picking') : close())}
        disabled={tooShort && phase === 'idle'}
        title={
          tooShort
            ? 'Add more text to enable AI tone rewriting'
            : 'Rewrite this text in a chosen tone'
        }
        className={`inline-flex items-center gap-1 rounded-md border border-purple-200 bg-purple-50 text-purple-700 hover:bg-purple-100 disabled:opacity-50 disabled:cursor-not-allowed dark:bg-purple-500/10 dark:border-purple-500/30 dark:text-purple-300 dark:hover:bg-purple-500/20 ${triggerSize}`}
      >
        <Sparkles className="w-3.5 h-3.5" aria-hidden="true" />
        <span>{label}</span>
      </button>

      {phase === 'picking' && (
        <Panel onClose={close} title="Rewrite tone">
          <div className="space-y-1.5">
            {TONES.map((t) => (
              <label
                key={t.value}
                className="flex items-start gap-2 px-2 py-1.5 rounded-md hover:bg-gray-50 dark:hover:bg-gray-800 cursor-pointer"
              >
                <input
                  type="radio"
                  name="ai-tone"
                  className="mt-1"
                  checked={tone === t.value}
                  onChange={() => setTone(t.value)}
                />
                <span className="text-xs">
                  <span className="font-medium text-gray-900 dark:text-gray-100">
                    {t.label}
                  </span>
                  <span className="block text-gray-500 dark:text-gray-400">
                    {t.hint}
                  </span>
                </span>
              </label>
            ))}
          </div>
          <div className="flex justify-end gap-2 mt-3 pt-3 border-t border-gray-100 dark:border-gray-800">
            <button
              type="button"
              onClick={close}
              className="px-3 py-1.5 text-xs font-medium text-gray-600 hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-100"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={run}
              className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-white bg-purple-600 hover:bg-purple-700 rounded-md"
            >
              <Sparkles className="w-3.5 h-3.5" />
              Improve
            </button>
          </div>
        </Panel>
      )}

      {phase === 'loading' && (
        <Panel onClose={close} title="Rewriting…">
          <div className="flex items-center gap-2 text-xs text-gray-600 dark:text-gray-400 py-3">
            <Loader2 className="w-4 h-4 animate-spin" />
            Asking the AI for a {tone} version…
          </div>
        </Panel>
      )}

      {phase === 'review' && (
        <Panel onClose={close} title={`Compare (${tone})`} wide>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-xs">
            <div>
              <div className="font-medium text-gray-700 dark:text-gray-300 mb-1">
                Original
              </div>
              <div className="border border-gray-200 dark:border-gray-700 rounded-md p-2 bg-gray-50 dark:bg-gray-900 max-h-64 overflow-auto whitespace-pre-wrap">
                {stripHtmlForPreview(text, isHtml)}
              </div>
            </div>
            <div>
              <div className="font-medium text-gray-700 dark:text-gray-300 mb-1">
                Improved
              </div>
              <div className="border border-purple-200 dark:border-purple-500/40 rounded-md p-2 bg-purple-50/40 dark:bg-purple-500/5 max-h-64 overflow-auto whitespace-pre-wrap">
                {stripHtmlForPreview(improved, isHtml)}
              </div>
            </div>
          </div>
          <div className="flex justify-end gap-2 mt-3 pt-3 border-t border-gray-100 dark:border-gray-800">
            <button
              type="button"
              onClick={close}
              className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-gray-600 hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-100"
            >
              <X className="w-3.5 h-3.5" />
              Keep original
            </button>
            <button
              type="button"
              onClick={() => setPhase('picking')}
              className="px-3 py-1.5 text-xs font-medium text-gray-600 hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-100"
            >
              Try another tone
            </button>
            <button
              type="button"
              onClick={accept}
              className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-white bg-purple-600 hover:bg-purple-700 rounded-md"
            >
              <Check className="w-3.5 h-3.5" />
              Use this
            </button>
          </div>
        </Panel>
      )}

      {phase === 'error' && (
        <Panel onClose={close} title="AI couldn't help">
          <div className="text-xs text-red-600 dark:text-red-400 py-2">
            {errorMsg || "Couldn't improve text — try again"}
          </div>
          <div className="flex justify-end gap-2 mt-3 pt-3 border-t border-gray-100 dark:border-gray-800">
            <button
              type="button"
              onClick={close}
              className="px-3 py-1.5 text-xs font-medium text-gray-600 hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-100"
            >
              Close
            </button>
            <button
              type="button"
              onClick={() => setPhase('picking')}
              className="px-3 py-1.5 text-xs font-medium text-white bg-purple-600 hover:bg-purple-700 rounded-md"
            >
              Try again
            </button>
          </div>
        </Panel>
      )}
    </div>
  );
}

// ─── Helpers ─────────────────────────────────────────────────────────────

function Panel({
  children,
  onClose: _onClose,
  title,
  wide,
}: {
  children: React.ReactNode;
  onClose: () => void;
  title: string;
  wide?: boolean;
}) {
  return (
    <div
      role="dialog"
      aria-label={title}
      className={`absolute right-0 top-full mt-1 z-30 ${
        wide ? 'w-[36rem] max-w-[calc(100vw-2rem)]' : 'w-72'
      } bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg p-3`}
    >
      <div className="text-xs font-semibold text-gray-700 dark:text-gray-300 mb-2">
        {title}
      </div>
      {children}
    </div>
  );
}

/**
 * For the side-by-side preview we want plain-text-ish output even when the
 * source is HTML, so users can compare wording without rendering tags.
 */
function stripHtmlForPreview(s: string, isHtml: boolean): string {
  if (!isHtml) return s;
  if (typeof window === 'undefined') return s.replace(/<[^>]+>/g, '');
  const tmp = document.createElement('div');
  tmp.innerHTML = s;
  return (tmp.textContent ?? '').trim();
}

export default AiImproveButton;
