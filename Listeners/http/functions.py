import redis
import requests
import sqlite3
from datetime import datetime

RED = "\033[1;31m"
GREEN = "\033[1;92m"
CYAN = "\033[1;36m"
RESET = "\033[0m"

r = redis.Redis(host='127.0.0.1', port=6379, db=0, decode_responses=True)

def register_agent(uuid):
    r.rpush(uuid, "AGENT REGISTERED")
    r.rpush("agents", uuid)
    print(f"{CYAN}{uuid} Registered{RESET}")
    checkin = datetime.utcnow()
    print(checkin)
    #conn = sqlite3.connect("agents")
    #cur = conn.cursor()
    #cur.execute()
    return ""

def create_db(path):
    conn = sqlite3.connect(path)
    cur = conn.cursor()

    cur.execute('''CREATE TABLE IF NOT EXISTS agents (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        uuid TEXT, name TEXT,
        status TEXT,
        first_seen TIMESTAMP,
        last_seen TIMESTAMP,
        sleep INTEGER
        )
    ''')
    conn.commit()
    conn.close()