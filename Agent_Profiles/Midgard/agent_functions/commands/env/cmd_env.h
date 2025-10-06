#ifndef CMD_env_H
#define CMD_env_H

// Standard library includes that might be needed by the function declaration
#include <liburing.h>

void cmd_env(request_t *req, int sockfd, const char *uuid, const char *path);

#endif