#ifndef SEND2SERV_H
#define SEND2SERV_H

// Standard library includes that might be needed by the function declaration
#include <liburing.h>

int send2serv(const char *uuid, const char *buf, size_t len);

#endif // SEND2SERV_H
