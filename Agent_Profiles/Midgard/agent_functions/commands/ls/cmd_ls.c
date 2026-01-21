#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <dirent.h>
#include "functions/send/send2serv.h"

void format_mode(mode_t mode, char *str) {
    // File type
    if (S_ISDIR(mode)) str[0] = 'd';
    else if (S_ISLNK(mode)) str[0] = 'l';
    else if (S_ISBLK(mode)) str[0] = 'b';
    else if (S_ISCHR(mode)) str[0] = 'c';
    else if (S_ISFIFO(mode)) str[0] = 'p';
    else if (S_ISSOCK(mode)) str[0] = 's';
    else str[0] = '-'; // Regular file

    // User permissions
    str[1] = (mode & S_IRUSR) ? 'r' : '-';
    str[2] = (mode & S_IWUSR) ? 'w' : '-';
    // User execute and SUID bit
    if (mode & S_ISUID) {
        str[3] = (mode & S_IXUSR) ? 's' : 'S';
    } else {
        str[3] = (mode & S_IXUSR) ? 'x' : '-';
    }

    // Group permissions
    str[4] = (mode & S_IRGRP) ? 'r' : '-';
    str[5] = (mode & S_IWGRP) ? 'w' : '-';
    // Group execute and SGID bit
    if (mode & S_ISGID) {
        str[6] = (mode & S_IXGRP) ? 's' : 'S';
    } else {
        str[6] = (mode & S_IXGRP) ? 'x' : '-';
    }

    // Other permissions
    str[7] = (mode & S_IROTH) ? 'r' : '-';
    str[8] = (mode & S_IWOTH) ? 'w' : '-';
    str[9] = (mode & S_IXOTH) ? 'x' : '-';
    
    str[10] = '\0';
}

void cmd_ls(request_t *req, int sockfd, const profile_t *profile, const char *args) {
    const char *path = (args != NULL && args[0] != '\0') ? args : ".";
    DIR *dir = opendir(path);

    if (dir == NULL) {
        char error_msg[256];
        snprintf(error_msg, sizeof(error_msg), "Cannot access '%s': No such file or directory\n", path);
        send2serv(req, profile, error_msg, strlen(error_msg));
        return;
    }

    // Allocate a large buffer to build the entire output string.
    // This is more efficient than sending many small packets.
    size_t buffer_size = 8192; // Start with 8KB
    char *output_buffer = malloc(buffer_size);
    if (output_buffer == NULL) {
        perror("malloc failed");
        closedir(dir);
        return;
    }
    output_buffer[0] = '\0';
    size_t current_len = 0;

    struct dirent *entry;
    while ((entry = readdir(dir)) != NULL) {
        // Since we want `ls -a`, we do not skip entries starting with '.'

        char full_path[1024];
        snprintf(full_path, sizeof(full_path), "%s/%s", path, entry->d_name);

        struct stat file_stat;
        // Use lstat to get info about the link itself, not what it points to
        if (lstat(full_path, &file_stat) == -1) {
            perror("lstat");
            continue; // Skip files we can't stat
        }

        char mode_str[11];
        format_mode(file_stat.st_mode, mode_str);

        char owner_name[32];
        char group_name[32];
        snprintf(owner_name, sizeof(owner_name), "%u", file_stat.st_uid);
        snprintf(group_name, sizeof(group_name), "%u", file_stat.st_gid);

        char time_str[80];
        strftime(time_str, sizeof(time_str), "%b %d %H:%M", localtime(&file_stat.st_mtime));

        char line_buffer[2048];
        int line_len = snprintf(line_buffer, sizeof(line_buffer), "%s %2lu %-8s %-8s %8ld %s %s\n",
               mode_str,
               file_stat.st_nlink,
               owner_name,
               group_name,
               file_stat.st_size,
               time_str,
               entry->d_name);

        if (current_len + line_len >= buffer_size) {
            buffer_size *= 2;
            char *new_buffer = realloc(output_buffer, buffer_size);
            if (new_buffer == NULL) {
                //perror("realloc failed");
                free(output_buffer);
                closedir(dir);
                return;
            }
            output_buffer = new_buffer;
        }
        strcat(output_buffer, line_buffer);
        current_len += line_len;
    }

    closedir(dir);


    if (current_len > 0) {
        send2serv(req, profile, output_buffer, current_len);
    } else {
        // Send something if the directory was empty
        const char *empty_msg = "Directory is empty.\n";
        send2serv(req, profile, empty_msg, strlen(empty_msg));
    }

    free(output_buffer);
}