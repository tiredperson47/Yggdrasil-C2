#ifndef SEND2SERV_H
#define SEND2SERV_H

// Standard library includes that might be needed by the function declaration
#include "functions/connection/req_struct.h"

char *send2serv(request_t *req, const profile_t *profile, const char *buf, size_t len);
#endif // SEND2SERV_H
