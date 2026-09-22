import cs from './i18n/cs.json';
import de from './i18n/de.json';
import en from './i18n/en.json';

export const locales = ['de', 'cs', 'en'] as const;

export type Locale = (typeof locales)[number];

type Dictionary = Record<string, string>;

const dictionaries: Record<Locale, Dictionary> = {
  de,
  cs,
  en,
};

export function t(locale: Locale, key: string): string {
  return dictionaries[locale][key] ?? dictionaries.de[key] ?? key;
}
