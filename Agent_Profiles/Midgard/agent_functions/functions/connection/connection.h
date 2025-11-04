#ifndef CONNECTION_H
#define CONNECTION_H

// Standard library includes that might be needed by the function declaration
#include <stdlib.h>
#include <liburing.h>
#include "structs.h"

int connection(request_t *req);
void cleanup_connection(request_t *req);
#endif