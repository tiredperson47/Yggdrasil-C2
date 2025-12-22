#!/bin/bash	

ARCH="$1"
NAME="$2"
    
if [[ $ARCH == "arm" || $ARCH == "ARM" || $ARCH == "Arm" ]]; then
    xxd -n "agent" -i $NAME > ../Obfuscation/shelf/agent.h
    gcc -static -pie -g -fPIE -Wall -o ./$NAME ../Obfuscation/shelf/shelf.c
elif [[ $ARCH == "amd" || $ARCH == "AMD" || $ARCH == "Amd" ]]; then
    xxd -n "agent" -i $NAME > ../Obfuscation/shelf/agent.h
    gcc -static -pie -s -fPIE -Wall -o ./$NAME ../Obfuscation/shelf/nidavellir-amd.c
else
    echo "Error: Unknown or unset architecture: $ARCH"
    exit 1
fi

echo "Build complete for $NAME"