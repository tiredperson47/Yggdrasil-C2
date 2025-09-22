#ifndef READ_FILE_H
#define READ_FILE_H

// Standard library includes that might be needed by the function declaration
#include <stdlib.h>

char *read_file(struct io_uring *ring, const char *path);

#endif