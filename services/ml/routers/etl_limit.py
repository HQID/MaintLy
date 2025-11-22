from fastapi import APIRouter, Query
import pandas as pd
from core.config import settings
from core.db import get_conn
from core.ids import new_id

router = APIRouter()

@router.post("/import-limit")
def etl_import_limit(limit: int = Query(200, ge=1, le=5000)):
    """
    Import data dari dataset CSV ke sensor_readings secara acak, dibatasi limit.
    Default limit=200 untuk mencegah bottleneck.
    """
    df = pd.read_csv(settings.DATASET_PATH)
    df = df.sample(n=min(limit, len(df)), random_state=None).reset_index(drop=True)

    with get_conn() as conn, conn.transaction():
        cur = conn.cursor()
        inserted = 0

        for _, r in df.iterrows():
            pid = r["Product ID"]
            cur.execute("SELECT id FROM machines WHERE product_id=%s", (pid,))
            got = cur.fetchone()
            if got:
                machine_id = got["id"]
            else:
                machine_id = new_id()
                cur.execute(
                    "INSERT INTO machines (id, product_id, type) VALUES (%s,%s,%s)",
                    (machine_id, pid, r["Type"] if "Type" in r else None),
                )

            ts = pd.Timestamp(r["Timestamps"]) if "Timestamps" in r else pd.Timestamp.now()
            cur.execute("""
                INSERT INTO sensor_readings
                (id, machine_id, ts, air_temp_k, process_temp_k, rotational_speed_rpm, torque_nm, tool_wear_min)
                VALUES (%s,%s,%s,%s,%s,%s,%s,%s)
            """, (
                new_id(), machine_id, ts.to_pydatetime(),
                float(r["Air temperature [K]"]),
                float(r["Process temperature [K]"]),
                int(r["Rotational speed [rpm]"]),
                float(r["Torque [Nm]"]),
                int(r["Tool wear [min]"]),
            ))
            inserted += 1

            # opsional: update last_reading_at
            cur.execute(
                "UPDATE machines SET last_reading_at=%s WHERE id=%s",
                (ts.to_pydatetime(), machine_id)
            )

    return {"ok": True, "imported": inserted}
