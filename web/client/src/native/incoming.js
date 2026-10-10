// Pure parser for "Share to ApplyPilot" payloads (no Capacitor imports, so Node tests can load it).
const URL_IN_TEXT = /https?:\/\/[^\s<>"')\]]+/i;
/** Parses applypilot://share?url=&text=, https://<server>/share?url=… and plain shared text. */
export function parseIncoming(raw) {
  const s = String(raw || '');
  let url = ''; let text = '';
  try {
    const u = new URL(s);
    const isShare = (u.protocol === 'applypilot:' && /^(\/\/)?(share|job)/.test(u.href.slice('applypilot:'.length))) || /\/share\/?$/.test(u.pathname);
    if (isShare) {
      url = u.searchParams.get('url') || '';
      text = u.searchParams.get('text') || u.searchParams.get('title') || '';
    } else if (/^https?:$/.test(u.protocol)) url = s;
  } catch { text = s; }
  if (!url) { const m = URL_IN_TEXT.exec(text); if (m) url = m[0]; }
  url = url.replace(/[.,;]+$/, '');
  if (url && !/^https?:\/\//i.test(url)) url = '';
  return url || text ? { url, text: text.slice(0, 2000) } : null;
}
