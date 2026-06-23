#!/usr/bin/env bash
# Install (or remove) a desktop menu entry for the built SFDX Bulker AppImage,
# so it shows up in your app launcher with the proper icon.
#
#   scripts/install-desktop.sh            # install
#   scripts/install-desktop.sh --uninstall
#
# AppImages don't self-install; this wires up the .desktop entry + icon and
# refreshes the desktop caches. Run `npm run dist` first to build the AppImage.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP_ID="sfdx-bulker"
DESKTOP_FILE="$HOME/.local/share/applications/$APP_ID.desktop"
ICON_DEST="$HOME/.local/share/icons/hicolor/512x512/apps/$APP_ID.png"

refresh() {
  gtk-update-icon-cache "$HOME/.local/share/icons/hicolor" >/dev/null 2>&1 || true
  update-desktop-database "$HOME/.local/share/applications" >/dev/null 2>&1 || true
}

if [[ "${1:-}" == "--uninstall" ]]; then
  rm -f "$DESKTOP_FILE" "$ICON_DEST"
  refresh
  echo "Removed SFDX Bulker desktop entry + icon."
  exit 0
fi

# Newest AppImage in release/
APPIMAGE="$(ls -t "$ROOT"/release/*.AppImage 2>/dev/null | head -1 || true)"
if [[ -z "$APPIMAGE" ]]; then
  echo "No AppImage found in $ROOT/release. Run 'npm run dist' first." >&2
  exit 1
fi
ICON_SRC="$ROOT/build/icon.png"
if [[ ! -f "$ICON_SRC" ]]; then
  echo "Icon not found at $ICON_SRC." >&2
  exit 1
fi

chmod +x "$APPIMAGE"
mkdir -p "$(dirname "$ICON_DEST")" "$(dirname "$DESKTOP_FILE")"
cp "$ICON_SRC" "$ICON_DEST"

cat > "$DESKTOP_FILE" <<EOF
[Desktop Entry]
Name=SFDX Bulker
Comment=Salesforce Bulk API 2.0 jobs
Exec="$APPIMAGE" --no-sandbox %U
Icon=$APP_ID
Type=Application
Categories=Utility;Development;
Terminal=false
StartupWMClass=SFDX Bulker
EOF

refresh
echo "Installed: $DESKTOP_FILE"
echo "Points at: $APPIMAGE"
echo "SFDX Bulker should now appear in your app menu (re-login if the icon lags)."
