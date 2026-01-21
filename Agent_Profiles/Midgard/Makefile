CC = gcc
CFLAGS = -I./agent_functions -Wall -O3 -g -static-pie -fPIE
LDFLAGS = -Bstatic -luring -lmbedtls -lmbedx509 -lmbedcrypto -lcjson

PACKER = upx


NAME ?= agent
ARCH ?= x86_64
HANDLERS ?= ../../Handlers
SRCS = Midgard.c $(wildcard agent_functions/**/**/*.c)


OBJS = $(SRCS:.c=.o)


all: agent pack shelf

agent: $(OBJS)
	$(CC) $(CFLAGS) -o ../Compiled_Payloads/$(NAME) $^ $(LDFLAGS)

%.o: %.c
	$(CC) $(CFLAGS) -c -o $@ $<

pack: agent
	gcc -o ../Obfuscation/upx/upx_bytes ../Obfuscation/upx/upx_bytes.c
	$(PACKER) ../Compiled_Payloads/$(NAME) -q -7
	../Obfuscation/upx/upx_bytes ../Compiled_Payloads/$(NAME) ../Compiled_Payloads/$(NAME)

shelf: agent
	@../Obfuscation/shelf/build_shelf.sh $(ARCH) ../Compiled_Payloads/$(NAME)


.PHONY: clean
clean:
	rm -f ../Compiled_Payloads/$(NAME) $(OBJS) ../Obfuscation/shelf-arm/agent.h
