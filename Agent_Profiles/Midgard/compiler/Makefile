CC ?= gcc
PROFILE ?= Midgard
AGENT_SOURCE ?= $(PROFILE).c
NAME ?= agent
ARCH ?= x86_64
OUT_DIR ?= /app/Compiled_Payloads
WRAPPER_DIR ?= /app/Wrappers

ifeq ($(ARCH),aarch64)
CC := aarch64-linux-gnu-gcc
else
CC := x86_64-linux-gnu-gcc
endif

CFLAGS := -I. -I./agent_functions -I./compiler/cJSON -Wall -O3 -s -static-pie -fPIE
LDFLAGS := -Bstatic -luring -lmbedtls -lmbedx509 -lmbedcrypto -lm

SHELF_FLAGS := -I$(WRAPPER_DIR)/Obfuscation/shelf/$(ARCH) -I$(WRAPPER_DIR)/Obfuscation/include

# DEBUG FLAGS: 
# CFLAGS = -I. -I./agent_functions -I./compiler/cJSON -Wall -Wextra -O0 -g3 -fno-omit-frame-pointer -fsanitize=address,undefined, -static-pie -fPIE
# LDFLAGS = -fsanitize=address,undefined -luring -lmbedtls -lmbedx509 -lm -lmbedcrypto

# Process the COMMANDS variable to create a list of command source files
comma := ,
empty :=
space := $(empty) $(empty)

COMMAND_LIST := $(strip $(subst $(comma),$(space),$(COMMANDS)))
REQUIRED_COMMAND_LIST := $(strip $(subst $(comma),$(space),$(REQUIRED_COMMANDS)))

DYNAMIC_COMMAND_LIST := $(filter-out $(REQUIRED_COMMAND_LIST),$(COMMAND_LIST))

CJSON_SRC := $(wildcard compiler/cJSON/cJSON.c)
AGENT_FUNCTION_SRCS := $(shell find agent_functions/functions -name '*.c' 2>/dev/null)
COMMAND_SRCS := $(foreach cmd,$(DYNAMIC_COMMAND_LIST),agent_functions/commands/$(cmd)/cmd_$(cmd).c)

SRCS := $(AGENT_SOURCE) $(AGENT_FUNCTION_SRCS) $(COMMAND_SRCS) $(CJSON_SRC)
OBJS := $(SRCS:.c=.o)

CLEAN = Midgard.c $(wildcard agent_functions/**/**/*.c)
CLEAN_OBJ = $(CLEAN:.c=.o)

.PHONY: all agent pack clean

all: agent

agent: $(OBJS)
	mkdir -p $(OUT_DIR)
	$(CC) $(CFLAGS) -o $(OUT_DIR)/$(NAME) $^ $(LDFLAGS)

%.o: %.c
	$(CC) $(CFLAGS) $(SHELF_FLAGS) -c -o $@ $<

pack: agent
	gcc -o $(WRAPPER_DIR)/upx/upx_bytes $(WRAPPER_DIR)/upx/upx_bytes.c
	upx $(OUT_DIR)/$(NAME) -q -7
	$(WRAPPER_DIR)/upx/upx_bytes $(OUT_DIR)/$(NAME) $(OUT_DIR)/$(NAME)

shelf: $(OBJS)
	mkdir -p $(OUT_DIR)
	$(CC) $(CFLAGS) -o $(OUT_DIR)/$(NAME) $^ $(LDFLAGS)

clean:
	rm -f $(OUT_DIR)/* $(CLEAN_OBJ)