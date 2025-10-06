#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <elf.h>
#include <sys/mman.h>
#include <assert.h>
#include <stdbool.h>
#include <unistd.h>
#include <fcntl.h> // For O_RDONLY
#include <signal.h>
#include "agent.h"

#define ElfN_Ehdr Elf64_Ehdr
#define ElfN_Phdr Elf64_Phdr
#define ElfN_Shdr Elf64_Shdr
#define ElfN_Sym  Elf64_Sym
#define ElfN_Rela Elf64_Rela
#define ElfN_Addr Elf64_Addr
#define ElfN_Word Elf64_Word

typedef struct {
    void* entry_point;
    ElfN_Addr pie_base;
    ElfN_Ehdr* hdr;
} loaded_elf_info;

void jump_to(ElfN_Addr new_sp, void* entry) {
    asm volatile(
        "mov sp, %0\n" // Set the new stack pointer.
        "br %1\n"      // Branch to the entry point.
        : // No output operands.
        : "r"(new_sp), "r"(entry) // Input operands.
    );

}

int is_image_valid(ElfN_Ehdr *hdr) {
    if (memcmp(hdr->e_ident, ELFMAG, SELFMAG) != 0) return 0;
    if (hdr->e_ident[EI_CLASS] != ELFCLASS64) return 0;
    if (hdr->e_machine != EM_AARCH64) return 0;
    if (hdr->e_type != ET_DYN) return 0;
    return 1;
}

// Relocation for a fully static PIE. We only need to handle relative relocations.
void relocate(ElfN_Shdr* shdr, const char* src, char* dst, ElfN_Addr pie_base_address) {
    if (shdr->sh_type != SHT_RELA) return;

    ElfN_Rela* rel = (ElfN_Rela*)(src + shdr->sh_offset);
    size_t rel_count = shdr->sh_size / sizeof(ElfN_Rela);

    for(size_t j = 0; j < rel_count; ++j) {
        ElfN_Addr *target = (ElfN_Addr*)(dst + rel[j].r_offset);
        long type = ELF64_R_TYPE(rel[j].r_info);

        if (type == R_AARCH64_RELATIVE) {
            *target = pie_base_address + rel[j].r_addend;
        }
    }
}

void prepare_and_jump(loaded_elf_info* info, int argc, char **argv, char **envp) {
    size_t stack_size = 1024 * 1024 * 2; // 2MB stack
    void* new_stack_base = mmap(NULL, stack_size, PROT_READ | PROT_WRITE, MAP_PRIVATE | MAP_ANONYMOUS | MAP_GROWSDOWN, -1, 0);
    if (new_stack_base == MAP_FAILED) {
        // perror("Failed to allocate new stack");
        return;
    }
    ElfN_Addr* stack_top = (ElfN_Addr*)((char*)new_stack_base + stack_size);

    ElfN_Addr auxv[18];
    int auxv_count = 0;
    auxv[auxv_count++] = AT_PHDR;   auxv[auxv_count++] = info->pie_base + info->hdr->e_phoff;
    auxv[auxv_count++] = AT_PHENT;  auxv[auxv_count++] = info->hdr->e_phentsize;
    auxv[auxv_count++] = AT_PHNUM;   auxv[auxv_count++] = info->hdr->e_phnum;
    auxv[auxv_count++] = AT_PAGESZ; auxv[auxv_count++] = sysconf(_SC_PAGESIZE);
    auxv[auxv_count++] = AT_BASE;   auxv[auxv_count++] = 0;
    auxv[auxv_count++] = AT_ENTRY;  auxv[auxv_count++] = (ElfN_Addr)info->entry_point;

    stack_top -= 2;
    unsigned char* random_bytes_ptr = (unsigned char*)stack_top;
    int urandom_fd = open("/dev/urandom", O_RDONLY);
    if (urandom_fd != -1) {
        if (read(urandom_fd, random_bytes_ptr, 16) > 0) {
            auxv[auxv_count++] = AT_RANDOM;
            auxv[auxv_count++] = (ElfN_Addr)random_bytes_ptr;
        }
        close(urandom_fd);
    }
    
    auxv[auxv_count++] = AT_NULL; auxv[auxv_count++] = 0;
    stack_top -= auxv_count;
    memcpy(stack_top, auxv, auxv_count * sizeof(ElfN_Addr));
    
    int envc = 0;
    for (char** e = envp; *e; ++e) envc++;
    stack_top -= (envc + 1);
    memcpy(stack_top, envp, sizeof(char*) * (envc + 1));

    stack_top -= (argc + 1);
    memcpy(stack_top, argv, sizeof(char*) * (argc + 1));
    
    stack_top--;
    *stack_top = argc;
    
    ElfN_Addr sp_val = (ElfN_Addr)stack_top & -16L;
    
    jump_to(sp_val, info->entry_point);
}


bool image_load(char *elf_start, loaded_elf_info *info) {
    info->hdr = (ElfN_Ehdr *)elf_start;
    if (!is_image_valid(info->hdr)) {
        // fprintf(stderr, "Invalid AArch64 static PIE ELF image\n");
        return false;
    }

    ElfN_Phdr *phdr = (ElfN_Phdr *)(elf_start + info->hdr->e_phoff);
    
    size_t mem_size = 0;
    for (int i = 0; i < info->hdr->e_phnum; ++i) {
        if (phdr[i].p_type == PT_LOAD) {
            size_t segment_end = phdr[i].p_vaddr + phdr[i].p_memsz;
            if (segment_end > mem_size) mem_size = segment_end;
        }
    }

    char *exec = mmap(NULL, mem_size, PROT_READ | PROT_WRITE, MAP_PRIVATE | MAP_ANONYMOUS, -1, 0);
    if (exec == MAP_FAILED) {
        // perror("mmap");
        return false;
    }
    info->pie_base = (ElfN_Addr)exec;

    for (int i = 0; i < info->hdr->e_phnum; ++i) {
        if (phdr[i].p_type == PT_LOAD) {
            char *taddr = exec + phdr[i].p_vaddr;
            char *start = elf_start + phdr[i].p_offset;
            memmove(taddr, start, phdr[i].p_filesz);
            if (phdr[i].p_filesz < phdr[i].p_memsz) {
                memset(taddr + phdr[i].p_filesz, 0, phdr[i].p_memsz - phdr[i].p_filesz);
            }
        }
    }

    ElfN_Shdr *shdr = (ElfN_Shdr *)(elf_start + info->hdr->e_shoff);
    for (int i = 0; i < info->hdr->e_shnum; ++i) {
        relocate(shdr + i, elf_start, exec, info->pie_base);
    }
    
    long page_size = sysconf(_SC_PAGESIZE);
    for (int i = 0; i < info->hdr->e_phnum; ++i) {
        if (phdr[i].p_type == PT_LOAD) {
            ElfN_Addr page_offset = phdr[i].p_vaddr % page_size;
            char* aligned_addr = exec + phdr[i].p_vaddr - page_offset;
            size_t adjusted_len = phdr[i].p_memsz + page_offset;

            int prot = 0;
            if (phdr[i].p_flags & PF_R) prot |= PROT_READ;
            if (phdr[i].p_flags & PF_W) prot |= PROT_WRITE;
            if (phdr[i].p_flags & PF_X) prot |= PROT_EXEC;
            
            if (mprotect(aligned_addr, adjusted_len, prot) != 0) {
                // perror("mprotect");
                munmap(exec, mem_size);
                return false;
            }
        }
    }

    info->entry_point = (void*)(info->pie_base + info->hdr->e_entry);
    return true;
}

int main(int argc, char** argv, char** envp) {
        
    loaded_elf_info info;
    if (image_load((char*)agent, &info)) {
        // printf("[LOADER] Static PIE loaded. Transferring execution...\n");
        prepare_and_jump(&info, argc, argv, envp);
    } else {
        // printf("[LOADER] Loading unsuccessful.\n");
        return 1;
    }
    return 0; // Unreachable
}
