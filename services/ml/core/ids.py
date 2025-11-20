import ulid

def new_id() -> str:
    return str(ulid.ULID())  # VARCHAR(26) aman; kolom kita VARCHAR(50)
