import os
from dotenv import load_dotenv
import mariadb

load_dotenv("../.env")
db_user = os.getenv('DB_USER')
db_pass = os.getenv('DB_PASS')
database = os.getenv('DATABASE')
db_host = os.getenv('HOST')

try:
    conn = mariadb.connect(
        user=db_user,
        password=db_pass,
        host=db_host,
        database=database
    )
    cur = conn.cursor()

    cur.execute('''CREATE TABLE IF NOT EXISTS agents (
        uuid TEXT PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        status TEXT,
        first_seen TIMESTAMP,
        last_seen TIMESTAMP,
        sleep INTEGER,
        profile TEXT,
        ip TEXT
        )
    ''')
    conn.commit()
    conn.close()
except mariadb.Error as e:
    print(f"Error connecting to MariaDB Platform: {e}")
    exit(1)

# conn = sqlite3.connect("agents.db")
