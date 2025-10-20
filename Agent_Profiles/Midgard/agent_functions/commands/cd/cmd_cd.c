#include "unistd.h"
#include "functions/send/send2serv.h"

void cmd_cd(request_t *req, int sockfd, const profile_t *profile, const char *dir) {
    int result = chdir(dir);
    char message[400];
    int len;
    
    if (result == 0) {
        len = snprintf(message, sizeof(message), "Directory changed to: %s\n", dir);
        send2serv(req, profile, message, len);
    } else {
        len = snprintf(message, sizeof(message), "ERROR: Permission issue or directory does not exist: %s\n", dir);
        send2serv(req, profile, message, len);
    }
    return;
}