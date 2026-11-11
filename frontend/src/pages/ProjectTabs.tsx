import { useCallback, useEffect, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import {
  BarChart3, Download, FileText, MessageSquare, Pencil, Pin, PinOff, Plus, Send, Sparkles, Table2, Trash2, FileBarChart, Wand2,
} from 'lucide-react'
import { Analysis, api, Conversation, Dataset, Doc, downloadFile, Msg, Project, Report, upload } from '../api'
import Plot from '../components/Plot'
import { DropZone, Empty, ErrorBox, fmtDate, fmtNum, fmtSize, Spinner, UploadButton } from '../components/ui'
import { ProjectModal } from '../App'

type TabProps = { project: Project; reload: () => void }

function useList<T>(path: string) {
  const [items, setItems] = useState<T[] | null>(null)
  const [error, setError] = useState('')
  const load = useCallback(() => api<T[]>(path).then(setItems).catch((e) => { setError(e.message); setItems((x) => x ?? []) }), [path])
  useEffect(() => { load() }, [load])
  return { items, setItems, load, error, setError }
}

const KIND_LABEL: Record<string, string> = { explore: 'Esplorazione', chart: 'Grafico', forecast: 'Previsione', model: 'Modello ML', simulation: 'Simulazione' }

/* ============================================================ DASHBOARD */
export function DashboardTab({ project, reload, onDeleted }: TabProps & { onDeleted: () => void }) {
  const { items, load } = useList<Analysis>(`/projects/${project.id}/analyses`)
  const [editing, setEditing] = useState(false)
  const pinned = items?.filter((a) => a.pinned) ?? []
  const del = async () => {
    if (!confirm(`Eliminare definitivamente il progetto "${project.name}" con tutti i suoi dati?`)) return
    await api(`/projects/${project.id}`, { method: 'DELETE' }); onDeleted()
  }
  const stats = [
    { label: 'Documenti', v: project.counts.documents, icon: FileText }, { label: 'Dataset', v: project.counts.datasets, icon: Table2 },
    { label: 'Analisi', v: project.counts.analyses, icon: BarChart3 }, { label: 'Conversazioni', v: project.counts.conversations, icon: MessageSquare },
  ]
  return (
    <div className="mx-auto max-w-7xl">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <p className="max-w-2xl text-sm text-slate-500">{project.description || 'Aggiungi una descrizione per dare contesto all’assistente AI.'}</p>
        <div className="flex gap-2"><button className="btn-ghost" onClick={() => setEditing(true)}><Pencil className="h-4 w-4" />Modifica</button>
          <button className="btn-ghost text-red-600" onClick={del}><Trash2 className="h-4 w-4" /></button></div>
      </div>
      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {stats.map((s) => (
          <div key={s.label} className="card p-4"><div className="flex items-center justify-between text-sm text-slate-500">{s.label}<s.icon className="h-4 w-4" /></div>
            <div className="mt-1 text-2xl font-semibold">{s.v}</div></div>
        ))}
      </div>
      {!items ? <div className="flex justify-center p-8"><Spinner /></div>
        : !pinned.length ? <Empty icon={<BarChart3 className="h-10 w-10" />} title="La dashboard è vuota" text="Carica un dataset e lancia analisi, previsioni o simulazioni: compariranno qui, su PC e su iPhone." />
        : <div className="grid gap-4 xl:grid-cols-2">{pinned.map((a) => <AnalysisCard key={a.id} a={a} projectId={project.id} onChange={() => { load(); reload() }} compact />)}</div>}
      {editing && <ProjectModal project={project} onClose={() => setEditing(false)} onSaved={() => { setEditing(false); reload() }} />}
    </div>
  )
}

/* ============================================================ ANALYSIS CARD */
function AnalysisCard({ a, projectId, onChange, compact }: { a: Analysis; projectId: number; onChange?: () => void; compact?: boolean }) {
  const [explain, setExplain] = useState(''); const [busy, setBusy] = useState(false); const [err, setErr] = useState('')
  const r = a.result
  const figs = compact ? (r.figures ?? []).slice(0, 1) : r.figures ?? []
  const doExplain = async () => {
    setBusy(true); setErr('')
    try { setExplain((await api(`/projects/${projectId}/analyses/${a.id}/explain`, { method: 'POST' })).text) } catch (e: any) { setErr(e.message) } finally { setBusy(false) }
  }
  return (
    <div className="card overflow-hidden">
      <div className="flex items-start gap-2 border-b border-slate-100 p-4 dark:border-ink-700">
        <div className="min-w-0 flex-1"><span className="chip mb-1">{KIND_LABEL[a.kind] ?? a.kind}</span><h3 className="truncate font-semibold">{a.title}</h3>
          {a.created_at && <div className="text-xs text-slate-500">{fmtDate(a.created_at)}</div>}</div>
        {a.id && <>
          <button className="btn-icon" title={a.pinned ? 'Togli dalla dashboard' : 'Metti in dashboard'} onClick={async () => { await api(`/projects/${projectId}/analyses/${a.id}?pinned=${a.pinned ? 0 : 1}`, { method: 'PATCH' }); onChange?.() }}>
            {a.pinned ? <PinOff className="h-4 w-4" /> : <Pin className="h-4 w-4" />}</button>
          <button className="btn-icon text-red-500" title="Elimina" onClick={async () => { if (confirm('Eliminare questa analisi?')) { await api(`/projects/${projectId}/analyses/${a.id}`, { method: 'DELETE' }); onChange?.() } }}><Trash2 className="h-4 w-4" /></button>
        </>}
      </div>
      {r.metrics && (
        <div className="grid grid-cols-2 gap-px bg-slate-100 dark:bg-ink-700 sm:grid-cols-3">
          {Object.entries(r.metrics).map(([k, v]) => (
            <div key={k} className="bg-white p-3 dark:bg-ink-900"><div className="truncate text-xs text-slate-500">{k.replace(/_/g, ' ')}</div><div className="truncate font-semibold">{fmtNum(v)}</div></div>
          ))}
        </div>
      )}
      <div className="p-2">{figs.map((f, i) => <Plot key={i} figure={f} />)}</div>
      {!compact && r.stats && <ScrollTable columns={Object.keys(r.stats[0] ?? {})} rows={r.stats.map((s) => Object.values(s))} />}
      {!compact && r.table && <ScrollTable columns={Object.keys(r.table[0] ?? {})} rows={r.table.map((s) => Object.values(s))} />}
      {a.id && (
        <div className="border-t border-slate-100 p-3 dark:border-ink-700">
          <ErrorBox error={err} />
          {explain ? <div className="prose-chat text-sm"><ReactMarkdown remarkPlugins={[remarkGfm]}>{explain}</ReactMarkdown></div>
            : <button className="btn-ghost" disabled={busy} onClick={doExplain}>{busy ? <Spinner /> : <Sparkles className="h-4 w-4" />}Spiegamelo con l’AI</button>}
        </div>
      )}
    </div>
  )
}

function ScrollTable({ columns, rows }: { columns: string[]; rows: any[][] }) {
  return (
    <div className="max-h-[420px] overflow-auto border-t border-slate-100 dark:border-ink-700" style={{ WebkitOverflowScrolling: 'touch' }}>
      <table className="w-full text-left text-sm">
        <thead className="sticky top-0 bg-slate-50 dark:bg-ink-800"><tr>{columns.map((c) => <th key={c} className="whitespace-nowrap px-3 py-2 font-medium">{c}</th>)}</tr></thead>
        <tbody>{rows.map((r, i) => <tr key={i} className="border-t border-slate-100 dark:border-ink-700">{r.map((v, j) => <td key={j} className="whitespace-nowrap px-3 py-1.5">{fmtNum(v)}</td>)}</tr>)}</tbody>
      </table>
    </div>
  )
}

/* ============================================================ DOCUMENTI */
export function DocumentsTab({ project, reload }: TabProps) {
  const { items, load, error, setError } = useList<Doc>(`/projects/${project.id}/documents`)
  const [busy, setBusy] = useState(false)
  const onFiles = async (f: FileList) => {
    setBusy(true); setError('')
    try { await upload(`/projects/${project.id}/documents`, f); load(); reload() } catch (e: any) { setError(e.message) } finally { setBusy(false) }
  }
  return (
    <DropZone onFiles={onFiles}>
      <div className="mx-auto max-w-5xl">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-slate-500">PDF, Word, Excel, CSV, testo e foto (anche scansioni): l’AI li legge e li usa in chat. <span className="hidden md:inline">Puoi trascinarli qui.</span></p>
          <UploadButton busy={busy} onFiles={onFiles} accept=".pdf,.doc,.docx,.xlsx,.xls,.csv,.txt,.md,image/*" label="Carica documenti" />
        </div>
        <ErrorBox error={error} onClose={() => setError('')} />
        {!items ? <div className="flex justify-center p-8"><Spinner /></div>
          : !items.length ? <Empty icon={<FileText className="h-10 w-10" />} title="Nessun documento" text="Carica file da PC o da Foto/File su iPhone." />
          : <div className="card divide-y divide-slate-100 dark:divide-ink-700">
            {items.map((d) => (
              <div key={d.id} className="flex items-center gap-3 p-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-brand-600 dark:bg-ink-800"><FileText className="h-5 w-5" /></div>
                <div className="min-w-0 flex-1"><div className="truncate font-medium">{d.filename}</div>
                  <div className="truncate text-xs text-slate-500">{fmtSize(d.size)} · {fmtDate(d.created_at)} · {d.status}</div></div>
                <button className="btn-icon" title="Scarica" onClick={() => downloadFile(`/projects/${project.id}/documents/${d.id}/file`, d.filename)}><Download className="h-4 w-4" /></button>
                <button className="btn-icon text-red-500" title="Elimina" onClick={async () => { if (confirm(`Eliminare ${d.filename}?`)) { await api(`/projects/${project.id}/documents/${d.id}`, { method: 'DELETE' }); load(); reload() } }}><Trash2 className="h-4 w-4" /></button>
              </div>
            ))}
          </div>}
      </div>
    </DropZone>
  )
}

/* ============================================================ CHAT */
export function ChatTab({ project, reload }: TabProps) {
  const { items: convs, load } = useList<Conversation>(`/projects/${project.id}/conversations`)
  const [cid, setCid] = useState<number | null>(null)
  const [msgs, setMsgs] = useState<Msg[]>([]); const [text, setText] = useState('')
  const [busy, setBusy] = useState(false); const [err, setErr] = useState('')
  const end = useRef<HTMLDivElement>(null)

  useEffect(() => { if (convs?.length && cid === null) setCid(convs[0].id) }, [convs, cid])
  useEffect(() => { if (cid) api<Msg[]>(`/projects/${project.id}/conversations/${cid}/messages`).then(setMsgs).catch(() => {}) ; else setMsgs([]) }, [cid, project.id])
  useEffect(() => { end.current?.scrollIntoView({ behavior: 'smooth' }) }, [msgs, busy])

  const newConv = async () => { const c = await api<Conversation>(`/projects/${project.id}/conversations`, { method: 'POST', json: {} }); await load(); setCid(c.id); return c.id }
  const send = async () => {
    const content = text.trim(); if (!content || busy) return
    setErr(''); setBusy(true); setText('')
    try {
      const id = cid ?? (await newConv())
      setMsgs((m) => [...m, { role: 'user', content }])
      const r = await api<Msg>(`/projects/${project.id}/conversations/${id}/messages`, { method: 'POST', json: { content } })
      setMsgs((m) => [...m, r]); load(); reload()
    } catch (e: any) { setErr(e.message); setText(content) } finally { setBusy(false) }
  }
  return (
    <div className="mx-auto flex h-[calc(100dvh-11rem-env(safe-area-inset-bottom))] max-w-6xl gap-4 md:h-[calc(100dvh-7rem)]">
      <aside className="card hidden w-64 shrink-0 flex-col overflow-hidden md:flex">
        <div className="p-3"><button className="btn-primary w-full" onClick={newConv}><Plus className="h-4 w-4" />Nuova chat</button></div>
        <div className="flex-1 overflow-y-auto px-2 pb-2">
          {convs?.map((c) => (
            <div key={c.id} className={`group flex items-center rounded-xl ${c.id === cid ? 'bg-brand-50 dark:bg-ink-800' : 'hover:bg-slate-50 dark:hover:bg-ink-800'}`}>
              <button className="min-w-0 flex-1 truncate px-3 py-2.5 text-left text-sm" onClick={() => setCid(c.id)}>{c.title}</button>
              <button className="hidden p-2 text-slate-400 hover:text-red-500 group-hover:block" onClick={async () => { await api(`/projects/${project.id}/conversations/${c.id}`, { method: 'DELETE' }); if (c.id === cid) setCid(null); load() }}><Trash2 className="h-3.5 w-3.5" /></button>
            </div>
          ))}
        </div>
      </aside>
      <section className="card flex min-w-0 flex-1 flex-col overflow-hidden">
        <div className="flex items-center gap-2 border-b border-slate-100 p-2 dark:border-ink-700 md:hidden">
          <select className="input flex-1" value={cid ?? ''} onChange={(e) => setCid(e.target.value ? Number(e.target.value) : null)}>
            <option value="">Nuova conversazione</option>{convs?.map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}
          </select>
          <button className="btn-icon" onClick={() => { setCid(null); setMsgs([]) }} aria-label="Nuova chat"><Plus className="h-5 w-5" /></button>
        </div>
        <div className="flex-1 overflow-y-auto p-3 md:p-5">
          {!msgs.length && !busy && (
            <div className="mx-auto mt-8 max-w-md text-center text-sm text-slate-500">
              <Sparkles className="mx-auto mb-2 h-8 w-8 text-brand-500" />
              Chiedi qualsiasi cosa su documenti, dataset e analisi di <b>{project.name}</b>.
              <div className="mt-4 flex flex-wrap justify-center gap-2">
                {['Riassumi i documenti caricati', 'Quali sono i rischi principali?', 'Commenta l’ultima previsione'].map((s) => (
                  <button key={s} className="chip px-3 py-1.5" onClick={() => setText(s)}>{s}</button>))}
              </div>
            </div>
          )}
          {msgs.map((m, i) => (
            <div key={i} className={`mb-3 flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div className={`max-w-[88%] rounded-2xl px-4 py-2.5 text-sm md:max-w-[75%] ${m.role === 'user' ? 'bg-brand-600 text-white' : 'bg-slate-100 dark:bg-ink-800'}`}>
                {m.role === 'user' ? <div className="whitespace-pre-wrap">{m.content}</div>
                  : <div className="prose-chat"><ReactMarkdown remarkPlugins={[remarkGfm]}>{m.content}</ReactMarkdown></div>}
                {!!m.sources?.length && (
                  <details className="mt-2 text-xs text-slate-500"><summary className="cursor-pointer">Fonti ({m.sources.length})</summary>
                    {m.sources.map((s) => <div key={s.n} className="mt-1"><b>[{s.n}] {s.filename}</b> — {s.excerpt}…</div>)}</details>
                )}
              </div>
            </div>
          ))}
          {busy && <div className="flex items-center gap-2 text-sm text-slate-500"><Spinner />L’AI sta pensando…</div>}
          <div ref={end} />
        </div>
        <div className="border-t border-slate-100 p-2 dark:border-ink-700 md:p-3">
          <ErrorBox error={err} onClose={() => setErr('')} />
          <div className="flex items-end gap-2">
            <textarea rows={1} className="input max-h-40 min-h-[44px] flex-1 resize-none py-2.5" placeholder="Scrivi un messaggio…" value={text}
              onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && window.innerWidth >= 768) { e.preventDefault(); send() } }} />
            <button className="btn-primary h-11 w-11 shrink-0 px-0" onClick={send} disabled={busy || !text.trim()} aria-label="Invia"><Send className="h-4 w-4" /></button>
          </div>
        </div>
      </section>
    </div>
  )
}

/* ============================================================ DATASET */
export function DatasetsTab({ project, reload }: TabProps) {
  const { items, load, error, setError } = useList<Dataset>(`/projects/${project.id}/datasets`)
  const [busy, setBusy] = useState(false)
  const [preview, setPreview] = useState<{ id: number; columns: string[]; rows: any[][] } | null>(null)
  const onFiles = async (f: FileList) => {
    setBusy(true); setError('')
    try { await upload(`/projects/${project.id}/datasets`, f); load(); reload() } catch (e: any) { setError(e.message) } finally { setBusy(false) }
  }
  return (
    <DropZone onFiles={onFiles}>
      <div className="mx-auto max-w-6xl">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-slate-500">Carica tabelle CSV o Excel per statistiche, Machine Learning, previsioni e simulazioni.</p>
          <UploadButton busy={busy} onFiles={onFiles} accept=".csv,.xlsx,.xls,.txt" label="Carica dataset" />
        </div>
        <ErrorBox error={error} onClose={() => setError('')} />
        {!items ? <div className="flex justify-center p-8"><Spinner /></div>
          : !items.length ? <Empty icon={<Table2 className="h-10 w-10" />} title="Nessun dataset" text="Esempio: un Excel con colonne Data e Vendite per fare una previsione." />
          : <div className="grid gap-3 md:grid-cols-2">
            {items.map((d) => (
              <div key={d.id} className="card p-4">
                <div className="flex items-start gap-2">
                  <div className="min-w-0 flex-1"><div className="truncate font-semibold">{d.name}</div><div className="text-xs text-slate-500">{d.rows.toLocaleString('it-IT')} righe · {d.columns.length} colonne · {fmtDate(d.created_at)}</div></div>
                  <button className="btn-icon text-red-500" onClick={async () => { if (confirm(`Eliminare ${d.name}?`)) { await api(`/projects/${project.id}/datasets/${d.id}`, { method: 'DELETE' }); load(); reload() } }}><Trash2 className="h-4 w-4" /></button>
                </div>
                <div className="mt-2 flex flex-wrap gap-1">{d.columns.slice(0, 12).map((c) => <span key={c.name} className="chip">{c.name}</span>)}{d.columns.length > 12 && <span className="chip">+{d.columns.length - 12}</span>}</div>
                <button className="btn-ghost mt-3 w-full" onClick={async () => setPreview(preview?.id === d.id ? null : { id: d.id, ...(await api<{ columns: string[]; rows: any[][] }>(`/projects/${project.id}/datasets/${d.id}/preview`)) })}>
                  {preview?.id === d.id ? 'Nascondi anteprima' : 'Mostra anteprima'}</button>
                {preview?.id === d.id && <div className="-mx-4 -mb-4 mt-3"><ScrollTable columns={preview.columns} rows={preview.rows} /></div>}
              </div>
            ))}
          </div>}
      </div>
    </DropZone>
  )
}

/* ============================================================ ANALISI */
export function AnalysesTab({ project, reload }: TabProps) {
  const { items: datasets } = useList<Dataset>(`/projects/${project.id}/datasets`)
  const { items: analyses, load } = useList<Analysis>(`/projects/${project.id}/analyses`)
  const [dsId, setDsId] = useState<number | ''>(''); const [kind, setKind] = useState('explore')
  const [p, setP] = useState<Record<string, any>>({ horizon: 12, n_sims: 1000, shock_pct: 0, type: 'line', algo: 'forest' })
  const [busy, setBusy] = useState(false); const [err, setErr] = useState('')
  const [result, setResult] = useState<Analysis | null>(null)
  useEffect(() => { if (datasets?.length && dsId === '') setDsId(datasets[0].id) }, [datasets, dsId])
  const ds = datasets?.find((d) => d.id === dsId)
  const cols = ds?.columns ?? []
  const numCols = cols.filter((c) => /int|float/.test(c.dtype))
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setP({ ...p, [k]: e.target.value })
  const sel = (k: string, list = cols, optional = false) => (
    <select className="input" value={p[k] ?? ''} onChange={set(k)}>
      <option value="">{optional ? '— nessuna —' : 'Scegli…'}</option>{list.map((c) => <option key={c.name} value={c.name}>{c.name}</option>)}
    </select>
  )
  const run = async () => {
    setBusy(true); setErr(''); setResult(null)
    try {
      const params = Object.fromEntries(Object.entries(p).filter(([, v]) => v !== ''))
      const r = await api<Analysis>(`/projects/${project.id}/analyses`, { method: 'POST', json: { dataset_id: dsId, kind, params } })
      setResult(r); load(); reload()
    } catch (e: any) { setErr(e.message) } finally { setBusy(false) }
  }
  if (datasets && !datasets.length) return <div className="mx-auto max-w-3xl"><Empty icon={<BarChart3 className="h-10 w-10" />} title="Serve almeno un dataset" text="Vai nella sezione Dataset e carica un CSV o un Excel." /></div>
  return (
    <div className="mx-auto max-w-7xl">
      <div className="card mb-6 p-4">
        <div className="grid gap-3 md:grid-cols-3">
          <div><label className="label">Dataset</label>
            <select className="input" value={dsId} onChange={(e) => setDsId(Number(e.target.value))}>{datasets?.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select></div>
          <div><label className="label">Tipo di analisi</label>
            <select className="input" value={kind} onChange={(e) => setKind(e.target.value)}>
              <option value="explore">Statistiche descrittive e correlazioni</option><option value="chart">Grafico personalizzato</option>
              <option value="forecast">Previsione (serie storica)</option><option value="model">Modello di Machine Learning</option>
              <option value="simulation">Simulazione Monte Carlo</option></select></div>
          {kind === 'chart' && <>
            <div><label className="label">Tipo grafico</label><select className="input" value={p.type} onChange={set('type')}>
              <option value="line">Linee</option><option value="bar">Barre</option><option value="scatter">Dispersione</option><option value="box">Box plot</option><option value="histogram">Istogramma</option></select></div>
            <div><label className="label">Asse X</label>{sel('x')}</div><div><label className="label">Asse Y</label>{sel('y', cols, true)}</div><div><label className="label">Colore per</label>{sel('color', cols, true)}</div>
          </>}
          {kind === 'forecast' && <>
            <div><label className="label">Colonna data</label>{sel('date_col')}</div><div><label className="label">Valore da prevedere</label>{sel('value_col', numCols)}</div>
            <div><label className="label">Periodi futuri</label><input className="input" type="number" min={1} max={365} value={p.horizon} onChange={set('horizon')} /></div>
            <div><label className="label">Frequenza</label><select className="input" value={p.freq ?? ''} onChange={set('freq')}>
              <option value="">Automatica</option><option value="D">Giornaliera</option><option value="W">Settimanale</option><option value="MS">Mensile</option><option value="QS">Trimestrale</option></select></div>
          </>}
          {kind === 'model' && <>
            <div><label className="label">Variabile da prevedere</label>{sel('target')}</div>
            <div><label className="label">Algoritmo</label><select className="input" value={p.algo} onChange={set('algo')}><option value="forest">Random Forest (consigliato)</option><option value="linear">Lineare / Logistica</option></select></div>
          </>}
          {kind === 'simulation' && <>
            <div><label className="label">Valore da simulare</label>{sel('value_col', numCols)}</div>
            <div><label className="label">Periodi</label><input className="input" type="number" min={1} max={240} value={p.horizon} onChange={set('horizon')} /></div>
            <div><label className="label">Numero scenari</label><input className="input" type="number" min={100} max={20000} step={100} value={p.n_sims} onChange={set('n_sims')} /></div>
            <div><label className="label">Shock iniziale %</label><input className="input" type="number" value={p.shock_pct} onChange={set('shock_pct')} /></div>
          </>}
        </div>
        <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3"><button className="btn-primary" onClick={run} disabled={busy || !dsId}>{busy ? <Spinner /> : <Wand2 className="h-4 w-4" />}Esegui sul server</button>
          <span className="text-xs text-slate-500">Il calcolo avviene sul server e il risultato viene salvato in dashboard.</span></div>
        <div className="mt-3"><ErrorBox error={err} onClose={() => setErr('')} /></div>
      </div>
      {result && <div className="mb-6"><AnalysisCard a={result} projectId={project.id} onChange={load} /></div>}
      <h2 className="mb-3 font-semibold">Storico analisi</h2>
      {!analyses ? <Spinner /> : !analyses.length ? <p className="text-sm text-slate-500">Nessuna analisi ancora.</p>
        : <div className="grid gap-4 xl:grid-cols-2">{analyses.filter((a) => a.id !== result?.id).map((a) => <AnalysisCard key={a.id} a={a} projectId={project.id} onChange={load} />)}</div>}
    </div>
  )
}

/* ============================================================ REPORT */
export function ReportsTab({ project, reload }: TabProps) {
  const { items, load, error, setError } = useList<Report>(`/projects/${project.id}/reports`)
  const [instr, setInstr] = useState(''); const [busy, setBusy] = useState(false)
  const [open, setOpen] = useState<number | null>(null)
  const gen = async () => {
    setBusy(true); setError('')
    try { const r = await api<Report>(`/projects/${project.id}/reports`, { method: 'POST', json: { instructions: instr } }); setOpen(r.id); setInstr(''); load(); reload() }
    catch (e: any) { setError(e.message) } finally { setBusy(false) }
  }
  return (
    <div className="mx-auto max-w-4xl">
      <div className="card mb-6 p-4">
        <label className="label">Istruzioni per il report (facoltative)</label>
        <textarea className="input min-h-[80px] py-2" placeholder="Es. focus su previsioni del prossimo trimestre, tono per il commercialista…" value={instr} onChange={(e) => setInstr(e.target.value)} />
        <button className="btn-primary mt-3" onClick={gen} disabled={busy}>{busy ? <Spinner /> : <Sparkles className="h-4 w-4" />}{busy ? 'Generazione…' : 'Genera report con l’AI'}</button>
      </div>
      <ErrorBox error={error} onClose={() => setError('')} />
      {!items ? <Spinner /> : !items.length ? <Empty icon={<FileBarChart className="h-10 w-10" />} title="Nessun report" text="Il report riassume documenti, dataset e analisi del progetto." />
        : items.map((r) => (
          <div key={r.id} className="card mb-3 overflow-hidden">
            <div className="flex items-center gap-2 p-4">
              <button className="min-w-0 flex-1 text-left" onClick={() => setOpen(open === r.id ? null : r.id)}><div className="truncate font-semibold">{r.title}</div><div className="text-xs text-slate-500">{fmtDate(r.created_at)}</div></button>
              <button className="btn-icon" title="Scarica HTML (stampabile in PDF)" onClick={() => downloadFile(`/projects/${project.id}/reports/${r.id}/download?format=html`, `${r.title}.html`)}><Download className="h-4 w-4" /></button>
              <button className="btn-icon text-red-500" onClick={async () => { if (confirm('Eliminare il report?')) { await api(`/projects/${project.id}/reports/${r.id}`, { method: 'DELETE' }); load() } }}><Trash2 className="h-4 w-4" /></button>
            </div>
            {open === r.id && <div className="prose-chat border-t border-slate-100 p-4 text-sm dark:border-ink-700"><ReactMarkdown remarkPlugins={[remarkGfm]}>{r.markdown}</ReactMarkdown></div>}
          </div>
        ))}
    </div>
  )
}
