'use client';

import { useState, useEffect, useCallback } from 'react';
import { getTranslation, loadLanguage } from './index';

/**
 * React hook that provides the translation function `t()`, the current
 * language code, and a setter to change language.
 *
 * Usage:
 *   const { t, lang, setLang } = useI18n();
 *   <span>{t('nav.dashboard')}</span>
 */
export function useI18n() {
  const [lang, setLangState] = useState('en');
  const [, setReady] = useState(false);

  useEffect(() => {
    const saved = localStorage.getItem('language') ?? 'en';
    setLangState(saved);
    loadLanguage(saved).then(() => setReady(true));
  }, []);

  const setLang = useCallback((newLang: string) => {
    localStorage.setItem('language', newLang);
    setLangState(newLang);
    loadLanguage(newLang).then(() => {
      // Force re-render after the language pack has loaded
      setLangState(newLang);
    });
  }, []);

  const t = useCallback(
    (key: string): string => getTranslation(lang, key),
    [lang],
  );

  return { t, lang, setLang };
}
