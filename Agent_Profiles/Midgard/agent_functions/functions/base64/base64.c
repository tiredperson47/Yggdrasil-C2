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


static int b64_decode_table[256];
void build_decode_table() {
    for (int i = 0; i < 256; i++) {
        b64_decode_table[i] = -1;
    }
    // Map the 64 valid Base64 characters to their values
    for (int i = 0; i < 64; i++) {
        b64_decode_table[(unsigned char)b64_alphabet[i]] = i;
    }
    // Map the padding character to 0. Its position tells us to stop.
    b64_decode_table[(unsigned char)'='] = 0;
}

unsigned char *base64_decode(const char *input, size_t length, size_t *out_len_ptr, int is_char) {
    
    // Build the lookup table if it hasn't been built yet
    static int table_built = 0;
    if (!table_built) {
        build_decode_table();
        table_built = 1;
    }

    // validate string
    if (length % 4 != 0) {
        fprintf(stderr, "Error: Input length is not a multiple of 4.\n");
        return NULL;
    }

    size_t padding = 0;
    if (length > 0 && input[length - 1] == '=') {
        padding++;
    }
    if (length > 1 && input[length - 2] == '=') {
        padding++;
    }
    
    // Each 4-char block decodes to 3 bytes, minus padding
    size_t out_len = (length / 4) * 3 - padding;

    unsigned char *output = malloc(out_len + 1);
    if (output == NULL) {
        fprintf(stderr, "Error: Memory allocation failed.\n");
        return NULL;
    }

    // iterate 4 input chars at a time
    for (size_t i = 0, j = 0; i < length;) {
        
        // Grab the 6-bit values for the 4 input characters
        int val1 = b64_decode_table[(unsigned char)input[i++]];
        int val2 = b64_decode_table[(unsigned char)input[i++]];
        int val3 = b64_decode_table[(unsigned char)input[i++]];
        int val4 = b64_decode_table[(unsigned char)input[i++]];

        if (val1 == -1 || val2 == -1 || val3 == -1 || val4 == -1) {
             fprintf(stderr, "Error: Invalid Base64 character in input.\n");
             free(output);
             return NULL;
        }

        // Combine the four 6-bit values into one 24-bit value
        unsigned int triple = (val1 << 18) | (val2 << 12) | (val3 << 6) | val4;

        // Extract the 3 original 8-bit bytes from the 24-bit value
        if (j < out_len) {
            output[j++] = (triple >> 16) & 0xFF;
        }
        if (j < out_len) {
            output[j++] = (triple >> 8) & 0xFF;
        }
        if (j < out_len) {
            output[j++] = triple & 0xFF;
        }
    }
    
    if (is_char == 1) {
        output[out_len] = '\0';
    }

    *out_len_ptr = out_len;
    return output;
}
