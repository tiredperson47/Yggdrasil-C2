#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <elf.h>
#include <sys/mman.h>
#include <sys/syscall.h>
#include <asm/prctl.h>
#include <assert.h>
#include <unistd.h>
#include "agent.h"

// // for debugging
// #include <ucontext.h>
// #include <stdint.h>

#define ElfN_Ehdr Elf64_Ehdr
#define ElfN_Phdr Elf64_Phdr
#define ElfN_Shdr Elf64_Shdr
#define ElfN_Sym  Elf64_Sym
#define ElfN_Rela Elf64_Rela
#define ElfN_Addr Elf64_Addr
#define ElfN_Word Elf64_Word
#define ElfN_Sxword Elf64_Sxword
#define ElfN_Xword Elf64_Xword
#define ElfN_Off  Elf64_Off
#define ElfN_Dyn  Elf64_Dyn
#define MAX_SEGMENTS 16

typedef struct elf_info {
    void* entry_point;
    ElfN_Addr pie_base;
    ElfN_Ehdr* hdr;
} elf_info;

typedef struct load_segment {
    ElfN_Addr  vaddr;
    ElfN_Xword memsz;
    ElfN_Xword filesz;
    ElfN_Off   offset;
    ElfN_Word  flags;
    ElfN_Xword align;
} load_segment;

load_segment segments[MAX_SEGMENTS];

static int prot_from_pflags(ElfN_Word flags) {
    int prot = 0;
    if (flags & PF_R) prot |= PROT_READ;
    if (flags & PF_W) prot |= PROT_WRITE;
    if (flags & PF_X) prot |= PROT_EXEC;
    return prot;
}


// Apply final memory protections for the loaded ELF image using a per-page union
// of PT_LOAD permissions. This avoids bugs from overlapping mprotect() ranges.

static int apply_segment_protections_union(void *mapping, size_t mapsz, ElfN_Addr pie_base, load_segment *segs, int seg_count, int allow_wx) {

    size_t page_size = (size_t)sysconf(_SC_PAGESIZE);
    size_t page_count = (mapsz + page_size - 1) / page_size;

    uint8_t *page_prot = (uint8_t *)calloc(page_count, 1);
    if (!page_prot) {
        // perror("calloc(page_prot)");
        return 0;
    }

    // Mark each page with the union of perms of all segments that cover it
    for (int i = 0; i < seg_count; i++) {
        load_segment *seg = &segs[i];

        ElfN_Addr seg_start = pie_base + seg->vaddr;
        ElfN_Addr seg_end   = seg_start + seg->memsz;

        ElfN_Addr map_start = (ElfN_Addr)mapping;
        ElfN_Addr map_end   = map_start + mapsz;

        /* clamp to mapping (defensive) */
        if (seg_end <= map_start || seg_start >= map_end) continue;
        if (seg_start < map_start) seg_start = map_start;
        if (seg_end   > map_end)   seg_end   = map_end;

        size_t p0 = (size_t)((seg_start - map_start) / page_size); // page start
        size_t p1 = (size_t)((seg_end   - map_start + page_size - 1) / page_size); // page end

        int prot = prot_from_pflags(seg->flags);
        
        for (size_t p = p0; p < p1 && p < page_count; p++) {
            if (allow_wx && (prot & PROT_EXEC)) prot |= PROT_WRITE; /* temporarily add write for exec pages */
            page_prot[p] |= (uint8_t)prot;
        }
    }

    // Apply mprotect in runs of same prot
    for (size_t p = 0; p < page_count; ) {
        int prot = page_prot[p];
        if (prot == 0) prot = PROT_READ; // avoid PROT_NONE by accident

        size_t run = 1;
        while (p + run < page_count) {  // group consecutive pages with same prot
            int next = page_prot[p + run];
            if (next == 0) next = PROT_READ;
            if (next != prot) break;
            run++;
        }

        void *addr = (char *)mapping + p * page_size;
        size_t len = run * page_size;

        if (mprotect(addr, len, prot) != 0) {   // apply protection
            // perror("mprotect(union)");
            free(page_prot);
            return 0;
        }

        p += run;
    }

    free(page_prot);
    return 1;
}

int is_image_valid(struct elf_info *info) {
    if (memcmp(info->hdr->e_ident, ELFMAG, SELFMAG) != 0) {
        // printf("[-] Invalid ELF Magic\n");
        return 0;
    }
    if (info->hdr->e_ident[EI_CLASS] != ELFCLASS64) {
        // printf("[-] Not ELFCLASS64\n");
        return 0;
    }
    if (info->hdr->e_machine != EM_X86_64) { // Check for x86_64
        // printf("[-] Unsupported Architecture: %d\n", info->hdr->e_machine);
        return 0; 
    }
    if (info->hdr->e_type != ET_DYN) {
        // printf("[-] Not ET_DYN\n");
        return 0;
    } // Check for PIE
    if (info->hdr->e_phnum <= 0) {
        // printf("[-] No Program Headers\n");
        return 0;
    } // Check if program header is > 0
    return 1;
}

__attribute__((noreturn))
void amd_jump(ElfN_Addr sp, void *entry) {
    asm volatile(
        "mov %0, %%rsp\n"
        "xor %%rbp, %%rbp\n"
        "xor %%rdi, %%rdi\n"
        "xor %%rsi, %%rsi\n"
        "xor %%rdx, %%rdx\n"
        "jmp *%1\n"
        :
        : "r"(sp), "r"(entry)
        : "memory", "rdi", "rsi", "rdx"
    );
    __builtin_unreachable();
}


static size_t cstr_len(const char *s) {
    return s ? (strlen(s) + 1) : 0;
}

// Copy string into the stack "string area" which grows upwards.
// Returns the new address of the copied string (inside the new stack mapping).
static char *stack_copy_str(char **str_top, const char *src) {
    size_t n = cstr_len(src);
    if (n == 0) return NULL;
    *str_top -= n;
    memcpy(*str_top, src, n);
    return *str_top;
}

int load_image(char *elf_start, struct elf_info *info, struct load_segment *load, int argc, char **argv, char **envp) {

    ElfN_Addr *orig_auxv = NULL;


    // envp is NULL-terminated
    char **e = envp;
    while (*e) e++;

    // auxv starts immediately after envp NULL 
    orig_auxv = (ElfN_Addr *)(e + 1);


    // elf_start is the binary to load
    info->hdr = (ElfN_Ehdr *)elf_start;
    if (!is_image_valid(info)) {
        return 0;
    }

    // Use elf binary + file program header offset to determine start of program header
    ElfN_Phdr *phdr = (ElfN_Phdr *)(elf_start + info->hdr->e_phoff);

    // Find the size of the PT_LOAD program headers
    ElfN_Addr min_vaddr = UINT64_MAX;
    ElfN_Addr max_vaddr = 0;

    // Process the necessary program headers once
    int seg_count = 0;
    ElfN_Phdr *tls_phdr = NULL;
    int stack_prot = PROT_READ | PROT_WRITE;
    // ElfN_Addr relro_start = 0, relro_end = 0;

    ElfN_Addr dyn_vaddr = 0;

    // Grab data from relevant program headers
    for (int i = 0; i < info->hdr->e_phnum; i++) {
        switch (phdr[i].p_type) {
            case PT_LOAD:
                if (seg_count >= MAX_SEGMENTS) return 0;
                segments[seg_count++] = (load_segment) {
                    .vaddr  = phdr[i].p_vaddr,
                    .memsz  = phdr[i].p_memsz,
                    .filesz = phdr[i].p_filesz,
                    .offset = phdr[i].p_offset,
                    .flags  = phdr[i].p_flags,
                    .align  = phdr[i].p_align
                };

                if (phdr[i].p_vaddr < min_vaddr) {
                    min_vaddr = phdr[i].p_vaddr;
                }

                ElfN_Addr end = phdr[i].p_vaddr + phdr[i].p_memsz;
                if (end > max_vaddr) {
                    max_vaddr = end;
                }
                break;
            case PT_TLS:
                tls_phdr = &phdr[i];
                break;
            case PT_GNU_STACK:
                stack_prot = 0;
                if (phdr[i].p_flags & PF_R) stack_prot |= PROT_READ;
                if (phdr[i].p_flags & PF_W) stack_prot |= PROT_WRITE;
                if (phdr[i].p_flags & PF_X) stack_prot |= PROT_EXEC;
                break;
            case PT_DYNAMIC:
                dyn_vaddr = phdr[i].p_vaddr;
                break;
            // case PT_GNU_RELRO:
            //     relro_start = phdr[i].p_vaddr;
            //     relro_end   = phdr[i].p_vaddr + phdr[i].p_memsz;
            //     break;
            default:
                continue;
        }
    }

    // Memory size of the whole file's PT_LOAD segments
    load->memsz = max_vaddr - min_vaddr;

    // Create PIE base
    size_t page_size = (size_t)sysconf(_SC_PAGESIZE);

    /* Determine max alignment among PT_LOAD segments */
    size_t max_align = page_size;
    for (int i = 0; i < seg_count; i++) {
        size_t a = (size_t)segments[i].align;
        if (a && a > max_align) max_align = a;
    }

    // Some toolchains set p_align=0 to be defensive
    if (max_align < page_size) max_align = page_size;

    // Over-allocate so we can align later
    size_t alloc_sz = load->memsz + max_align;

    char *mapping_raw = mmap(NULL, alloc_sz, PROT_READ | PROT_WRITE, MAP_PRIVATE | MAP_ANONYMOUS, -1, 0);
    if (mapping_raw == MAP_FAILED) {
        // perror("mmap(mapping_raw)");
        return 0;
    }

    // Get the mapped memory region and align it
    uintptr_t raw = (uintptr_t)mapping_raw;
    uintptr_t aligned = (raw + (max_align - 1)) & ~(uintptr_t)(max_align - 1);
    char *mapping = (char *)aligned;

    // Keep mapping_raw around (don’t munmap prefix/suffix yet)
    info->pie_base = (ElfN_Addr)mapping - (ElfN_Addr)min_vaddr;

    // printf("[+] PIE Base: 0x%lx (raw=%p align=0x%zx alloc_sz=0x%zx)\n",info->pie_base, mapping_raw, max_align, alloc_sz);
    // printf("[+] Debug: blr x3 site approx: %p\n", (void *)(info->pie_base + 0x9db84));

    // if (relro_start) {
    //     printf("[+] RELRO: [%p - %p)\n", (void *)(info->pie_base + relro_start), (void *)(info->pie_base + relro_end));
    // }

    // Load each segment into memory
    for (int i = 0; i < seg_count; i++) {
        load_segment *seg = &segments[i];
        // printf("[+] Loading Segment %d: vaddr=0x%lx, memsz=0x%lx, filesz=0x%lx, flags=0x%x\n",  i, seg->vaddr, seg->memsz, seg->filesz, seg->flags);
        void *dst = (void *)(info->pie_base + seg->vaddr); // Compute offset of program header for each PT_LOAD
        void *src = (void *)(elf_start + seg->offset);

        memcpy(dst, src, seg->filesz);

        // Zero out the .bss if necessary
        if (seg->memsz > seg->filesz) {
            memset(dst + seg->filesz, 0, seg->memsz - seg->filesz); 
        }
    }

    // Flush instruction cache
    __builtin___clear_cache((char *)mapping, (char *)mapping + load->memsz);


    // Discover relocation entries
    ElfN_Rela *rela_dyn = NULL;
    size_t rela_dyn_count = 0;

    ElfN_Rela *rela_plt = NULL;
    size_t rela_plt_count = 0;
    ElfN_Sxword plt_is_rela = 1; // x86_64 uses RELA

    // Parse dynamic segment to find relocation tables
    if (dyn_vaddr != 0) {
        ElfN_Dyn *dyn = (ElfN_Dyn *)(info->pie_base + dyn_vaddr);

        for (ElfN_Dyn *d = dyn; d->d_tag != DT_NULL; d++) {
            switch (d->d_tag) {
                case DT_RELA:
                    rela_dyn = (ElfN_Rela *)(info->pie_base + d->d_un.d_ptr);
                    break;
                case DT_RELASZ:
                    rela_dyn_count = d->d_un.d_val / sizeof(ElfN_Rela);
                    break;

                case DT_JMPREL:
                    /* relocation table for PLT (usually .rela.plt) */
                    rela_plt = (ElfN_Rela *)(info->pie_base + d->d_un.d_ptr);
                    break;
                case DT_PLTRELSZ:
                    rela_plt_count = d->d_un.d_val / sizeof(ElfN_Rela);
                    break;
                case DT_PLTREL:
                    plt_is_rela = d->d_un.d_val;
                    break;
                default:
                    break;
            }
        }
    }
    
    // Apply dynamic relocations
    if (rela_dyn) {
        // printf("[+] Applying %zu .rela.dyn relocations\n", rela_dyn_count);

        // Handle relative relocations
        for (size_t i = 0; i < rela_dyn_count; i++) {
            ElfN_Xword type = ELF64_R_TYPE(rela_dyn[i].r_info);
            ElfN_Addr *where = (ElfN_Addr *)(info->pie_base + rela_dyn[i].r_offset);

            if (type == R_X86_64_RELATIVE) {
                *where = info->pie_base + rela_dyn[i].r_addend;
            } else if (type == R_X86_64_IRELATIVE || type == R_X86_64_NONE) {
                continue;
            } else {
                // fprintf(stderr,
                //     "[-] Unhandled .rela.dyn type=%llu sym=%llu r_offset=0x%llx addend=0x%llx (addr=%p)\n",
                //     (unsigned long long)type,
                //     (unsigned long long)ELF64_R_SYM(rela_dyn[i].r_info),
                //     (unsigned long long)rela_dyn[i].r_offset,
                //     (unsigned long long)rela_dyn[i].r_addend,
                //     (void *)(info->pie_base + rela_dyn[i].r_offset));
                _exit(1);
            }
        }
    }
    

    // Handle PT_TLS (x86_64 SysV ABI, TLS Variant II)
    if (tls_phdr) {
        size_t tls_size  = tls_phdr->p_memsz;
        size_t tls_align = tls_phdr->p_align ? tls_phdr->p_align : 16;

        size_t tls_area = (tls_size + tls_align - 1) & ~(tls_align - 1);

        /* Allocate TCB + TLS */
        size_t neg_tls = 0x80;
        size_t tcb_size = 0x100;  // minimal fake pthread
        size_t total = tcb_size + tls_area;

        uint8_t *block = mmap(
            NULL, total,
            PROT_READ | PROT_WRITE,
            MAP_PRIVATE | MAP_ANONYMOUS,
            -1, 0
        );

        if (block == MAP_FAILED)
            _exit(1);

        void *tcb = block + neg_tls;
        void *tls_block = block + tcb_size;

        // Zero negative space
        memset(block, 0, neg_tls);

        // Copy TLS
        memcpy(
            tls_block,
            (void *)(info->pie_base + tls_phdr->p_vaddr),
            tls_phdr->p_filesz
        );

        /* Zero .tbss */
        memset(
            (uint8_t *)tls_block + tls_phdr->p_filesz,
            0,
            tls_phdr->p_memsz - tls_phdr->p_filesz
        );

        /* Self pointer (glibc-compatible enough) */
        *(void **)tcb = tcb;

        /* Install FS base */
        syscall(SYS_arch_prctl, ARCH_SET_FS, tcb);
    }


    // Apply RWX permissions
    if (!apply_segment_protections_union(mapping, load->memsz, info->pie_base, segments, seg_count, 1)) {
        // fprintf(stderr, "[-] Failed to apply segment protections\n");
        return 0;
    }

    /* Apply IRELATIVE relocations now that text is executable */
    if (rela_dyn) {
        // printf("[+] Applying .rela.dyn IRELATIVE relocations\n");
        for (size_t i = 0; i < rela_dyn_count; i++) {
            ElfN_Xword type = ELF64_R_TYPE(rela_dyn[i].r_info);
            if (type != R_X86_64_IRELATIVE) continue;

            ElfN_Addr *where = (ElfN_Addr *)(info->pie_base + rela_dyn[i].r_offset);
            ElfN_Addr resolver_addr = info->pie_base + rela_dyn[i].r_addend;
            ElfN_Addr (*resolver)(void) = (ElfN_Addr (*)(void))resolver_addr;

            *where = resolver();
        }
    }

    // Call IFUNC resolvers to handle PLT relocations
    if (rela_plt) {
        if (plt_is_rela != DT_RELA) {
            // fprintf(stderr, "[-] Unexpected DT_PLTREL (expected DT_RELA)\n");
            _exit(1);
        }

        // printf("[+] Applying %zu .rela.plt relocations\n", rela_plt_count);
        for (size_t i = 0; i < rela_plt_count; i++) {
            ElfN_Xword type = ELF64_R_TYPE(rela_plt[i].r_info);
            ElfN_Addr *where = (ElfN_Addr *)(info->pie_base + rela_plt[i].r_offset);

            if (type == R_X86_64_IRELATIVE) {
                ElfN_Addr resolver_addr = info->pie_base + rela_plt[i].r_addend;
                ElfN_Addr (*resolver)(void) = (ElfN_Addr (*)(void))resolver_addr;

                ElfN_Addr value = resolver();
                *where = value;
            } else if (type == R_X86_64_NONE) {
                continue;
            } else if (type == R_X86_64_RELATIVE) {
                *where = info->pie_base + rela_plt[i].r_addend;
            } else {
                // fprintf(stderr, "[-] Unhandled .rela.plt type=%llu at idx=%zu\n", (unsigned long long)type, i);
                _exit(1);
            }
        }
    }

    // Remove write permissions
    if (!apply_segment_protections_union(mapping, load->memsz, info->pie_base, segments, seg_count, 0)) {
        // fprintf(stderr, "[-] Failed to apply segment protections\n");
        return 0;
    }

    // Calculate entry point and store it
    info->entry_point = (void*)(info->pie_base + info->hdr->e_entry);
    // printf("[+] Entry Point: %p\n", info->entry_point);


    // Create the stack
    size_t stack_size = 3 * 1024 * 1024;
    char *stack = mmap(NULL, stack_size, PROT_READ | PROT_WRITE, MAP_PRIVATE | MAP_ANONYMOUS, -1, 0);
    assert(stack != MAP_FAILED);

    char *stack_end = stack + stack_size;

    // Count envc
    int envc = 0;
    for (char **p = envp; *p; ++p) envc++;

    // Build AUXV
    ElfN_Addr new_auxv[256];
    int auxc = 0;

    // Macro to push key-value pairs onto new_auxv
    #define AUX_PUSH(k,v) do { \
        if (auxc + 2 >= (int)(sizeof(new_auxv)/sizeof(new_auxv[0]))) { \
            /*fprintf(stderr, "auxv overflow\n");*/ \
            _exit(1); \
        } \
        new_auxv[auxc++] = (ElfN_Addr)(k); \
        new_auxv[auxc++] = (ElfN_Addr)(v); \
    } while (0)

    ElfN_Addr at_sysinfo_ehdr = 0, at_hwcap = 0, at_hwcap2 = 0, at_clktck = 0;
    ElfN_Addr at_uid = 0, at_euid = 0, at_gid = 0, at_egid = 0, at_secure = 0;
    ElfN_Addr at_platform = 0;

    for (ElfN_Addr *a = orig_auxv; a[0] != AT_NULL; a += 2) {
        switch (a[0]) {
            case AT_SYSINFO_EHDR: at_sysinfo_ehdr = a[1]; break;
            case AT_HWCAP:        at_hwcap = a[1]; break;
            case AT_HWCAP2:       at_hwcap2 = a[1]; break;
            case AT_CLKTCK:       at_clktck = a[1]; break;
            case AT_UID:          at_uid = a[1]; break;
            case AT_EUID:         at_euid = a[1]; break;
            case AT_GID:          at_gid = a[1]; break;
            case AT_EGID:         at_egid = a[1]; break;
            case AT_SECURE:       at_secure = a[1]; break;
            case AT_PLATFORM:     at_platform = a[1]; break;
            default: break;
        }
    }

    size_t pagesz = (size_t)sysconf(_SC_PAGESIZE);

    AUX_PUSH(AT_PHDR,   info->pie_base + info->hdr->e_phoff);
    AUX_PUSH(AT_PHENT,  info->hdr->e_phentsize);
    AUX_PUSH(AT_PHNUM,  info->hdr->e_phnum);
    AUX_PUSH(AT_PAGESZ, pagesz);
    AUX_PUSH(AT_ENTRY,  (ElfN_Addr)info->entry_point);
    AUX_PUSH(AT_BASE,   0);
    AUX_PUSH(AT_SECURE, at_secure);

    if (at_uid)  AUX_PUSH(AT_UID, at_uid);
    if (at_euid) AUX_PUSH(AT_EUID, at_euid);
    if (at_gid)  AUX_PUSH(AT_GID, at_gid);
    if (at_egid) AUX_PUSH(AT_EGID, at_egid);

    if (at_hwcap)  AUX_PUSH(AT_HWCAP, at_hwcap);
    if (at_hwcap2) AUX_PUSH(AT_HWCAP2, at_hwcap2);
    if (at_clktck) AUX_PUSH(AT_CLKTCK, at_clktck);

    // Reserve space for extra auxv entries we will add later
    size_t extra_aux_words = 2 /*AT_RANDOM*/ + 2 /*AT_EXECFN*/ + 2 /*AT_PLATFORM (optional)*/ + 2 /*AT_SYSINFO_EHDR (optional)*/ + 2 /*AT_NULL*/;
    size_t ptr_words = 1 + (size_t)argc + 1 + (size_t)envc + 1 + (size_t)auxc + extra_aux_words;

    // Align pointer table size to 16 bytes
    size_t ptr_bytes = ptr_words * sizeof(ElfN_Addr);
    ptr_bytes = (ptr_bytes + 15) & ~(size_t)15;

    uintptr_t ptr_base_unaligned = (uintptr_t)stack_end - ptr_bytes;
    uintptr_t ptr_base = ptr_base_unaligned & ~(uintptr_t)0xFULL;

    // Define ptr_top relative to ptr_base so reservation size is preserved
    char *ptr_base_p = (char *)ptr_base;
    char *ptr_top_p  = ptr_base_p + ptr_bytes;

    // Strings go below ptr_base
    char *str_top = ptr_base_p;

    // Copy argv strings
    char **new_argv = alloca(sizeof(char*) * (argc + 1));
    for (int i = 0; i < argc; i++) new_argv[i] = stack_copy_str(&str_top, argv[i]);
    new_argv[argc] = NULL;

    // Copy envp strings
    char **new_envp = alloca(sizeof(char*) * (envc + 1));
    for (int i = 0; i < envc; i++) new_envp[i] = stack_copy_str(&str_top, envp[i]);
    new_envp[envc] = NULL;

    // fill out other auxv entries
    char *new_execfn = stack_copy_str(&str_top, argv[0]);

    char *new_platform = NULL;
    if (at_platform) new_platform = stack_copy_str(&str_top, (const char *)at_platform);

    // Align for AT_RANDOM
    str_top = (char *)((uintptr_t)str_top & ~0xFULL);

    uint8_t *randbuf = (uint8_t *)(str_top - 16);
    str_top = (char *)randbuf;  // add AT_RANDOM string space
    syscall(__NR_getrandom, randbuf, 16, 0);

    // Finalize auxv
    AUX_PUSH(AT_RANDOM, (ElfN_Addr)randbuf);
    AUX_PUSH(AT_EXECFN, (ElfN_Addr)new_execfn);
    if (new_platform) AUX_PUSH(AT_PLATFORM, (ElfN_Addr)new_platform);
    if (at_sysinfo_ehdr) AUX_PUSH(AT_SYSINFO_EHDR, at_sysinfo_ehdr);
    AUX_PUSH(AT_NULL, 0);

    // Write pointer table linearly
    ElfN_Addr *sp = (ElfN_Addr *)ptr_base_p;
    ElfN_Addr *out = sp;

    *out++ = (ElfN_Addr)argc;

    for (int i = 0; i < argc; i++) *out++ = (ElfN_Addr)new_argv[i];
    *out++ = 0;

    for (int i = 0; i < envc; i++) *out++ = (ElfN_Addr)new_envp[i];
    *out++ = 0;

    memcpy(out, new_auxv, (size_t)auxc * sizeof(ElfN_Addr));
    out += auxc;

    // bounds + alignment checks
    if ((char *)out > ptr_top_p) {
        // fprintf(stderr, "stack pointer table overflow\n");
        _exit(1);
    }
    // if (((uintptr_t)sp & 0xFULL) != 0) {
    //     fprintf(stderr, "SP not 16-byte aligned: %p\n", sp);
    //     _exit(1);
    // }

    mprotect(stack, stack_size, stack_prot);
    // printf("[+] Stack Pointer: %p\n", sp);

    // fprintf(stderr, "argc=%lu argv0=%s envp0=%s\n", (unsigned long)sp[0], (char *)sp[1], (char *)(sp + 1 + argc + 1)[0]);

    amd_jump((ElfN_Addr)sp, info->entry_point);
    
    return 1; // Unreachable
}

int main(int argc, char** argv, char** envp) {
    struct elf_info info;
    struct load_segment load;
    load_image((char *)agent, &info, &load, argc, argv, envp);
        
    return 0; // Unreachable
}
