import en from './translations/en.json';

const translations: Record<string, Record<string, any>> = { en };

/**
 * Lazy-load a language pack. Returns the translation dictionary for the
 * requested language, falling back to English if the file does not exist.
 */
export async function loadLanguage(lang: string): Promise<Record<string, any>> {
  if (translations[lang]) return translations[lang];
  try {
    const mod = await import(`./translations/${lang}.json`);
    translations[lang] = mod.default;
    return mod.default;
  } catch {
    return en; // fallback
  }
}

/**
 * Synchronously look up a dot-separated key (e.g. "nav.dashboard") in the
 * given language dictionary. Falls back to English, then to the raw key.
 */
export function getTranslation(lang: string, key: string): string {
  const resolve = (dict: Record<string, any>): string | undefined => {
    let val: any = dict;
    for (const k of key.split('.')) {
      val = val?.[k];
      if (val === undefined) return undefined;
    }
    return typeof val === 'string' ? val : undefined;
  };

  return resolve(translations[lang] ?? en) ?? resolve(en) ?? key;
}

/** List of supported locales with display labels. */
export const SUPPORTED_LANGUAGES = [
  { code: 'en', label: 'English' },
  { code: 'el', label: 'Ελληνικά' },
  { code: 'de', label: 'Deutsch' },
  { code: 'fr', label: 'Français' },
] as const;
