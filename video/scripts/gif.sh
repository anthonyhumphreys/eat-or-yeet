#!/bin/sh
# Two-pass palette GIF: flat brand colours keep the 256-colour palette clean.
# Usage: sh scripts/gif.sh in.mp4 out.gif [width] [fps]
set -eu
in="$1"; out="$2"; width="${3:-960}"; fps="${4:-24}"
filters="fps=${fps},scale=${width}:-1:flags=lanczos"
palette="$(mktemp -t palette).png"
ffmpeg -v error -y -i "$in" -vf "${filters},palettegen=max_colors=192:stats_mode=diff" "$palette"
ffmpeg -v error -y -i "$in" -i "$palette" -lavfi "${filters}[x];[x][1:v]paletteuse=dither=sierra2_4a:diff_mode=rectangle" -loop 0 "$out"
rm -f "$palette"
ls -lh "$out"
