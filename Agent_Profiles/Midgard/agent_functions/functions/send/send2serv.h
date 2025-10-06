#ifndef SEND2SERV_H
#define SEND2SERV_H

// Standard library includes that might be needed by the function declaration
#include <liburing.h>
#include "functions/connection/req_struct.h"

int send2serv(request_t *req, const char *uuid, const char *buf, size_t len);
char *send_get(request_t *req, const char *uuid, char *path, char *hostname);
#endif // SEND2SERV_H
