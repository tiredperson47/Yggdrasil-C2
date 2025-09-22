#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <netinet/in.h>
#include <arpa/inet.h>
#include <unistd.h>
#include <liburing.h>
#include <errno.h>
#include "req_struct.h"
#include "functions/http_parse/http_parse.h"
#include "functions/read_file/read_file.h"

#define HOST "127.0.0.1"
#define PORT 8000
#define PROFILE "Midgard"

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
    if (!sqe) {
        fprintf(stderr, "Error: io_uring submission queue is full!\n");
        // Handle the error. You might need to submit the ring and try again.
        // For now, just returning is a safe option.
        return 0; 
    }
    // Prepare the SQE for a connect operation.
    io_uring_prep_connect(sqe, req->client_socket, (struct sockaddr *)&serv_addr, sizeof(serv_addr));
    io_uring_sqe_set_data(sqe, &req);

    io_uring_submit(ring);
    io_uring_wait_cqe(ring, &cqe);

    io_uring_cqe_seen(ring, cqe);
    return req->client_socket;
}


char *send_get(struct io_uring *ring, request_t *req, const char *uuid, char *path, char *hostname) {
    struct io_uring_sqe *sqe;
    struct io_uring_cqe *cqe;
    char request_buffer[2048];
    int req_len = snprintf(request_buffer, sizeof(request_buffer),
        "GET /%s HTTP/1.1\r\n"
        "Host: google.com\r\n"
        "Accept-Language: en-US,en;q=0.\r\n"
        "Upgrade-Insecure-Requests: 1\r\n"
        "User-Agent: %s/381.3 /%s/918.4 Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36\r\n"
        "Accept: text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7\r\n"
        "Sec-Ch-Ua-Mobile: ?0\r\n"
        "X-Client-Data: %s\r\n"
        "Sec-Fetch-Site: none\r\n"
        "Sec-Fetch-Mode: navigate\r\n"
        "Sec-Fetch-User: ?1\r\n"
        "Sec-Fetch-Dest: document\r\n"
        "Accept-Encoding: gzip, deflate, br\r\n"
        "Priority: u=0, i\r\n"
        "Connection: close\r\n\r\n",
        path, PROFILE, hostname, uuid);

    sqe = io_uring_get_sqe(ring);
    io_uring_prep_send(sqe, req->client_socket, request_buffer, req_len, 0);
    io_uring_submit(ring);
    io_uring_wait_cqe(ring, &cqe);
    io_uring_cqe_seen(ring, cqe);

    size_t n;
    size_t total_read = 0;
        int cont_length = -1;
        int header_parsed = 0;
        size_t body_offset = 0;
        while (1) {
            req->iov.iov_base = req->buffer + total_read;
            req->iov.iov_len = BUFFER_SIZE - 1 - total_read;
            sqe = io_uring_get_sqe(ring);
            // Prepare the SQE for a receive operation (using readv).
            io_uring_prep_readv(sqe, req->client_socket, &req->iov, 1, 0);
            io_uring_sqe_set_data(sqe, req);
            io_uring_submit(ring);
            io_uring_wait_cqe(ring, &cqe);
            n = cqe->res;
            io_uring_cqe_seen(ring, cqe);
            req->buffer[n] = '\0';

            if (n <= 0) {
                break;
            }

            total_read += n;

            if (!header_parsed) {
                char *end = header_end(req->buffer);
                if (end) {
                    header_parsed = 1;
                    body_offset = end - req->buffer + 4;
                    cont_length = content_length(req->buffer);
                }
            }
            
            if (header_parsed && cont_length > -1) {
                size_t body_len = total_read - body_offset;
                if (body_len >= (size_t)content_length) {
                    break;
                }
            }

        }

        char *http_body = req->buffer + body_offset;
        return http_body;
}