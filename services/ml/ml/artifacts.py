import joblib
from core.config import settings

# Load sekali saat modul diimport
MODEL = joblib.load(settings.MODEL_PATH)
PREP  = joblib.load(settings.PREP_PATH)
try:
    EXPL  = joblib.load(settings.SHAP_PATH)
except Exception:
    EXPL = None

# Fitur sesuai training (coba ambil dari PREP/MODEL)
if hasattr(PREP, "feature_names_in_"):
    FEATS = list(PREP.feature_names_in_)
elif hasattr(MODEL, "feature_names_in_"):
    FEATS = list(MODEL.feature_names_in_)
else:
    FEATS = ["Air temperature [K]","Process temperature [K]","Rotational speed [rpm]","Torque [Nm]","Tool wear [min]"]
