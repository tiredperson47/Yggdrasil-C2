#!/bin/bash

read -p "This script will stop all Yggdrasil C2 containers and DELETE ALL DATA. Continue? (y/n) " choice

if [[ $choice == y || $choice == Y ]] then
    if [[ "${1,,}" == "full" ]] then
        sudo docker system prune -a
    else
        sudo docker stop $(sudo docker ps -q)
        sudo docker container prune
        sudo docker builder prune
        sudo docker network prune
        sudo docker image prune
    fi
    sudo rm -r ../Handlers/mariadb/data
else
    echo "[!] Quitting script..."
fi
