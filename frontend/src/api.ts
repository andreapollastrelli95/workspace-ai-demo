// Client API unico: stesso backend per PC e iPhone → dati sempre sincronizzati.
const BASE = (import.meta.env.VITE_API_URL as string | undefined) ?? ''

const store = {
  get: (k: string) => { try { return localStorage.getItem(k) } catch { return null } },
  set: (k: string, v: string | null) => {
    try { v === null ? localStorage.removeItem(k) : localStorage.setItem(k, v) } catch { /* privato */ }
  },
}

export const auth = {
  token: () => store.get('wa_token'),
  set: (t: string | null) => store.set('wa_token', t),
}

export class ApiError extends Error {
  constructor(public status: number, message: string) { super(message) }
}

export async function api<T = any>(path: string, opts: RequestInit & { json?: unknown } = {}): Promise<T> {
  const headers: Record<string, string> = { ...(opts.headers as Record<string, string>) }
  const t = auth.token()
  if (t) headers.Authorization = `Bearer ${t}`
  let body = opts.body
  if (opts.json !== undefined) { headers['Content-Type'] = 'application/json'; body = JSON.stringify(opts.json) }
  let res: Response
  try {
    res = await fetch(BASE + '/api' + path, { ...opts, headers, body })
  } catch {
    throw new ApiError(0, 'Server non raggiungibile. Controlla la connessione (il server gratuito può impiegare ~1 minuto a risvegliarsi).')
  }
  if (res.status === 401) { auth.set(null); window.dispatchEvent(new Event('wa-logout')) }
  if (!res.ok) {
    let msg = res.statusText
    try { const j = await res.json(); msg = typeof j.detail === 'string' ? j.detail : JSON.stringify(j.detail) } catch { /* */ }
    throw new ApiError(res.status, msg || 'Errore')
  }
  const ct = res.headers.get('content-type') || ''
  return (ct.includes('json') ? res.json() : res.text()) as Promise<T>
}

export function upload<T = any>(path: string, files: FileList | File[]) {
  const fd = new FormData()
  Array.from(files).forEach((f) => fd.append('files', f))
  return api<T>(path, { method: 'POST', body: fd })
}

export async function downloadFile(path: string, filename: string) {
  const res = await fetch(BASE + '/api' + path, { headers: { Authorization: `Bearer ${auth.token()}` } })
  if (!res.ok) throw new ApiError(res.status, 'Download non riuscito')
  const url = URL.createObjectURL(await res.blob())
  const a = document.createElement('a')
  a.href = url; a.download = filename; a.click()
  setTimeout(() => URL.revokeObjectURL(url), 5000)
}

// --- tipi
export type Project = { id: number; name: string; description: string; color: string; updated_at: string
  counts: { documents: number; datasets: number; analyses: number; conversations: number; reports: number } }
export type Doc = { id: number; filename: string; mime: string; size: number; summary: string; status: string; created_at: string }
export type Dataset = { id: number; name: string; filename: string; rows: number; columns: { name: string; dtype: string }[]; created_at: string }
export type Analysis = { id: number; kind: string; title: string; params: any; pinned: number; created_at: string
  result: { metrics?: Record<string, any>; figures?: any[]; stats?: any[]; table?: any[]; rows?: number; cols?: number } }
export type Conversation = { id: number; title: string; updated_at: string }
export type Msg = { id?: number; role: 'user' | 'assistant'; content: string; sources?: { n: number; filename: string; excerpt: string }[] }
export type Report = { id: number; title: string; markdown: string; created_at: string }
