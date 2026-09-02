// ============================================================
// i18n bootstrap.
//
// Why a custom detector instead of i18next-browser-languagedetector:
//   The library has a known footgun where the `lookupLocalStorage`
//   option (and the modern `lookup` map) silently no-ops when
//   combined with `caches: ['localStorage']` on some bundlers. We
//   side-step it entirely by reading the persisted key ourselves
//   and passing it as `lng` to `init`. `i18next.changeLanguage()`
//   in the Settings UI then writes back to `portami.lang` and
//   reloads the page so the new language takes effect everywhere
//   (including the `<html lang="…">` attribute and the document
//   title). This is simple, robust, and avoids any dependency on
//   a bug-prone library version.
// ============================================================

import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

import es from '../../public/locales/es/common.json';
import ca from '../../public/locales/ca/common.json';
import en from '../../public/locales/en/common.json';

export const SUPPORTED_LANGUAGES = ['es', 'ca', 'en'] as const;
export type Language = (typeof SUPPORTED_LANGUAGES)[number];

export const LANGUAGE_LABELS: Record<Language, string> = {
  es: 'Castellano',
  ca: 'Català',
  en: 'English',
};

const STORAGE_KEY = 'portami.lang';

/** Read the persisted language; null if not set or invalid. */
export function getStoredLanguage(): Language | null {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored && (SUPPORTED_LANGUAGES as readonly string[]).includes(stored)) {
    return stored as Language;
  }
  return null;
}

/** Write the language to the same key the Settings UI reads. */
export function setStoredLanguage(lng: Language): void {
  localStorage.setItem(STORAGE_KEY, lng);
}

const initialLng = getStoredLanguage() ?? 'es';

void i18n.use(initReactI18next).init({
  resources: {
    es: { common: es },
    ca: { common: ca },
    en: { common: en },
  },
  lng: initialLng,
  fallbackLng: 'es',
  supportedLngs: SUPPORTED_LANGUAGES as unknown as string[],
  ns: ['common'],
  defaultNS: 'common',
  interpolation: { escapeValue: false },
});

export default i18n;