#!/usr/bin/env bash
# Concatenate the institution tool layer into one file for deployment.
#
# WHY. supabase/functions/institution-tools/index.ts imports 16 modules from
# _shared/. The deploy path available to this project is the Supabase MCP
# tool, which takes an inline file set; a 17-file graph with ../ paths does
# not survive it reliably. The bundle is a BUILD ARTEFACT: the repo files
# stay the source of truth, are what vitest runs, and are what a reader
# reviews. Regenerate and redeploy after any change to them.
#
#     scripts/bundle-institution-tools.sh [out.ts]
set -euo pipefail
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT="${1:-$REPO/institution-tools.bundle.ts}"
python3 - "$REPO" "$OUT" <<'PY'
import re, sys, pathlib
repo, out = pathlib.Path(sys.argv[1]), pathlib.Path(sys.argv[2])
order = [
 'supabase/functions/_shared/numberScan.ts',
 'supabase/functions/_shared/numberEcho.ts',
 'supabase/functions/_shared/institution/types.ts',
 'supabase/functions/_shared/institution/hash.ts',
 'supabase/functions/_shared/institution/egress.ts',
 'supabase/functions/_shared/institution/robots.ts',
 'supabase/functions/_shared/institution/rateLimit.ts',
 'supabase/functions/_shared/institution/extract.ts',
 'supabase/functions/_shared/institution/searchParse.ts',
 'supabase/functions/_shared/institution/provenance.ts',
 'supabase/functions/_shared/institution/policy.ts',
 'supabase/functions/_shared/institution/sandbox/lexer.ts',
 'supabase/functions/_shared/institution/sandbox/parser.ts',
 'supabase/functions/_shared/institution/sandbox/stdlib.ts',
 'supabase/functions/_shared/institution/sandbox/run.ts',
 'supabase/functions/_shared/appKeyAuth.ts',
 'supabase/functions/institution-tools/index.ts',
]
IMPORT = re.compile(r"^import\s(?:type\s)?[\s\S]*?from\s+'(\.[^']+)';\s*$", re.M)
EXPORT_FROM = re.compile(r"^export\s(?:type\s)?\{[\s\S]*?\}\s+from\s+'(\.[^']+)';\s*$", re.M)
# A bare `export { X };` re-exports something this module imported. After
# concatenation X is already declared once, so the re-export is a duplicate
# declaration — dropped, not renamed, because the bundle has one scope.
REEXPORT = re.compile(r"^export\s(?:type\s)?\{[^}]*\};\s*$", re.M)
parts = []
for f in order:
    src = (repo / f).read_text()
    src = REEXPORT.sub('', EXPORT_FROM.sub('', IMPORT.sub('', src)))
    parts.append(f"// ===== {f} =====\n{src.strip()}\n")
out.write_text(
 "// GENERATED BUNDLE — do not edit. Source of truth: the files named in each\n"
 "// section header. Regenerate with scripts/bundle-institution-tools.sh.\n\n"
 + "\n".join(parts))
print(f"{out} — {out.stat().st_size} bytes from {len(order)} files")
PY
