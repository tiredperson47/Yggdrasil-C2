import sqlite3
from datetime import datetime, timezone
import os
import time

script_dir = os.path.dirname(os.path.abspath(__file__))
db_path = os.path.join(script_dir, 'Handlers', 'data', 'agents.db')

while True:
    current_time = datetime.now()

    conn = sqlite3.connect(db_path)
    cur = conn.cursor()
    update = """UPDATE agents SET status = 'DEAD' WHERE status = 'ALIVE' AND datetime(last_seen, '+' || (sleep * 4) || ' seconds') < ?"""
    cur.execute(update, (current_time,))
    conn.commit()
    conn.close
    time.sleep(30)