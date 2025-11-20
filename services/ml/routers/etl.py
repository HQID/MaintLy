from fastapi import APIRouter
import pandas as pd
from core.config import settings
from core.db import get_conn
from core.ids import new_id

router = APIRouter()

@router.post("/import")
def etl_import():
    df = pd.read_csv(settings.DATASET_PATH)
    anchor = pd.Timestamp(settings.ANCHOR_TS)

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
            # base ts untuk mesin ini digeser per 'machine_idx' (mis. per menit)
            ts_base = anchor + pd.Timedelta(hours=machine_idx)

            rows = []
            for i, r in grp.iterrows():
                ts = ts_base + pd.Timedelta(hours=int(i))  # kalau nanti ada >1 baris/mesin
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

            # opsional: langsung set last_reading_at saat ETL
            cur.execute(
                "UPDATE machines SET last_reading_at=%s WHERE id=%s",
                (rows[-1][2], machine_id)
            )

            machine_idx += 1  # geser 1 menit untuk mesin berikutnya

    return {"ok": True}
