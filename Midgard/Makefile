# Makefile for the 'agent' project

# 1. Compiler and Flags
# ---------------------
# CC: The C compiler we will use.
# CFLAGS: Flags passed to the compiler for compilation steps.
#   -I./commands: Tells gcc to look in the 'commands' directory for headers.
#   -Wall: Enables all compiler warnings (highly recommended).
#   -g: Includes debugging information in the executable.
# LDFLAGS: Flags passed to the linker for the final linking step.
#   -Wl,-Bstatic: Tells the linker to prefer static libraries.
#   -luring: The name of the library to link (liburing).
#   -Wl,-Bdynamic: Tells the linker to revert to dynamic linking for any
#                  subsequent default libraries (like libc).
CC = gcc
CFLAGS = -I./agent_functions -Wall -g
LDFLAGS = -Wl,-Bstatic -luring -Wl,-Bdynamic,-g

# 2. Files and Directories
# ------------------------
# TARGET: The name of the final executable file.
# SRCS: A list of all your .c source files.
#       The '$(wildcard ...)' function automatically finds all files matching
#       the pattern. This is the magic that solves your problem of listing
#       all 20 files manually. It finds agent.c and all .c files inside
#       any subdirectory of 'commands'.
TARGET = agent
SRCS = Midgard.c $(wildcard agent_functions/**/**/*.c)

# OBJS: The list of object files (.o) that will be created from the .c files.
#       This line automatically converts a list like "a.c b.c" to "a.o b.o".
OBJS = $(SRCS:.c=.o)


# 3. Build Rules
# --------------
# The 'all' rule is the default rule that runs when you just type 'make'.
# It depends on the $(TARGET), so 'make' will try to build the target executable.
all: $(TARGET)

# This rule tells 'make' how to create the final executable.
# It now includes $(LDFLAGS) to pass the linking flags to the compiler.
# It depends on all the object files ($(OBJS)).
# The command '$@' is a shortcut for the rule's target (agent_executable).
# The command '$^' is a shortcut for all the dependencies (all the .o files).
$(TARGET): $(OBJS)
	$(CC) $(CFLAGS) -o $@ $^ $(LDFLAGS)

# This is a pattern rule that tells 'make' how to create a .o file from a .c file.
# It compiles each source file into an object file without linking.
# '$<' is a shortcut for the first dependency (the .c file).
%.o: %.c
	$(CC) $(CFLAGS) -c -o $@ $<

# 4. Utility Rules
# ----------------
# The 'clean' rule is for cleanup. It's not a file, so we mark it as .PHONY.
# It removes the executable and all the generated object files.
.PHONY: clean
clean:
	rm -f $(TARGET) $(OBJS)