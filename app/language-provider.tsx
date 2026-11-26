'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { Languages } from 'lucide-react';
import { Button } from '@/components/ui/button';

export type Language = 'zh' | 'en';

type LanguageContextValue = {
  language: Language;
  setLanguage: (language: Language) => void;
};

const STORAGE_KEY = 'glory-navy.language.v1';
const LanguageContext = createContext<LanguageContextValue | null>(null);
let activeLanguage: Language = 'zh';
const numberFormatters = new Map<string, Intl.NumberFormat>();

export function translate(zh: string, en: string) {
  return activeLanguage === 'en' ? en : zh;
}

export function languageLocale() {
  return activeLanguage === 'en' ? 'en-US' : 'zh-CN';
}

export function formatLocalizedNumber(value: number, options: Intl.NumberFormatOptions = {}) {
  const locale = languageLocale();
  const key = `${locale}:${JSON.stringify(options)}`;
  let formatter = numberFormatters.get(key);
  if (!formatter) {
    formatter = new Intl.NumberFormat(locale, options);
    numberFormatters.set(key, formatter);
  }
  return formatter.format(value);
}

export function bilingualName(zh: string, en: string) {
  if (zh === en) return zh;
  return activeLanguage === 'en' ? `${en} (${zh})` : `${zh}（${en}）`;
}

export function LanguageProvider({ children }: { children: React.ReactNode }) {
  const [language, setLanguageState] = useState<Language>('zh');

  useEffect(() => {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    if (saved !== 'zh' && saved !== 'en') return;
    const frame = window.requestAnimationFrame(() => {
      activeLanguage = saved;
      setLanguageState(saved);
      document.documentElement.lang = saved === 'en' ? 'en' : 'zh-CN';
    });
    return () => window.cancelAnimationFrame(frame);
  }, []);

  const setLanguage = useCallback((nextLanguage: Language) => {
    activeLanguage = nextLanguage;
    setLanguageState(nextLanguage);
    window.localStorage.setItem(STORAGE_KEY, nextLanguage);
    document.documentElement.lang = nextLanguage === 'en' ? 'en' : 'zh-CN';
  }, []);

  const value = useMemo(() => ({ language, setLanguage }), [language, setLanguage]);
  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

export function useLanguage() {
  const context = useContext(LanguageContext);
  if (!context) throw new Error('useLanguage must be used inside LanguageProvider');
  return context;
}

export function LanguageToggle() {
  const { language, setLanguage } = useLanguage();
  const next = language === 'zh' ? 'en' : 'zh';
  return (
    <Button
      type="button"
      size="sm"
      variant="outline"
      className="language-toggle"
      aria-label={language === 'zh' ? 'Switch to English' : '切换到中文'}
      title={language === 'zh' ? 'Switch to English' : '切换到中文'}
      onClick={() => setLanguage(next)}
    >
      <Languages data-icon="inline-start" />
      {language === 'zh' ? 'EN' : '中文'}
    </Button>
  );
}
