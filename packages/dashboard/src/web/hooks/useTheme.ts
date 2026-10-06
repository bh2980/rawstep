import { useCallback, useEffect, useState } from 'react';
import { nextThemePreference, readThemePreference, resolveTheme, writeThemePreference, type ThemePreference } from '../lib/theme';

const QUERY = '(prefers-color-scheme: dark)';

/** The theme preference and the theme it resolves to; the `dark` class on <html> follows it and the system setting while it is "system". */
export function useTheme() {
  const [preference, setPreference] = useState<ThemePreference>(() => readThemePreference());
  const [systemDark, setSystemDark] = useState(() => window.matchMedia(QUERY).matches);
  useEffect(() => {
    const query = window.matchMedia(QUERY);
    const change = () => setSystemDark(query.matches);
    query.addEventListener('change', change);
    return () => query.removeEventListener('change', change);
  }, []);
  const resolved = resolveTheme(preference, systemDark);
  useEffect(() => { document.documentElement.classList.toggle('dark', resolved === 'dark'); }, [resolved]);
  const cycle = useCallback(() => { const next = nextThemePreference(preference); setPreference(next); writeThemePreference(next); }, [preference]);
  return { preference, resolved, cycle };
}
