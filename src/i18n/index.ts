import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';

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

void i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: {
      es: { common: es },
      ca: { common: ca },
      en: { common: en },
    },
    fallbackLng: 'es',
    supportedLngs: SUPPORTED_LANGUAGES as unknown as string[],
    ns: ['common'],
    defaultNS: 'common',
    interpolation: { escapeValue: false },
    detection: {
      order: ['localStorage', 'navigator'],
      lookupLocalStorage: 'portami.lang',
      caches: ['localStorage'],
    },
  });

export default i18n;