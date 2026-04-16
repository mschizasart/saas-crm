'use client';
import { useState, useEffect } from 'react';

export function useTheme() {
  const [dark, setDark] = useState(false);

  useEffect(() => {
    const saved = localStorage.getItem('theme');
    const isDark =
      saved === 'dark' ||
      (!saved && window.matchMedia('(prefers-color-scheme: dark)').matches);
    setDark(isDark);
    document.documentElement.classList.toggle('dark', isDark);
  }, []);

  function toggle() {
    const newDark = !dark;
    setDark(newDark);
    localStorage.setItem('theme', newDark ? 'dark' : 'light');
    document.documentElement.classList.toggle('dark', newDark);
  }

  function setMode(mode: 'light' | 'dark' | 'system') {
    if (mode === 'system') {
      localStorage.removeItem('theme');
      const isDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
      setDark(isDark);
      document.documentElement.classList.toggle('dark', isDark);
    } else {
      const isDark = mode === 'dark';
      setDark(isDark);
      localStorage.setItem('theme', mode);
      document.documentElement.classList.toggle('dark', isDark);
    }
  }

  return { dark, toggle, setMode };
}
