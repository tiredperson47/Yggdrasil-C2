import redis
import requests
import os
import time
import yaml
from functions import *
from sqlalchemy import create_engine, text
from dotenv import load_dotenv
import threading
import urllib3

RED = "\033[1;31m"
GREEN = "\033[1;92m"
CYAN = "\033[1;36m"
RESET = "\033[0m"

# Dictionary used for the help command. Add new SERVER SIDE commands here:
server_command = {
    "agents": f"{CYAN}List all agents within database and select an agent to use by index{RESET}",
    "uuid": f"{CYAN}List your current UUID{RESET}",
    "history": f"{CYAN}Get all commands sent to current Agent. Pulls from Redis database by UUID{RESET}",
    "clear": f"{CYAN}Clear terminal screen{RESET}",
    "delete": f"{CYAN}Delete an agent by index. Usage: {RESET}'delete'",
    "rename": f"{CYAN}Rename an agent by selecting its index and pass a non empty string{RESET}",
    "uuid2name": f"{CYAN}Translate uuid to agent name. Usage: {RESET}'uuid2name <UUID>'",
    "name2uuid": f"{CYAN}Translate agent name to uuid. Usage: {RESET}'name2uuid <name>'",
    "lshell": f"{CYAN}Execute bash commands on the local server. Usage: {RESET} 'lshell <bash command>'",
    "mass": f"{CYAN}Select agent indexs (separated by spaces) and send a command to all of them. Usage: {RESET} 'mass <command>'"
}

null_output = [
    "exit",
]

load_dotenv("../Handlers/.env")
db_user = os.getenv('DB_USER')
db_pass = os.getenv('DB_PASS')
database = os.getenv('DATABASE')
db_host = os.getenv('HOST')
redis_host = os.getenv('REDIS_HOST')
ygg_core = os.getenv('YGG_CORE')
ygg_core_port = os.getenv('YGG_CORE_PORT')

# Create the agents.db file and table if it's not already created in the Listeners/http/ directory.
script_dir = os.path.dirname(os.path.abspath(__file__))
db_path = os.path.join(script_dir, '..', 'Handlers', 'data', 'agents.db')

# Connect to redis database. Redis stores Agent commands
r = redis.Redis(host=redis_host, port=6379, db=0, decode_responses=False)
url = f"https://{ygg_core}:{ygg_core_port}/admin"
urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning) # To hide warnings about self signed ssl

header = {"Content-Type": "application/json"}

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


# Sends agent commands to the Gunicorn/flask app HTTP listener at /admin
def send_cmd(id, cmd):
    key = f"{os.getenv('UUID')}-output"
    raw_cmd = cmd.split(" ", 1) # get the command (first word)
    if raw_cmd[0] not in null_output:
        thread = threading.Thread(target=sub_listener, args=(key,))
        thread.start()

    try:
        json_payload = {"uuid": id, "command": cmd}
        response = requests.post(url, verify=False, json=json_payload, headers=header)
        csv_history(os.getenv('PROFILE'), os.getenv('IP'), cmd, os.getenv('HOSTNAME'))
    except:
        print(f"{RED}ERROR: Failed to send. Is HTTP Listener running?{RESET}")
        return

    if raw_cmd[0] not in null_output and thread is not None:
        thread.join()


def agents(*agrs):
    result = print_table()
    try:
    # get int user input and grab the uuid of that agent name. Allows for Name to UUID translation.
        agent_index = int(input(f"{CYAN}Select an Agent: {RESET}"))  
        if agent_index > len(result) - 1:
            print(f"{RED}ERROR: Invalid agent index {RESET}")
            return
    except ValueError:
        print(f"{RED}ERROR: Input must be a number {RESET}")
        return
    os.environ['UUID'] = result[agent_index][0]
    os.environ['NAME'] = result[agent_index][1]
    os.environ['PROFILE'] = result[agent_index][3]
    os.environ['IP'] = result[agent_index][4]
    os.environ['HOSTNAME'] = result[agent_index][5]


# Grab uuid stored in environmental variable
def uuid(*bruh):
    id = os.getenv('UUID')
    print(f"{CYAN}Current UUID: {RESET}{id}")

# Get all commands sent to the agent. 
def history(length):
    try:
        if length:
            tmp = int(length)
            index = -tmp
        else:
            index = 1
        raw = r.lrange(os.getenv('UUID'), index, -1)
        hist = []
        for i in range(len(raw)):
            if raw[i].decode('utf-8') != "SEEN" and raw[i].decode('utf-8') != "AGENT REGISTERED": # Skip lines that have SEEN or AGENT REGISTERED
                hist.append(raw[i].decode('utf-8'))
        
        for i in range(len(hist)):
            print(f'{i}) {hist[i]}')
    except:
        print(f"{RED}ERROR: No history found or empty Redis{RESET}")


def clear(bruh):
    os.system("clear")


def delete(bruh):
    agent_list = print_table()
    agent_index = list(map(int, input(f"{CYAN}Select Agent indexes separated by spaces: {RESET}").split()))
    for i in range(len(agent_index)):
        # conn = sqlite3.connect(db_path)
        with engine.begin() as conn:
            sql_delete = text("DELETE FROM agents WHERE uuid = :uuid AND NOT status = :status") # Update sqlite database
            uuid = agent_list[agent_index[i]][0]
            name = agent_list[agent_index[i]][1]
            tmp = conn.execute(sql_delete, {"uuid": uuid, "status": "ALIVE"})
        
        if tmp.rowcount == 0:
            print(f'{RED}ERROR: An Agent is alive{RESET}')
            choice = input(f'{RED}Are you sure you want to delete: {name}? THIS WILL KILL THE AGENT!{RESET} (y/n): ')

            if choice == "y" or choice == "Y":
                send_cmd(agent_list[agent_index[i]][0], "exit")
            else:
                print(f'{CYAN}Skipping:{RESET} {name}')
        else:
            r.delete(uuid)
            # r.delete(f"{uuid}-output")
            if os.getenv('UUID') and uuid == os.getenv('UUID'):
                os.environ['UUID'] = ""
                os.environ['NAME'] = ""


# Rename agents by index
def rename(bruh):
    result = print_table()
    try:
    # get int user input and grab the uuid of that agent name. Allows for Name to UUID translation.
        agent_index = int(input(f"\n{CYAN}Select an Agent to Rename: {RESET}"))  
        new_name = input(f"{CYAN}New Name: {RESET}")
        if agent_index > len(result) - 1 or new_name == "":
            print(f"{RED}ERROR: Invalid agent index or NULL name{RESET}")
            return
        
    except ValueError:
        print(f"{RED}ERROR: Input must be a number{RESET}")
        return

    try: 
        # conn = sqlite3.connect(db_path)
        with engine.begin() as conn:
            uuid = result[agent_index][0] # result is from print_table()
            sql_update = text("UPDATE agents SET name = :name WHERE uuid = :uuid") # Update database
            conn.execute(sql_update, {"name": new_name, "uuid": uuid})

        os.environ['NAME'] = new_name
    except:
        print(f"{RED}ERROR: Name already exists{RESET}")
        return


def help(cmd):
    command = cmd.split(" ", 1)
    if command[0]:
        if command[0] in server_command:
            print(server_command[command[0]])  # Print command description from server_command dictionary at the top
        elif os.getenv('PROFILE'):
            script_dir = os.path.dirname(os.path.abspath(__file__)) #Open Agent's commands.yaml file to find and list command descriptions
            profile_path = os.path.join(script_dir, '..', 'Agent_Profiles')
            command_config = f"{profile_path}/{os.environ['PROFILE']}/commands.yaml" #Build absolute path
            with open(command_config, 'r') as file:
                config = yaml.safe_load(file)
            command_list = config.get('help', {})
            tmp = command_list.get(command[0])
            if tmp:
                print(f"{CYAN}{tmp}{RESET}")
        else:
            print(f"{RED}ERROR: Command not found or Profile not set{RESET}")
    else: # List all commands. List agent commands as well if profile env is set.
        for key in server_command.keys():
            print(f"{CYAN}└─ {key}{RESET}")

        if os.getenv('PROFILE'):
            script_dir = os.path.dirname(os.path.abspath(__file__))
            profile_path = os.path.join(script_dir, '..', 'Agent_Profiles')
            command_config = f"{profile_path}/{os.environ['PROFILE']}/commands.yaml" # build absolute path
            with open(command_config, 'r') as file:
                config = yaml.safe_load(file)
            commands = config['commands']

            for i in range(len(commands)):
                print(f"{CYAN}└─ {commands[i]}{RESET}")

# Translate uuid to agent name
def uuid2name(uuid):
    # conn = sqlite3.connect(db_path)
    with engine.begin() as conn:
        query = text("SELECT name FROM agents WHERE uuid = :uuid")
        tmp = conn.execute(query, {"uuid": uuid})
        name = tmp.fetchone()
    if name:
        print(f"{CYAN}Name: {RESET}{name[0]}")
    else:
        print(f"{RED}ERROR: UUID not found{RESET}")

# translate agent name to uuid. 
def name2uuid(name):
    # conn = sqlite3.connect(db_path)
    with engine.begin() as conn:
        query = text("SELECT uuid FROM agents WHERE name = :name")
        tmp = conn.execute(query, {"name": name})
        uuid = tmp.fetchone()
    if uuid:
        print(f"{CYAN}UUID: {RESET}{uuid[0]}")
    else:
        print(f"{RED}ERROR: Name not found{RESET}")


def mass(bruh):
    result = print_table()
    agent_index = list(map(int, input(f"{CYAN}Select Agent indexes separated by spaces: {RESET}").split()))
    command = input(f"{CYAN}Command to send to Agents: {RESET}")
    output_keys = {}

    for i in range(len(agent_index)):
        output_keys[f"{result[agent_index[i]][0]}-output"] = result[agent_index[i]][1]   # creates {<uuid>-output: name}

    # handles commands that don't return outputs. 
    cmd = command.split(" ", 1)
    
    if cmd[0] not in null_output:
        thread = threading.Thread(target=sub_listener, args=(output_keys,))
        thread.start()
    else:
        print(f"\n{CYAN}=============== No Output Expected. Skipping... ==============={RESET}\n")

    for i in range(len(agent_index)):
        try:
            json_payload = {"uuid": result[agent_index[i]][0], "command": command}
            response = requests.post(url, verify=False, json=json_payload, headers=header)
            csv_history(result[agent_index[i]][3], result[agent_index[i]][4], command, result[agent_index[i]][5])
        except:
            print(f"{RED}ERROR: Failed to send. Is HTTP Listener running?{RESET}")
            return
        
    if cmd[0] not in null_output and thread is not None:
        thread.join()
    

    
def lshell(command):
    os.system(command)