#include <stdio.h>
#include <stdlib.h>
#include <string.h>

static const char b64_alphabet[] = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

char* base64_encode(const unsigned char *input, int length) {
    // Calculate the length of the output string
    int out_len = 4 * ((length + 2) / 3);
    char *output = malloc(out_len + 1);
    if (output == NULL) return NULL;

    for (int i = 0, j = 0; i < length;) {
        // --- Grab up to 3 bytes from the input ---
        unsigned int octet_a = i < length ? input[i++] : 0;
        unsigned int octet_b = i < length ? input[i++] : 0;
        unsigned int octet_c = i < length ? input[i++] : 0;

        // --- Combine them into a single 24-bit value ---
        unsigned int triple = (octet_a << 16) + (octet_b << 8) + octet_c;

        // --- Extract four 6-bit values and map them to the alphabet ---
        output[j++] = b64_alphabet[(triple >> 18) & 0x3F];
        output[j++] = b64_alphabet[(triple >> 12) & 0x3F];
        output[j++] = b64_alphabet[(triple >> 6) & 0x3F];
        output[j++] = b64_alphabet[triple & 0x3F];
    }

    int mod_table[] = {0, 2, 1};
    int padding = mod_table[length % 3];
    for (int i = 0; i < padding; i++) {
        output[out_len - 1 - i] = '=';
    }
    
    output[out_len] = '\0';
    return output;
}