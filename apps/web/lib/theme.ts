'use client';
import { useState, useEffect } from 'react';

export type Theme = 'light' | 'dark' | 'system';
const STORAGE_KEY = 'theme';

function resolveTheme(t: Theme): 'light' | 'dark' {
  if (t === 'system') {
    if (typeof window === 'undefined') return 'light';
    return window.matchMedia('(prefers-color-scheme: dark)').matches
      ? 'dark'
      : 'light';
  }
  return t;
}

export function applyTheme(t: Theme) {
  if (typeof document === 'undefined') return;
  const resolved = resolveTheme(t);
  document.documentElement.classList.toggle('dark', resolved === 'dark');
}

function readStoredTheme(): Theme {
  if (typeof window === 'undefined') return 'system';
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved === 'light' || saved === 'dark') return saved;
  return 'system';
}

/**
 * Unified theme hook.
 * - `theme` reflects the user's preference ('light' | 'dark' | 'system').
 * - `dark` is the currently-resolved concrete mode (for backwards-compat callers).
 * - `setTheme(t)` persists and applies.
 * - `toggle()` flips between light and dark (kept for backwards-compat).
 * - `setMode(t)` alias of `setTheme` (kept for backwards-compat).
 */
export function useTheme() {
  const [theme, setThemeState] = useState<Theme>('system');
  const [dark, setDark] = useState(false);

  useEffect(() => {
    const stored = readStoredTheme();
    setThemeState(stored);
    const resolved = resolveTheme(stored);
    setDark(resolved === 'dark');
    applyTheme(stored);
  }, []);

  // React to OS-level changes while in 'system' mode.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (theme !== 'system') return;
    const mql = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = () => {
      setDark(mql.matches);
      applyTheme('system');
    };
    mql.addEventListener?.('change', handler);
    return () => mql.removeEventListener?.('change', handler);
  }, [theme]);

  function setTheme(t: Theme) {
    if (t === 'system') {
      localStorage.removeItem(STORAGE_KEY);
    } else {
      localStorage.setItem(STORAGE_KEY, t);
    }
    setThemeState(t);
    const resolved = resolveTheme(t);
    setDark(resolved === 'dark');
    applyTheme(t);
  }

  function toggle() {
    setTheme(dark ? 'light' : 'dark');
  }

  // Back-compat alias used by existing callers (admin-sidebar, settings page).
  const setMode = setTheme;

  return { theme, setTheme, dark, toggle, setMode };
}
