from fastapi import APIRouter, Query
from core.db import get_conn
from core.ids import new_id
from ml.predict import predict_one
from psycopg.types.json import Json

router = APIRouter()


@router.post("/limit")
def infer_limit(limit: int = Query(200, ge=1, le=5000)):
    """
    Ambil data historis dari sensor_readings secara acak (RANDOM()).
    Lalu lakukan infer → simpan predictions, anomalies → update machines.

    Default limit=200 untuk mencegah bottleneck di FE.
    """
    inserted_predictions = 0
    inserted_anomalies = 0

    with get_conn() as conn, conn.transaction():
        cur = conn.cursor()

        # ===================================================================
        # 1) Ambil data sensor secara acak dari seluruh dataset
        # ===================================================================
        cur.execute(f"""
            SELECT sr.*, m.product_id
            FROM sensor_readings sr
            JOIN machines m ON sr.machine_id = m.id
            ORDER BY RANDOM()
            LIMIT {limit}
        """)

        rows = cur.fetchall()

        # ===================================================================
        # 2) Proses setiap baris → infer
        # ===================================================================
        for r in rows:
            raw = {
                "air_temp_k": r["air_temp_k"],
                "process_temp_k": r["process_temp_k"],
                "rotational_speed_rpm": r["rotational_speed_rpm"],
                "torque_nm": r["torque_nm"],
                "tool_wear_min": r["tool_wear_min"],
            }

            out = predict_one(raw)
            top = out.get("top_factors") or []

            # ---------------------------------------------------------------
            # INSERT predictions
            # ---------------------------------------------------------------
            cur.execute("""
                INSERT INTO predictions (id, machine_id, ts, risk_score, risk_level, predicted_failure_type, top_factors)
                VALUES (%s,%s,%s,%s,%s,%s,%s)
            """, (
                new_id(),
                r["machine_id"],
                r["ts"],  # gunakan timestamp asli dari dataset
                out["risk_score"],
                out["risk_level"],
                None,
                Json(top),
            ))
            inserted_predictions += 1

            # ---------------------------------------------------------------
            # INSERT anomalies hanya jika high
            # ---------------------------------------------------------------
            if out["risk_level"] == "high":
                cur.execute("""
                    INSERT INTO anomalies (id, machine_id, detected_at, risk_score, risk_level, predicted_failure_type, reason)
                    VALUES (%s,%s,%s,%s,%s,%s,%s)
                """, (
                    new_id(),
                    r["machine_id"],
                    r["ts"],
                    out["risk_score"],
                    out["risk_level"],
                    None,
                    out.get("reason")
                ))
                inserted_anomalies += 1

            # ---------------------------------------------------------------
            # UPDATE machines ringkasan terbaru
            # ---------------------------------------------------------------
            cur.execute("""
                UPDATE machines
                SET current_risk_score=%s,
                    current_risk_level=%s,
                    predicted_failure_type=%s
                WHERE id=%s
            """, (
                out["risk_score"],
                out["risk_level"],
                None,
                r["machine_id"]
            ))

    return {
        "ok": True,
        "limit_used": limit,
        "predictions_inserted": inserted_predictions,
        "anomalies_inserted": inserted_anomalies
    }
