#!/usr/bin/env python3
"""Package Raad DM deliverables: project zip + extension zips."""
import os
import zipfile

ROOT = '/home/z/my-project/raad-dm'
OUT = '/home/z/my-project/download'
os.makedirs(OUT, exist_ok=True)

EXCLUDE_DIRS = {'node_modules', 'dist', '.git'}
EXCLUDE_FILES = {'.DS_Store', 'Thumbs.db'}


def zip_dir(src_dir, zip_path, arc_root=''):
    n = 0
    with zipfile.ZipFile(zip_path, 'w', zipfile.ZIP_DEFLATED, compresslevel=9) as z:
        for base, dirs, files in os.walk(src_dir):
            dirs[:] = [d for d in dirs if d not in EXCLUDE_DIRS]
            for f in files:
                if f in EXCLUDE_FILES or f.endswith('.log'):
                    continue
                full = os.path.join(base, f)
                rel = os.path.relpath(full, src_dir)
                z.write(full, os.path.join(arc_root, rel))
                n += 1
    return n


# 1) extension zips (contents at zip root — required for AMO / load-unpacked-from-zip workflows)
for name in ['chrome', 'firefox']:
    src = os.path.join(ROOT, 'extension', name)
    dst = os.path.join(OUT, f'raad-extension-{name}.zip')
    cnt = zip_dir(src, dst)
    print(f'{dst}  ({cnt} files)')

# 2) full project zip
dst = os.path.join(OUT, 'raad-dm-v1.0.0.zip')
cnt = zip_dir(ROOT, dst, arc_root='raad-dm')
print(f'{dst}  ({cnt} files)')

# sizes
for f in sorted(os.listdir(OUT)):
    p = os.path.join(OUT, f)
    if os.path.isfile(p):
        print(f'{f}: {os.path.getsize(p)/1024:.0f} KB')
