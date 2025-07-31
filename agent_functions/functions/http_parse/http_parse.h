#ifndef HTTP_PARSE_H
#define HTTP_PARSE_H

// Standard library includes that might be needed by the function declaration
#include <stdlib.h>

char *header_end(const char *buf);
int content_length(const char *headers);
#endif