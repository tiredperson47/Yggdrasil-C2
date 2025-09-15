# import redis
# import requests
#import yaml
#import time
import os
from sqlalchemy import create_engine, text
import csv
from datetime import datetime, timezone
from dotenv import load_dotenv


RED = "\033[1;31m"
GREEN = "\033[1;92m"
CYAN = "\033[1;36m"
RESET = "\033[0m"


# Create the agents.db file and table if it's not already created in the Listeners/http/ directory.
script_dir = os.path.dirname(os.path.abspath(__file__))
#db_path = os.path.join(script_dir, '..', 'Handlers', 'data', 'agents.db')
history_csv = os.path.join(script_dir, "history.csv")

if not os.path.exists(history_csv):
    with open('history.csv', 'w', newline='') as file:
        writer = csv.writer(file)
        writer.writerow(['Agent', 'IP', 'Command', 'Time'])

load_dotenv("../Handlers/.env")
db_user = os.getenv('DB_USER')
db_pass = os.getenv('DB_PASS')
database = os.getenv('DATABASE')
db_host = os.getenv('HOST')

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

def print_table():
    # # conn = sqlite3.connect(db_path)
    # cur = conn.cursor()
    with engine.begin() as conn:
        sql_select = text("SELECT uuid, name, status, profile, ip FROM agents")
        tmp = conn.execute(sql_select)
        result = tmp.fetchall()

    if not result:
        print(f"{CYAN}No Callbacks Yet!{RESET}")
        return

    # Print in a nicely formatted table. Unnecessary but visually better
    INDEX_WIDTH = 7
    NAME_WIDTH = 25
    STATUS_WIDTH = 8
    PROFILE_WIDTH = 15
    IP_WIDTH = 17
    # Add length of new columns here. Future implement: IP column
    total_width = INDEX_WIDTH + NAME_WIDTH + STATUS_WIDTH + PROFILE_WIDTH + IP_WIDTH + 16
    print('=' * total_width)
    print(f'| {"Index":^{INDEX_WIDTH}} | {"Agent Name":^{NAME_WIDTH}} | {"IP":^{IP_WIDTH}} | {"Profile":^{PROFILE_WIDTH}} | {"Status":^{STATUS_WIDTH}} |') # Print column headers and centers them. 
    print('=' * total_width)

    # print the table
    for index, row in enumerate(result):
        status = row[2]
        index_cell = str(index).center(INDEX_WIDTH)
        name_cell = row[1].center(NAME_WIDTH)
        profile_cell = row[3].center(PROFILE_WIDTH)
        status_cell = row[2].center(STATUS_WIDTH)
        ip_cell = row[4].center(IP_WIDTH)
        if status == "DEAD":
            print(f"| {index_cell} | {CYAN}{name_cell}{RESET} | {CYAN}{ip_cell}{RESET} | {CYAN}{profile_cell}{RESET} | {RED}{status_cell}{RESET} |")
        elif status == "ALIVE":
            print(f"| {index_cell} | {CYAN}{name_cell}{RESET} | {CYAN}{ip_cell}{RESET} | {CYAN}{profile_cell}{RESET} | {GREEN}{status_cell}{RESET} |")
        else:
            print(f"| {index_cell} | {CYAN}{name_cell}{RESET} | {CYAN}{ip_cell}{RESET} | {CYAN}{profile_cell}{RESET} | {status_cell} |")
        print('-' * total_width)

    return result


def csv_history(profile, ip, command):
    utc = datetime.now()
    time = utc.isoformat(" ", "seconds")
    with open('history.csv', 'a', newline='') as file:
        writer = csv.writer(file)
        writer.writerow([profile, ip, command, time])