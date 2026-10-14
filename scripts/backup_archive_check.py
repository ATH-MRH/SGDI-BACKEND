"""Validate and extract an ATLAS bundle before any database is created.

Only directories and regular files inside the private staging directory are
accepted. Every payload and nested file archive must match its checksum list.
No archive-supplied path, link or manifest label can escape staging.
"""
import gzip
import hashlib
import re
import shutil
import sys
import tarfile
from pathlib import Path, PurePosixPath


def relative(name):
    path = PurePosixPath(name)
    if path.is_absolute() or '..' in path.parts or '\\' in name or '\n' in name or '\r' in name:
        raise ValueError('chemin d’archive invalide')
    return path


def extract(archive, target):
    # Consume the complete gzip stream, including its CRC/trailer, before tar
    # inspection. tarfile may stop at the tar end marker before checking gzip EOF.
    if archive.suffix == '.gz':
        plain = target.parent / (target.name + '.validated.tar')
        try:
            with gzip.open(archive, 'rb') as source, plain.open('xb') as output:
                shutil.copyfileobj(source, output)
            extract(plain, target)
        finally:
            plain.unlink(missing_ok=True)
        return
    seen = set()
    with tarfile.open(archive, 'r:*') as handle:
        members = handle.getmembers()  # Read the whole archive before extracting anything.
        for member in members:
            path = relative(member.name)
            if not (member.isdir() or member.isfile()) or path in seen:
                raise ValueError('entrée d’archive invalide ou dupliquée')
            seen.add(path)
        for member in members:
            dest = target.joinpath(*relative(member.name).parts)
            if member.isdir():
                dest.mkdir(parents=True, exist_ok=True)
            else:
                dest.parent.mkdir(parents=True, exist_ok=True)
                with handle.extractfile(member) as source, dest.open('xb') as output:
                    shutil.copyfileobj(source, output)


def verify(target, sums):
    expected = set()
    for line in sums.read_text().splitlines():
        match = re.fullmatch(r'([0-9a-f]{64})  (.+)', line)
        if not match:
            raise ValueError('liste de checksums invalide')
        path = relative(match[2])
        if path in expected:
            raise ValueError('checksum dupliqué')
        expected.add(path)
        file = target.joinpath(*path.parts)
        with file.open('rb') as stream:
            digest = hashlib.file_digest(stream, 'sha256').hexdigest()
        if digest != match[1]:
            raise ValueError('checksum du contenu incorrect')
    actual = {PurePosixPath(p.relative_to(target).as_posix()) for p in target.rglob('*') if p.is_file() and p != sums}
    if actual != expected:
        raise ValueError('fichier manquant ou non couvert par les checksums')


def validate(archive, work):
    bundle = work / 'bundle'
    extract(archive, bundle)
    verify(bundle, bundle / 'SHA256SUMS')
    manifest = {}
    for line in (bundle / 'manifest.txt').read_text().splitlines():
        key, sep, value = line.partition('=')
        if not sep or key in manifest:
            raise ValueError('manifeste invalide')
        manifest[key] = value
    if manifest.get('format') != 'atlas-backup-1':
        raise ValueError('format d’archive inconnu')
    for name in ('db.dump', 'row_counts_before.tsv', 'row_counts_after.tsv'):
        if not (bundle / name).is_file():
            raise ValueError('archive incomplète')
    for key in ('tables', 'constraints', 'indexes', 'files_total'):
        if not manifest.get(key, '').isdigit():
            raise ValueError('compteur du manifeste invalide')
    labels = manifest.get('files_sets', '').split()
    if len(set(labels)) != len(labels) or any(not re.fullmatch(r'[A-Za-z0-9_-]+', label) for label in labels):
        raise ValueError('liste des fichiers invalide')
    count = 0
    for label in labels:
        target = work / 'files' / label
        target.mkdir(parents=True)
        extract(bundle / 'files' / (label + '.tar.gz'), target)
        verify(target, bundle / 'files' / (label + '.sha256'))
        count += sum(p.is_file() for p in target.rglob('*'))
    if count != int(manifest['files_total']):
        raise ValueError('nombre de fichiers incorrect')


if __name__ == '__main__':
    try:
        validate(Path(sys.argv[1]), Path(sys.argv[2]))
    except (OSError, ValueError, tarfile.TarError, EOFError):
        print('archive ou somme de contrôle du contenu invalide : restauration refusée', file=sys.stderr)
        sys.exit(1)
