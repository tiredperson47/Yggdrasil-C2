import redis
import requests
import os

RED = "\033[1;31m"
GREEN = "\033[1;92m"
CYAN = "\033[1;36m"
RESET = "\033[0m"

r = redis.Redis(host='127.0.0.1', port=6379, db=0, decode_responses=True)

header = {"Content-Type": "application/json"}

def send_cmd(url, cmd):
    id = os.getenv('UUID')
    json_payload = {"uuid": id, "command": cmd}
    response = requests.post(url, json=json_payload, headers=header)

def agents(*args):
    if r.exists("agents") == 0:
        print(f"{CYAN}No Callbacks Yet!{RESET}")
        return

    agent_list = r.lrange("agents", 0, -1)
    
    for i in range(len(agent_list)):
        print(f'{i}) {agent_list}\n')
    try:
        index = int(input(f"{CYAN}Select an Agent: {RESET}"))
        if index > len(agent_list) - 1:
            print(f"{RED}ERROR: Invalid agent index {RESET}")
            return
    except:
        print(f"{RED}ERROR: Input must be a number {RESET}")
        return
    os.environ['UUID'] = agent_list[index]

def uuid(*args):
    print(os.getenv('UUID'))

def history(length):
    if length:
        tmp = int(length)
        index = -tmp
    else:
        index = 1
    raw = r.lrange(os.getenv('UUID'), index, -1)
    hist = []
    for i in range(len(raw)):
        if raw[i] != "SEEN" and raw[i] != "AGENT REGISTERED":
            hist.append(raw[i])
    
    for i in range(len(hist)):
        print(f'{i}) {hist[i]}')

def rename(*args):
    agent_list = r.lrange("agents", 0, -1)
    for i in range(len(agent_list)):
        print(f'{i}) {agent_list}\n')
    try:
        index = int(input(f"{CYAN}Index of Agent to Rename: {RESET}"))
        if index > len(agent_list) - 1:
            print(f"{RED}ERROR: Invalid Agent Index{RESET}")
            return
    except:
        print(f"{RED}ERROR: Input must be a number!{RESET}")
        return
    
    new_name = input(f"{CYAN}New Name: {RESET}")
    if new_name in agent_list:
        print(f"{RED}ERROR: Name already exists: {RESET}{new_name}")
    else:
        r.lset("agents", index, new_name)
        r.rename(agent_list[index], new_name)
        if os.getenv('UUID') == agent_list[index]:
            os.environ['UUID'] = new_name

def clear(*args):
    os.system("clear")

def delete(name):
    # Check if they pass an argument
    if name != None and r.exists(name):
        r.delete(name)
        r.lrem("agents", 0, name)
    else:
        agent_list = r.lrange("agents", 0, -1)
        for i in range(len(agent_list)):
            print(f'{i}) {agent_list}\n')
        try:
            index = int(input(f"{CYAN}Select an Agent to Delete: {RESET}"))
            if index > len(agent_list) - 1:
                print(f"{RED}ERROR: Invalid agent index {RESET}")
                return
        except:
            print(f"{RED}ERROR: Input must be a number {RESET}")
            return
        r.delete(agent_list[index])
        r.lrem("agents", 0, agent_list[index])