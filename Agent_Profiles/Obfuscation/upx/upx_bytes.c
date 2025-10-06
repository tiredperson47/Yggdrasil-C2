#define _GNU_SOURCE // Often needed for AT_FDCWD, though it may be in fcntl.h
#include <stdio.h>
#include <stdlib.h>
#include <stdbool.h>
#include <fcntl.h>      // For openat() and O_RDONLY flags
#include <sys/stat.h>   // For fstat()
#include <unistd.h>     // For read(), write(), close()

int main(int argc, char *argv[]) {
    if (argc != 3) {
        fprintf(stderr, "Usage: %s <input_file> <output_file>\n", argv[0]);
        return 1;
    }

    const char *input_filename = argv[1];
    const char *output_filename = argv[2];
    
    int input_fd = -1; // File descriptors are integers, not pointers
    int output_fd = -1;
    unsigned char *file_data = NULL;
    long file_size;
    bool patched = false;

    // --- 1. Open and Read the Input File using Low-Level I/O ---
    // Use openat() instead of fopen(). It returns an integer file descriptor.
    input_fd = openat(AT_FDCWD, input_filename, O_RDONLY, 0);
    if (input_fd == -1) { // Check for -1, not NULL
        perror("Error opening input file");
        return 1;
    }

    // Get the size of the file using fstat() instead of fseek/ftell
    struct stat st;
    if (fstat(input_fd, &st) == -1) {
        perror("Error getting file size with fstat");
        close(input_fd);
        return 1;
    }
    file_size = st.st_size;


    // Allocate memory (this part is the same)
    file_data = (unsigned char *)malloc(file_size);
    if (file_data == NULL) {
        fprintf(stderr, "Error: Could not allocate memory for file.\n");
        close(input_fd);
        return 1;
    }

    // Read the file into the buffer using read() instead of fread()
    if (read(input_fd, file_data, file_size) != file_size) {
        fprintf(stderr, "Error reading file into buffer.\n");
        free(file_data);
        close(input_fd);
        return 1;
    }
    close(input_fd); // Close the input file descriptor

    // --- 2. Search and Patch (this logic is the same) ---
    for (long i = 0; i < file_size - 3; ++i) {
        if (file_data[i] == 0x55 &&
            file_data[i+1] == 0x50 &&
            file_data[i+2] == 0x58 &&
            (file_data[i+3] == 0x30 || file_data[i+3] == 0x21))
        {
            file_data[i] = 0x41; // Change 'U' to 'A'
            patched = true;
            break;
        }
    }

    // --- 3. Write the Modified File (if patched) ---
    if (patched) {
        // Use openat() to create the output file.
        // O_WRONLY = Write-only, O_CREAT = Create if doesn't exist, O_TRUNC = Truncate if exists
        // 0644 are the file permissions (read/write for owner, read for others)
        output_fd = openat(AT_FDCWD, output_filename, O_WRONLY | O_CREAT | O_TRUNC, 0644);
        if (output_fd == -1) {
            perror("Error opening output file");
            free(file_data);
            return 1;
        }

        // Use write() instead of fwrite()
        if (write(output_fd, file_data, file_size) != file_size) {
            fprintf(stderr, "Error writing modified data to file.\n");
            close(output_fd);
            free(file_data);
            return 1;
        }
        close(output_fd);
    } else {
        printf("Your file was not patched (UPX signature not found).\n");
    }

    // --- 4. Clean Up (this is the same) ---
    free(file_data);
    return 0;
}
