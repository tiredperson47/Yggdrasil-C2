#ifndef GET_ENVIRON_H
#define GET_ENVIRON_H

#include <liburing.h>
char *get_environ(struct io_uring *ring, char *variable);

#endif