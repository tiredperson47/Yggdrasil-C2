import requests
import redis
import sys
from commands import *
import os

RED = "\033[1;31m"
GREEN = "\033[1;92m"
CYAN = "\033[1;36m"
RESET = "\033[0m"

url = "http://127.0.0.1:8000/admin" # change later to proper port/ip/domain name

def cmd_check(message):
    if not message:
        return "invalid"

    if message in agent_command:
        return "agent"
    elif message in server_command:
        return "server"
    else:
        return "invalid"

server_command = {
    "agents": agents,
    "uuid": uuid,
    "history": history,
    "clear": clear,
    "delete": delete,
}

agent_command = {
    "ls",
    "exit",
    "sleep",
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
print(logo)
print("========================== Select an Agent ==========================\n")

# A forever loop to accept client connections
try:
    while True:
        if not os.getenv('UUID'):
            agents()
        
        message_to_send = input(f"{GREEN}Yggdrasil > {RESET}")
        if not message_to_send.strip():
            continue
        split_cmd = message_to_send.split(" ", 1)
        cmd_input = split_cmd[0]
        if len(split_cmd) == 2:
            cmd_args = split_cmd[1]
        else:
            cmd_args = ""


        # check to see if it's a server or agent side command. 
        if cmd_check(cmd_input) == "server":
            cmd = server_command[cmd_input]
            cmd(cmd_args)
            continue
        
        elif cmd_check(cmd_input) == "agent":
            send_cmd(url, message_to_send) # if it's an agent side function, send it immediately.
            
            if message_to_send == "exit": # exit will delete the agent uuid from redis
                print(f"\n========== Killing {os.getenv('UUID')} ==========")
                del os.environ['UUID']
                continue

        else:
            print(f"{RED}ERROR: Invalid command:{RESET} {cmd_input}")
            continue
                    
except KeyboardInterrupt:
    print("\nServer shutting down.")
    exit(0)