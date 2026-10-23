# Bundled fonts (v1.3 spec §4)

`*.woff2` here are the app's self-hosted fonts — Inter for interface and
tree text (`--font-ui`) and JetBrains Mono for sequences (`--font-mono`) —
so text renders and measures identically on every machine. They are built
by `scripts/fonts/subset.sh` and committed; do not edit them by hand.

## Sources (pinned)

| Font | Upstream release | URL | SHA-256 |
|---|---|---|---|
| Inter | 4.1 (`extras/ttf/Inter-{Regular,Medium,SemiBold}.ttf`) | https://github.com/rsms/inter/releases/download/v4.1/Inter-4.1.zip | `9883fdd4a49d4fb66bd8177ba6625ef9a64aa45899767dde3d36aa425756b11e` |
| JetBrains Mono | 2.304 (`fonts/ttf/JetBrainsMono-Regular.ttf`) | https://github.com/JetBrains/JetBrainsMono/releases/download/v2.304/JetBrainsMono-2.304.zip | `6f6376c6ed2960ea8a963cd7387ec9d76e3f629125bc33d1fdcd7eb7012f7bbf` |

Weights: Inter 400/500/600, JetBrains Mono 400. Subsets: `latin`,
`latin-ext`, `greek`, `cyrillic` — the standard Google Fonts unicode
ranges (the css2 API's per-subset `unicode-range` values, mirrored in
`src/design/fonts.css`). OpenType features kept: `kern`, `tnum`; hinting
dropped for size (web rendering doesn't rely on it). On the JetBrains
Mono subsets those flags are no-ops — upstream JetBrains Mono ships
neither a `kern` table nor a `tnum` feature, so the files carry none.
Flavor: `woff2`.

Tooling (pinned): fonttools `pyftsubset` 4.60.1 + brotli 1.1.0, run in a
venv the script creates — nothing is installed system-wide.

## Inventory and size

16 files, **189,320 bytes** total — budget ≤ 200 KB (spec §4.1).

| File | Bytes |
|---|---|
| inter-400-latin.woff2 | 13,960 |
| inter-400-latin-ext.woff2 | 28,168 |
| inter-400-greek.woff2 | 6,372 |
| inter-400-cyrillic.woff2 | 6,028 |
| inter-500-latin.woff2 | 14,336 |
| inter-500-latin-ext.woff2 | 28,972 |
| inter-500-greek.woff2 | 6,456 |
| inter-500-cyrillic.woff2 | 6,136 |
| inter-600-latin.woff2 | 14,308 |
| inter-600-latin-ext.woff2 | 29,000 |
| inter-600-greek.woff2 | 6,396 |
| inter-600-cyrillic.woff2 | 6,128 |
| jetbrains-mono-400-latin.woff2 | 8,496 |
| jetbrains-mono-400-latin-ext.woff2 | 6,316 |
| jetbrains-mono-400-greek.woff2 | 3,660 |
| jetbrains-mono-400-cyrillic.woff2 | 4,588 |

Characters outside these subsets fall back to the system font, measured
as rendered (Review Focus 1); SVG exports embed the needed subsets
(Task 15) and warn about uncovered characters.

## License

Both fonts are SIL Open Font License 1.1. The subsets are a Modified
Version; the Reserved Font Names (Inter, JetBrains Mono) are used only
to name the original families, not to advertise derivatives.

> Copyright (c) 2016 The Inter Project Authors
> (https://github.com/rsms/inter)
>
> Copyright 2020 The JetBrains Mono Project Authors
> (https://github.com/JetBrains/JetBrainsMono)

```
SIL OPEN FONT LICENSE Version 1.1 - 26 February 2007

PREAMBLE
The goals of the Open Font License (OFL) are to stimulate worldwide
development of collaborative font projects, to support the font creation
efforts of academic and linguistic communities, and to provide a free and
open framework in which fonts may be shared and improved in partnership
with others.

The OFL allows the licensed fonts to be used, studied, modified and
redistributed freely as long as they are not sold by themselves. The
fonts, including any derivative works, can be bundled, embedded,
redistributed and/or sold with any software provided that any reserved
names are not used by derivative works. The fonts and derivatives,
however, cannot be released under any other type of license. The
requirement for fonts to remain under this license does not apply
to any document created using the fonts or their derivatives.

DEFINITIONS
"Font Software" refers to the set of files released by the Copyright
Holder(s) under this license and clearly marked as such. This may
include source files, build scripts and documentation.

"Reserved Font Name" refers to any names specified as such after the
copyright statement(s).

"Original Version" refers to the collection of Font Software components as
distributed by the Copyright Holder(s).

"Modified Version" refers to any derivative made by adding to, deleting,
or substituting -- in part or in whole -- any of the components of the
Original Version, by changing formats or by porting the Font Software to a
new environment.

"Author" refers to any designer, engineer, programmer, technical
writer or other person who contributed to the Font Software.

PERMISSION & CONDITIONS
Permission is hereby granted, free of charge, to any person obtaining
a copy of the Font Software, to use, study, copy, merge, embed, modify,
redistribute, and sell modified and unmodified copies of the Font
Software, subject to the following conditions:

1) Neither the Font Software nor any of its individual components,
in Original or Modified Versions, may be sold by itself.

2) Original or Modified Versions of the Font Software may be bundled,
redistributed and/or sold with any software, provided that each copy
contains the above copyright notice and this license. These can be
included either as stand-alone text files, human-readable headers or
in the appropriate machine-readable metadata fields within text or
binary files as long as those fields can be easily viewed by the user.

3) No Modified Version of the Font Software may use the Reserved Font
Name(s) unless explicit written permission is granted by the corresponding
Copyright Holder. This restriction only applies to the primary font name as
presented to the users.

4) The name(s) of the Copyright Holder(s) or the Author(s) of the Font
Software shall not be used to promote, endorse or advertise any
Modified Version, except to acknowledge the contribution(s) of the
Copyright Holder(s) and the Author(s) or with their explicit written
permission.

5) The Font Software, modified or unmodified, in part or in whole,
must be distributed entirely under this license, and must not be
distributed under any other license. The requirement for fonts to
remain under this license does not apply to any document created
using the Font Software.

TERMINATION
This license becomes null and void if any of the above conditions are
not met.

DISCLAIMER
THE FONT SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO ANY WARRANTIES OF
MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT
OF COPYRIGHT, PATENT, TRADEMARK, OR OTHER RIGHT. IN NO EVENT SHALL THE
COPYRIGHT HOLDER BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY,
INCLUDING ANY GENERAL, SPECIAL, INDIRECT, INCIDENTAL, OR CONSEQUENTIAL
DAMAGES, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING
FROM, OUT OF THE USE OR INABILITY TO USE THE FONT SOFTWARE OR FROM
OTHER DEALINGS IN THE FONT SOFTWARE.
```
