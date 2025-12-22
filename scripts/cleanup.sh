#!/bin/bash

read -p "This script will stop all Yggdrasil C2 containers and DELETE ALL DATA. Continue? (y/n) " choice

if [[ $choice == y || $choice == Y ]] then
    /usr/bin/sudo /usr/bin/docker stop redis Yggdrasil_Core mariadb nginx http_listener
    /usr/bin/sudo /usr/bin/docker container prune
    /usr/bin/sudo /usr/bin/docker builder prune
    /usr/bin/sudo /usr/bin/docker network prune
    /usr/bin/sudo /usr/bin/docker image prune
    /usr/bin/sudo rm -r ../Handlers/mariadb/data
else
    echo "[!] Quitting script..."
fi