import os
from dotenv import load_dotenv

load_dotenv()

class Settings:
    POSTGRES_URL: str = os.getenv("POSTGRES_URL", "postgres://pmc_user:pmc_pass@127.0.0.1:5432/pmc_db")
    BE2_PORT: int = int(os.getenv("BE2_PORT", "5000"))
    DATASET_PATH: str = os.getenv("DATASET_PATH", "./data/predictive_maintenance.csv")
    ANCHOR_TS: str = os.getenv("ANCHOR_TS", "2025-10-01 08:00:00+08:00")
    MODEL_PATH: str = os.getenv("MODEL_PATH", "./models/rf_v1/model.pkl")
    PREP_PATH: str  = os.getenv("PREP_PATH",  "./models/rf_v1/preprocessing.pkl")
    SHAP_PATH: str  = os.getenv("SHAP_PATH",  "./models/rf_v1/shap_explainer.pkl")
    LOW_TH: float = float(os.getenv("LOW_TH", "0.4"))
    HIGH_TH: float = float(os.getenv("HIGH_TH", "0.7"))

settings = Settings()
