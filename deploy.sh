#!/bin/bash

source venv/bin/activate
/usr/bin/pip install -r requirements.txt
source .env
/usr/bin/sudo /usr/bin/docker pull redis:latest
/usr/bin/sudo /usr/bin/docker run -d -p 127.0.0.1:6379:6379 --name redis redis

cd Listeners/http
/usr/bin/gunicorn --workers 4 --bind 0.0.0.0:8000 app:app &
