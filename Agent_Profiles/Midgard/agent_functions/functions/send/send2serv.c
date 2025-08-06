#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <netinet/in.h>
#include <arpa/inet.h>
#include <unistd.h>
#include <liburing.h>
#include "functions/connection/connection.h"
#include "functions/connection/req_struct.h"
#define QUEUE_DEPTH 3

int send2serv(const char *uuid, const char *buf, size_t len) {
    struct io_uring ring;

    if (io_uring_queue_init(QUEUE_DEPTH, &ring, 0) < 0) {
        perror("io_uring_queue_init");
        return -1;
    }

    request_t *req = malloc(sizeof(request_t));
    int sockfd = connection(&ring, req);

    char header_buffer[1024];
    int header_len = snprintf(header_buffer, sizeof(header_buffer),
        "POST /login?uuid=%s HTTP/1.1\r\n"
        "Host: google.com\r\n"
        "User-Agent: Wget/1.20.3 (linux-gnu)\r\n"
        "Accept: */*\r\n"
        "Content-Length: %lu\r\n"
        "Content-Type: text/plain\r\n"
        "Connection: close\r\n\r\n",
        uuid, len);

    if (header_len <= 0 || header_len >= sizeof(header_buffer)) {
        return -1;
    }

    char *full_req = malloc(header_len + len);
    if (!full_req) return -1;

    memcpy(full_req, header_buffer, header_len);
    memcpy(full_req + header_len, buf, len);

    //printf("%s", full_req);
    struct io_uring_sqe *sqe = io_uring_get_sqe(&ring);
    io_uring_prep_send(sqe, sockfd, full_req, header_len + len, 0);
    io_uring_submit(&ring);

    struct io_uring_cqe *cqe;
    io_uring_wait_cqe(&ring, &cqe);
    if (cqe->res < 0) {
        //printf("\nHeader Sending Failed\n");
        return -1;
    }

    io_uring_cqe_seen(&ring, cqe);

    /*char response_buffer[1024];
    sqe = io_uring_get_sqe(&ring);
    io_uring_prep_recv(sqe, sockfd, response_buffer, sizeof(response_buffer) - 1, 0);
    io_uring_sqe_set_data(sqe, response_buffer);
    io_uring_submit(&ring);
    io_uring_wait_cqe(&ring, &cqe);

    if (cqe->res > 0) {
        response_buffer[cqe->res] = '\0';
    } else {
        //printf("\nReceive Failed!!\n");
        return -1;
    }

    io_uring_cqe_seen(&ring, cqe);*/


    close(req->client_socket);
    io_uring_queue_exit(&ring);
    free(full_req);
    free(req);
    return 0;
}