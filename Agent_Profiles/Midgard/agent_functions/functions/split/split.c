#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <stdbool.h>

// Usage:
// **args = split(char string[], delimiter, split_limit)
// Access strings with args[0], args[1], etc
char **split(char *str, char delim, int count) {
    int arg_count = 0;
    bool in_word = false;
    int split_to_do = 0;

    // Find out how many times we need/can split the string
    for (int i = 0; str[i] != '\0'; i++) {
        if (str[i] != delim && !in_word) {
            in_word = true;
            arg_count++;
        } else if (str[i] == delim && in_word) {
            in_word = false;
            if (split_to_do < count) {
                split_to_do++;
            }
        }
    }

    if (arg_count == 0) return NULL;

    // Allocate memory
    int final_arg_count = (split_to_do < count) ? arg_count : split_to_do + 1;
    char **args = malloc(sizeof(char *) * (final_arg_count + 1));
    if (args == NULL) return NULL;

    // Actually go though the code and split at most "count" number of times
    int current_arg = 0;
    int num_split = 0;
    in_word = false;
    for (int i = 0; str[i] != '\0'; i++) {
        if (str[i] != delim && !in_word) {
            in_word = true;
            if (current_arg < final_arg_count) {
                args[current_arg++] = &str[i];
            }
        } else if (str[i] == delim && in_word) {
            in_word = false;
            if (num_split < count) {
                str[i] = '\0';
                num_split++;
            }
        }
    }
    
    // Null terminate
    args[final_arg_count] = NULL;

    return args;
}

// int main() {
//     char command[] = "shell bash script.sh";
//     char **result = split(command, ' ', 2);
//     for (int i = 0; result[i] != NULL; i++) {
//             printf("args[%d]: %s\n", i, result[i]);
//         }
//     free(result);

//     return 0;
// }