CC = gcc
CFLAGS = -I./agent_functions -Wall -O3 -s -static-pie -fPIE
LDFLAGS = -static-pie -fPIE -s -Bstatic -luring -lmbedtls -lmbedx509 -lmbedcrypto

PACKER ?= upx


NAME ?= agent
ARCH ?= arm
SRCS = Midgard.c $(wildcard agent_functions/**/**/*.c)


OBJS = $(SRCS:.c=.o)


all: agent pack shelf

agent: $(OBJS)
	$(CC) $(CFLAGS) -o $(NAME) $^ $(LDFLAGS)

%.o: %.c
	$(CC) $(CFLAGS) -c -o $@ $<

pack: agent
	gcc -o ../Obfuscation/upx/upx_bytes ../Obfuscation/upx/upx_bytes.c
	$(PACKER) $(NAME) -q -7
	../Obfuscation/upx/upx_bytes $(NAME) $(NAME)

shelf: agent
	@../Obfuscation/shelf/build_shelf.sh $(ARCH) $(NAME)

.PHONY: clean
clean:
	rm -f $(NAME) $(OBJS) ../Obfuscation/shelf-arm/agent.h
