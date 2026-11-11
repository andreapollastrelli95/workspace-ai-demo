import { useEffect, useRef, useState } from 'react'
import { useRegisterSW } from 'virtual:pwa-register/react'
import { Loader2, RefreshCw, Upload, WifiOff, X } from 'lucide-react'

export function Spinner({ className = '' }: { className?: string }) {
  return <Loader2 className={`h-4 w-4 animate-spin ${className}`} />
}

export function Empty({ icon, title, text, action }: { icon: React.ReactNode; title: string; text?: string; action?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-slate-300 px-6 py-12 text-center dark:border-ink-700">
      <div className="mb-3 text-slate-400">{icon}</div>
      <div className="font-semibold">{title}</div>
      {text && <p className="mt-1 max-w-sm text-sm text-slate-500">{text}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  )
}

export function ErrorBox({ error, onClose }: { error: string; onClose?: () => void }) {
  if (!error) return null
  return (
    <div className="mb-4 flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/50 dark:text-red-300">
      <span className="flex-1">{error}</span>
      {onClose && <button onClick={onClose} aria-label="Chiudi"><X className="h-4 w-4" /></button>}
    </div>
  )
}

/** Upload: su iPhone apre il menu nativo (Libreria foto / Scatta foto / Scegli file). Su PC supporta drag & drop multiplo. */
export function UploadButton({ accept, onFiles, busy, label = 'Carica file' }:
  { accept?: string; onFiles: (f: FileList) => void; busy?: boolean; label?: string }) {
  const ref = useRef<HTMLInputElement>(null)
  return (
    <>
      <input ref={ref} type="file" multiple accept={accept} className="hidden"
        onChange={(e) => { if (e.target.files?.length) onFiles(e.target.files); e.target.value = '' }} />
      <button className="btn-primary" disabled={busy} onClick={() => ref.current?.click()}>
        {busy ? <Spinner /> : <Upload className="h-4 w-4" />} {busy ? 'Elaborazione…' : label}
      </button>
    </>
  )
}

export function DropZone({ onFiles, children }: { onFiles: (f: FileList) => void; children: React.ReactNode }) {
  const [over, setOver] = useState(false)
  return (
    <div onDragOver={(e) => { e.preventDefault(); setOver(true) }} onDragLeave={() => setOver(false)}
      onDrop={(e) => { e.preventDefault(); setOver(false); if (e.dataTransfer.files.length) onFiles(e.dataTransfer.files) }}
      className={`rounded-2xl transition ${over ? 'ring-2 ring-brand-500 ring-offset-2 dark:ring-offset-ink-950' : ''}`}>
      {children}
    </div>
  )
}

/** Banner connessione + aggiornamenti controllati del service worker */
export function SystemBanners() {
  const [online, setOnline] = useState(navigator.onLine)
  useEffect(() => {
    const on = () => setOnline(true), off = () => setOnline(false)
    window.addEventListener('online', on); window.addEventListener('offline', off)
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off) }
  }, [])
  const { needRefresh: [needRefresh, setNeedRefresh], updateServiceWorker } = useRegisterSW({
    onRegisteredSW(_url, reg) { if (reg) setInterval(() => reg.update(), 60 * 60 * 1000) }, // controlla ogni ora
  })
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-20 z-50 flex flex-col items-center gap-2 px-4 md:bottom-6">
      {!online && (
        <div className="pointer-events-auto flex items-center gap-2 rounded-full bg-amber-500 px-4 py-2 text-sm font-medium text-white shadow-lg">
          <WifiOff className="h-4 w-4" /> Offline: puoi consultare i dati già aperti
        </div>
      )}
      {needRefresh && (
        <div className="pointer-events-auto flex items-center gap-3 rounded-2xl bg-ink-900 px-4 py-3 text-sm text-white shadow-xl">
          Nuova versione disponibile
          <button className="rounded-lg bg-brand-500 px-3 py-1.5 font-medium" onClick={() => updateServiceWorker(true)}>
            <RefreshCw className="mr-1 inline h-3.5 w-3.5" />Aggiorna
          </button>
          <button onClick={() => setNeedRefresh(false)} aria-label="Più tardi"><X className="h-4 w-4" /></button>
        </div>
      )}
    </div>
  )
}

export function fmtDate(s: string) {
  try { return new Date(s).toLocaleString('it-IT', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) } catch { return s }
}
export function fmtSize(b: number) {
  return b > 1e6 ? `${(b / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1e3))} KB`
}
export function fmtNum(v: any) {
  if (typeof v === 'number') return Math.abs(v) >= 1000 ? v.toLocaleString('it-IT', { maximumFractionDigits: 0 }) : v.toLocaleString('it-IT', { maximumFractionDigits: 3 })
  return v === null || v === undefined ? '—' : String(v)
}
