#include "liburing.h"
#include "unistd.h"
#include "stdio.h"
#include "functions/send/send2serv.h"

void cmd_cd(request_t *req, int sockfd, const char *uuid, const char *dir) {
    int result = chdir(dir);
    char message[400];
    int len;
    
    if (result == 0) {
        len = snprintf(message, sizeof(message), "Directory changed to: %s\n", dir);
        send2serv(req, uuid, message, len);
    } else {
        len = snprintf(message, sizeof(message), "ERROR: Permission issue or directory does not exist: %s\n", dir);
        send2serv(req, uuid, message, len);
    }
    return;
}