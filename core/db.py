import psycopg

DATABASE_URL = "postgresql://contextd:contextd@localhost:5433/contextd"

def check_db():
    with psycopg.connect(DATABASE_URL) as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT 1;")
            return cur.fetchone()


if __name__ == "__main__":
    print(check_db())