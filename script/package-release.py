#!/usr/bin/env python3
"""Package explicit public files, never the working directory wholesale."""
from pathlib import Path
import argparse, hashlib, plistlib, subprocess, zipfile

root = Path(__file__).resolve().parents[1]
p = argparse.ArgumentParser()
p.add_argument('--version', default='3.4.0')
p.add_argument('--app', type=Path)
p.add_argument('--image', type=Path)
args = p.parse_args()
if args.version != '3.4.0':
    raise SystemExit('Update the versioned public guides before packaging another version.')
out = root / 'dist' / 'release'
out.mkdir(parents=True, exist_ok=True)
prefix = 'AssetTracker-v' + args.version
assets = (root / 'script/web-assets.manifest').read_text().splitlines()
public_docs = ['README.md','LICENSE','CONTRIBUTORS.md','CONTRIBUTING.md','SECURITY.md',
 'THIRD_PARTY_NOTICES.md','docs/user-guide.md','docs/branding.md','docs/releases/v3.4.0.md',
 'docs/validation/v3.4.0.md','deploy/ugreen/README.md', 'docs/examples/demo-book.json',
 'vendor/SHEETJS-LICENSE.txt','vendor/CHARTJS-LICENSE.txt']
public_docs += [str(p.relative_to(root)) for p in sorted(p for p in (root/'docs/images').iterdir() if p.suffix.lower() in {'.png','.jpg'})]

def put(archive, source, name):
    file = root / source
    if not file.is_file() or file.is_symlink() or not file.resolve().is_relative_to(root):
        raise RuntimeError('Missing or unsafe package source: '+source)
    archive.write(file, name)

with zipfile.ZipFile(out/(prefix+'-web.zip'),'w',zipfile.ZIP_DEFLATED) as z:
    for source in dict.fromkeys(assets+public_docs):
        put(z, source, 'AssetTracker-web/'+source)

nas = ['server/server.cjs','server/backup.cjs','script/web-assets.manifest',
 'nas.html','nas.css','nas-connection.js','nas-model.js','nas-ui.js','ledger-import.js',
 'legacy-safety.js','expense-projects.js','styles.css','assets/asset-tracker-logo-v3.png',
 'LICENSE','payment-file.js','wechat-import.js','alipay-import.js','bank-import.js',
 'wechat-import-ui.js','import-audit-ui.js','vendor/xlsx.full.min.js',
 'vendor/pdfjs/pdf.mjs','vendor/pdfjs/pdf.worker.mjs','vendor/pdfjs/pdf.classic.js',
 'vendor/pdfjs/pdf.worker.classic.js','vendor/pdfjs/LICENSE','vendor/SHEETJS-LICENSE.txt',
 'vendor/CHARTJS-LICENSE.txt','THIRD_PARTY_NOTICES.md']
with zipfile.ZipFile(out/(prefix+'-nas.zip'),'w',zipfile.ZIP_DEFLATED) as z:
    for source in nas:
        put(z, source, 'AssetTracker-nas/'+source)
    for name in ['Dockerfile','.env.example','compose.yaml','compose.prebuilt.yaml','compose.nas-lan.yaml']:
        content=(root/'deploy/ugreen'/name).read_text()
        if name=='compose.yaml':
            content=content.replace('context: ../..','context: .').replace('dockerfile: deploy/ugreen/Dockerfile','dockerfile: Dockerfile')
        z.writestr('AssetTracker-nas/'+name,content)
    guide=(root/'deploy/ugreen/README.md').read_text().replace('../../README.md','https://github.com/QiushanHuang/Asset-Tracker/blob/v3.4.0/README.md')
    z.writestr('AssetTracker-nas/README.md',guide)

if args.app:
    app=args.app.resolve()
    info=plistlib.loads((app/'Contents/Info.plist').read_bytes())
    if info['CFBundleShortVersionString']!=args.version:
        raise SystemExit('Application version does not match release.')
    subprocess.run(['/usr/bin/ditto','-c','-k','--keepParent',str(app),str(out/(prefix+'-macos-arm64.zip'))],check=True)

if args.image:
    image=args.image.resolve()
    destination=out/(prefix+'-nas-linux-amd64.tar.gz')
    if image!=destination:
        import shutil
        shutil.copyfile(image,destination)

for file in out.glob(prefix+'-*.zip'):
    with zipfile.ZipFile(file) as z:
        if z.testzip() is not None: raise SystemExit('Invalid archive '+file.name)
        for name in z.namelist():
            parts=Path(name).parts
            if any(part in {'.env','.git','node_modules','output'} for part in parts) or '/docs/qa/' in name or name.endswith(('.sqlite','.sqlite-wal','.sqlite-shm')) or Path(name).name=='AssetTrackerBook.json':
                raise SystemExit('Private state in archive: '+name)
checks=[]
for file in sorted(out.glob(prefix+'-*')):
    if file.is_file():
        with file.open('rb') as f: digest=hashlib.file_digest(f,'sha256').hexdigest()
        checks.append(digest+'  '+file.name)
(out/'SHA256SUMS.txt').write_text('\n'.join(checks)+'\n')
print(f'Packaged {len(checks)} public artifacts; archive integrity and private-state exclusions verified.')
