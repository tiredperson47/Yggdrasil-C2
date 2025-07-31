#ifndef CONNECTION_H
#define CONNECTION_H

// Standard library includes that might be needed by the function declaration
#include <stdlib.h>
#include <liburing.h>
#include "req_struct.h"

int connection(struct io_uring *ring, request_t *req);
void send_get(struct io_uring *ring, request_t *req, const char *uuid);
#endif