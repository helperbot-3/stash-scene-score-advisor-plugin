#!/usr/bin/env python3
"""Package the advisor and a Stash plugin source index; excludes all local data."""
from pathlib import Path
from datetime import datetime, timezone
import hashlib
import sys
import zipfile
root=Path(__file__).resolve().parent
out=Path(sys.argv[1]) if len(sys.argv)>1 else root/'_site/main'
out.mkdir(parents=True,exist_ok=True)
package=root/'plugins/scene-score-advisor'
version=next(line.split(':',1)[1].strip() for line in (package/'scene-score-advisor.yml').read_text().splitlines() if line.startswith('version:'))
archive=out/'scene-score-advisor.zip'
with zipfile.ZipFile(archive,'w',zipfile.ZIP_DEFLATED) as zipped:
    for name in ['scene-score-advisor.yml','ui/model.js','ui/advisor.js','ui/advisor.css']:
        zipped.write(package/name,name)
    for name in ['README.md','LICENCE']:zipped.write(root/name,name)
digest=hashlib.sha256(archive.read_bytes()).hexdigest()
date=datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M:%S')
(out/'index.yml').write_text(f'''- id: scene-score-advisor
  name: Scene Score Advisor
  metadata:
    description: Explainable tag-based score suggestions with a separate 1–5 display.
  version: {version}-{digest[:12]}
  date: "{date}"
  path: scene-score-advisor.zip
  sha256: {digest}
''')
print(archive.resolve())
