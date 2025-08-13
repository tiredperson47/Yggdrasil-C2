import redis
import requests
import os
import time
import sqlite3
import yaml
from functions import *

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
    "delete": f"{CYAN}Delete an agent by name or by index. Usage: {RESET}'delete <agent_name>' OR 'delete'",
    "rename": f"{CYAN}Rename an agent by selecting its index and pass a non empty string{RESET}",
    "uuid2name": f"{CYAN}Translate uuid to agent name. Usage: {RESET}'uuid2name <UUID>'",
    "name2uuid": f"{CYAN}Translate agent name to uuid. Usage: {RESET}'name2uuid <name>'",
    "lshell": f"{CYAN}Execute bash commands on the local server. Usage: {RESET} 'lshell <bash command>'",
    "mass": f"{CYAN}Select agent indexs (separated by spaces) and send a command to all of them. Usage: {RESET} 'mass <command>'"
}

null_output = [
    "sleep",
    "exit",
]

# Create the agents.db file and table if it's not already created in the Listeners/http/ directory.
script_dir = os.path.dirname(os.path.abspath(__file__))
db_path = os.path.join(script_dir, '..', 'Listeners', 'data', 'agents.db')

# Connect to redis database. Redis stores Agent commands
r = redis.Redis(host="127.0.0.1", port=6379, db=0, decode_responses=True)
url = f"http://127.0.0.1:8000/admin" # change later to proper port/ip/domain name

header = {"Content-Type": "application/json"}

# A clean way to list agents and status.


# Sends agent commands to the Gunicorn/flask app HTTP listener at /admin
def send_cmd(cmd):
    if os.getenv('UUID'):
        id = os.getenv('UUID')
    else:
        print(f"{RED}Agent UUID not set yet!{RESET}")
        return

    try:
        json_payload = {"uuid": id, "command": cmd}
        response = requests.post(url, json=json_payload, headers=header)
        csv_history(os.getenv('PROFILE'), os.getenv('IP'), cmd)
    except:
        print(f"{RED}ERROR: Failed to send. Is HTTP Listener running?{RESET}")
        return
    
    raw_cmd = cmd.split(" ", 1) # get the command (first word)
    if raw_cmd[0] in null_output:
        return
    elif response.status_code == 200:
        key = f"{os.getenv('UUID')}-output"
        while True: # Wait for the output to appear at <uuid>-output
            if r.exists(key):
                output = r.rpop(key) # prints last index and deletes last index
                print(output)
                break
            else:
                time.sleep(1)
                continue


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
    os.environ['PROFILE'] = result[agent_index][3]
    os.environ['IP'] = result[agent_index][4]


# Grab uuid stored in environmental variable
def uuid(*bruh):
    id = os.getenv('UUID')
    print(f"{CYAN}Current UUID: {RESET}{id}")

# Get all commands sent to the agent. 
def history(length):
    if length:
        tmp = int(length)
        index = -tmp
    else:
        index = 1
    raw = r.lrange(os.getenv('UUID'), index, -1)
    hist = []
    for i in range(len(raw)):
        if raw[i] != "SEEN" and raw[i] != "AGENT REGISTERED": # Skip lines that have SEEN or AGENT REGISTERED
            hist.append(raw[i])
    
    for i in range(len(hist)):
        print(f'{i}) {hist[i]}')


def clear(bruh):
    os.system("clear")


def delete(name):
    if name: # Delete by agent name provided
        conn = sqlite3.connect(db_path)
        cur = conn.cursor()
        cur.execute("SELECT uuid FROM agents WHERE name = ?", (name,))
        uuid = cur.fetchone()
        if not uuid:
            print(f"{RED}ERROR: Invalid agent name {RESET}")
            return

        cur.execute("DELETE FROM agents WHERE name = ?", (name,))
        conn.commit()
        conn.close()
            
        if os.getenv('UUID') and uuid == os.environ['UUID']:
            del os.environ['UUID']

    else: # Delete by index
        agent_list = print_table()

        try: 
            agent_index = int(input(f"{CYAN}Select an Agent to Delete: {RESET}"))
            if agent_index > len(agent_list) - 1:
                print(f"{RED}ERROR: Invalid agent index {RESET}")
                return
        except ValueError:
            print(f"{RED}ERROR: Input must be a number {RESET}")
            return

        conn = sqlite3.connect(db_path)
        cur = conn.cursor()
        sql_delete = "DELETE FROM agents WHERE uuid = ?" # Update sqlite database
        uuid = agent_list[agent_index][0]
        cur.execute(sql_delete, (uuid,))
        conn.commit()
        conn.close
        if os.getenv('UUID') and uuid == os.environ['UUID']:
            del os.environ['UUID']

# Rename agents by index
def rename(name):
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
        conn = sqlite3.connect(db_path)
        cur = conn.cursor()
        uuid = result[agent_index][0] # result is from print_table()
        sql_update = "UPDATE agents SET name = ? WHERE uuid = ?" # Update database
        cur.execute(sql_update, (new_name, uuid))
        conn.commit()
        conn.close()
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
            command_config = f'{profile_path}/{os.environ['PROFILE']}/commands.yaml' #Build absolute path
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
            command_config = f'{profile_path}/{os.environ['PROFILE']}/commands.yaml' # build absolute path
            with open(command_config, 'r') as file:
                config = yaml.safe_load(file)
            commands = config['commands']

            for i in range(len(commands)):
                print(f"{CYAN}└─ {commands[i]}{RESET}")

# Translate uuid to agent name
def uuid2name(uuid):
    conn = sqlite3.connect(db_path)
    cur = conn.cursor()
    cur.execute("SELECT name FROM agents WHERE uuid = ?", (uuid,))
    name = cur.fetchone()
    conn.close()
    if name:
        print(f"{CYAN}Name: {RESET}{name[0]}")
    else:
        print(f"{RED}ERROR: UUID not found{RESET}")

# translate agent name to uuid. 
def name2uuid(name):
    conn = sqlite3.connect(db_path)
    cur = conn.cursor()
    cur.execute("SELECT uuid FROM agents WHERE name = ?", (name,))
    uuid = cur.fetchone()
    conn.close()
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
        uuid = result[agent_index[i]][0]
        name = result[agent_index[i]][1]
        try:
            json_payload = {"uuid": uuid, "command": command}
            response = requests.post(url, json=json_payload, headers=header)
            csv_history(result[agent_index[i]][3], result[agent_index[i]][4], command)
        except:
            print(f"{RED}ERROR: Failed to send. Is HTTP Listener running?{RESET}")
            return
        output_keys[name] = f"{uuid}-output"

    # handles commands that don't return outputs. 
    cmd = command.split(" ", 1)
    if cmd[0] in null_output:
        return

    while True:
        remove = []
        for name, key in output_keys.items():
            if r.exists(key):
                output = r.rpop(key)
                print(f"{GREEN}{name}:\n{RESET}{output}\n")
                remove.append(name)

        for name in remove:
            del output_keys[name]

        if not output_keys:
            print(f"{CYAN}=============== All Output Received ==============={RESET}")
            break

        time.sleep(1)


def lshell(command):
    os.system(command)