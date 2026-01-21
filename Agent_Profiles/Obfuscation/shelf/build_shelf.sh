#!/bin/bash	

ARCH="$1"
NAME="$2"
    
if [[ $ARCH == "aarch64" || $ARCH == "AARCH64" ]]; then
    xxd -n "agent" -i $NAME > ../Obfuscation/shelf/agent.h
    gcc -static -pie -s -fPIE -Wall -o ./$NAME ../Obfuscation/shelf/shelf-arm.c
elif [[ $ARCH == "x86_64" || $ARCH == "X86_64" ]]; then
    xxd -n "agent" -i $NAME > ../Obfuscation/shelf/agent.h
    gcc -static -pie -g -fPIE -Wall -o ./$NAME ../Obfuscation/shelf/shelf-amd.c
else
    echo "Error: Unknown or unset architecture: $ARCH"
    exit 1
fi

echo "Build complete for $NAME ($ARCH)"