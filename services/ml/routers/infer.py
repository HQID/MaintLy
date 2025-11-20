from fastapi import APIRouter
from pydantic import BaseModel
from core.db import get_conn
from core.ids import new_id
from ml.predict import predict_one
from psycopg.types.json import Json

router = APIRouter()

class OnlineInput(BaseModel):
    air_temp_k: float
    process_temp_k: float
    rotational_speed_rpm: float
    torque_nm: float
    tool_wear_min: float

@router.post("/online")
def infer_online(p: OnlineInput):
    return predict_one(p.model_dump())

@router.post("/batch")
def infer_batch():
    """Ambil bacaan terbaru per mesin → prediksi → tulis predictions/anomalies → update machines."""
    with get_conn() as conn, conn.transaction():
        cur = conn.cursor()
        cur.execute("""
            SELECT m.id AS machine_id, m.product_id,
                   s.ts, s.air_temp_k, s.process_temp_k, s.rotational_speed_rpm, s.torque_nm, s.tool_wear_min
            FROM machines m
            JOIN LATERAL (
                SELECT ts, air_temp_k, process_temp_k, rotational_speed_rpm, torque_nm, tool_wear_min
                FROM sensor_readings sr WHERE sr.machine_id = m.id
                ORDER BY ts DESC LIMIT 1
            ) s ON TRUE
        """)
        rows = cur.fetchall()
        n_pred, n_anom = 0, 0

        for r in rows:
            raw = {
                "air_temp_k": r["air_temp_k"],
                "process_temp_k": r["process_temp_k"],
                "rotational_speed_rpm": r["rotational_speed_rpm"],
                "torque_nm": r["torque_nm"],
                "tool_wear_min": r["tool_wear_min"],
            }
            out = predict_one(raw)
            # tulis predictions
            top = out.get("top_factors") or []
            cur.execute("""
                INSERT INTO predictions (id, machine_id, ts, risk_score, risk_level, predicted_failure_type, top_factors)
                VALUES (%s,%s,%s,%s,%s,%s,%s)
            """, (new_id(), r["machine_id"], r["ts"], out["risk_score"], out["risk_level"], None, Json(top)))
            n_pred += 1

            # aturan sederhana anomali: risk_level == 'high'
            if out["risk_level"] == "high":
                cur.execute("""
                    INSERT INTO anomalies (id, machine_id, detected_at, risk_score, risk_level, predicted_failure_type, reason)
                    VALUES (%s,%s,%s,%s,%s,%s,%s)
                """, (new_id(), r["machine_id"], r["ts"], out["risk_score"], out["risk_level"], None, out.get("reason")))
                n_anom += 1

            # update ringkasan machines
            cur.execute("""
                UPDATE machines
                SET last_reading_at=%s, current_risk_score=%s, current_risk_level=%s, predicted_failure_type=%s
                WHERE id=%s
            """, (r["ts"], out["risk_score"], out["risk_level"], None, r["machine_id"]))

    return {"ok": True, "predictions": n_pred, "anomalies": n_anom}
