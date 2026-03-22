#!/bin/bash	

ARCH="$1"
NAME="$2"
    
if [[ $ARCH == "aarch64" || $ARCH == "AARCH64" ]]; then
    xxd -n "agent" -i $NAME | sed 's/unsigned char/static const unsigned char/g' | sed 's/unsigned int/static const unsigned int/g' > ../Obfuscation/shelf/agent.h
    aarch64-linux-gnu-gcc -O3 -fPIC -fPIE -ffreestanding -fno-builtin -fno-stack-protector -nostdlib -nodefaultlibs -fvisibility=hidden -c ../Obfuscation/shelf/shelf-aarch64.c -o ../Obfuscation/shelf/injection/loader.o
    aarch64-linux-gnu-ld -T ../Obfuscation/shelf/linker.ld --omagic -o ../Obfuscation/shelf/injection/loader.elf ../Obfuscation/shelf/injection/loader.o
    aarch64-linux-gnu-objcopy -O binary ../Obfuscation/shelf/injection/loader.elf ../Obfuscation/shelf/injection/loader.bin
    xxd -n "agent" -i ../Obfuscation/shelf/injection/loader.bin | sed 's/unsigned char/static const unsigned char/g' | sed 's/unsigned int/static const unsigned int/g' > ../Obfuscation/shelf/injection/agent.h
    aarch64-linux-gnu-gcc -static -pie -s -fPIE -Wall -O3 -o ../Obfuscation/shelf/injection/inject ../Obfuscation/shelf/injection/aarch64_reg.c
    mv ../Obfuscation/shelf/injection/inject ../Compiled_Payloads/$NAME
elif [[ $ARCH == "x86_64" || $ARCH == "X86_64" ]]; then
    xxd -n "agent" -i $NAME | sed 's/unsigned char/static const unsigned char/g' | sed 's/unsigned int/static const unsigned int/g' > ../Obfuscation/shelf/agent.h
    x86_64-linux-gnu-gcc -O3 -fPIC -fPIE -ffreestanding -fno-builtin -fno-stack-protector -nostdlib -nodefaultlibs -fvisibility=hidden -c ../Obfuscation/shelf/shelf-x86_64.c -o ../Obfuscation/shelf/injection/loader.o
    x86_64-linux-gnu-ld -T ../Obfuscation/shelf/linker.ld --omagic -o ../Obfuscation/shelf/injection/loader.elf ../Obfuscation/shelf/injection/loader.o
    x86_64-linux-gnu-objcopy -O binary ../Obfuscation/shelf/injection/loader.elf ../Obfuscation/shelf/injection/loader.bin
    xxd -n "agent" -i ../Obfuscation/shelf/injection/loader.bin | sed 's/unsigned char/static const unsigned char/g' | sed 's/unsigned int/static const unsigned int/g' > ../Obfuscation/shelf/injection/agent.h
    x86_64-linux-gnu-gcc -static -pie -s -fPIE -Wall -O3 -o ../Obfuscation/shelf/injection/inject ../Obfuscation/shelf/injection/x86_64_reg.c
    mv ../Obfuscation/shelf/injection/inject ../Compiled_Payloads/$NAME
else
    echo "Error: Unknown or unset architecture: $ARCH"
    exit 1
fi
echo "============== Build complete for $NAME ($ARCH) =============="