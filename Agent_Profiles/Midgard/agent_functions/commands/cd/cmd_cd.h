#ifndef CMD_CD_H
#define CMD_CD_H

// Standard library includes that might be needed by the function declaration
#include <liburing.h>

void cmd_cd(request_t *req, int sockfd, const char *uuid, const char *dir);

#endif