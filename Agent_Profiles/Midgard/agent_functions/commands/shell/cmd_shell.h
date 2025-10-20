#ifndef CMD_SHELL_H
#define CMD_SHELL_H

// Standard library includes that might be needed by the function declaration

void cmd_shell(request_t *req, int sockfd, const profile_t *profile, const char *file);

#endif