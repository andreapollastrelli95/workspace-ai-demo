"""Unico punto di accesso a Gemini. La API key resta solo sul server.

Robustezza: Google ritira periodicamente i modelli. Se il modello configurato non esiste più
(errore 404 / "no longer available"), l'app interroga l'elenco dei modelli disponibili per la tua
chiave, sceglie automaticamente il Flash più recente e lo ricorda finché il server resta acceso.
"""
import logging
import re

from fastapi import HTTPException

from .config import settings

log = logging.getLogger("gemini")
_client = None
_active = {"chat": None, "embed": None}  # modelli scelti a runtime


def client():
    global _client
    if not settings.gemini_api_key:
        raise HTTPException(503, "GEMINI_API_KEY non configurata sul server")
    if _client is None:
        from google import genai

        _client = genai.Client(api_key=settings.gemini_api_key)
    return _client


def _is_model_missing(e: Exception) -> bool:
    s = str(e).lower()
    return "404" in s or "not_found" in s or "no longer available" in s or "not found" in s


def _version_key(name: str):
    nums = [float(x) for x in re.findall(r"(\d+(?:\.\d+)?)", name.split("/")[-1])[:1]] or [0.0]
    return (nums[0], "latest" in name)


def _pick_model(kind: str) -> str | None:
    """Sceglie il modello più recente disponibile per questa chiave."""
    try:
        models = list(client().models.list())
    except Exception as e:
        log.warning("Impossibile elencare i modelli: %s", e)
        return None
    cands = []
    for m in models:
        name = getattr(m, "name", "") or ""
        actions = [a.lower() for a in (getattr(m, "supported_actions", None) or [])]
        low = name.lower()
        if kind == "chat":
            if "generatecontent" not in actions or "flash" not in low:
                continue
            if any(x in low for x in ("lite", "image", "tts", "audio", "live", "thinking", "exp", "preview", "8b")):
                continue
        else:
            if "embedcontent" not in actions or "embedding" not in low:
                continue
        cands.append(name)
    if not cands and kind == "chat":  # ultima risorsa: anche preview/lite
        cands = [m.name for m in models if "flash" in (m.name or "").lower()
                 and "generatecontent" in [a.lower() for a in (m.supported_actions or [])]]
    if not cands:
        return None
    best = sorted(cands, key=_version_key, reverse=True)[0]
    log.warning("Modello Gemini %s selezionato automaticamente", best)
    return best


def chat_model() -> str:
    return _active["chat"] or settings.gemini_model


def embed_model() -> str:
    return _active["embed"] or settings.gemini_embed_model


def _with_fallback(kind: str, call):
    """Esegue la chiamata; se il modello è stato ritirato, ne sceglie un altro e riprova una volta."""
    try:
        return call(chat_model() if kind == "chat" else embed_model())
    except HTTPException:
        raise
    except Exception as e:
        if not _is_model_missing(e):
            raise
        new = _pick_model(kind)
        if not new or new in (chat_model(), embed_model()):
            raise
        _active[kind] = new
        return call(new)


def friendly(e: Exception) -> str:
    s = str(e)
    low = s.lower()
    if "429" in s or "resource_exhausted" in low or "quota" in low:
        return "Limite gratuito di Gemini raggiunto per ora: riprova tra qualche minuto."
    if "api key" in low or "permission_denied" in low or "401" in s or "403" in s:
        return "La chiave Gemini non è valida o non ha i permessi: controlla GEMINI_API_KEY su Render."
    if _is_model_missing(e):
        return "Nessun modello Gemini compatibile trovato per questa chiave."
    return f"Errore Gemini: {s[:300]}"


def generate(prompt: str, system: str = "", history: list[dict] | None = None) -> str:
    from google.genai import types

    contents = []
    for m in history or []:
        contents.append(
            types.Content(role="user" if m["role"] == "user" else "model", parts=[types.Part(text=m["content"])])
        )
    contents.append(types.Content(role="user", parts=[types.Part(text=prompt)]))
    cfg = types.GenerateContentConfig(system_instruction=system or None, temperature=0.4)
    try:
        r = _with_fallback("chat", lambda model: client().models.generate_content(model=model, contents=contents, config=cfg))
        return r.text or ""
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(502, friendly(e))


def describe_file(data: bytes, mime: str) -> str:
    """OCR / descrizione di immagini e PDF scansionati tramite Gemini (multimodale)."""
    from google.genai import types

    parts = [
        types.Part.from_bytes(data=data, mime_type=mime),
        "Trascrivi fedelmente tutto il testo presente. Se ci sono tabelle riportale in Markdown. "
        "Se è una foto senza testo, descrivila in dettaglio. Rispondi in italiano.",
    ]
    try:
        r = _with_fallback("chat", lambda model: client().models.generate_content(model=model, contents=parts))
        return r.text or ""
    except Exception as e:
        return f"[Impossibile leggere il file con Gemini: {friendly(e)}]"


def embed(texts: list[str]) -> list[list[float]] | None:
    """Embedding per pgvector. Se Gemini non è disponibile ritorna None (la ricerca userà il testo)."""
    if not settings.gemini_api_key or not texts:
        return None
    from google.genai import types

    cfg = types.EmbedContentConfig(output_dimensionality=settings.embed_dim)
    out: list[list[float]] = []
    try:
        for i in range(0, len(texts), 50):
            batch = texts[i : i + 50]
            r = _with_fallback("embed", lambda model: client().models.embed_content(model=model, contents=batch, config=cfg))
            out.extend(e.values for e in r.embeddings)
        return out
    except Exception as e:
        log.warning("Embedding non disponibile: %s", e)
        return None
