from fastapi import FastAPI
from core.config import settings
from routers import health, etl, infer

app = FastAPI(title="Maintly BE2 (internal)")

app.include_router(health.router, prefix="", tags=["health"])
app.include_router(etl.router,    prefix="/internal/etl", tags=["etl"])
app.include_router(infer.router,  prefix="/internal/infer", tags=["infer"])

# Uvicorn run example:
# uvicorn app:app --reload --port ${BE2_PORT:-5000}
