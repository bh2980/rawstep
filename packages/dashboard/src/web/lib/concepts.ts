/**
 * Concepts explained once, in one sentence, where a person first meets them (spec §38). A dismissed concept is remembered in
 * localStorage; where storage is unavailable (a private window, blocked site data) the note simply shows again.
 */
export const CONCEPTS = ['profile', 'check', 'decisionModel', 'inspect'] as const;
export type Concept = (typeof CONCEPTS)[number];

export const CONCEPTS_KEY = 'rawstep.concepts.dismissed';

type Store = Pick<Storage, 'getItem' | 'setItem'>;
const browserStore = (): Store | undefined => { try { return typeof localStorage === 'undefined' ? undefined : localStorage; } catch { return undefined; } };

/** The concepts already dismissed. An unreadable or malformed value means none. */
export function readDismissed(store: Store | undefined = browserStore()): Concept[] {
  try {
    const value: unknown = JSON.parse(store?.getItem(CONCEPTS_KEY) ?? '[]');
    return Array.isArray(value) ? CONCEPTS.filter(concept => value.includes(concept)) : [];
  } catch { return []; }
}

const listeners = new Set<() => void>();

/** Tells every note on the page that the list changed, so a concept dismissed in one place goes away everywhere. */
export function subscribeConcepts(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** Remembers that a concept was dismissed; the result is the new list, kept even when it could not be written. */
export function dismissConcept(concept: Concept, store: Store | undefined = browserStore()): Concept[] {
  const next = [...new Set([...readDismissed(store), concept])];
  try { store?.setItem(CONCEPTS_KEY, JSON.stringify(next)); } catch { /* the note comes back next time */ }
  listeners.forEach(listener => listener());
  return next;
}
