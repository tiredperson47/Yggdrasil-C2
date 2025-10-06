#ifndef CMD_CAT_H
#define CMD_CAT_H

// Standard library includes that might be needed by the function declaration
#include <liburing.h>

void cmd_cat(request_t *req, int sockfd, const char *uuid, const char *input);

#endif