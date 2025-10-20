#ifndef REQ_STRUCT_H
#define REQ_STRUCT_H

#include "mbedtls/ssl.h"
#include "mbedtls/entropy.h"
#include "mbedtls/ctr_drbg.h"
#include "liburing.h"

#define BUFFER_SIZE 16384

typedef struct request {
    int client_socket;
    char buffer[BUFFER_SIZE];
    struct iovec iov;

    mbedtls_entropy_context entropy;
    mbedtls_ctr_drbg_context ctr_drbg;
    mbedtls_ssl_context ssl;
    mbedtls_ssl_config conf;
    mbedtls_x509_crt cacert;

    struct io_uring *ring;
} request_t;

typedef struct {
    char *uuid;
    char *hostname;
    char *path;
    char *user;
    char *method;
    char *agent;
} profile_t;

#endif