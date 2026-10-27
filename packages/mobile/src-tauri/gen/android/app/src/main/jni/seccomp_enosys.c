// SPDX-License-Identifier: MIT
// Turns the app seccomp filter's SIGSYS into -ENOSYS for rootfs programs.
//
// Android's untrusted_app filter traps every syscall it does not know: on a 4.19 kernel that includes
// faccessat2, clone3, close_range, io_uring_* and other calls newer userlands try first and fall back from
// when the kernel answers -ENOSYS. The filter kills the process instead (node -e, npm, toybox under a musl
// environment, measured on a Mi 10 Pro, Android 13). This library installs a SIGSYS handler that writes -ENOSYS
// into the return register and resumes, which is exactly what a kernel without the call would have answered.
//
// It is freestanding (no libc, no DT_NEEDED) so both the musl loader of the rootfs and Bionic can preload it:
// the handler and its registration use raw syscalls only.
#include <stddef.h>
#include <stdint.h>

#define SIGSYS_NUMBER 31
#define SA_SIGINFO_FLAG 0x00000004
#define SA_RESTART_FLAG 0x10000000
#define ENOSYS_ERRNO 38
#define NR_RT_SIGACTION 134

// Kernel struct sigaction for arm64 (sa_handler, sa_flags, sa_restorer, sa_mask).
struct kernel_sigaction {
    void (*handler)(int, void *, void *);
    unsigned long flags;
    void (*restorer)(void);
    uint64_t mask;
};

// arm64 ucontext: uc_flags(8) uc_link(8) uc_stack(24) uc_sigmask(8) padding(120) then mcontext with
// fault_address(8) followed by regs[31]. regs[0] is the syscall return value.
#define UCONTEXT_MCONTEXT_OFFSET 176
#define MCONTEXT_REGS_OFFSET 8

static void enosys_handler(int signal, void *info, void *context) {
    (void)signal;
    (void)info;
    uint64_t *regs = (uint64_t *)((char *)context + UCONTEXT_MCONTEXT_OFFSET + MCONTEXT_REGS_OFFSET);
    regs[0] = (uint64_t)(int64_t)-ENOSYS_ERRNO;
}

static long raw_syscall4(long number, long a0, long a1, long a2, long a3) {
    register long x8 __asm__("x8") = number;
    register long x0 __asm__("x0") = a0;
    register long x1 __asm__("x1") = a1;
    register long x2 __asm__("x2") = a2;
    register long x3 __asm__("x3") = a3;
    __asm__ volatile("svc #0" : "+r"(x0) : "r"(x8), "r"(x1), "r"(x2), "r"(x3) : "memory");
    return x0;
}

__attribute__((constructor)) static void install_enosys_handler(void) {
    struct kernel_sigaction action = {
        .handler = enosys_handler,
        .flags = SA_SIGINFO_FLAG | SA_RESTART_FLAG,
        .restorer = NULL, // arm64 returns through the vDSO sigreturn trampoline
        .mask = 0,
    };
    raw_syscall4(NR_RT_SIGACTION, SIGSYS_NUMBER, (long)&action, 0, sizeof(uint64_t));
}
