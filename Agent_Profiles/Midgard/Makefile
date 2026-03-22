CC = gcc

# RELEASE FLAGS:
CFLAGS = -I./agent_functions -Wall -O3 -s -static-pie -fPIE
LDFLAGS = -Bstatic -luring -lmbedtls -lmbedx509 -lmbedcrypto -lcjson

# DEBUG FLAGS: 
# CFLAGS = -I./agent_functions -Wall -O1 -g -fsanitize=address -fPIE
# LDFLAGS = -Bstatic -luring -lmbedtls -lmbedx509 -lmbedcrypto -lcjson -lm -pie

PACKER = upx


NAME ?= agent
ARCH ?= x86_64
HANDLERS ?= ../../Handlers
SRCS = Midgard.c $(wildcard agent_functions/**/**/*.c)


OBJS = $(SRCS:.c=.o)


all: agent pack

agent: $(OBJS)
	$(CC) $(CFLAGS) -o ../Compiled_Payloads/$(NAME) $^ $(LDFLAGS)

%.o: %.c
	$(CC) $(CFLAGS) -c -o $@ $<

pack: agent
	gcc -o ../Obfuscation/upx/upx_bytes ../Obfuscation/upx/upx_bytes.c
	$(PACKER) ../Compiled_Payloads/$(NAME) -q -7
	../Obfuscation/upx/upx_bytes ../Compiled_Payloads/$(NAME) ../Compiled_Payloads/$(NAME)

.PHONY: clean
clean:
	rm -f ../Compiled_Payloads/* $(OBJS)
