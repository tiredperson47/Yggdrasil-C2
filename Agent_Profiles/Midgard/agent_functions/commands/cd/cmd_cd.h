#ifndef CMD_CD_H
#define CMD_CD_H

// Standard library includes that might be needed by the function declaration

void cmd_cd(request_t *req, int sockfd, const profile_t *profile, const char *dir);

#endif