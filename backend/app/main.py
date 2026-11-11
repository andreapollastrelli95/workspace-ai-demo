import json
import os
import re

import markdown as md
from fastapi import Depends, FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import FileResponse, HTMLResponse, Response
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, EmailStr
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session, undefer

from . import analytics, gemini
from .auth import check_password, current_user, hash_password, make_token, own_project
from .config import settings
from .db import get_db, init_db
from .extract import chunk, column_info, extract_text, guess_mime, read_table
from .models import Analysis, Chunk, Conversation, Dataset, Document, Message, Project, Report, User

app = FastAPI(title="Workspace AI", version="1.0.0")
app.add_middleware(GZipMiddleware, minimum_size=1000)
app.add_middleware(
    CORSMiddleware,
    allow_origins=[o.strip() for o in settings.cors_origins.split(",")],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
def _startup():
    init_db()


@app.get("/api/health")
def health(db: Session = Depends(get_db)):
    db.execute(select(1))
    return {"ok": True, "gemini": bool(settings.gemini_api_key), "model": gemini.chat_model()}


_ai_check = {"at": 0.0, "result": None}


@app.get("/api/health/ai")
def health_ai():
    """Diagnostica: verifica che Gemini risponda (risultato in cache 10 minuti per non consumare quota)."""
    import time

    if _ai_check["result"] and time.time() - _ai_check["at"] < 600:
        return _ai_check["result"]
    try:
        txt = gemini.generate("Rispondi solo con la parola: ok")
        res = {"ok": True, "model": gemini.chat_model(), "reply": txt.strip()[:20]}
    except HTTPException as e:
        res = {"ok": False, "model": gemini.chat_model(), "error": e.detail}
    _ai_check.update(at=time.time(), result=res)
    return res


# ---------------------------------------------------------------- AUTH
class Credentials(BaseModel):
    email: EmailStr
    password: str
    name: str = ""


@app.post("/api/auth/register")
def register(c: Credentials, db: Session = Depends(get_db)):
    has_users = db.scalar(select(func.count(User.id))) > 0
    if has_users and not settings.allow_signup:
        raise HTTPException(403, "Registrazioni chiuse")
    if len(c.password) < 8:
        raise HTTPException(400, "La password deve avere almeno 8 caratteri")
    if db.scalar(select(User).where(User.email == c.email.lower())):
        raise HTTPException(400, "Email già registrata")
    u = User(email=c.email.lower(), name=c.name or c.email.split("@")[0], password_hash=hash_password(c.password))
    db.add(u)
    db.commit()
    return {"token": make_token(u.id), "user": {"id": u.id, "email": u.email, "name": u.name}}


@app.post("/api/auth/login")
def login(c: Credentials, db: Session = Depends(get_db)):
    u = db.scalar(select(User).where(User.email == c.email.lower()))
    if not u or not check_password(c.password, u.password_hash):
        raise HTTPException(401, "Email o password errati")
    return {"token": make_token(u.id), "user": {"id": u.id, "email": u.email, "name": u.name}}


@app.get("/api/auth/me")
def me(u: User = Depends(current_user)):
    return {"id": u.id, "email": u.email, "name": u.name}


# ---------------------------------------------------------------- PROGETTI
class ProjectIn(BaseModel):
    name: str
    description: str = ""
    color: str = "#6366f1"


def project_out(p: Project, db: Session):
    count = lambda m: db.scalar(select(func.count(m.id)).where(m.project_id == p.id))  # noqa: E731
    return {
        "id": p.id, "name": p.name, "description": p.description, "color": p.color,
        "created_at": p.created_at, "updated_at": p.updated_at,
        "counts": {"documents": count(Document), "datasets": count(Dataset), "analyses": count(Analysis),
                   "conversations": count(Conversation), "reports": count(Report)},
    }


@app.get("/api/projects")
def list_projects(u: User = Depends(current_user), db: Session = Depends(get_db)):
    ps = db.scalars(select(Project).where(Project.user_id == u.id).order_by(Project.updated_at.desc())).all()
    return [project_out(p, db) for p in ps]


@app.post("/api/projects")
def create_project(data: ProjectIn, u: User = Depends(current_user), db: Session = Depends(get_db)):
    p = Project(user_id=u.id, **data.model_dump())
    db.add(p)
    db.commit()
    return project_out(p, db)


@app.get("/api/projects/{pid}")
def get_project(pid: int, u: User = Depends(current_user), db: Session = Depends(get_db)):
    return project_out(own_project(pid, u, db), db)


@app.put("/api/projects/{pid}")
def update_project(pid: int, data: ProjectIn, u: User = Depends(current_user), db: Session = Depends(get_db)):
    p = own_project(pid, u, db)
    for k, v in data.model_dump().items():
        setattr(p, k, v)
    db.commit()
    return project_out(p, db)


@app.delete("/api/projects/{pid}")
def delete_project(pid: int, u: User = Depends(current_user), db: Session = Depends(get_db)):
    db.delete(own_project(pid, u, db))
    db.commit()
    return {"ok": True}


def touch(p: Project, db: Session):
    p.updated_at = func.now()
    db.commit()


# ---------------------------------------------------------------- DOCUMENTI
def read_upload(f: UploadFile) -> bytes:
    data = f.file.read()
    if len(data) > settings.max_upload_mb * 1024 * 1024:
        raise HTTPException(413, f"{f.filename}: supera {settings.max_upload_mb} MB")
    return data


@app.post("/api/projects/{pid}/documents")
def upload_documents(pid: int, files: list[UploadFile] = File(...), u: User = Depends(current_user),
                     db: Session = Depends(get_db)):
    p = own_project(pid, u, db)
    out = []
    for f in files:
        data = read_upload(f)
        mime = guess_mime(f.filename or "file", f.content_type or "")
        text = extract_text(f.filename or "file", data, mime)
        doc = Document(project_id=p.id, filename=f.filename or "file", mime=mime, size=len(data),
                       content=data, text=text, summary=text[:300])
        db.add(doc)
        db.flush()
        parts = chunk(text)
        vecs = gemini.embed(parts) or [None] * len(parts)
        for i, (t, v) in enumerate(zip(parts, vecs)):
            db.add(Chunk(document_id=doc.id, project_id=p.id, idx=i, text=t, embedding=v))
        doc.status = "indicizzato" if vecs and vecs[0] is not None else "solo testo"
        out.append({"id": doc.id, "filename": doc.filename, "chunks": len(parts), "status": doc.status})
    touch(p, db)
    return out


@app.get("/api/projects/{pid}/documents")
def list_documents(pid: int, u: User = Depends(current_user), db: Session = Depends(get_db)):
    own_project(pid, u, db)
    ds = db.scalars(select(Document).where(Document.project_id == pid).order_by(Document.created_at.desc())).all()
    return [{"id": d.id, "filename": d.filename, "mime": d.mime, "size": d.size, "summary": d.summary,
             "status": d.status, "created_at": d.created_at} for d in ds]


@app.get("/api/projects/{pid}/documents/{did}/file")
def download_document(pid: int, did: int, u: User = Depends(current_user), db: Session = Depends(get_db)):
    own_project(pid, u, db)
    d = db.scalar(select(Document).options(undefer(Document.content)).where(Document.id == did, Document.project_id == pid))
    if not d:
        raise HTTPException(404)
    return Response(d.content, media_type=d.mime,
                    headers={"Content-Disposition": f'inline; filename="{d.filename}"'})


@app.delete("/api/projects/{pid}/documents/{did}")
def delete_document(pid: int, did: int, u: User = Depends(current_user), db: Session = Depends(get_db)):
    own_project(pid, u, db)
    d = db.get(Document, did)
    if d and d.project_id == pid:
        db.delete(d)
        db.commit()
    return {"ok": True}


def search_chunks(db: Session, pid: int, query: str, k: int = 6):
    vec = gemini.embed([query])
    q = select(Chunk, Document.filename).join(Document, Document.id == Chunk.document_id).where(Chunk.project_id == pid)
    if vec:
        rows = db.execute(q.where(Chunk.embedding.is_not(None)).order_by(Chunk.embedding.cosine_distance(vec[0])).limit(k)).all()
        if rows:
            return rows
    words = [w for w in re.findall(r"\w{4,}", query.lower())][:6]
    if not words:
        return db.execute(q.limit(k)).all()
    return db.execute(q.where(or_(*[Chunk.text.ilike(f"%{w}%") for w in words])).limit(k)).all()


# ---------------------------------------------------------------- CHAT AI
class ConvIn(BaseModel):
    title: str = "Nuova conversazione"


class MsgIn(BaseModel):
    content: str


@app.get("/api/projects/{pid}/conversations")
def list_convs(pid: int, u: User = Depends(current_user), db: Session = Depends(get_db)):
    own_project(pid, u, db)
    cs = db.scalars(select(Conversation).where(Conversation.project_id == pid).order_by(Conversation.updated_at.desc())).all()
    return [{"id": c.id, "title": c.title, "updated_at": c.updated_at} for c in cs]


@app.post("/api/projects/{pid}/conversations")
def create_conv(pid: int, data: ConvIn, u: User = Depends(current_user), db: Session = Depends(get_db)):
    own_project(pid, u, db)
    c = Conversation(project_id=pid, title=data.title)
    db.add(c)
    db.commit()
    return {"id": c.id, "title": c.title, "updated_at": c.updated_at}


@app.delete("/api/projects/{pid}/conversations/{cid}")
def delete_conv(pid: int, cid: int, u: User = Depends(current_user), db: Session = Depends(get_db)):
    own_project(pid, u, db)
    c = db.get(Conversation, cid)
    if c and c.project_id == pid:
        db.delete(c)
        db.commit()
    return {"ok": True}


@app.get("/api/projects/{pid}/conversations/{cid}/messages")
def get_messages(pid: int, cid: int, u: User = Depends(current_user), db: Session = Depends(get_db)):
    own_project(pid, u, db)
    ms = db.scalars(select(Message).where(Message.conversation_id == cid).order_by(Message.id)).all()
    return [{"id": m.id, "role": m.role, "content": m.content, "sources": m.sources, "created_at": m.created_at} for m in ms]


def project_context(db: Session, pid: int) -> str:
    dss = db.scalars(select(Dataset).where(Dataset.project_id == pid)).all()
    ans = db.scalars(select(Analysis).where(Analysis.project_id == pid).order_by(Analysis.created_at.desc()).limit(8)).all()
    lines = [f"- Dataset '{d.name}': {d.rows} righe, colonne {[c['name'] for c in d.columns][:30]}" for d in dss]
    lines += [f"- Analisi '{a.title}' ({a.kind}): {json.dumps(a.result.get('metrics', {}), ensure_ascii=False)[:600]}" for a in ans]
    return "\n".join(lines)


@app.post("/api/projects/{pid}/conversations/{cid}/messages")
def send_message(pid: int, cid: int, data: MsgIn, u: User = Depends(current_user), db: Session = Depends(get_db)):
    p = own_project(pid, u, db)
    conv = db.get(Conversation, cid)
    if not conv or conv.project_id != pid:
        raise HTTPException(404)
    history = db.scalars(select(Message).where(Message.conversation_id == cid).order_by(Message.id.desc()).limit(10)).all()[::-1]
    db.add(Message(conversation_id=cid, role="user", content=data.content))

    hits = search_chunks(db, pid, data.content)
    docs_ctx = "\n\n".join(f"[{i + 1}] ({fn}) {c.text}" for i, (c, fn) in enumerate(hits))
    system = (
        f"Sei l'assistente analitico del progetto '{p.name}'. {p.description}\n"
        "Rispondi in italiano, in modo chiaro e pratico. Usa i documenti forniti e cita le fonti come [1], [2]. "
        "Se un'informazione non è nei documenti dillo esplicitamente. Per numeri e analisi usa i dati del progetto.\n\n"
        f"DATI E ANALISI DEL PROGETTO:\n{project_context(db, pid) or 'nessuno'}\n\n"
        f"ESTRATTI DAI DOCUMENTI:\n{docs_ctx or 'nessun documento caricato'}"
    )
    answer = gemini.generate(data.content, system=system,
                             history=[{"role": m.role, "content": m.content} for m in history])
    sources = [{"n": i + 1, "document_id": c.document_id, "filename": fn, "excerpt": c.text[:200]} for i, (c, fn) in enumerate(hits)]
    msg = Message(conversation_id=cid, role="assistant", content=answer, sources=sources)
    db.add(msg)
    if conv.title == "Nuova conversazione":
        conv.title = data.content[:60]
    conv.updated_at = func.now()
    touch(p, db)
    return {"id": msg.id, "role": "assistant", "content": answer, "sources": sources}


# ---------------------------------------------------------------- DATASET
def dataset_df(db: Session, pid: int, did: int):
    d = db.scalar(select(Dataset).options(undefer(Dataset.content)).where(Dataset.id == did, Dataset.project_id == pid))
    if not d:
        raise HTTPException(404, "Dataset non trovato")
    return d, read_table(d.filename, d.content)


@app.post("/api/projects/{pid}/datasets")
def upload_datasets(pid: int, files: list[UploadFile] = File(...), u: User = Depends(current_user),
                    db: Session = Depends(get_db)):
    p = own_project(pid, u, db)
    out = []
    for f in files:
        data = read_upload(f)
        try:
            df = read_table(f.filename or "dati.csv", data)
        except Exception as e:
            raise HTTPException(400, f"{f.filename}: file non leggibile come tabella ({e})")
        if df.empty or df.shape[1] == 0:
            raise HTTPException(400, f"{f.filename}: nessuna tabella trovata nel file")
        cols = column_info(df)
        cols[0]["v"] = 2
        d = Dataset(project_id=p.id, name=(f.filename or "dati").rsplit(".", 1)[0], filename=f.filename or "dati.csv",
                    content=data, rows=len(df), columns=cols)
        db.add(d)
        db.flush()
        out.append({"id": d.id, "name": d.name, "rows": d.rows, "columns": cols})
    touch(p, db)
    return out


@app.get("/api/projects/{pid}/datasets")
def list_datasets(pid: int, u: User = Depends(current_user), db: Session = Depends(get_db)):
    own_project(pid, u, db)
    ds = db.scalars(select(Dataset).where(Dataset.project_id == pid).order_by(Dataset.created_at.desc())).all()
    changed = False
    for d in ds:
        if not any(c.get("v") == 2 for c in d.columns[:1]):
            try:
                _, df = dataset_df(db, pid, d.id)
                cols = column_info(df)
                if cols:
                    cols[0]["v"] = 2
                d.columns, d.rows, changed = cols, len(df), True
            except Exception:
                pass
    if changed:
        db.commit()
    return [{"id": d.id, "name": d.name, "filename": d.filename, "rows": d.rows, "columns": d.columns,
             "created_at": d.created_at} for d in ds]


@app.get("/api/projects/{pid}/datasets/{did}/preview")
def preview_dataset(pid: int, did: int, limit: int = 200, u: User = Depends(current_user), db: Session = Depends(get_db)):
    own_project(pid, u, db)
    _, df = dataset_df(db, pid, did)
    return analytics.clean({"columns": [str(c) for c in df.columns],
                            "rows": df.head(limit).astype(object).where(df.head(limit).notna(), None).values.tolist()})


@app.delete("/api/projects/{pid}/datasets/{did}")
def delete_dataset(pid: int, did: int, u: User = Depends(current_user), db: Session = Depends(get_db)):
    own_project(pid, u, db)
    d = db.get(Dataset, did)
    if d and d.project_id == pid:
        db.delete(d)
        db.commit()
    return {"ok": True}


# ---------------------------------------------------------------- ANALISI / ML / PREVISIONI / SIMULAZIONI
class AnalysisIn(BaseModel):
    dataset_id: int
    kind: str  # explore | chart | forecast | model | simulation
    title: str = ""
    params: dict = {}
    save: bool = True


@app.post("/api/projects/{pid}/analyses")
def run_analysis(pid: int, a: AnalysisIn, u: User = Depends(current_user), db: Session = Depends(get_db)):
    p = own_project(pid, u, db)
    ds, df = dataset_df(db, pid, a.dataset_id)
    pr = a.params
    try:
        if a.kind == "explore":
            res, title = analytics.profile(df), f"Esplorazione di {ds.name}"
        elif a.kind == "chart":
            res = analytics.chart(df, pr.get("type", "line"), pr["x"], pr.get("y"), pr.get("color"))
            title = f"Grafico {pr.get('y') or ''} per {pr['x']}"
        elif a.kind == "forecast":
            res = analytics.forecast(df, pr["date_col"], pr["value_col"], int(pr.get("horizon", 12)), pr.get("freq"))
            title = f"Previsione {pr['value_col']}"
        elif a.kind == "model":
            res = analytics.train_model(df, pr["target"], pr.get("features"), pr.get("algo", "forest"))
            title = f"Modello ML su {pr['target']}"
        elif a.kind == "simulation":
            res = analytics.simulate(df, pr["value_col"], int(pr.get("horizon", 12)), int(pr.get("n_sims", 1000)),
                                     float(pr.get("shock_pct", 0)))
            title = f"Simulazione Monte Carlo {pr['value_col']}"
        else:
            raise HTTPException(400, "Tipo di analisi non valido")
    except KeyError as e:
        raise HTTPException(400, f"Parametro mancante: {e}")
    except (ValueError, TypeError) as e:
        raise HTTPException(400, f"Analisi non eseguibile su questi dati: {e}")
    item = Analysis(project_id=p.id, dataset_id=ds.id, kind=a.kind, title=a.title or title, params=pr, result=res)
    if a.save:
        db.add(item)
        touch(p, db)
    return {"id": item.id, "kind": a.kind, "title": item.title, "params": pr, "result": res,
            "created_at": item.created_at, "pinned": 1}


@app.get("/api/projects/{pid}/analyses")
def list_analyses(pid: int, u: User = Depends(current_user), db: Session = Depends(get_db)):
    own_project(pid, u, db)
    xs = db.scalars(select(Analysis).where(Analysis.project_id == pid).order_by(Analysis.created_at.desc())).all()
    return [{"id": x.id, "kind": x.kind, "title": x.title, "params": x.params, "result": x.result,
             "pinned": x.pinned, "dataset_id": x.dataset_id, "created_at": x.created_at} for x in xs]


@app.patch("/api/projects/{pid}/analyses/{aid}")
def pin_analysis(pid: int, aid: int, pinned: int = 1, u: User = Depends(current_user), db: Session = Depends(get_db)):
    own_project(pid, u, db)
    x = db.get(Analysis, aid)
    if x and x.project_id == pid:
        x.pinned = pinned
        db.commit()
    return {"ok": True}


@app.delete("/api/projects/{pid}/analyses/{aid}")
def delete_analysis(pid: int, aid: int, u: User = Depends(current_user), db: Session = Depends(get_db)):
    own_project(pid, u, db)
    x = db.get(Analysis, aid)
    if x and x.project_id == pid:
        db.delete(x)
        db.commit()
    return {"ok": True}


@app.post("/api/projects/{pid}/analyses/{aid}/explain")
def explain_analysis(pid: int, aid: int, u: User = Depends(current_user), db: Session = Depends(get_db)):
    own_project(pid, u, db)
    x = db.get(Analysis, aid)
    if not x or x.project_id != pid:
        raise HTTPException(404)
    payload = {k: v for k, v in x.result.items() if k != "figures"}
    text = gemini.generate(
        f"Spiega in italiano semplice i risultati di questa analisi ({x.kind}) intitolata '{x.title}', "
        f"con 3-5 punti chiave, limiti e prossimi passi consigliati:\n{json.dumps(payload, ensure_ascii=False)[:6000]}")
    return {"text": text}


# ---------------------------------------------------------------- REPORT
class ReportIn(BaseModel):
    title: str = ""
    instructions: str = ""


@app.post("/api/projects/{pid}/reports")
def create_report(pid: int, r: ReportIn, u: User = Depends(current_user), db: Session = Depends(get_db)):
    p = own_project(pid, u, db)
    docs = db.scalars(select(Document).where(Document.project_id == pid).limit(20)).all()
    ctx = project_context(db, pid)
    doc_lines = "\n".join(f"- {d.filename}: {d.summary[:250]}" for d in docs)
    text = gemini.generate(
        f"Scrivi un report professionale in Markdown per il progetto '{p.name}' ({p.description}). "
        f"Struttura: Sintesi, Dati e documenti, Analisi e previsioni, Rischi, Raccomandazioni. "
        f"Istruzioni aggiuntive: {r.instructions or 'nessuna'}\n\nDOCUMENTI:\n{doc_lines or 'nessuno'}\n\nANALISI:\n{ctx or 'nessuna'}",
        system="Sei un analista senior. Scrivi in italiano, conciso, con numeri concreti tratti dai dati forniti; non inventare dati.",
    )
    rep = Report(project_id=pid, title=r.title or f"Report {p.name}", markdown=text)
    db.add(rep)
    touch(p, db)
    return {"id": rep.id, "title": rep.title, "markdown": rep.markdown, "created_at": rep.created_at}


@app.get("/api/projects/{pid}/reports")
def list_reports(pid: int, u: User = Depends(current_user), db: Session = Depends(get_db)):
    own_project(pid, u, db)
    rs = db.scalars(select(Report).where(Report.project_id == pid).order_by(Report.created_at.desc())).all()
    return [{"id": r.id, "title": r.title, "markdown": r.markdown, "created_at": r.created_at} for r in rs]


@app.get("/api/projects/{pid}/reports/{rid}/download")
def download_report(pid: int, rid: int, format: str = "html", u: User = Depends(current_user), db: Session = Depends(get_db)):
    own_project(pid, u, db)
    r = db.get(Report, rid)
    if not r or r.project_id != pid:
        raise HTTPException(404)
    safe = re.sub(r"[^\w\-]+", "_", r.title)
    if format == "md":
        return Response(r.markdown, media_type="text/markdown",
                        headers={"Content-Disposition": f'attachment; filename="{safe}.md"'})
    body = md.markdown(r.markdown, extensions=["tables"])
    html = (f"<!doctype html><html lang='it'><meta charset='utf-8'><title>{r.title}</title>"
            "<style>body{font-family:system-ui;max-width:800px;margin:40px auto;padding:0 16px;line-height:1.6}"
            "table{border-collapse:collapse}td,th{border:1px solid #ccc;padding:4px 8px}</style>"
            f"<body>{body}</body></html>")
    return HTMLResponse(html, headers={"Content-Disposition": f'attachment; filename="{safe}.html"'})


@app.delete("/api/projects/{pid}/reports/{rid}")
def delete_report(pid: int, rid: int, u: User = Depends(current_user), db: Session = Depends(get_db)):
    own_project(pid, u, db)
    r = db.get(Report, rid)
    if r and r.project_id == pid:
        db.delete(r)
        db.commit()
    return {"ok": True}


# ---------------------------------------------------------------- FRONTEND (PWA) servito dallo stesso server
if os.path.isdir(settings.static_dir):
    app.mount("/assets", StaticFiles(directory=os.path.join(settings.static_dir, "assets")), name="assets")

    @app.get("/{path:path}", include_in_schema=False)
    def spa(path: str):
        if path.startswith("api/"):
            raise HTTPException(404)
        f = os.path.join(settings.static_dir, path)
        if path and os.path.isfile(f):
            headers = {"Cache-Control": "no-cache"} if path in ("sw.js", "manifest.webmanifest", "registerSW.js") else {}
            return FileResponse(f, headers=headers)
        return FileResponse(os.path.join(settings.static_dir, "index.html"), headers={"Cache-Control": "no-cache"})
