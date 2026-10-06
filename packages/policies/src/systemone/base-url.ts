import { isLoopbackHostname } from '@rawstep/core/defaults';

/** A model server address: HTTPS (or HTTP on loopback) without credentials, query or fragment. Returned with a trailing slash so relative paths resolve under it. */
export function modelBaseURL(value: string): URL {
  let url: URL;
  try { url = new URL(value); } catch { throw new Error('Model base URL must be an absolute HTTP(S) URL.'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash ||
      (url.protocol === 'http:' && !isLoopbackHostname(url.hostname)))
    throw new Error('Model base URL requires HTTPS, or loopback HTTP, without credentials/query/fragment.');
  url.pathname = url.pathname.replace(/\/$/, '') + '/'; return url;
}
