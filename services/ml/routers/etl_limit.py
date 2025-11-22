from fastapi import APIRouter, Query
import pandas as pd
from core.config import settings
from core.db import get_conn
from core.ids import new_id

router = APIRouter()

@router.post("/import-limit")
def etl_import_limit(limit: int = Query(200, ge=1, le=5000)):
    """
    Import data dari dataset CSV ke sensor_readings, dibatasi limit.
    Gaya dan logika mengikuti etl.py, hanya menambah limit.
    """
    df = pd.read_csv(settings.DATASET_PATH)
    anchor = pd.Timestamp(settings.ANCHOR_TS)

    # Ambil hanya sejumlah 'limit' baris pertama dari dataset
    df = df.head(limit)

    with get_conn() as conn, conn.transaction():
        machine_idx = 0  # <— offset global per mesin

        for pid, grp in df.groupby("Product ID"):
            cur = conn.cursor()
            cur.execute("SELECT id FROM machines WHERE product_id=%s", (pid,))
            got = cur.fetchone()
            if got:
                machine_id = got["id"]
            else:
                machine_id = new_id()
                cur.execute(
                    "INSERT INTO machines (id, product_id, type) VALUES (%s,%s,%s)",
                    (machine_id, pid, grp["Type"].iloc[0] if "Type" in grp else None),
                )

            grp = grp.reset_index(drop=True)
            ts_base = anchor + pd.Timedelta(hours=machine_idx)

            rows = []
            for i, r in grp.iterrows():
                ts = ts_base + pd.Timedelta(hours=int(i))
                rows.append((
                    new_id(), machine_id, ts.to_pydatetime(),
                    float(r["Air temperature [K]"]),
                    float(r["Process temperature [K]"]),
                    int(r["Rotational speed [rpm]"]),
                    float(r["Torque [Nm]"]),
                    int(r["Tool wear [min]"]),
                ))

            conn.cursor().executemany("""
                INSERT INTO sensor_readings
                (id, machine_id, ts, air_temp_k, process_temp_k, rotational_speed_rpm, torque_nm, tool_wear_min)
                VALUES (%s,%s,%s,%s,%s,%s,%s,%s)
            """, rows)

            cur.execute(
                "UPDATE machines SET last_reading_at=%s WHERE id=%s",
                (rows[-1][2], machine_id)
            )

            machine_idx += 1

    return {"ok": True}
