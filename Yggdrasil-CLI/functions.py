import os
from sqlalchemy import create_engine, text
import csv
from datetime import datetime
from dotenv import load_dotenv
import threading
import requests
import redis
import argparse


# Any variable that needs to be in yggdrasil-cli.py and commands.py can be initialized in this file. 
RED = "\033[1;31m"
GREEN = "\033[1;92m"
DGRN = "\x1b[38;5;22m"
CYAN = "\033[1;36m"
DBLUE = "\x1b[38;5;33m"
RESET = "\033[0m"

parser = argparse.ArgumentParser(description='CLI for Yggdrasil C2')
parser.add_argument('-c', '--config', type=str, default="../Handlers", help='Folder path of the "Handlers" directory. Ex. /home/user/Handlers')
parser.add_argument('-n', '--no-nginx', action='store_false', help="Whether or not you're using an nginx reverse proxy or not (Default is True)")
parser.add_argument('-r', '--redis', type=str, help="Specify Redis IP. Only use if --nginx is false. (Default is Yggdrasil_Core IP)")
args = parser.parse_args()
config = args.config.rstrip('/')

load_dotenv(f"{config}/.env")
db_user = os.getenv('DB_USER')
db_pass = os.getenv('DB_PASS')
database = os.getenv('DATABASE')
db_host = os.getenv('DB_HOST')
redis_user = os.getenv('REDIS_USER')
redis_pass = os.getenv('REDIS_PASS')
ygg_core = os.getenv('YGG_CORE')
ygg_core_port = os.getenv('YGG_CORE_PORT')
ygg_dir = os.getenv('ENDPOINT')

if args.no_nginx == False and args.redis:
    redis_host = args.redis
elif args.no_nginx == True and args.redis:
    print(f"{RED}ERROR: You don't need to specify redis host if it's behind a TCP reverse proxy{RESET}")
    exit(1)
else:
    redis_host = ygg_core

script_dir = os.path.dirname(os.path.abspath(__file__))
history_csv = os.path.join(script_dir, "history.csv")
ca_cert = f"{config}/nginx/certs/ca.crt"
cert = f"{config}/nginx/certs/client.crt"
key = f"{config}/nginx/certs/client.key"

r = redis.Redis(
    host=redis_host,
    port=6379,
    db=0,
    decode_responses=False,
    username="default",
    password=redis_pass,
    ssl=True,
    ssl_ca_certs=ca_cert,
    ssl_cert_reqs="required",
    ssl_check_hostname=True,
    ssl_certfile=cert,
    ssl_keyfile=key
    )

if not os.path.exists(history_csv):
    with open('history.csv', 'w', newline='') as file:
        writer = csv.writer(file)
        writer.writerow(['Agent', 'IP', 'Hostname', 'Command', 'Time'])


sql_ssl = {
    'ssl_ca': ca_cert,
    'ssl_cert': cert,
    'ssl_key': key
}
# variables get imported to commands.py so no need to reinitialize variables in commands.py
try:
    URL = f"mysql+pymysql://{db_user}:{db_pass}@{db_host}:3306/{database}"
    engine = create_engine(
        URL,
        connect_args={"ssl": sql_ssl},
        pool_size=5, # keep 5 open connections ready
        max_overflow=10, # allow up to 10 extra if demand spikes
        pool_recycle=1800, # recycle connections after 30 min
        pool_pre_ping=True # check if connection is alive before use
    )
except:
    print(f"{RED}ERROR: Can't connect to MariaDB Platform!{RESET}")


# Prints a nicely formatted table of agent callback information
def print_table(table):
    with engine.begin() as conn:
        sql_select = text(f"SELECT uuid, name, status, profile, ip, hostname, user FROM {table} ORDER BY first_seen ASC")
        tmp = conn.execute(sql_select)
        result = tmp.fetchall()

    if not result:
        print(f"{CYAN}No Callbacks Yet!{RESET}")
        return

    # Print in a nicely formatted table. Unnecessary but visually better
    INDEX_WIDTH = 7
    NAME_WIDTH = 37
    STATUS_WIDTH = 8
    PROFILE_WIDTH = 15
    HOSTNAME_WIDTH = 25
    IP_WIDTH = 17
    USER_WIDTH = 17
    # Add length of new columns here. Future implement: IP column
    total_width = INDEX_WIDTH + NAME_WIDTH + STATUS_WIDTH + PROFILE_WIDTH + IP_WIDTH + HOSTNAME_WIDTH + USER_WIDTH + 22
    print('=' * total_width)
    print(f'| {"Index":^{INDEX_WIDTH}} | {"Agent Name":^{NAME_WIDTH}} | {"Hostname":^{HOSTNAME_WIDTH}} | {"IP":^{IP_WIDTH}} | {"User":^{USER_WIDTH}} | {"Profile":^{PROFILE_WIDTH}} | {"Status":^{STATUS_WIDTH}} |') # Print column headers and centers them. 
    print('=' * total_width)

    # print and format the table
    for index, row in enumerate(result):
        status = row[2]
        index_cell = str(index).center(INDEX_WIDTH)
        name_cell = row[1].center(NAME_WIDTH)
        profile_cell = row[3].center(PROFILE_WIDTH)
        status_cell = row[2].center(STATUS_WIDTH)
        ip_cell = row[4].center(IP_WIDTH)
        hostname_cell = row[5].center(HOSTNAME_WIDTH)
        user_cell = row[6].center(USER_WIDTH)
        if status == "DEAD":
            print(f"| {index_cell} | {CYAN}{name_cell}{RESET} | {CYAN}{hostname_cell}{RESET} | {CYAN}{ip_cell}{RESET} | {CYAN}{user_cell}{RESET} | {CYAN}{profile_cell}{RESET} | {RED}{status_cell}{RESET} |")
        elif status == "ALIVE":
            print(f"| {index_cell} | {CYAN}{name_cell}{RESET} | {CYAN}{hostname_cell}{RESET} | {CYAN}{ip_cell}{RESET} | {CYAN}{user_cell}{RESET} | {CYAN}{profile_cell}{RESET} | {GREEN}{status_cell}{RESET} |")
        else:
            print(f"| {index_cell} | {CYAN}{name_cell}{RESET} | {CYAN}{hostname_cell}{RESET} | {CYAN}{ip_cell}{RESET} | {CYAN}{user_cell}{RESET} | {CYAN}{profile_cell}{RESET} | {status_cell} |")
        print('-' * total_width)

    return result


# Keeps track of command history for each LOCAL operator. (Remote operators generate their own files.)
def csv_history(profile, ip, command, hostname):
    utc = datetime.now()
    time = utc.isoformat(" ", "seconds")
    with open('history.csv', 'a', newline='') as file:
        writer = csv.writer(file)
        writer.writerow([profile, ip, hostname, command, time]) #add hostname to headers


# Listener to obtain output from agent
def sub_listener(output_keys):
    try: 
        keys = set(output_keys.keys())
        pubsub = r.pubsub(ignore_subscribe_messages=True)
        pubsub.subscribe(*output_keys.keys())
        for output in pubsub.listen():
            channel = output['channel'].decode('utf-8')
            data = output['data']

            # Process the actual message
            if channel in keys:
                try:
                    print(f"\n{GREEN}{output_keys[channel]}:\n{RESET}{data.decode('utf-8')}\n")
                    pubsub.unsubscribe(channel)
                    
                except:
                    print(data)
                finally:
                    keys.remove(channel)
            
            if not keys:
                print(f"{CYAN}=============== All Output Received ==============={RESET}\n")
                break
        pubsub.close()
    except:
        pubsub = r.pubsub(ignore_subscribe_messages=True)
        pubsub.subscribe(output_keys)
        for output in pubsub.listen():
            try: 
                channel = output['channel'].decode('utf-8')
                data = output['data']
                print(f"\n{data.decode('utf-8')}")
                
            except:
                print(f"\n{data}")
            break
        pubsub.unsubscribe(channel)
        pubsub.close()


# Listener to get notified whenever a new agent appears
def redis_listener(): 
    pubsub = r.pubsub(ignore_subscribe_messages=True)
    pubsub.subscribe("new_agent")
    for output in pubsub.listen():
        data = output['data'].decode('utf-8')
        print(f"\n{CYAN}New Agent Callback: {data.rstrip('\n')}{RESET}")



# variables get imported to commands.py so no need to reinitialize variables in commands.py
header = {
    "Content-Type": "application/json", 
    "Sec-Purpose": "operator",
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36"
}
null_output = [
    "exit",
]

url = f"https://{ygg_core}:{ygg_core_port}{ygg_dir}"
# Send command to Yggdrasil_Core for processing
def send_cmd(uuid, cmd):
    key = f"{os.getenv('UUID')}-output"
    raw_cmd = cmd.split(" ", 1) # get the command (first word)
    if raw_cmd[0] not in null_output:
        thread = threading.Thread(target=sub_listener, args=(key,)) # Subscribe to redis channel for output.
        thread.start()

    try:
        json_payload = {"uuid": uuid, "command": cmd}
        response = requests.post(url, verify=False, json=json_payload, headers=header)
        csv_history(os.getenv('PROFILE'), os.getenv('IP'), cmd, os.getenv('HOSTNAME'))
    except:
        print(f"{RED}ERROR: Failed to send. Is HTTP Listener running?{RESET}")
        return

    if raw_cmd[0] not in null_output and thread is not None:
        thread.join()