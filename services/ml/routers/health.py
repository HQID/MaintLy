from fastapi import APIRouter
import time

router = APIRouter()

start = time.time()

@router.get("/health")
def health():
    return {"status": "ok", "service": "maintly-be2", "uptime": round(time.time()-start, 1)}
