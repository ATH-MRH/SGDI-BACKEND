"""Run backup.sh under a nonblocking kernel lock (Linux and macOS).

The lock file must never be removed: all contenders lock the same inode.
FD 9 survives exec and is inherited by backup subprocesses; the kernel releases
it when the last owner exits, including after a crash. No PID recovery race.
"""
import fcntl
import os
import sys


def main():
    if sys.argv[1] == '--verify':
        try:
            held, named = os.fstat(9), os.stat(sys.argv[2], follow_symlinks=False)
            if (held.st_dev, held.st_ino) != (named.st_dev, named.st_ino):
                return 1
            fcntl.flock(9, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except OSError:
            return 1
        return 0
    path, script, *args = sys.argv[1:]
    fd = os.open(path, os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
    try:
        fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError:
        os.close(fd)
        print("une autre sauvegarde est en cours : abandon", file=sys.stderr)
        return 75
    if fd != 9:
        os.dup2(fd, 9, inheritable=True)
        os.close(fd)
    os.set_inheritable(9, True)
    os.execvp("bash", ["bash", script, "--atlas-backup-locked", *args])


if __name__ == "__main__":
    sys.exit(main())
