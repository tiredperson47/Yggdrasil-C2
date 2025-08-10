import redis
import requests
import sqlite3
from datetime import datetime, timezone

RED = "\033[1;31m"
GREEN = "\033[1;92m"
CYAN = "\033[1;36m"
RESET = "\033[0m"

r = redis.Redis(host='127.0.0.1', port=6379, db=0, decode_responses=True)

def register_agent(uuid, profile, path):
    r.rpush(uuid, "AGENT REGISTERED")
    print(f"{CYAN}{uuid} Registered{RESET}")
    utc = datetime.now(timezone.utc)
    checkin = utc.isoformat()
    conn = sqlite3.connect(path)
    cur = conn.cursor()

    # Future implement (maybe): read a yaml/json file for the default sleep int. Or Some other work around
    sql_insert = """INSERT INTO agents (uuid, name, status, first_seen, last_seen, sleep, profile) VALUES (?, ?, ?, ?, ?, ?, ?)"""
    cur.execute(sql_insert, (uuid, uuid, "ALIVE", checkin, checkin, 10, profile))
    conn.commit()
    conn.close()
    return ""

def create_db(path):
    conn = sqlite3.connect(path)
    cur = conn.cursor()

    cur.execute('''CREATE TABLE IF NOT EXISTS agents (
        uuid TEXT PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        status TEXT,
        first_seen TIMESTAMP,
        last_seen TIMESTAMP,
        sleep INTEGER,
        profile TEXT
        )
    ''')
    conn.commit()
    conn.close()

# Check and process small commands. (exit, sleep, etc)
def small_check(uuid, path):
    cmd = r.lindex(uuid, -2)
    raw_cmd = cmd.split(" ", 1)
    match raw_cmd[0]:
        case "exit":
            r.delete(uuid)
            r.delete(f"{uuid}-output")
            conn = sqlite3.connect(path)
            cur = conn.cursor()
            sql_delete = """DELETE FROM agents WHERE uuid = ?"""
            cur.execute(sql_delete, (uuid,))
            conn.commit()
            conn.close()
        case "sleep":
            conn = sqlite3.connect(path)
            cur = conn.cursor()
            sql_update = """UPDATE agents SET sleep = ? WHERE uuid = ?"""
            cur.execute(sql_update, (raw_cmd[1], uuid))
            conn.commit()
            conn.close()

def update_seen(uuid, path):
    conn = sqlite3.connect(path)
    cur = conn.cursor()

    utc = datetime.now(timezone.utc)
    current_time = utc.isoformat()
    update = "UPDATE agents SET last_seen = ? WHERE uuid = ?"
    cur.execute(update, (current_time, uuid))
    conn.commit()
    conn.close()