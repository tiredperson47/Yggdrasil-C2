#ifndef BASE64_H
#define BASE64_H

char *base64_encode(const unsigned char *input, int length);
unsigned char *base64_decode(const char *input, size_t length, size_t *out_len_ptr, int is_char);

#endif