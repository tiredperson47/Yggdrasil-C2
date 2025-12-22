#include "functions/read_file/read_file.h"
#include <liburing.h>
#include <string.h>
#include <stdio.h>
#include <stdlib.h>

char *get_environ(struct io_uring *ring, char *variable) {
    char *output_buffer = read_file(ring, "/proc/self/environ");
    if (output_buffer == NULL) {
        return NULL;
    }

    char *current_ptr = output_buffer;
    char *env_data = NULL;
    while (*current_ptr) {

        if (current_ptr && strncmp(current_ptr, variable, strlen(variable)) == 0) {
            char *env_data = strdup(current_ptr + strlen(variable) + 1); // +1 to skip '='
            free(output_buffer);
            return env_data;
        }
        current_ptr += strlen(current_ptr) + 1;
    }

    return env_data;
}