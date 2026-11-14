#!/bin/sh
# Builds build/Market District.app (needs the Xcode command line tools).
set -e
cd "$(dirname "$0")/../.."
APP="build/Market District.app"
mkdir -p "$APP/Contents/MacOS"
swiftc -O -o "$APP/Contents/MacOS/MarketDistrict" tools/shell/main.swift -framework Cocoa -framework WebKit
cat > "$APP/Contents/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>CFBundleIdentifier</key><string>local.marketdistrict.shell</string>
  <key>CFBundleName</key><string>Market District</string>
  <key>CFBundleDisplayName</key><string>Market District</string>
  <key>CFBundleExecutable</key><string>MarketDistrict</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>0.2</string>
  <key>NSHighResolutionCapable</key><true/>
  <key>LSMinimumSystemVersion</key><string>13.0</string>
  <key>NSAppTransportSecurity</key><dict><key>NSAllowsLocalNetworking</key><true/></dict>
</dict></plist>
PLIST
echo "built $APP"
