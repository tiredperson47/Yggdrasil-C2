#ifndef CMD_SHELL_H
#define CMD_SHELL_H

// Standard library includes that might be needed by the function declaration
#include <liburing.h>

void cmd_shell(request_t *req, int sockfd, const char *uuid, const char *file);

#endif