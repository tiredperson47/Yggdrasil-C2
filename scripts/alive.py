from sqlalchemy import create_engine, text
from datetime import datetime, timezone
import os
import time
from dotenv import load_dotenv

RED = "\033[1;31m"
GREEN = "\033[1;92m"
CYAN = "\033[1;36m"
RESET = "\033[0m"

load_dotenv("../Handlers/.env")
db_user = os.getenv('DB_USER')
db_pass = os.getenv('DB_PASS')
database = os.getenv('DATABASE')
db_host = os.getenv('DB_HOST')

path = "../Handlers/nginx/certs"
sql_ssl = {
    'ssl_ca': f"{path}/ca.crt",
    'ssl_cert': f"{path}/client.crt",
    'ssl_key': f"{path}/client.key"
}

try:
    URL = f"mysql+pymysql://{db_user}:{db_pass}@{db_host}:3306/{database}"
    engine = create_engine(
        URL,
        connect_args={"ssl": sql_ssl},
        pool_size=1, # keep 5 open connections ready
        max_overflow=3, # allow up to 10 extra if demand spikes
        pool_recycle=1800, # recycle connections after 30 min
        pool_pre_ping=True # check if connection is alive before use
    )
except:
    print(f"{RED}Error connecting to MariaDB Platform!{RESET}")

while True:
    utc = datetime.now(timezone.utc)
    current_time = utc.strftime("%Y-%m-%d %H:%M:%S")

    try: 
        with engine.begin() as conn:
            update = text("UPDATE agents SET status = 'DEAD' WHERE status = 'ALIVE' AND TIMESTAMPADD(SECOND, sleep * 4, last_seen) < :current_time")
            conn.execute(update, {"current_time": current_time})
        time.sleep(30)
    except KeyboardInterrupt:
        print("\nQuitting Script...")
        break
    except:
        print(f"{RED}ERROR: Something wrong with Alive.py, OR waiting for .env to be copied{RESET}")
        time.sleep(30)