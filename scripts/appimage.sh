#!/bin/sh
# Builds release/swrm-x86_64.AppImage: a ~700 KB WebKitGTK shell + node + the server.
# Needs on the machine: webkit2gtk-4.1, gtk3 and the `claude` CLI (the SDK's own 330 MB copy is left out).
set -e
cd "$(dirname "$0")/.."
ROOT=$PWD
OUT=$ROOT/release
APP=$OUT/swrm.AppDir
L=$APP/usr/lib/swrm
TOOL=${XDG_CACHE_HOME:-$HOME/.cache}/swrm/appimagetool

rm -rf "$APP"; mkdir -p "$APP/usr/bin" "$L/node_modules"
npm run build
(cd shell && cargo build --release)
cp shell/target/release/swrm-shell "$APP/usr/bin/"

cp -r bin server dist package.json package-lock.json "$L/"
NODE=$(node -p process.execPath)
cp "$NODE" "$L/node"; strip "$L/node" 2>/dev/null || true

# production deps only, without the bundled claude binaries; node-pty's native part comes from the checkout
(cd "$L" && npm ci --omit=dev --omit=optional --ignore-scripts --no-audit --no-fund >/dev/null)
mkdir -p "$L/node_modules/node-pty/build"
cp -r "$ROOT/node_modules/node-pty/build/Release" "$L/node_modules/node-pty/build/"
rm -rf "$L/node_modules/node-pty/prebuilds" "$L/node_modules/node-pty/deps" "$L/node_modules/node-pty/src"

cat > "$APP/AppRun" <<'RUN'
#!/bin/sh
HERE=$(dirname "$(readlink -f "$0")")
export SWRM_ROOT="$HERE/usr/lib/swrm"
exec "$HERE/usr/bin/swrm-shell" "$@"
RUN
chmod +x "$APP/AppRun"

cat > "$APP/swrm.svg" <<'SVG'
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256"><rect width="256" height="256" rx="58" fill="#1c1c1c"/><rect x="40" y="40" width="82" height="176" rx="16" fill="#0a84ff"/><rect x="134" y="40" width="82" height="82" rx="16" fill="#282828"/><rect x="134" y="134" width="82" height="82" rx="16" fill="#282828"/></svg>
SVG
rsvg-convert -w 256 -h 256 "$APP/swrm.svg" -o "$APP/swrm.png"; rm "$APP/swrm.svg"; cp "$APP/swrm.png" "$APP/.DirIcon"
cat > "$APP/swrm.desktop" <<'DESK'
[Desktop Entry]
Type=Application
Name=swrm
Comment=Claude Code chats side by side
Exec=swrm-shell
Icon=swrm
Terminal=false
Categories=Development;
StartupWMClass=swrm-shell
DESK

if [ ! -x "$TOOL" ]; then
  mkdir -p "$(dirname "$TOOL")"
  curl -fL -o "$TOOL" https://github.com/AppImage/appimagetool/releases/download/continuous/appimagetool-x86_64.AppImage
  chmod +x "$TOOL"
fi
# build next to the old file and rename over it: the old one may be running right now ("Text file busy")
ARCH=x86_64 "$TOOL" --appimage-extract-and-run --comp zstd "$APP" "$OUT/swrm-x86_64.AppImage.new" >/dev/null
mv -f "$OUT/swrm-x86_64.AppImage.new" "$OUT/swrm-x86_64.AppImage"
ls -la "$OUT/swrm-x86_64.AppImage"
