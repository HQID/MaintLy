import psycopg
from psycopg.rows import dict_row
from core.config import settings

def get_conn():
    return psycopg.connect(settings.POSTGRES_URL, row_factory=dict_row)

def exec_many(conn, query, rows):
    with conn.cursor() as cur:
        cur.executemany(query, rows)
