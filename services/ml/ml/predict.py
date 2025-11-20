import numpy as np
import pandas as pd
from typing import List, Dict, Any
from ml.artifacts import MODEL, PREP, EXPL, FEATS
from ml.rules import risk_bucket

# --- helper mapping payload -> fitur training ---
def map_payload_to_feats(row: dict) -> pd.DataFrame:
    mapping = {
        "Air temperature [K]":     row["air_temp_k"],
        "Process temperature [K]": row["process_temp_k"],
        "Rotational speed [rpm]":  row["rotational_speed_rpm"],
        "Torque [Nm]":             row["torque_nm"],
        "Tool wear [min]":         row["tool_wear_min"],
    }
    X = pd.DataFrame([{f: mapping.get(f, 0.0) for f in FEATS}])[FEATS].astype(float)
    return X

# --- fallback heuristik jika nama fitur SHAP tidak manusiawi ---
def heuristic_factors(raw: dict) -> List[Dict[str, Any]]:
    delta_k = raw["process_temp_k"] - raw["air_temp_k"]
    facs: List[Dict[str, Any]] = []
    if raw["tool_wear_min"] >= 180:
        facs.append({"feature": "tool_wear_min", "value": int(raw["tool_wear_min"]), "threshold": 180})
    if delta_k >= 12:
        facs.append({"feature": "delta_k", "value": round(delta_k, 1), "threshold": 12})
    if raw["torque_nm"] >= 50:
        facs.append({"feature": "torque_nm", "value": round(raw["torque_nm"], 1), "threshold": 50})
    return facs[:3]

def explain_top_factors(Xt, k: int = 3) -> List[Dict[str, float]]:
    sv = EXPL.shap_values(Xt)

    # pilih array SHAP yang tepat, lalu jadi vektor 1D
    if isinstance(sv, list):
        arr = sv[1] if len(sv) > 1 else sv[0]
    else:
        arr = sv
    s = np.asarray(arr).squeeze()
    if s.ndim == 2:
        s = s[0]
    s = np.asarray(s).reshape(-1)

    # nama fitur; fallback jika panjang tidak cocok
    feats = list(FEATS)
    if len(feats) != s.shape[0]:
        feats = [f"f{i}" for i in range(s.shape[0])]

    idx = np.argsort(np.abs(s))[::-1][:k]
    idx = [int(i) for i in np.asarray(idx).tolist()]
    return [{"feature": feats[i], "contrib": float(s[i])} for i in idx]

def format_reason(factors: List[Dict[str, Any]], raw: dict) -> str | None:
    if not factors:
        return None
    names = [f.get("feature") for f in factors[:2]]
    parts = []
    if "Tool wear [min]" in names or "tool_wear_min" in names:
        parts.append(f"Tool wear {int(raw['tool_wear_min'])} (≥180)")
    if any(n in names for n in ["Process temperature [K]", "Air temperature [K]", "delta_k"]):
        delta_k = raw["process_temp_k"] - raw["air_temp_k"]
        parts.append(f"ΔT {round(delta_k,1)}K (≥12)")
    if "Torque [Nm]" in names or "torque_nm" in names:
        parts.append(f"Torsi {round(raw['torque_nm'],1)}")
    return " & ".join(parts) if parts else None

def predict_one(raw: dict) -> Dict[str, Any]:
    X = map_payload_to_feats(raw)
    Xt = PREP.transform(X)

    # pastikan ambil kolom proba untuk kelas positif yang benar
    if hasattr(MODEL, "predict_proba"):
        proba = MODEL.predict_proba(Xt)
        pos_idx = 1
        if hasattr(MODEL, "classes_"):
            if 1 in MODEL.classes_:
                pos_idx = int(np.where(MODEL.classes_ == 1)[0][0])
            elif "Failure" in MODEL.classes_:
                pos_idx = int(np.where(MODEL.classes_ == "Failure")[0][0])
        risk_score = float(proba[0, pos_idx])
    else:
        z = float(MODEL.decision_function(Xt)[0])
        risk_score = 1 / (1 + np.exp(-z))

    level = risk_bucket(risk_score)

    # SHAP → aman-kan bentuk + fallback heuristik bila nama fitur tidak manusiawi
    try:
        factors = explain_top_factors(Xt) if EXPL is not None else []
    except Exception:
        factors = []
    if not any(f.get("feature") in {
        "Tool wear [min]", "Process temperature [K]", "Air temperature [K]", "Torque [Nm]"
    } for f in factors):
        hf = heuristic_factors(raw)
        if hf:
            factors = hf

    reason = format_reason(factors, raw)
    return {
        "risk_score": round(risk_score, 4),
        "risk_level": level,
        "top_factors": factors,
        "reason": reason
    }
