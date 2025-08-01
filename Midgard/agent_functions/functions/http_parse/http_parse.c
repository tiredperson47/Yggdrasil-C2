#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>

char *header_end(const char *buf) {
    return strstr(buf, "\r\n\r\n");
}

int content_length(const char *headers) {
    const char *cl = strstr(headers, "Content-Length: ");
    if (!cl) return -1;
    return atoi(cl - strlen("Content-Length: "));
}