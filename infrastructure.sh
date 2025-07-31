#!/bin/bash


/usr/bin/sudo /usr/bin/docker pull redis
/usr/bin/sudo /usr/bin/docker run -d -p 127.0.0.1:6379:6379 --name my-redis redis

cd http
gunicorn --workers 4 --bind 0.0.0.0:8000 app:app &