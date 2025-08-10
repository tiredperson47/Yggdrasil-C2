#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>
#include <sys/stat.h>
#include <time.h>
#include <liburing.h>

int read_file(struct io_uring *ring, const char *path, char *output_buffer, size_t buffer_len) {

    struct io_uring_sqe *sqe;
    struct io_uring_cqe *cqe;
    int fd, ret;
    off_t offset = 0;
    size_t total = 0;

    sqe = io_uring_get_sqe(ring);
    io_uring_prep_openat(sqe, AT_FDCWD, path, O_RDONLY, 0); //AT_FDCWD may show an error, but it does work. It's imported from liburing, so no need to import fcntl.h
    io_uring_submit(ring);
    io_uring_wait_cqe(ring, &cqe);
    fd = cqe->res;
    io_uring_cqe_seen(ring, cqe);
    if (fd < 0) return fd;

    while (total < buffer_len - 1) {
        sqe = io_uring_get_sqe(ring);
        io_uring_prep_read(sqe, fd, output_buffer + total, buffer_len - 1 - total, offset);
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
    return total;
}