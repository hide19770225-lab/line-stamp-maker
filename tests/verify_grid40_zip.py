"""Independent PNG/ZIP validation for the synthetic numbered 40-sheet test."""
import sys
from pathlib import Path
from verify_zip import verify
folder = Path(sys.argv[1] if len(sys.argv) > 1 else '/tmp/stamp-grid40-results')
for name in ['numbered-40.zip', 'fallback-40.zip']:
    verify(folder / name, 40)
assert (folder / 'numbered-40.zip').read_bytes() == (folder / 'fallback-40.zip').read_bytes()
print('PASS: share failure and capability failure preserve the same 42-file ZIP')
