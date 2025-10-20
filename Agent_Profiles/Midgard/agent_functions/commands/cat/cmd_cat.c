#define _GNU_SOURCE
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <liburing.h>
#include "functions/send/send2serv.h"

void cmd_cat(request_t *req, int sockfd, const profile_t *profile, const char *file) {
    struct io_uring_sqe *sqe;
    struct io_uring_cqe *cqe;
    int fd, ret;

    sqe = io_uring_get_sqe(req->ring);
    io_uring_prep_openat(sqe, AT_FDCWD, file, O_RDONLY, 0);
    io_uring_submit(req->ring);
    io_uring_wait_cqe(req->ring, &cqe);
    fd = cqe->res;
    io_uring_cqe_seen(req->ring, cqe);
    if (fd < 0) {
        char error_msg[256];
        snprintf(error_msg, sizeof(error_msg), "Cannot access '%s': No such file/directory OR invalid permissions\n", file);
        send2serv(req, profile, error_msg, strlen(error_msg));
        return;
    }

    char *buffer = NULL;
    size_t CHUNK_SIZE = 4096;
    size_t total = 0;
    size_t capacity = 0;

    while (true) {

        if (total + CHUNK_SIZE > capacity) {
            capacity = total + CHUNK_SIZE;
            char *new_buffer = realloc(buffer, capacity);
            if (!new_buffer) {
                perror("realloc failed");
                free(buffer);
                close(fd);
                return;
            }
            buffer = new_buffer;
        }


        sqe = io_uring_get_sqe(req->ring);
        io_uring_prep_read(sqe, fd, buffer + total, CHUNK_SIZE, -1);
        io_uring_submit(req->ring);
        io_uring_wait_cqe(req->ring, &cqe);
        ret = cqe->res;
        io_uring_cqe_seen(req->ring, cqe);
        if (ret <= 0) break;
        total += ret;
    }

    char *final_buffer = realloc(buffer, total + 1);
    final_buffer[total] = '\0';

    sqe = io_uring_get_sqe(req->ring);
    io_uring_prep_close(sqe, fd);
    io_uring_submit(req->ring);
    io_uring_wait_cqe(req->ring, &cqe);
    io_uring_cqe_seen(req->ring, cqe);

    send2serv(req, profile, final_buffer, total);
    free(final_buffer);
}