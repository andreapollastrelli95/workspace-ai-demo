"""Estrazione testo da documenti di vario formato."""
import io
import re

import pandas as pd

from . import gemini

IMAGE_EXT = {"jpg", "jpeg", "png", "webp", "heic", "heif", "gif"}


def ext_of(name: str) -> str:
    return name.rsplit(".", 1)[-1].lower() if "." in name else ""


def guess_mime(name: str, mime: str) -> str:
    e = ext_of(name)
    table = {"heic": "image/heic", "heif": "image/heif", "jpg": "image/jpeg", "jpeg": "image/jpeg",
             "png": "image/png", "webp": "image/webp", "pdf": "application/pdf"}
    return table.get(e, mime or "application/octet-stream")


def extract_text(name: str, data: bytes, mime: str) -> str:
    e = ext_of(name)
    try:
        if e == "pdf":
            from pypdf import PdfReader

            reader = PdfReader(io.BytesIO(data))
            txt = "\n\n".join((p.extract_text() or "") for p in reader.pages)
            if len(txt.strip()) < 50:  # PDF scansionato → OCR con Gemini
                txt = gemini.describe_file(data, "application/pdf")
            return txt
        if e == "docx":
            from docx import Document

            d = Document(io.BytesIO(data))
            parts = [p.text for p in d.paragraphs]
            for t in d.tables:
                for row in t.rows:
                    parts.append(" | ".join(c.text for c in row.cells))
            return "\n".join(parts)
        if e in ("xlsx", "xls"):
            sheets = pd.read_excel(io.BytesIO(data), sheet_name=None)
            return "\n\n".join(f"## Foglio {n}\n{df.head(500).to_csv(index=False)}" for n, df in sheets.items())
        if e == "csv":
            return pd.read_csv(io.BytesIO(data), sep=None, engine="python").head(1000).to_csv(index=False)
        if e in IMAGE_EXT or mime.startswith("image/"):
            return gemini.describe_file(data, guess_mime(name, mime))
        return data.decode("utf-8", errors="ignore")
    except Exception as ex:
        return f"[Errore estrazione: {ex}]"


def chunk(text: str, size: int = 1500, overlap: int = 200) -> list[str]:
    text = text.strip()
    if not text:
        return []
    out, i = [], 0
    while i < len(text):
        out.append(text[i : i + size])
        i += size - overlap
    return out


_DATE_RE = re.compile(r"^\d{1,4}[./-]\d{1,2}[./-]\d{1,4}")
_NUM_CLEAN_RE = re.compile(r"[€$£\s ]|eur|euro", re.I)


def _to_number(v):
    """Converte '-1.234,56 €', '1,234.56', '(12,50)', '+300' in float. None se non è un numero."""
    if v is None or (isinstance(v, float) and pd.isna(v)):
        return None
    if isinstance(v, (int, float)):
        return float(v)
    s = _NUM_CLEAN_RE.sub("", str(v)).strip()
    if not s:
        return None
    neg = s.startswith("(") and s.endswith(")")
    s = s.strip("()")
    if s.endswith("-"):  # formato contabile '123,45-'
        s, neg = s[:-1], True
    if "," in s and "." in s:
        s = s.replace(".", "").replace(",", ".") if s.rfind(",") > s.rfind(".") else s.replace(",", "")
    elif "," in s:
        s = s.replace(",", ".") if re.fullmatch(r"[+-]?\d+,\d{1,2}", s) or s.count(",") == 1 and len(s.split(",")[1]) != 3 else s.replace(",", "")
    elif s.count(".") > 1 or re.fullmatch(r"[+-]?\d{1,3}(\.\d{3})+", s):
        s = s.replace(".", "")  # 1.234.567 = migliaia italiane
    try:
        x = float(s)
    except ValueError:
        return None
    return -x if neg else x


def _find_header_row(raw: pd.DataFrame) -> int:
    """Gli estratti conto hanno spesso righe di intestazione (banca, IBAN, periodo) sopra la tabella:
    trova la prima riga che sembra una riga di titoli di colonna."""
    filled = raw.notna().sum(axis=1)
    if filled.empty:
        return 0
    width = filled.max()
    for i in range(min(len(raw), 40)):
        row = raw.iloc[i]
        vals = [v for v in row if pd.notna(v)]
        if len(vals) >= max(2, 0.6 * width):
            texts = sum(isinstance(v, str) and _to_number(v) is None for v in vals)
            if texts >= 0.6 * len(vals):
                return i
    return 0


def clean_table(df: pd.DataFrame) -> pd.DataFrame:
    df = df.dropna(how="all").dropna(axis=1, how="all")
    cols, seen = [], {}
    for i, c in enumerate(df.columns):
        name = str(c).strip()
        if not name or name.lower().startswith("unnamed") or name == "nan":
            name = f"colonna_{i + 1}"
        if name in seen:
            seen[name] += 1
            name = f"{name}_{seen[name]}"
        else:
            seen[name] = 0
        cols.append(name)
    df.columns = cols
    for c in df.columns:
        s = df[c]
        if s.dtype != object:
            continue
        nonnull = s.dropna().astype(str).str.strip()
        nonnull = nonnull[nonnull != ""]
        if nonnull.empty:
            continue
        if nonnull.str.match(_DATE_RE).mean() >= 0.8:
            d = pd.to_datetime(s, errors="coerce", dayfirst=True)
            if d.notna().sum() >= 0.8 * len(nonnull):
                df[c] = d
                continue
        nums = s.map(_to_number)
        if nums.notna().sum() >= 0.8 * len(nonnull):
            df[c] = pd.to_numeric(nums, errors="coerce")
    return df.reset_index(drop=True)


def read_table(name: str, data: bytes) -> pd.DataFrame:
    if ext_of(name) in ("xlsx", "xls"):
        raw = pd.read_excel(io.BytesIO(data), header=None)
        h = _find_header_row(raw)
        df = raw.iloc[h + 1 :].copy()
        df.columns = raw.iloc[h].tolist()
    else:
        try:
            text = data.decode("utf-8-sig")
        except UnicodeDecodeError:
            text = data.decode("latin-1")  # export bancari spesso in Windows-1252
        lines = [ln for ln in text.splitlines() if ln.strip()]
        sample = lines[:200]
        sep = max([";", ",", "\t", "|"], key=lambda d: sum(ln.count(d) for ln in sample))
        counts = [ln.count(sep) for ln in sample]
        modal = max(set(counts), key=counts.count) if counts else 0
        start = next((i for i, n in enumerate(counts) if n == modal and n > 0), 0)  # salta righe introduttive
        raw = pd.read_csv(io.StringIO("\n".join(lines[start:])), sep=sep, header=None, dtype=str,
                          engine="python", on_bad_lines="skip")
        h = _find_header_row(raw)
        df = raw.iloc[h + 1 :].copy()
        df.columns = raw.iloc[h].tolist()
    return clean_table(df)


def column_info(df: pd.DataFrame) -> list[dict]:
    return [{"name": str(c), "dtype": str(t)} for c, t in df.dtypes.items()]
