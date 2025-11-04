#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "mbedtls/aes.h"
#include "functions/base64/base64.h"
#include "functions/connection/structs.h"

int hex_decode(const char *hex_str, unsigned char *output, size_t output_len) {
    size_t len = strlen(hex_str);
    if (len % 2 != 0 || len / 2 != output_len) {
        fprintf(stderr, "Error: Invalid hex string length or output buffer size.\n");
        return -1;
    }
    for (size_t i = 0; i < output_len; i++) {
        if (sscanf(hex_str + 2 * i, "%2hhx", &output[i]) != 1) {
            fprintf(stderr, "Error: Invalid hex character sequence.\n");
            return -1;
        }
    }
    return 0;
}

unsigned char *aes_decrypt(char *input, profile_t *profile) {
    unsigned char key[32];
    unsigned char iv[16];

    if (strlen(profile->key) != 64) {
        // fprintf(stderr, "Error: Key hex string must be 64 characters long for AES-256.\n");
        return NULL;
    }
    if (strlen(profile->iv) != 32) {
        // fprintf(stderr, "Error: IV hex string must be 32 characters long for AES.\n");
        return NULL;
    }

    if (hex_decode(profile->key, key, sizeof(key)) != 0) {
        return NULL;
    }
    if (hex_decode(profile->iv, iv, sizeof(iv)) != 0) {
        return NULL;
    }
    

    size_t input_len = strlen(input);
    size_t ciphertext_len;
    unsigned char *ciphertext = base64_decode(input, input_len, &ciphertext_len, 0);

    unsigned char *decrypted_output = malloc(ciphertext_len + 1);

    mbedtls_aes_context aes_ctx;
    unsigned char current_iv[16]; // Use a copy for CBC mode

    mbedtls_aes_init(&aes_ctx);

    int ret = mbedtls_aes_setkey_dec(&aes_ctx, key, 256);
    if (ret != 0) { goto cleanup; }

    memcpy(current_iv, iv, 16);

    // Ciphertext length must be multiple of 16 for CBC
    if (ciphertext_len % 16 != 0) {
        ret = -1;
        goto cleanup;
    }

    ret = mbedtls_aes_crypt_cbc(&aes_ctx, MBEDTLS_AES_DECRYPT, ciphertext_len, current_iv, ciphertext, decrypted_output);
    if (ret != 0) {
        // fprintf(stderr, "mbedtls_aes_crypt_cbc failed: -0x%04X\n", -ret);
        goto cleanup;
    }

    // Handle PKCS7 Padding
    size_t pad_len = decrypted_output[ciphertext_len - 1];
    size_t actual_len = ciphertext_len - pad_len;
    int padding_ok = 1;

    // Basic padding validation
    if (pad_len == 0 || pad_len > 16) {
        padding_ok = 0;
        goto cleanup;
    } else {
        for (size_t i = 0; i < pad_len; i++) {
            if (decrypted_output[ciphertext_len - 1 - i] != pad_len) {
                padding_ok = 0;
                break;
            }
        }
    }

    if (padding_ok) {
        decrypted_output[actual_len] = '\0'; 
    } else {
        // fprintf(stderr, "Warning: Invalid padding detected!\n");
        free(decrypted_output);
        decrypted_output = NULL;
        goto cleanup;
    }

    mbedtls_aes_free(&aes_ctx);
    free(ciphertext);
    return decrypted_output;

cleanup:
    fprintf(stderr, "Warning: Decryption failed or invalid padding detected!\n");
    mbedtls_aes_free(&aes_ctx);
    free(ciphertext);
    free(decrypted_output);
    return NULL;
}

char *aes_encrypt(unsigned char *input, size_t input_len, profile_t *profile) {
    // Get input size and calculate padding
    size_t block_size = 16;
    size_t padding_len = block_size - (input_len % block_size);
    size_t padded_len = input_len + padding_len;
    unsigned char key[32];
    unsigned char iv[16];

    // Base64 decode the encryption keys
    if (hex_decode(profile->key, key, sizeof(key)) != 0) {
        return NULL;
    }
    if (hex_decode(profile->iv, iv, sizeof(iv)) != 0) {
        return NULL;
    }

    unsigned char padded_input[padded_len];
    memcpy(padded_input, input, input_len);
    // Add PKCS7 padding bytes (each byte's value is the padding length)
    for (size_t i = 0; i < padding_len; i++) {
        padded_input[input_len + i] = (unsigned char)padding_len;
    }

    unsigned char ciphertext_output[padded_len];
    memset(ciphertext_output, 0, sizeof(ciphertext_output));

    mbedtls_aes_context aes_ctx;
    int ret;

    // Initialize the AES context
    mbedtls_aes_init(&aes_ctx);

    // Set the encryption key (256 bits)
    ret = mbedtls_aes_setkey_enc(&aes_ctx, key, 256);
    if (ret != 0) {
        // fprintf(stderr, "mbedtls_aes_setkey_enc failed: -0x%04X\n", -ret);
        goto cleanup;
    }

    // Encrupt
    ret = mbedtls_aes_crypt_cbc(&aes_ctx, MBEDTLS_AES_ENCRYPT, padded_len, iv, padded_input, ciphertext_output);
    if (ret != 0) {
        // fprintf(stderr, "mbedtls_aes_crypt_cbc failed: -0x%04X\n", -ret);
        goto cleanup;
    }

    char *final = base64_encode(ciphertext_output, padded_len);
    mbedtls_aes_free(&aes_ctx);
    return final;

cleanup:
    mbedtls_aes_free(&aes_ctx);
    return NULL;
}