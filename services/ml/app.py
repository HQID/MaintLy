from fastapi import FastAPI
from core.config import settings
from routers import health, etl, infer, infer_limit, etl_limit

app = FastAPI(title="Maintly BE2 (internal)")

app.include_router(health.router, prefix="", tags=["health"])
app.include_router(etl.router,    prefix="/internal/etl", tags=["etl"])
app.include_router(etl_limit.router,  prefix="/internal/etl", tags=["etl-limit"])
app.include_router(infer.router,  prefix="/internal/infer", tags=["infer"])
app.include_router(infer_limit.router,  prefix="/internal/infer", tags=["infer-limit"])

# Uvicorn run example:
# uvicorn app:app --reload --port ${BE2_PORT:-5000}
