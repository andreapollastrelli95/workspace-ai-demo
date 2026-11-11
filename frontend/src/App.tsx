import { useCallback, useEffect, useState } from 'react'
import { Link, NavLink, Navigate, Route, Routes, useNavigate, useParams } from 'react-router-dom'
import {
  BarChart3, FileText, FolderKanban, LayoutDashboard, LogOut, Menu, MessageSquare, Plus, Sparkles, Table2, X, FileBarChart,
} from 'lucide-react'
import { api, auth, Project } from './api'
import { ErrorBox, Spinner, SystemBanners } from './components/ui'
import { AnalysesTab, ChatTab, DashboardTab, DatasetsTab, DocumentsTab, ReportsTab } from './pages/ProjectTabs'

export const TABS = [
  { key: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { key: 'chat', label: 'Chat AI', icon: MessageSquare },
  { key: 'documenti', label: 'Documenti', icon: FileText },
  { key: 'dati', label: 'Dataset', icon: Table2 },
  { key: 'analisi', label: 'Analisi', icon: BarChart3 },
  { key: 'report', label: 'Report', icon: FileBarChart },
] as const

export default function App() {
  const [logged, setLogged] = useState(!!auth.token())
  useEffect(() => {
    const out = () => setLogged(false)
    window.addEventListener('wa-logout', out)
    return () => window.removeEventListener('wa-logout', out)
  }, [])
  if (!logged) return <><Login onDone={() => setLogged(true)} /><SystemBanners /></>
  return (
    <>
      <Routes>
        <Route path="/" element={<Shell />} />
        <Route path="/p/:pid/:tab?" element={<Shell />} />
        <Route path="*" element={<Navigate to="/" />} />
      </Routes>
      <SystemBanners />
    </>
  )
}

function Logo() {
  return (
    <div className="flex items-center gap-2">
      <img src="/icons/icon-192.png" alt="" className="h-8 w-8 rounded-lg" />
      <span className="font-semibold tracking-tight">Workspace AI</span>
    </div>
  )
}

function Login({ onDone }: { onDone: () => void }) {
  const [mode, setMode] = useState<'login' | 'register'>('login')
  const [email, setEmail] = useState(''); const [password, setPassword] = useState(''); const [name, setName] = useState('')
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false)
  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true); setErr('')
    try {
      const r = await api(`/auth/${mode}`, { method: 'POST', json: { email, password, name } })
      auth.set(r.token); onDone()
    } catch (x: any) { setErr(x.message) } finally { setBusy(false) }
  }
  return (
    <div className="safe-top flex min-h-full items-center justify-center bg-gradient-to-br from-ink-950 via-ink-900 to-brand-700 p-4">
      <form onSubmit={submit} className="card w-full max-w-sm p-6">
        <div className="mb-6"><Logo /><p className="mt-2 text-sm text-slate-500">Lo stesso spazio di lavoro su PC e iPhone.</p></div>
        <ErrorBox error={err} />
        {mode === 'register' && (<div className="mb-3"><label className="label">Nome</label><input className="input" value={name} onChange={(e) => setName(e.target.value)} /></div>)}
        <div className="mb-3"><label className="label">Email</label><input className="input" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} /></div>
        <div className="mb-5"><label className="label">Password</label><input className="input" type="password" minLength={8} required autoComplete={mode === 'login' ? 'current-password' : 'new-password'} value={password} onChange={(e) => setPassword(e.target.value)} /></div>
        <button className="btn-primary w-full" disabled={busy}>{busy && <Spinner />}{mode === 'login' ? 'Accedi' : 'Crea account'}</button>
        <button type="button" className="mt-3 w-full text-sm text-brand-600 dark:text-brand-400" onClick={() => setMode(mode === 'login' ? 'register' : 'login')}>
          {mode === 'login' ? 'Primo accesso? Crea l’account' : 'Hai già un account? Accedi'}
        </button>
      </form>
    </div>
  )
}

function Shell() {
  const { pid, tab = 'dashboard' } = useParams()
  const nav = useNavigate()
  const [projects, setProjects] = useState<Project[] | null>(null)
  const [drawer, setDrawer] = useState(false)
  const [creating, setCreating] = useState(false)
  const load = useCallback(() => api<Project[]>('/projects').then(setProjects).catch(() => setProjects([])), [])
  useEffect(() => { load() }, [load])
  // sincronizzazione: ricarica quando l'app torna in primo piano (es. dopo aver lavorato dall'altro dispositivo)
  useEffect(() => {
    const f = () => document.visibilityState === 'visible' && load()
    document.addEventListener('visibilitychange', f)
    return () => document.removeEventListener('visibilitychange', f)
  }, [load])
  useEffect(() => setDrawer(false), [pid, tab])
  const current = projects?.find((p) => String(p.id) === pid)

  const sidebar = (
    <nav className="flex h-full flex-col gap-1 p-3">
      <div className="mb-3 flex items-center justify-between px-2 pt-1"><Link to="/"><Logo /></Link>
        <button className="btn-icon md:hidden" onClick={() => setDrawer(false)} aria-label="Chiudi menu"><X className="h-5 w-5" /></button></div>
      <NavLink to="/" end className={({ isActive }) => `flex min-h-[44px] items-center gap-3 rounded-xl px-3 text-sm ${isActive ? 'bg-brand-50 font-medium text-brand-700 dark:bg-ink-800 dark:text-brand-400' : 'hover:bg-slate-100 dark:hover:bg-ink-800'}`}>
        <FolderKanban className="h-4 w-4" /> Tutti i progetti</NavLink>
      {current && (
        <div className="mt-4">
          <div className="label px-3">{current.name}</div>
          {TABS.map((t) => (
            <NavLink key={t.key} to={`/p/${current.id}/${t.key}`} className={() => `flex min-h-[44px] items-center gap-3 rounded-xl px-3 text-sm ${tab === t.key ? 'bg-brand-50 font-medium text-brand-700 dark:bg-ink-800 dark:text-brand-400' : 'hover:bg-slate-100 dark:hover:bg-ink-800'}`}>
              <t.icon className="h-4 w-4" />{t.label}</NavLink>
          ))}
        </div>
      )}
      <div className="mt-4 flex-1 overflow-y-auto">
        <div className="label px-3">Progetti</div>
        {projects?.map((p) => (
          <Link key={p.id} to={`/p/${p.id}/dashboard`} className={`flex min-h-[40px] items-center gap-3 truncate rounded-xl px-3 text-sm hover:bg-slate-100 dark:hover:bg-ink-800 ${String(p.id) === pid ? 'font-medium' : 'text-slate-600 dark:text-slate-400'}`}>
            <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: p.color }} /><span className="truncate">{p.name}</span></Link>
        ))}
      </div>
      <button className="btn-ghost mt-2" onClick={() => { auth.set(null); window.dispatchEvent(new Event('wa-logout')) }}><LogOut className="h-4 w-4" />Esci</button>
    </nav>
  )

  return (
    <div className="flex h-full">
      {/* Sidebar desktop */}
      <aside className="hidden w-64 shrink-0 border-r border-slate-200 bg-white dark:border-ink-700 dark:bg-ink-900 md:block">{sidebar}</aside>
      {/* Drawer mobile */}
      {drawer && (
        <div className="fixed inset-0 z-40 md:hidden" onClick={() => setDrawer(false)}>
          <div className="absolute inset-0 bg-black/40" />
          <aside className="safe-top safe-bottom absolute inset-y-0 left-0 w-72 bg-white shadow-xl dark:bg-ink-900" onClick={(e) => e.stopPropagation()}>{sidebar}</aside>
        </div>
      )}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="safe-top sticky top-0 z-30 border-b border-slate-200 bg-white/85 backdrop-blur dark:border-ink-700 dark:bg-ink-950/85">
          <div className="flex h-14 items-center gap-2 px-2 md:px-6">
            <button className="btn-icon md:hidden" onClick={() => setDrawer(true)} aria-label="Menu"><Menu className="h-5 w-5" /></button>
            <h1 className="truncate text-base font-semibold md:text-lg">{current ? current.name : 'Progetti'}</h1>
            <div className="flex-1" />
            {!current && <button className="btn-primary" onClick={() => setCreating(true)}><Plus className="h-4 w-4" /><span className="hidden sm:inline">Nuovo progetto</span></button>}
          </div>
        </header>
        <main className="flex-1 overflow-y-auto px-3 pb-28 pt-4 md:px-6 md:pb-8">
          {!pid ? <ProjectList projects={projects} onNew={() => setCreating(true)} />
            : !projects ? <div className="flex justify-center p-10"><Spinner /></div>
            : !current ? <Navigate to="/" />
            : <ProjectBody project={current} tab={tab} reload={load} onDeleted={() => { load(); nav('/') }} />}
        </main>
        {/* Tab bar mobile */}
        {current && (
          <nav className="safe-bottom fixed inset-x-0 bottom-0 z-30 border-t border-slate-200 bg-white/95 backdrop-blur dark:border-ink-700 dark:bg-ink-900/95 md:hidden">
            <div className="grid grid-cols-6">
              {TABS.map((t) => (
                <Link key={t.key} to={`/p/${current.id}/${t.key}`} className={`flex min-h-[56px] flex-col items-center justify-center gap-0.5 text-[10px] ${tab === t.key ? 'text-brand-600 dark:text-brand-400' : 'text-slate-500'}`}>
                  <t.icon className="h-5 w-5" />{t.label.replace(' AI', '')}</Link>
              ))}
            </div>
          </nav>
        )}
      </div>
      {creating && <ProjectModal onClose={() => setCreating(false)} onSaved={(p) => { setCreating(false); load(); nav(`/p/${p.id}/dashboard`) }} />}
    </div>
  )
}

const COLORS = ['#6366f1', '#0ea5e9', '#10b981', '#f59e0b', '#ef4444', '#a855f7', '#64748b']

export function ProjectModal({ project, onClose, onSaved }: { project?: Project; onClose: () => void; onSaved: (p: Project) => void }) {
  const [name, setName] = useState(project?.name ?? ''); const [description, setDesc] = useState(project?.description ?? '')
  const [color, setColor] = useState(project?.color ?? COLORS[0]); const [err, setErr] = useState('')
  const save = async (e: React.FormEvent) => {
    e.preventDefault()
    try {
      const p = await api<Project>(project ? `/projects/${project.id}` : '/projects', { method: project ? 'PUT' : 'POST', json: { name, description, color } })
      onSaved(p)
    } catch (x: any) { setErr(x.message) }
  }
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 md:items-center" onClick={onClose}>
      <form onSubmit={save} onClick={(e) => e.stopPropagation()} className="card safe-bottom w-full max-w-md rounded-b-none p-5 md:rounded-2xl">
        <h2 className="mb-4 text-lg font-semibold">{project ? 'Modifica progetto' : 'Nuovo progetto'}</h2>
        <ErrorBox error={err} />
        <label className="label">Nome</label><input className="input mb-3" required autoFocus value={name} onChange={(e) => setName(e.target.value)} />
        <label className="label">Descrizione (aiuta l’AI a capire il contesto)</label>
        <textarea className="input mb-3 min-h-[90px] py-2" value={description} onChange={(e) => setDesc(e.target.value)} />
        <label className="label">Colore</label>
        <div className="mb-5 flex gap-2">{COLORS.map((c) => (
          <button type="button" key={c} onClick={() => setColor(c)} className={`h-9 w-9 rounded-full ${color === c ? 'ring-2 ring-offset-2 ring-slate-400 dark:ring-offset-ink-900' : ''}`} style={{ background: c }} aria-label={c} />))}</div>
        <div className="flex gap-2"><button type="button" className="btn-ghost flex-1" onClick={onClose}>Annulla</button><button className="btn-primary flex-1">Salva</button></div>
      </form>
    </div>
  )
}

function ProjectList({ projects, onNew }: { projects: Project[] | null; onNew: () => void }) {
  if (!projects) return <div className="flex justify-center p-10"><Spinner /></div>
  if (!projects.length) return (
    <div className="mx-auto mt-10 max-w-md text-center">
      <Sparkles className="mx-auto mb-3 h-10 w-10 text-brand-500" />
      <h2 className="text-xl font-semibold">Crea il tuo primo progetto</h2>
      <p className="mt-2 text-sm text-slate-500">Un progetto raccoglie documenti, dataset, conversazioni con l’AI, analisi, previsioni e report.</p>
      <button className="btn-primary mt-5" onClick={onNew}><Plus className="h-4 w-4" />Nuovo progetto</button>
    </div>
  )
  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {projects.map((p) => (
        <Link key={p.id} to={`/p/${p.id}/dashboard`} className="card group p-4 transition hover:shadow-md">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl text-white" style={{ background: p.color }}><FolderKanban className="h-5 w-5" /></div>
            <div className="min-w-0"><div className="truncate font-semibold">{p.name}</div><div className="truncate text-sm text-slate-500">{p.description || 'Nessuna descrizione'}</div></div>
          </div>
          <div className="mt-4 flex flex-wrap gap-1.5">
            <span className="chip">{p.counts.documents} documenti</span><span className="chip">{p.counts.datasets} dataset</span>
            <span className="chip">{p.counts.analyses} analisi</span><span className="chip">{p.counts.conversations} chat</span>
          </div>
        </Link>
      ))}
    </div>
  )
}

function ProjectBody({ project, tab, reload, onDeleted }: { project: Project; tab: string; reload: () => void; onDeleted: () => void }) {
  const props = { project, reload }
  switch (tab) {
    case 'chat': return <ChatTab {...props} />
    case 'documenti': return <DocumentsTab {...props} />
    case 'dati': return <DatasetsTab {...props} />
    case 'analisi': return <AnalysesTab {...props} />
    case 'report': return <ReportsTab {...props} />
    default: return <DashboardTab {...props} onDeleted={onDeleted} />
  }
}
