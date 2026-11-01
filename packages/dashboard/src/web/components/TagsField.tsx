import { useId, useRef, useState, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { addTags, MAX_TAGS, MAX_TAG_LENGTH, tagProblem, type TagProblem } from '../lib/tags';
import { InfoTip } from './layout/InfoTip';
import { Input } from './ui/input';
import { Label } from './ui/label';

type Props = {
  label: string; tags: string[]; onChange: (tags: string[]) => void;
  hint?: string; info?: ReactNode;
};

/**
 * A task's tags: the ones it has as chips, each with its own remove button, and an input that adds a tag on Enter or a comma. What
 * a tag may be is the project's rule; the reason a tag is refused is written under the input, and read out when the person tries to
 * add it (not on every key). The chips are plain text in a list, so only the remove buttons and the input are controls.
 */
export function TagsField({ label, tags, onChange, hint, info }: Props) {
  const { t } = useTranslation();
  const id = useId(), input = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState('');
  // A refusal after the person tried to add: it is announced once, where the reason shown while typing is not.
  const [refused, setRefused] = useState(false);
  const [notice, setNotice] = useState('');
  const first = draft.split(',').map(piece => piece.trim()).find(Boolean);
  const typing = first ? tagProblem(first, tags) : undefined;
  const reason = (code: TagProblem, tag: string) => t(`tags.problem.${code}`, { tag, max: code === 'full' ? MAX_TAGS : MAX_TAG_LENGTH });

  /** Takes what is typed; what cannot be taken stays in the input with the reason. */
  function commit(text: string, byPerson: boolean) {
    const result = addTags(text, tags);
    if (result.tags.length !== tags.length) {
      onChange(result.tags);
      setNotice(t('tags.added', { tags: result.tags.slice(tags.length).join(', ') }));
    }
    setDraft(result.rest);
    setRefused(byPerson && !!result.problem);
  }
  const remove = (tag: string) => {
    onChange(tags.filter(item => item !== tag));
    setNotice(t('tags.removed', { tag }));
    setRefused(false);
    // The button that had focus is gone: the input is the next place to type.
    input.current?.focus();
  };
  const problemText = typing ? reason(typing, first!) : '';
  return <div className="grid gap-2">
    <div className="flex items-center gap-1"><Label htmlFor={id}>{label}</Label>{info && <InfoTip term={label}>{info}</InfoTip>}</div>
    {tags.length > 0 && <ul aria-label={t('tags.list')} className="flex flex-wrap gap-1.5">{tags.map(tag => <li key={tag} className="inline-flex h-7 items-center gap-0.5 rounded-md border border-edge-strong bg-raised pr-0.5 pl-2 text-[13px]">
      <span>{tag}</span>
      <button type="button" aria-label={t('tags.remove', { tag })} onClick={() => remove(tag)}
        className="inline-flex size-6 items-center justify-center rounded-sm text-muted-foreground hover:bg-background hover:text-foreground focus-visible:outline-2 focus-visible:outline-trace">
        <X aria-hidden="true" className="size-3.5" />
      </button>
    </li>)}</ul>}
    <Input ref={input} id={id} value={draft} maxLength={80} autoComplete="off" spellCheck={false} placeholder={t('tags.placeholder')}
      aria-invalid={!!typing} aria-describedby={[problemText && id + '-problem', hint && id + '-hint'].filter(Boolean).join(' ') || undefined}
      onChange={event => { setRefused(false); if (event.target.value.includes(',')) commit(event.target.value, false); else setDraft(event.target.value); }}
      onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); commit(draft, true); } }}
      onBlur={() => { if (draft.trim() && !typing) commit(draft, false); }} />
    {problemText && <p key={refused ? 'refused' : 'typing'} id={id + '-problem'} role={refused ? 'alert' : undefined} className="text-xs leading-5 text-inspect">{problemText}</p>}
    {hint && <p id={id + '-hint'} className="text-xs leading-5 text-muted-foreground">{hint}</p>}
    <p role="status" className="sr-only">{notice}</p>
  </div>;
}
