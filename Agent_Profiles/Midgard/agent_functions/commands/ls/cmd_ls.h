#ifndef CMD_LS_H
#define CMD_LS_H

// Standard library includes that might be needed by the function declaration
#include <liburing.h>

void cmd_ls(request_t *req, int sockfd, const char *uuid, const char *input);

#endif