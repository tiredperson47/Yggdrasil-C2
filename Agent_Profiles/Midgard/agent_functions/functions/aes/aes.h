#ifndef AES_H
#define AES_H

#include "functions/connection/structs.h"
unsigned char *aes_decrypt(char *input, profile_t *profile);
char *aes_encrypt(unsigned char *input, size_t input_len, profile_t *profile);
#endif