#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <netinet/in.h>
#include <arpa/inet.h>
#include <unistd.h>
#include <liburing.h>
#include <errno.h>
#include "req_struct.h" //This may show "no file or direcotry" error, but trust me it works

#define HOST "127.0.0.1"
#define PORT 8000

int connection(struct io_uring *ring, request_t *req) {
    const char *host = HOST;
    const int port = PORT;
    struct io_uring_sqe *sqe;
    struct io_uring_cqe *cqe;

    // Get a Submission Queue Entry (SQE) from the submission ring.
    sqe = io_uring_get_sqe(ring);
    // Prepare the SQE for a socket operation.
    io_uring_prep_socket(sqe, AF_INET, SOCK_STREAM, 0, 0);
    // Associate our request struct with this SQE.
    io_uring_sqe_set_data(sqe, req);
    // Tell the kernel we have a new request ready.
    io_uring_submit(ring);
    // Wait for the operation to complete and get the Completion Queue Entry (CQE).
    io_uring_wait_cqe(ring, &cqe);

    if (cqe->res < 0) {
        fprintf(stderr, "Socket creation failed: %s\n", strerror(-cqe->res));
        return 1;
    }
    // The result of a successful socket call is the new file descriptor.
    req->client_socket = cqe->res;
    // Mark the CQE as seen so the kernel can reuse it.
    io_uring_cqe_seen(ring, cqe);


    // --- 4. Connect to the Server ---
    struct sockaddr_in serv_addr;
    memset(&serv_addr, 0, sizeof(serv_addr));
    serv_addr.sin_family = AF_INET;
    serv_addr.sin_port = htons(port);
    inet_pton(AF_INET, host, &serv_addr.sin_addr);

    sqe = io_uring_get_sqe(ring);
    // Prepare the SQE for a connect operation.
    io_uring_prep_connect(sqe, req->client_socket, (struct sockaddr *)&serv_addr, sizeof(serv_addr));
    io_uring_sqe_set_data(sqe, &req);

    io_uring_submit(ring);
    io_uring_wait_cqe(ring, &cqe);

    io_uring_cqe_seen(ring, cqe);
    return req->client_socket;
}


void send_get(struct io_uring *ring, request_t *req, const char *uuid) {
    struct io_uring_sqe *sqe;
    struct io_uring_cqe *cqe;
    char request_buffer[2048];
    int req_len = snprintf(request_buffer, sizeof(request_buffer),
        "GET /login?uuid=%s HTTP/1.1\r\n"
        "Host: google.com\r\n"
        "User-Agent: Wget/1.20.3 (linux-gnu)\r\n"
        "Accept: */*\r\n"
        "Connection: close\r\n\r\n",
        uuid);

    sqe = io_uring_get_sqe(ring);
    io_uring_prep_send(sqe, req->client_socket, request_buffer, req_len, 0);
    io_uring_submit(ring);
    io_uring_wait_cqe(ring, &cqe);
    io_uring_cqe_seen(ring, cqe);
}