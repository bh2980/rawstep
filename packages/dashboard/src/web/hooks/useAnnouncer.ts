import { useEffect, useRef, useState } from 'react';

/**
 * The text a polite live region should read: it follows `message` but changes at most once per `intervalMs`,
 * keeping only the latest message, so a fast run does not bury the screen reader in speech.
 */
export function useThrottledMessage(message: string, intervalMs = 2500): string {
  const [spoken, setSpoken] = useState('');
  const last = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => {
    if (!message) return;
    const wait = last.current + intervalMs - Date.now();
    const speak = () => { last.current = Date.now(); setSpoken(message); };
    clearTimeout(timer.current);
    if (wait <= 0) speak(); else timer.current = setTimeout(speak, wait);
    return () => clearTimeout(timer.current);
  }, [message, intervalMs]);
  return spoken;
}
