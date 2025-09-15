#ifndef CMD_EXECUTE_ASSEMBLY_H
#define CMD_EXECUTE_ASSEMBLY_H

// Standard library includes that might be needed by the function declaration
#include <liburing.h>

void cmd_execute_assembly(struct io_uring *ring, int sockfd, const char *uuid, const char *file);

#endif