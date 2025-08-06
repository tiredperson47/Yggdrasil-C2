import redis
import requests
import os
import time
import sqlite3
import yaml

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
}

# Create the agents.db file and table if it's not already created in the Listeners/http/ directory.
script_dir = os.path.dirname(os.path.abspath(__file__))
db_path = os.path.join(script_dir, '..', 'Listeners', 'http', 'agents.db')
if not os.path.exists(db_path):
    conn = sqlite3.connect(db_path)
    cur = conn.cursor()

    cur.execute('''CREATE TABLE IF NOT EXISTS agents (
        uuid TEXT PRIMARY KEY,
        name TEXT,
        status TEXT,
        first_seen TIMESTAMP,
        last_seen TIMESTAMP,
        sleep INTEGER,
        profile TEXT
        )
    ''')
    conn.commit()
    conn.close()

# Connect to redis database. Redis stores Agent commands
r = redis.Redis(host="127.0.0.1", port=6379, db=0, decode_responses=True)

header = {"Content-Type": "application/json"}

# A clean way to list agents and status.
def print_table():
    conn = sqlite3.connect(db_path)
    cur = conn.cursor()
    sql_select = """SELECT uuid, name, status, profile FROM agents"""
    cur.execute(sql_select)
    result = cur.fetchall()
    conn.close()

    if not result:
        print(f"{CYAN}No Callbacks Yet!{RESET}")
        return

    # Print in a nicely formatted table. Unnecessary but visually better
    INDEX_WIDTH = 7
    NAME_WIDTH = 25
    STATUS_WIDTH = 8
    # Add length of new columns here. Future implement: IP column
    total_width = INDEX_WIDTH + NAME_WIDTH + STATUS_WIDTH + 10
    print('=' * total_width)
    print(f'| {"Index":^{INDEX_WIDTH}} | {"Agent Name":^{NAME_WIDTH}} | {"Status":^{STATUS_WIDTH}} |') # Print column headers and centers them. 
    print('=' * total_width)

    # print the table
    for index, row in enumerate(result):
        status = row[2]
        index_cell = str(index).center(INDEX_WIDTH)
        name_cell = row[1].center(NAME_WIDTH)
        status_cell = row[2].center(STATUS_WIDTH)
        if status == "DEAD":
            print(f"| {index_cell} | {CYAN}{name_cell}{RESET} | {RED}{status_cell}{RESET} |")
        elif status == "ALIVE":
            print(f"| {index_cell} | {CYAN}{name_cell}{RESET} | {GREEN}{status_cell}{RESET} |")
        else:
            print(f"| {index_cell} | {CYAN}{name_cell}{RESET} | {status_cell} |")
        print('-' * total_width)

    return result

# Sends agent commands to the Gunicorn/flask app HTTP listener at /admin
def send_cmd(url, cmd):
    if os.getenv('UUID'):
        id = os.getenv('UUID')
    else:
        print(f"{RED}Agent UUID not set yet!{RESET}")
        return

    try:
        json_payload = {"uuid": id, "command": cmd}
        response = requests.post(url, json=json_payload, headers=header)
    except:
        print(f"{RED}ERROR: Failed to send. Is HTTP Listener running?{RESET}")
        return
    
    raw_cmd = cmd.split(" ", 1) # get the command (first word)
    if raw_cmd[0] == "exit":
        return
    elif raw_cmd[0] == "sleep":
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

# Grab uuid stored in environmental variable
def uuid(*args):
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


def clear(*args):
    os.system("clear")


def delete(name):
    if name: # Delete by agent name provided
        conn = sqlite3.connect(db_path)
        cur = conn.cursor()
        cur.execute("SELECT uuid FROM agents where name = ?", (name,)) # translate name to uuid + used for logic check
        uuid = cur.fetchone()
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
        print(f"{RED}ERROR: Input must be a number {RESET}")
        return
    conn = sqlite3.connect(db_path)
    cur = conn.cursor()
    uuid = result[agent_index][0]
    sql_update = "UPDATE agents SET name = ? WHERE uuid = ?" # Update database
    cur.execute(sql_update, (new_name, uuid))
    conn.commit()
    conn.close()


def help(cmd):
    if cmd:
        if cmd in server_command:
            print(server_command[cmd])  # Print command description from server_command dictionary at the top
        elif os.getenv('PROFILE'):
            script_dir = os.path.dirname(os.path.abspath(__file__)) #Open Agent's commands.yaml file to find and list command descriptions
            profile_path = os.path.join(script_dir, '..', 'Agent_Profiles')
            command_config = f'{profile_path}/{os.environ['PROFILE']}/commands.yaml' #Build absolute path
            with open(command_config, 'r') as file:
                config = yaml.safe_load(file)
            command_list = config.get('help', {})
            tmp = command_list.get(cmd)
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
    print(f"{CYAN}Name: {RESET}{name}")

# translate agent name to uuid. 
def name2uuid(name):
    conn = sqlite3.connect(db_path)
    cur = conn.cursor()
    cur.execute("SELECT uuid FROM agents WHERE name = ?", (name,))
    uuid = cur.fetchone()
    conn.close()
    print(f"{CYAN}UUID: {RESET}{uuid}")