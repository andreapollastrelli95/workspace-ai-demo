"""Statistica, Machine Learning, forecasting e simulazioni (tutto lato server)."""
import json

import numpy as np
import pandas as pd
import plotly.express as px
import plotly.graph_objects as go

TEMPLATE = "plotly_white"


def fig_json(fig: go.Figure) -> dict:
    fig.update_layout(template=TEMPLATE, margin=dict(l=40, r=20, t=50, b=40), autosize=True)
    return json.loads(fig.to_json())


def _num(df: pd.DataFrame) -> pd.DataFrame:
    return df.select_dtypes(include="number")


def clean(v):
    """Rende serializzabili in JSON i valori numpy/NaN."""
    if isinstance(v, dict):
        return {str(k): clean(x) for k, x in v.items()}
    if isinstance(v, (list, tuple)):
        return [clean(x) for x in v]
    if isinstance(v, (np.floating, float)):
        return None if np.isnan(v) or np.isinf(v) else float(v)
    if isinstance(v, np.integer):
        return int(v)
    if isinstance(v, (pd.Timestamp, np.datetime64)):
        return None if pd.isna(v) else str(pd.Timestamp(v).date())
    if isinstance(v, (np.bool_,)):
        return bool(v)
    return v


def profile(df: pd.DataFrame) -> dict:
    num = _num(df)
    if df.shape[1] == 0:
        raise ValueError("il file non contiene colonne leggibili")
    base = num if num.shape[1] else df
    stats = base.describe(include="all").T.reset_index().rename(columns={"index": "colonna"})
    stats = stats.astype(object).where(stats.notna(), None)
    figs = []
    for c in num.columns[:4]:
        figs.append(fig_json(px.histogram(df, x=c, nbins=30, title=f"Distribuzione di {c}")))
    if num.shape[1] >= 2:
        corr = num.corr().round(3)
        figs.append(fig_json(px.imshow(corr, text_auto=True, color_continuous_scale="RdBu_r",
                                       zmin=-1, zmax=1, title="Matrice di correlazione")))
    dates = [c for c in df.columns if pd.api.types.is_datetime64_any_dtype(df[c])]
    if dates and num.shape[1]:
        d0, v0 = dates[0], num.columns[0]
        t = df[[d0, v0]].dropna().sort_values(d0)
        figs.insert(0, fig_json(px.line(t, x=d0, y=v0, title=f"{v0} nel tempo")))
    return clean({
        "rows": len(df), "cols": df.shape[1],
        "metrics": {"righe": len(df), "colonne": df.shape[1], "colonne_numeriche": num.shape[1],
                    "colonne_data": len(dates)},
        "missing": df.isna().sum().to_dict(),
        "stats": stats.to_dict(orient="records"),
        "figures": figs,
    })


def chart(df: pd.DataFrame, kind: str, x: str, y: str | None, color: str | None) -> dict:
    fn = {"line": px.line, "bar": px.bar, "scatter": px.scatter, "box": px.box, "histogram": px.histogram}[kind]
    kw = {"x": x}
    if y:
        kw["y"] = y
    if color:
        kw["color"] = color
    d = df.sort_values(x) if kind == "line" else df
    return {"figures": [fig_json(fn(d, **kw, title=f"{kind.title()}: {y or ''} per {x}"))]}


def _hw_forecast(s: pd.Series, horizon: int, season: int | None):
    from statsmodels.tsa.holtwinters import ExponentialSmoothing

    use_season = bool(season) and len(s) >= 2 * season
    # storico corto: niente trend (eviterebbe estrapolazioni assurde); storico lungo: trend smorzato
    trend = "add" if len(s) >= 12 else None
    model = ExponentialSmoothing(s, trend=trend, damped_trend=bool(trend), seasonal="add" if use_season else None,
                                 seasonal_periods=season if use_season else None).fit()
    return model.forecast(horizon), float(np.std(model.resid)), use_season


def forecast(df: pd.DataFrame, date_col: str, value_col: str, horizon: int, freq: str | None) -> dict:
    from statsmodels.tsa.holtwinters import ExponentialSmoothing

    d = df[[date_col, value_col]].copy()
    d[date_col] = pd.to_datetime(d[date_col], errors="coerce", dayfirst=True)
    d[value_col] = pd.to_numeric(d[value_col], errors="coerce")
    d = d.dropna().sort_values(date_col).set_index(date_col)[value_col]
    if d.empty:
        raise ValueError("nessuna coppia data/valore valida")
    # un saldo si aggrega con l'ultimo valore del periodo, un flusso (importi, vendite) con la somma
    is_level = any(k in value_col.lower() for k in ("saldo", "balance", "giacenza", "patrimonio", "prezzo"))
    span_days = (d.index.max() - d.index.min()).days
    f = freq or (pd.infer_freq(d.index.unique()) if d.index.is_unique and len(d) > 2 else None) \
        or ("MS" if span_days > 120 else "W" if span_days > 30 else "D")
    s = d.resample(f).last().ffill() if is_level else d.resample(f).sum()
    if len(s) < 4:
        raise ValueError(f"servono almeno 4 periodi di storico (ne ho {len(s)}): prova una frequenza più fine")

    season = {"MS": 12, "M": 12, "ME": 12, "QS": 4, "Q": 4, "QE": 4, "W": 52, "D": 7}.get(f.split("-")[0])
    pred, resid_sd, use_season = _hw_forecast(s, horizon, season)
    steps = np.arange(1, horizon + 1)
    lo, hi = pred - 1.96 * resid_sd * np.sqrt(steps), pred + 1.96 * resid_sd * np.sqrt(steps)

    n_test = max(2, len(s) // 5)
    try:
        bt = _hw_forecast(s[:-n_test], n_test, None)[0]
        actual = s[-n_test:].values
        denom = np.where(np.abs(actual) < 1e-9, np.nan, np.abs(actual))
        mape = float(np.nanmean(np.abs(actual - bt.values) / denom) * 100)
        mape = None if np.isnan(mape) else mape
    except Exception:
        mape = None

    def main_fig(pred, lo, hi):
        fig = go.Figure()
        fig.add_trace(go.Scatter(x=s.index, y=s.values, name="Storico", mode="lines+markers" if len(s) < 40 else "lines"))
        fig.add_trace(go.Scatter(x=pred.index, y=hi, line=dict(width=0), showlegend=False, hoverinfo="skip"))
        fig.add_trace(go.Scatter(x=pred.index, y=lo, fill="tonexty", line=dict(width=0), name="Intervallo 95%",
                                 fillcolor="rgba(99,102,241,0.18)"))
        fig.add_trace(go.Scatter(x=pred.index, y=pred.values, name="Previsione", mode="lines+markers", line=dict(dash="dash")))
        fig.update_layout(title=f"Previsione di {value_col} ({horizon} periodi, {'ultimo valore' if is_level else 'somma'} per periodo)")
        return fig_json(fig)

    figures = [main_fig(pred, lo, hi)]
    metrics = {"frequenza": f, "aggregazione": "ultimo valore" if is_level else "somma",
               "periodi_storici": len(s), "stagionalita": season if use_season else None,
               "mape_backtest_%": round(mape, 2) if mape is not None else None,
               "ultimo_periodo": float(s.iloc[-1]), "previsione_ultimo_periodo": float(pred.iloc[-1])}
    if not is_level:
        metrics["totale_previsto"] = float(pred.sum())

    # flussi con segno misto (es. estratto conto): previsione separata di entrate e uscite
    if not is_level and (d > 0).any() and (d < 0).any():
        ent = d.clip(lower=0).resample(f).sum()
        usc = (-d.clip(upper=0)).resample(f).sum()
        pe, _, _ = _hw_forecast(ent, horizon, season)
        pu, _, _ = _hw_forecast(usc, horizon, season)
        pe, pu = pe.clip(lower=0), pu.clip(lower=0)
        net = pe - pu  # il netto previsto è sempre entrate - uscite, così i numeri sono coerenti
        figures = [main_fig(net, net - 1.96 * resid_sd * np.sqrt(steps), net + 1.96 * resid_sd * np.sqrt(steps))]
        metrics["totale_previsto"] = float(net.sum())
        metrics["previsione_ultimo_periodo"] = float(net.iloc[-1])
        bars = go.Figure()
        bars.add_trace(go.Bar(x=ent.index, y=ent.values, name="Entrate storiche", marker_color="#10b981", opacity=0.55))
        bars.add_trace(go.Bar(x=usc.index, y=-usc.values, name="Uscite storiche", marker_color="#ef4444", opacity=0.55))
        bars.add_trace(go.Bar(x=pe.index, y=pe.values, name="Entrate previste", marker_color="#10b981"))
        bars.add_trace(go.Bar(x=pu.index, y=-pu.values, name="Uscite previste", marker_color="#ef4444"))
        bars.add_trace(go.Scatter(x=pe.index, y=(pe - pu).values, name="Saldo netto previsto", mode="lines+markers",
                                  line=dict(color="#6366f1", width=3)))
        bars.update_layout(title="Entrate e uscite: storico e previsione", barmode="relative")
        figures.insert(0, fig_json(bars))
        metrics.update({"entrate_previste_totali": float(pe.sum()), "uscite_previste_totali": float(pu.sum()),
                        "netto_previsto_totale": float(pe.sum() - pu.sum()),
                        "entrate_medie_storiche_per_periodo": float(ent.mean()),
                        "uscite_medie_storiche_per_periodo": float(usc.mean())})
        table = [{"periodo": str(i.date()), "entrate": float(a), "uscite": float(b), "netto": float(a - b)}
                 for i, a, b in zip(pe.index, pe.values, pu.values)]
    else:
        table = [{"data": str(i.date()), "previsione": float(v), "min": float(a), "max": float(b)}
                 for i, v, a, b in zip(pred.index, pred.values, lo, hi)]
    return clean({"metrics": metrics, "table": table, "figures": figures})


def train_model(df: pd.DataFrame, target: str, features: list[str] | None, algo: str) -> dict:
    from sklearn.compose import ColumnTransformer
    from sklearn.ensemble import RandomForestClassifier, RandomForestRegressor
    from sklearn.impute import SimpleImputer
    from sklearn.linear_model import LinearRegression, LogisticRegression
    from sklearn.metrics import accuracy_score, f1_score, mean_absolute_error, r2_score
    from sklearn.model_selection import train_test_split
    from sklearn.pipeline import Pipeline
    from sklearn.preprocessing import OneHotEncoder

    d = df.dropna(subset=[target]).copy()
    # le date diventano variabili numeriche (anno, mese, giorno della settimana)
    for c in list(d.columns):
        if c != target and pd.api.types.is_datetime64_any_dtype(d[c]):
            d[f"{c}_anno"], d[f"{c}_mese"], d[f"{c}_giorno_sett"] = d[c].dt.year, d[c].dt.month, d[c].dt.dayofweek
            d = d.drop(columns=c)
            if features and c in features:
                features = [f for f in features if f != c] + [f"{c}_anno", f"{c}_mese", f"{c}_giorno_sett"]
    feats = features or [c for c in d.columns if c != target]
    X, y = d[feats], d[target]
    is_class = y.dtype == object or y.nunique() <= 10
    num_cols = X.select_dtypes(include="number").columns.tolist()
    cat_cols = [c for c in feats if c not in num_cols and X[c].nunique() <= 50]
    pre = ColumnTransformer([
        ("num", SimpleImputer(strategy="median"), num_cols),
        ("cat", Pipeline([("imp", SimpleImputer(strategy="most_frequent")),
                          ("oh", OneHotEncoder(handle_unknown="ignore"))]), cat_cols),
    ])
    if is_class:
        est = RandomForestClassifier(n_estimators=200, random_state=0) if algo != "linear" else LogisticRegression(max_iter=1000)
    else:
        est = RandomForestRegressor(n_estimators=200, random_state=0) if algo != "linear" else LinearRegression()
    pipe = Pipeline([("pre", pre), ("model", est)])
    Xtr, Xte, ytr, yte = train_test_split(X[num_cols + cat_cols], y, test_size=0.2, random_state=0)
    pipe.fit(Xtr, ytr)
    p = pipe.predict(Xte)

    if is_class:
        metrics = {"tipo": "classificazione", "accuracy": accuracy_score(yte, p),
                   "f1_macro": f1_score(yte, p, average="macro")}
    else:
        metrics = {"tipo": "regressione", "r2": r2_score(yte, p), "mae": mean_absolute_error(yte, p)}
    metrics.update({"righe_train": len(Xtr), "righe_test": len(Xte), "algoritmo": type(est).__name__})

    figs = []
    names = pipe.named_steps["pre"].get_feature_names_out()
    m = pipe.named_steps["model"]
    imp = getattr(m, "feature_importances_", None)
    if imp is None and hasattr(m, "coef_"):
        imp = np.abs(np.ravel(m.coef_))[: len(names)]
    if imp is not None:
        fi = pd.DataFrame({"variabile": [n.split("__", 1)[-1] for n in names], "importanza": imp})
        fi = fi.sort_values("importanza").tail(15)
        figs.append(fig_json(px.bar(fi, x="importanza", y="variabile", orientation="h", title="Importanza delle variabili")))
    if not is_class:
        figs.append(fig_json(px.scatter(x=yte, y=p, labels={"x": "Reale", "y": "Previsto"}, title="Reale vs previsto")))
    return clean({"metrics": metrics, "figures": figs})


def simulate(df: pd.DataFrame, value_col: str, horizon: int, n_sims: int, shock_pct: float) -> dict:
    """Monte Carlo. Valori sempre positivi (saldi, prezzi, vendite): variazioni percentuali.
    Valori che cambiano segno (importi di un estratto conto): somma cumulata dei flussi futuri."""
    s = pd.to_numeric(df[value_col], errors="coerce").dropna()
    if len(s) < 6:
        raise ValueError("servono almeno 6 valori numerici per simulare")
    rng = np.random.default_rng(42)
    steps = list(range(1, horizon + 1))
    additive = (s <= 0).any()
    if additive:
        mu, sd = float(s.mean()), float(s.std())
        draws = rng.choice(s.values, size=(n_sims, horizon), replace=True) * (1 + shock_pct / 100)  # bootstrap storico
        paths = np.cumsum(draws, axis=1)
        start_val, label = 0.0, f"Somma cumulata di {value_col}"
        extra = {"modello": "flussi (bootstrap dei valori storici)", "media_per_periodo": mu, "dev_standard": sd,
                 "prob_totale_positivo": float((paths[:, -1] > 0).mean())}
    else:
        r = s.pct_change().replace([np.inf, -np.inf], np.nan).dropna()
        mu, sd = float(r.mean()), float(r.std())
        start_val = float(s.iloc[-1])
        paths = start_val * (1 + shock_pct / 100) * np.cumprod(1 + rng.normal(mu, sd, size=(n_sims, horizon)), axis=1)
        label = value_col
        extra = {"modello": "variazioni percentuali", "valore_iniziale": start_val, "media_variazione_%": mu * 100,
                 "volatilita_%": sd * 100, "prob_sopra_valore_attuale": float((paths[:, -1] > start_val).mean())}
    final = paths[:, -1]
    pct = {f"p{q}": float(np.percentile(final, q)) for q in (5, 25, 50, 75, 95)}
    fig = go.Figure()
    for i in range(min(40, n_sims)):
        fig.add_trace(go.Scatter(x=steps, y=paths[i], mode="lines", line=dict(width=1), opacity=0.25, showlegend=False))
    for q, dash in ((5, "dot"), (50, "solid"), (95, "dot")):
        fig.add_trace(go.Scatter(x=steps, y=np.percentile(paths, q, axis=0), name=f"P{q}", line=dict(width=3, dash=dash)))
    fig.update_layout(title=f"Monte Carlo: {n_sims} scenari — {label}", xaxis_title="Periodi (righe future)")
    hist = px.histogram(x=final, nbins=40, title="Distribuzione del valore finale", labels={"x": label})
    return clean({"metrics": {**extra, **pct}, "figures": [fig_json(fig), fig_json(hist)]})
