#ifndef REQ_STRUCT_H
#define REQ_STRUCT_H

#define BUFFER_SIZE 16384

#include <stdlib.h>
#include <liburing.h>

typedef struct request {
    int client_socket;
    char buffer[BUFFER_SIZE];
    struct iovec iov;
} request_t;

#endif