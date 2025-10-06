#ifndef REQ_STRUCT_H
#define REQ_STRUCT_H

#include <netinet/in.h>
#include <sys/uio.h>
#include "mbedtls/net_sockets.h"
#include "mbedtls/ssl.h"
#include "mbedtls/entropy.h"
#include "mbedtls/ctr_drbg.h"
#include "mbedtls/error.h"
#include "mbedtls/x509_crt.h"
#include "liburing.h"

#define BUFFER_SIZE 16384

#include <stdlib.h>
#include <liburing.h>

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

#endif