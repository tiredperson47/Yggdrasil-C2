from commands import *
import os
import yaml
from functions import *
import threading

script_dir = os.path.dirname(os.path.abspath(__file__))
profile_path = os.path.join(script_dir, '..', 'Agent_Profiles')

server_command = {
    "agents": agents,
    # "payloads": payloads,
    "uuid": uuid,
    "history": history,
    "clear": clear,
    "delete": delete,
    "rename": rename,
    "help": help,
    "uuid2name": uuid2name,
    "name2uuid": name2uuid,
    "mass": mass,
    "lshell": lshell,
}

thread = threading.Thread(target=redis_listener, daemon=True)
thread.start()

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
        message_to_send = input(f"{GREEN}Yggdrasil {DGRN}[{os.getenv('NAME')}]{RESET} > {RESET}")
        if not message_to_send.strip():
            continue
        split_cmd = message_to_send.split(" ", 1)
        cmd_input = split_cmd[0]
        if len(split_cmd) == 2:
            cmd_args = split_cmd[1]
        else:
            cmd_args = ""

        if cmd_input in server_command:
            cmd = server_command[cmd_input]
            cmd(cmd_args)
            continue

        if not os.getenv('UUID') or not os.getenv('PROFILE'):
            agents()
            continue
        
        command_config = f"{profile_path}/{os.environ['PROFILE']}/commands.yaml" 
        with open(command_config, 'r') as file:
            config = yaml.safe_load(file)
        commands = config['commands']

        if cmd_input in commands:
            send_cmd(os.getenv('UUID'), message_to_send) # if it's an agent side function, send it.
            
            if message_to_send == "exit": # exit will delete the agent uuid from redis
                print(f"{CYAN}Killing UUID: {RESET}{os.getenv('UUID')}")
                os.environ['UUID'] = ""
                os.environ['NAME'] = ""
                continue

        else:
            print(f"{RED}ERROR: Invalid command:{RESET} {cmd_input}")
                    
except KeyboardInterrupt:
    print("\nServer shutting down.")
    exit(0)