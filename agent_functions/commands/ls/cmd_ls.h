#ifndef CMD_LS_H
#define CMD_LS_H

// Standard library includes that might be needed by the function declaration
#include <liburing.h>

void cmd_ls(struct io_uring *ring, int sockfd, const char *uuid, const char *input);

#endif