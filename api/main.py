from fastapi import FastAPI
from core.db import check_db

app = FastAPI()

@app.get("/health")
def health():
    return {"status": "ok"}

@app.get("/db-check")
def db_check():
    result = check_db()
    return {"db": result}