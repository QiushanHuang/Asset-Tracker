#!/usr/bin/env python3
"""Validate local links and the promised single-file language navigation."""
from pathlib import Path
import re
from urllib.parse import unquote, urlsplit

root = Path(__file__).resolve().parents[1]
files = [root / name for name in (
    'README.md', 'README.en.md', 'CONTRIBUTORS.md', 'CONTRIBUTING.md', 'SECURITY.md',
    'THIRD_PARTY_NOTICES.md', 'docs/user-guide.md', 'docs/branding.md',
    'docs/releases/v3.2.1.md', 'docs/validation/v3.2.1.md', 'deploy/ugreen/README.md')]

def anchors(path):
    text = path.read_text()
    found = set(re.findall(r'<a\s+id="([^"]+)"', text))
    for heading in re.findall(r'^#{1,6}\s+(.+)$', text, re.M):
        clean = re.sub(r'[`*_]', '', heading).lower()
        found.add(''.join(c for c in clean if c.isalnum() or c in ' -_').replace(' ', '-'))
    return found

errors = []
for path in files:
    if not path.exists():
        errors.append(f'Missing document: {path.relative_to(root)}')
        continue
    text = path.read_text()
    for target in re.findall(r'!?\[[^\]]*\]\(([^)]+)\)', text):
        target = target.strip('<>')
        parts = urlsplit(target)
        if parts.scheme or parts.netloc:
            continue
        resolved = (path.parent / unquote(parts.path)).resolve() if parts.path else path
        if not resolved.is_relative_to(root) or not resolved.is_file():
            errors.append(f'{path.relative_to(root)}: broken local link {target}')
        elif parts.fragment and resolved.suffix == '.md' and unquote(parts.fragment) not in anchors(resolved):
            errors.append(f'{path.relative_to(root)}: missing anchor {target}')
readme = (root / 'README.md').read_text()
assert readme.index('<a id="english">') < readme.index('<a id="中文">')
assert readme.count(')](#中文)') >= 2 and readme.count(')](#english)') >= 2
assert not re.search(r'\[!\[(?:English|简体中文)\].*?\]\([^#]', readme)
assert 'https://github.com/QiushanHuang' in readme
if errors:
    raise SystemExit('\n'.join(errors))
print(f'{len(files)} public documents: local links, anchors and same-file language badges verified.')
