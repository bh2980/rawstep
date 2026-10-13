import { useEffect, useId, useMemo, useState, type ReactNode } from 'react';
import { Check, FolderOpen, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { ProjectFiles } from '../../shared/api';
import { api } from '../api';
import { cn } from '../lib/utils';
import { InfoTip } from './layout/InfoTip';
import { Button } from './ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from './ui/dialog';
import { Input } from './ui/input';
import { Label } from './ui/label';

/** One listing per page load, shared by every path field; dropped on failure so the next field asks again. */
let listing: Promise<ProjectFiles> | undefined;
function projectFiles(fresh?: boolean): Promise<ProjectFiles> {
  if (fresh || !listing) {
    const ask = api<ProjectFiles>('/files');
    listing = ask;
    ask.catch(() => { if (listing === ask) listing = undefined; });
  }
  return listing;
}

const isWebAddress = (value: string) => /^https?:\/\//i.test(value.trim());
/** The name `{task}` stands for: the task file's name without folders or `.json`. */
export const taskStem = (file: string) => file.replace(/^.*\//, '').replace(/\.json$/i, '');

type Props = {
  label: string; value: string; onChange: (value: string) => void;
  /** File endings the picker lists, such as ['.json']. */
  extensions: readonly string[];
  /** A web address is a valid value too (a task's start page). */
  allowUrl?: boolean;
  /** Tasks the path is used for, when it may hold `{task}`: each is shown with the file its own name makes. */
  tasks?: readonly { name: string; file: string }[];
  example?: string; info?: ReactNode;
};

/**
 * A path inside the project, typed or picked: it says what it is relative to (the project folder, shown), lists the project's files
 * of the right kind in 찾아보기, and says under the field whether the file is there. A path with `{task}` is checked per task.
 */
export function ProjectPathField({ label, value, onChange, extensions, allowUrl, tasks, example, info }: Props) {
  const { t } = useTranslation();
  const id = useId();
  const [files, setFiles] = useState<ProjectFiles>(), [failed, setFailed] = useState(false), [picking, setPicking] = useState(false);
  useEffect(() => { let live = true; projectFiles().then(list => { if (live) setFiles(list); }, () => { if (live) setFailed(true); }); return () => { live = false; }; }, []);
  const known = useMemo(() => new Set(files?.files ?? []), [files]);
  const path = value.trim().replace(/^\.\//, '');
  const lines: { text: string; ok?: boolean }[] = !path ? []
    : allowUrl && isWebAddress(path) ? [{ text: t('pathField.webAddress') }]
    : !files ? []
    : path.includes('{task}') && tasks?.length ? tasks.map(task => { const file = path.replaceAll('{task}', taskStem(task.file)); return { text: t('pathField.forTask', { task: task.name, file }), ok: known.has(file) }; })
    : path.includes('{task}') ? [{ text: t('pathField.perTask') }]
    : [{ text: known.has(path) ? t('pathField.found') : t('pathField.missing'), ok: known.has(path) }];
  return <div className="grid gap-1.5">
    <Label htmlFor={id} className="flex items-center gap-1">{label}{info && <InfoTip term={label}>{info}</InfoTip>}</Label>
    <p id={id + '-base'} className="text-xs leading-5 text-muted-foreground">
      {allowUrl ? t('pathField.baseOrUrl') : t('pathField.base')}{files && <> <span className="font-mono break-all">{files.root}</span></>}
    </p>
    <div className="flex gap-2">
      <Input id={id} value={value} onChange={event => onChange(event.target.value)} aria-describedby={`${id}-base ${id}-status`} className="font-mono text-[13px]" />
      <Button type="button" variant="outline" onClick={() => { setPicking(true); void projectFiles(true).then(setFiles, () => setFailed(true)); }}><FolderOpen aria-hidden="true" />{t('pathField.browse')}</Button>
    </div>
    <div id={id + '-status'} role="status" className="grid gap-0.5 text-xs leading-5">
      {lines.map(line => <p key={line.text} className={cn('flex items-center gap-1', line.ok === true ? 'text-reach' : line.ok === false ? 'text-inspect' : 'text-muted-foreground')}>
        {line.ok === true && <Check aria-hidden="true" className="size-3.5" />}{line.ok === false && <X aria-hidden="true" className="size-3.5" />}{line.text}
      </p>)}
      {!path && example && <p className="text-muted-foreground">{t('pathField.example', { example })}</p>}
      {failed && <p className="text-inspect">{t('pathField.listFailed')}</p>}
    </div>
    <PickDialog open={picking} onOpenChange={setPicking} title={label} files={files} extensions={extensions} onPick={file => { onChange(file); setPicking(false); }} />
  </div>;
}

/** The project's files of the wanted kinds, searchable; picking one puts its project-relative path in the field. */
function PickDialog({ open, onOpenChange, title, files, extensions, onPick }: { open: boolean; onOpenChange: (open: boolean) => void; title: string; files: ProjectFiles | undefined; extensions: readonly string[]; onPick: (file: string) => void }) {
  const { t } = useTranslation();
  const [query, setQuery] = useState('');
  const needle = query.trim().toLowerCase();
  const shown = (files?.files ?? []).filter(file => extensions.some(ext => file.toLowerCase().endsWith(ext)) && (!needle || file.toLowerCase().includes(needle)));
  return <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent className="sm:max-w-xl">
      <DialogHeader>
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription>{t('pathField.pickDescription', { kinds: extensions.join(', ') })}{files && <> <span className="font-mono break-all">{files.root}</span></>}</DialogDescription>
      </DialogHeader>
      <Input aria-label={t('pathField.search')} placeholder={t('pathField.search')} value={query} onChange={event => setQuery(event.target.value)} />
      <ul aria-label={t('pathField.listLabel')} className="max-h-80 overflow-y-auto rounded-md border border-edge">
        {shown.map(file => <li key={file} className="border-b border-edge last:border-0">
          <button type="button" onClick={() => onPick(file)} className="w-full px-3 py-1.5 text-left font-mono text-[13px] hover:bg-raised focus-visible:bg-raised">
            {file.includes('/') && <span className="text-muted-foreground">{file.slice(0, file.lastIndexOf('/') + 1)}</span>}{file.slice(file.lastIndexOf('/') + 1)}
          </button>
        </li>)}
        {files && shown.length === 0 && <li className="px-3 py-6 text-center text-sm text-muted-foreground">{t('pathField.none')}</li>}
        {!files && <li className="px-3 py-6 text-center text-sm text-muted-foreground">{t('pathField.loading')}</li>}
      </ul>
      {files?.truncated && <p className="text-xs text-muted-foreground">{t('pathField.truncated')}</p>}
    </DialogContent>
  </Dialog>;
}
