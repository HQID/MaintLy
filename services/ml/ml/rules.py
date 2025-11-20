from core.config import settings

LOW_TH = settings.LOW_TH
HIGH_TH = settings.HIGH_TH

def risk_bucket(score: float) -> str:
    return "low" if score < LOW_TH else ("medium" if score < HIGH_TH else "high")
