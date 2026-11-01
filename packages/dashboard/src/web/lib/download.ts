/** Saves text as a file from the browser: a Blob behind a temporary link. Nothing is sent to the server. A byte order mark lets spreadsheets read UTF-8 CSV. */
export function downloadText(name: string, text: string, type: 'application/json' | 'text/csv'): void {
  const blob = new Blob([type === 'text/csv' ? '﻿' + text : text], { type: `${type};charset=utf-8` }), url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url; link.download = name; link.hidden = true;
  document.body.append(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
