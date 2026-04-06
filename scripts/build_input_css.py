#!/usr/bin/env python3
"""Build docs/css/input.css from docs/css/styles.css for Tailwind CSS v3 migration.

Strategy:
  1. Font @import + @tailwind directives at the top
  2. @layer base   — CSS custom properties, resets, body, scrollbar, selection
  3. @layer components — everything else, minus mobile media queries & sections
"""
import re, sys

SRC = '/workspaces/casters-tool/docs/css/styles.css'
DST = '/workspaces/casters-tool/docs/css/input.css'

with open(SRC) as f:
    lines = f.read().split('\n')
N = len(lines)

# ── Helpers ──────────────────────────────────────────────────
def block_end(start):
    """Return the line index where the brace block opened at `start` closes."""
    depth = 0
    for i in range(start, N):
        depth += lines[i].count('{') - lines[i].count('}')
        if depth <= 0:
            return i
    return N - 1

MOBILE_RE = re.compile(
    r'@media\s*\(\s*max-width\s*:\s*(768|480|560)px\s*\)'
    r'|@media\s*\(\s*max-width\s*:\s*900px\s*\)\s*and\s*\(\s*orientation'
    r'|@media\s*\(\s*max-height\s*:\s*500px\s*\)\s*and\s*\(\s*orientation'
    r'|@media\s*\(\s*pointer\s*:\s*coarse'
    r'|@supports\s*\(\s*padding\s*:\s*env\(safe-area-inset'
)

def is_mobile(line):
    return bool(MOBILE_RE.search(line))

# ── Section boundaries ───────────────────────────────────────
def find_comment_block(text):
    """Find the first line of a  /* ═══ TEXT ═══ */  comment group."""
    for i, l in enumerate(lines):
        if text in l:
            j = i
            while j > 0 and ('═' in lines[j-1] or lines[j-1].strip().startswith('/*')):
                j -= 1
            return j
    return None

mob_ux = find_comment_block('MOBILE UX IMPROVEMENTS')

# UI IMPROVEMENTS — need "Additional" to disambiguate from MOBILE UX
ui_imp = None
for i, l in enumerate(lines):
    if 'UI IMPROVEMENTS' in l and 'Additional' in l:
        j = i
        while j > 0 and ('═' in lines[j-1] or lines[j-1].strip().startswith('/*')):
            j -= 1
        ui_imp = j
        break

mob_fold = find_comment_block('MOBILE FOLD')

print(f"Sections → mob_ux={mob_ux}  ui_imp={ui_imp}  mob_fold={mob_fold}",
      file=sys.stderr)

# ── Collect base-layer line ranges ───────────────────────────
base_ranges = []            # list of (start, end) inclusive

def add_base(start, end):
    base_ranges.append((start, end))

# ── :root { … } ──
for i in range(N):
    if lines[i].strip() == ':root {':
        add_base(i, block_end(i))
        break

# ── /* ═══ LIGHT THEME OVERRIDES ═══ */ ──
for i in range(N):
    if 'LIGHT THEME OVERRIDES' in lines[i]:
        add_base(i, i)
        break

# ── [data-theme="light"] { … }  (first = custom props) ──
for i in range(N):
    if lines[i].strip() == '[data-theme="light"] {':
        add_base(i, block_end(i))
        break

# ── *, *::before, *::after reset ──
for i in range(N):
    if '*, *::before, *::after' in lines[i]:
        add_base(i, i)
        break

# ── html { … } ──
for i in range(N):
    if lines[i].strip() == 'html {':
        add_base(i, block_end(i))
        break

# ── body { … } ──
for i in range(N):
    if lines[i].strip() == 'body {':
        add_base(i, block_end(i))
        break

# ── /* Subtle noise overlay */ + body::before { … } ──
for i in range(N):
    if 'Subtle noise overlay' in lines[i]:
        add_base(i, i)
        break
for i in range(N):
    if lines[i].strip() == 'body::before {':
        add_base(i, block_end(i))
        break

# ── body > * { … } ──
for i in range(N):
    if 'body > *' in lines[i] and 'position' in lines[i]:
        add_base(i, i)
        break

# ── [data-theme="light"] body::before ──
for i in range(N):
    if '[data-theme="light"] body::before' in lines[i]:
        add_base(i, i)
        break

# ── /* ═══ SCROLLBAR ═══ */ + rules ──
for i in range(N):
    s = lines[i].strip()
    if 'SCROLLBAR' in s and '═══' in s:
        add_base(i, i)
for i in range(N):
    s = lines[i].strip()
    if s in ('::-webkit-scrollbar {',
             '::-webkit-scrollbar-track {',
             '::-webkit-scrollbar-thumb {',
             '::-webkit-scrollbar-thumb:hover {'):
        add_base(i, block_end(i))

# ── /* ═══ SELECTION ═══ */ + rule ──
for i in range(N):
    s = lines[i].strip()
    if 'SELECTION' in s and '═══' in s:
        add_base(i, i)
for i in range(N):
    if lines[i].strip() == '::selection {':
        add_base(i, block_end(i))
        break

# ── Light-theme scrollbar / selection / checkbox overrides ──
for i in range(N):
    s = lines[i].strip()
    if s.startswith('[data-theme="light"] ::-webkit-scrollbar'):
        add_base(i, block_end(i))
    elif s.startswith('[data-theme="light"] ::selection'):
        add_base(i, block_end(i))
    elif s.startswith('[data-theme="light"] input[type="checkbox"]'):
        add_base(i, block_end(i))

# ── Dark-mode checkbox accent ──
for i in range(N):
    if 'dark-mode checkboxes' in lines[i].lower():
        add_base(i, i)
        break
for i in range(N):
    if lines[i].strip() == 'input[type="checkbox"] {':
        add_base(i, block_end(i))
        break

# ── Derive full set of base line numbers ──
base_set = set()
for s, e in base_ranges:
    for j in range(s, e + 1):
        base_set.add(j)

# ── Build output ─────────────────────────────────────────────
out = []

# Preamble
out.append("@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500;600;700&display=swap');")
out.append('')
out.append('@tailwind base;')
out.append('@tailwind components;')
out.append('@tailwind utilities;')
out.append('')

# ── @layer base ──
out.append('@layer base {')
sorted_base = sorted(base_ranges, key=lambda r: r[0])
prev_end = -2
for s, e in sorted_base:
    # Add a blank line separator between non-adjacent base blocks
    if s - prev_end > 2:
        out.append('')
    for j in range(s, e + 1):
        out.append('    ' + lines[j])
    prev_end = e
out.append('}')
out.append('')

# ── @layer components ──
out.append('@layer components {')

# Lines 0-5 are file header + @import — always skip
skip_header = set(range(min(6, N)))

i = 0
while i < N:
    # Skip file header
    if i in skip_header:
        i += 1
        continue

    # Skip base lines
    if i in base_set:
        i += 1
        continue

    # Skip original @import (in case it's beyond line 5)
    if lines[i].strip().startswith("@import url("):
        i += 1
        continue

    # Skip MOBILE UX IMPROVEMENTS section  →  up to (not including) UI IMPROVEMENTS
    if mob_ux is not None and ui_imp is not None and mob_ux <= i < ui_imp:
        i += 1
        continue

    # Skip MOBILE FOLD section  →  end of file
    if mob_fold is not None and i >= mob_fold:
        i += 1
        continue

    # Strip mobile @media / @supports blocks (brace-matched)
    if is_mobile(lines[i].strip()):
        i = block_end(i) + 1
        continue

    out.append('    ' + lines[i])
    i += 1

out.append('}')
out.append('')

# ── Write ──
with open(DST, 'w') as f:
    f.write('\n'.join(out) + '\n')

print(f"✓ Written {len(out)} lines to {DST}")
print(f"  Base: {len(sorted_base)} blocks, {len(base_set)} lines")
