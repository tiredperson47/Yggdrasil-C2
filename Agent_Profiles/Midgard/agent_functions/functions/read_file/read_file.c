#define _GNU_SOURCE
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>
#include <sys/stat.h>
#include <time.h>
#include <liburing.h>

char *read_file(struct io_uring *ring, const char *path) {

    struct io_uring_sqe *sqe;
    struct io_uring_cqe *cqe;

    sqe = io_uring_get_sqe(ring);
    io_uring_prep_openat(sqe, AT_FDCWD, path, O_RDONLY, 0);
    io_uring_submit(ring);
    io_uring_wait_cqe(ring, &cqe);
    int fd = cqe->res;
    io_uring_cqe_seen(ring, cqe);
    if (fd < 0) return NULL;

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
                return NULL;
            }
            buffer = new_buffer;
        }

        sqe = io_uring_get_sqe(ring);
        io_uring_prep_read(sqe, fd, buffer + total, CHUNK_SIZE, -1);
        io_uring_submit(ring);
        io_uring_wait_cqe(ring, &cqe);
        int ret = cqe->res;
        io_uring_cqe_seen(ring, cqe);
        if (ret <= 0) {
            break;
        }
        total += ret;
    }

    char *final_buffer = realloc(buffer, total + 1);
    final_buffer[total] = '\0';


    // close the file
    // close(fd);
    sqe = io_uring_get_sqe(ring);
    io_uring_prep_close(sqe, fd);
    io_uring_submit(ring);
    io_uring_wait_cqe(ring, &cqe);
    io_uring_cqe_seen(ring, cqe);
    return final_buffer;
}