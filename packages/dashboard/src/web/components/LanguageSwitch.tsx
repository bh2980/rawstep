import { Languages } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { LANGUAGES, LANGUAGE_NAMES, currentLanguage, setLanguage, type Language } from '../i18n/index.js';
import { Button } from './ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuTrigger } from './ui/dropdown-menu';

/**
 * The screen language: 한국어 or English. It opens in the browser's language; a choice here is remembered in this browser.
 * Each name is written, and marked, in its own language so a screen reader pronounces it right.
 */
export function LanguageSwitch() {
  const { t } = useTranslation();
  const language = currentLanguage();
  const label = t('topBar.language', { current: LANGUAGE_NAMES[language] });
  return <DropdownMenu>
    <DropdownMenuTrigger asChild>
      <Button variant="ghost" size="sm" aria-label={label} title={label}>
        <Languages aria-hidden="true" /><span lang={language}>{LANGUAGE_NAMES[language]}</span>
      </Button>
    </DropdownMenuTrigger>
    <DropdownMenuContent align="end">
      <DropdownMenuRadioGroup value={language} onValueChange={value => setLanguage(value as Language)}>
        {LANGUAGES.map(option => <DropdownMenuRadioItem key={option} value={option} lang={option}>{LANGUAGE_NAMES[option]}</DropdownMenuRadioItem>)}
      </DropdownMenuRadioGroup>
    </DropdownMenuContent>
  </DropdownMenu>;
}
