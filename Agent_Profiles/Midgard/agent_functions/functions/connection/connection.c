#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <netinet/in.h>
#include <arpa/inet.h>
#include <unistd.h>
#include <liburing.h>
#include <errno.h>
#include "req_struct.h"
#include "functions/read_file/read_file.h"
#include "mbedtls/ctr_drbg.h"
#include "mbedtls/net_sockets.h"
#include "mbedtls/ssl.h"
#include "mbedtls/entropy.h"
#include "mbedtls/error.h"
#include "mbedtls/x509_crt.h"
#include "mbedtls/debug.h"
#include "cert.h"

#define HOST "127.0.0.1"
#define PORT 8000
#define QUEUE_DEPTH 5


int tls_ring_send(void *ctx, const unsigned char *buf, size_t len) {
    request_t *req = (request_t *)ctx;
    struct io_uring_sqe *sqe;
    struct io_uring_cqe *cqe;

    size_t sent = 0;

    // Chunking to ensure all data is sent
    while (sent < len) {
        sqe = io_uring_get_sqe(req->ring);

        io_uring_prep_send(sqe, req->client_socket, buf + sent, len - sent, 0);
        io_uring_submit(req->ring);
        io_uring_wait_cqe(req->ring, &cqe);

        int ret = cqe->res;
        io_uring_cqe_seen(req->ring, cqe);
        if (ret < 0) {
            return MBEDTLS_ERR_SSL_INTERNAL_ERROR;
        }

        sent += ret;
    }
    return (int)sent;
}

// mbedTLS receive callback using io_uring
int tls_ring_recv(void *ctx, unsigned char *buf, size_t len) {
    request_t *req = (request_t *)ctx;
    struct io_uring_sqe *sqe;
    struct io_uring_cqe *cqe;

    struct iovec iov;
    iov.iov_base = buf;
    iov.iov_len = len;

    // Read data from server
    sqe = io_uring_get_sqe(req->ring);

    io_uring_prep_readv(sqe, req->client_socket, &iov, 1, 0);
    io_uring_submit(req->ring);
    io_uring_wait_cqe(req->ring, &cqe);

    int ret = cqe->res;
    io_uring_cqe_seen(req->ring, cqe);
    if (ret < 0) {
        return MBEDTLS_ERR_SSL_INTERNAL_ERROR;
    }
    if (ret == 0) {
        return MBEDTLS_ERR_SSL_PEER_CLOSE_NOTIFY;
    }

    return ret; // Return number of bytes read
}

void dumb(void *ctx, int level, const char *file, int line, const char *str) { // This is just a dummy function to satisfy mbedTLS dependencies
    fprintf((FILE *)ctx, "%s:%04d: %s", file, line, str);
    fflush((FILE *)ctx);
}

int connection(request_t *req) {
    const char *host = HOST;
    const int port = PORT;
    req->ring = malloc(sizeof(struct io_uring));
    if (io_uring_queue_init(QUEUE_DEPTH, req->ring, 0) < 0) {
        perror("io_uring_queue_init in connection");
        free(req->ring);
        req->ring = NULL;
        return -1;
    }
    struct io_uring_sqe *sqe;
    struct io_uring_cqe *cqe;

    // Get a Submission Queue Entry (SQE) from the submission ring.
    sqe = io_uring_get_sqe(req->ring);
    // Prepare the SQE for a socket operation.
    io_uring_prep_socket(sqe, AF_INET, SOCK_STREAM, 0, 0);
    // Associate our request struct with this SQE.
    io_uring_sqe_set_data(sqe, req);
    // Tell the kernel we have a new request ready.
    io_uring_submit(req->ring);
    // Wait for the operation to complete and get the Completion Queue Entry (CQE).
    io_uring_wait_cqe(req->ring, &cqe);

    if (cqe->res < 0) {
        fprintf(stderr, "Socket creation failed: %s\n", strerror(-cqe->res));
        return 1;
    }
    // The result of a successful socket call is the new file descriptor.
    req->client_socket = cqe->res;
    // Mark the CQE as seen so the kernel can reuse it.
    io_uring_cqe_seen(req->ring, cqe);


    // --- 4. Connect to the Server ---
    struct sockaddr_in serv_addr;
    memset(&serv_addr, 0, sizeof(serv_addr));
    serv_addr.sin_family = AF_INET;
    serv_addr.sin_port = htons(port);
    inet_pton(AF_INET, host, &serv_addr.sin_addr);

    sqe = io_uring_get_sqe(req->ring);
    if (!sqe) {
        fprintf(stderr, "Error: io_uring submission queue is full!\n");
        // Handle the error. You might need to submit the ring and try again.
        // For now, just returning is a safe option.
        return 0; 
    }
    // Prepare the SQE for a connect operation.
    io_uring_prep_connect(sqe, req->client_socket, (struct sockaddr *)&serv_addr, sizeof(serv_addr));
    io_uring_sqe_set_data(sqe, &req);

    io_uring_submit(req->ring);
    io_uring_wait_cqe(req->ring, &cqe);

    io_uring_cqe_seen(req->ring, cqe);
    // int sockfd = req->client_socket;




    // --- Part 2: Initialize mbedTLS ---
    mbedtls_ssl_init(&req->ssl);
    mbedtls_ssl_config_init(&req->conf);
    mbedtls_x509_crt_init(&req->cacert);
    mbedtls_ctr_drbg_init(&req->ctr_drbg);
    mbedtls_entropy_init(&req->entropy);


    const char charset[] = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz1234567890";
    int charset_len = strlen(charset);

    int str_len = 45 + 1;
    char str[str_len + 1];
    for (int i = 0; i < str_len; i++) {
        int str_index = rand() % charset_len;
        str[i] = charset[str_index];
    }
    str[str_len] = '\0';


    const char *pers = str;
    if (mbedtls_ctr_drbg_seed(&req->ctr_drbg, mbedtls_entropy_func, &req->entropy, (const unsigned char *)pers, strlen(pers)) != 0) {
        fprintf(stderr, "mbedtls_ctr_drbg_seed failed\n");
        return -1;
    }

    // --- Part 3: Load the Hardcoded Server Certificate ---
    // The +1 includes the null terminator.
    int ret = mbedtls_x509_crt_parse(&req->cacert, (const unsigned char *)SERVER_CERTIFICATE_PEM, strlen(SERVER_CERTIFICATE_PEM) + 1);
    if (ret < 0) {
         fprintf(stderr, "mbedtls_x509_crt_parse returned -0x%x\n", (unsigned int)-ret);
        return -1;
    }

    // --- Part 4: Configure the SSL Context ---
    if (mbedtls_ssl_config_defaults(&req->conf, MBEDTLS_SSL_IS_CLIENT, MBEDTLS_SSL_TRANSPORT_STREAM, MBEDTLS_SSL_PRESET_DEFAULT) != 0) {
        fprintf(stderr, "mbedtls_ssl_config_defaults failed\n");
        return -1;
    }

    mbedtls_ssl_conf_dbg(&req->conf, dumb, stderr); //Dummy calls for dependencies. 
    mbedtls_debug_set_threshold(0);


    // Set the CA certificate chain for server verification
    mbedtls_ssl_conf_ca_chain(&req->conf, &req->cacert, NULL);
    // Enforce certificate verification
    mbedtls_ssl_conf_authmode(&req->conf, MBEDTLS_SSL_VERIFY_REQUIRED);
    mbedtls_ssl_conf_rng(&req->conf, mbedtls_ctr_drbg_random, &req->ctr_drbg);

    if (mbedtls_ssl_setup(&req->ssl, &req->conf) != 0) {
        fprintf(stderr, "mbedtls_ssl_setup failed\n");
        return -1;
    }

    // Set the hostname for Server Name Indication (SNI) - CRITICAL for many servers
    if (mbedtls_ssl_set_hostname(&req->ssl, HOST) != 0) {
        fprintf(stderr, "mbedtls_ssl_set_hostname failed\n");
        return -1;
    }
    
    // Allow data to pass through
    mbedtls_ssl_set_bio(&req->ssl, req, tls_ring_send, tls_ring_recv, NULL);

    // --- Part 6: Perform the TLS Handshake ---
    while ((ret = mbedtls_ssl_handshake(&req->ssl)) != 0) {
        if (ret != MBEDTLS_ERR_SSL_WANT_READ && ret != MBEDTLS_ERR_SSL_WANT_WRITE) {
            fprintf(stderr, "mbedtls_ssl_handshake returned -0x%x\n", (unsigned int)-ret);
            return -1;
        }
    }

    return req->client_socket;

}

void cleanup_connection(request_t *req) {
    if (req) {
        mbedtls_ssl_close_notify(&req->ssl);
        close(req->client_socket); // Close the underlying socket

        if(req->ring) {
            io_uring_queue_exit(req->ring);
            free(req->ring);
        }
        
        mbedtls_x509_crt_free(&req->cacert);
        mbedtls_ssl_free(&req->ssl);
        mbedtls_ssl_config_free(&req->conf);
        mbedtls_ctr_drbg_free(&req->ctr_drbg);
        mbedtls_entropy_free(&req->entropy);
        
        free(req);
    }
}