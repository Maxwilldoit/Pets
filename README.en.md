# Pets

[简体中文](README.md) · **English**

Pets is a desktop application for managing a local pet library and displaying animated pets on Windows, macOS, and Linux.

## Core features

- Browse, search, filter by source, and preview pets and their animations.
- Display a transparent pet above other windows. Click to cycle actions, drag or throw it, and use its context menu to change pets or size. Transparent areas pass mouse clicks through.
- Use tray controls, multiple displays, and saved pet selection and position. Startup at login is supported on Windows and macOS.
- Import local pet folders and automatically discover compatible pets in the Codex pet directory.

The current source (**v0.2.0**) supports Simplified Chinese and English. Choose a language or System Default in Settings → Language. The preference is saved and applies to the interface and native menus. Published v0.1.1 packages do not yet include language selection.

## Platforms and downloads

The latest stable release is [v0.1.1](https://github.com/Maxworkinghard/Pets/releases/tag/v0.1.1). It bundles **11 pets**, including **Makima 1.1.0**, and requires no separate Node.js installation.

| Platform | Downloads | Installation |
| --- | --- | --- |
| Windows x64 | [Installer (.exe)](https://github.com/Maxworkinghard/Pets/releases/download/v0.1.1/Pets-0.1.1-windows-x64-setup.exe) · [Portable (.exe)](https://github.com/Maxworkinghard/Pets/releases/download/v0.1.1/Pets-0.1.1-windows-x64-portable.exe) | Run the installer or portable executable. |
| macOS Intel (x64) | [DMG](https://github.com/Maxworkinghard/Pets/releases/download/v0.1.1/Pets-0.1.1-macos-x64.dmg) · [ZIP](https://github.com/Maxworkinghard/Pets/releases/download/v0.1.1/Pets-0.1.1-macos-x64.zip) | Move Pets.app to Applications. |
| macOS Apple Silicon (arm64) | [DMG](https://github.com/Maxworkinghard/Pets/releases/download/v0.1.1/Pets-0.1.1-macos-arm64.dmg) · [ZIP](https://github.com/Maxworkinghard/Pets/releases/download/v0.1.1/Pets-0.1.1-macos-arm64.zip) | Move Pets.app to Applications. |
| Linux x64 | [AppImage](https://github.com/Maxworkinghard/Pets/releases/download/v0.1.1/Pets-0.1.1-linux-x86_64.AppImage) · [DEB](https://github.com/Maxworkinghard/Pets/releases/download/v0.1.1/Pets-0.1.1-linux-amd64.deb) | Make AppImage executable; install DEB on Debian/Ubuntu-compatible systems. |

Compare downloaded files with the release's `SHA256SUMS`. Windows v0.1.1 binaries are unsigned; macOS packages have no developer signing or Apple notarization. The operating system may warn or block launch. See the [release notes](docs/releases/v0.1.1.md) for installation and checksum commands.

## Getting started

1. Install or extract the appropriate package, then launch Pets.
2. Select a pet in the control panel and set it as your desktop pet. Click it to cycle actions; right-click for controls.
3. Open Settings to adjust size, automatic walking, random actions, and startup preferences. Use the tray icon to reopen the panel or quit. Later launches restore the saved pet and position.

To export a pet, open its details and choose **Export to Codex** (`导入到 Codex` in v0.1.1). Pets writes `pet.json` and `spritesheet.webp` to the Codex pet directory, normally `~/.codex/pets/<id>/`. Then select the exported pet in Codex.

## Development

Requires **Node.js 22.12 or later** and npm. From the repository root:

```sh
cd desktop
npm ci
npm start
```

Run these commands from `desktop/`:

```sh
npm run dev                     # Start with debug logging
npm test                        # Run unit tests
npm run validate                # Validate bundled pets
npm run pack                    # Build an unpacked application
npm run dist -- --publish never # Build distribution packages locally
```

Build output is in `desktop/dist/`. Package on the target operating system; the release workflow uses native runners for all four platform targets.

## Pet format and asset library

Each pet is a folder containing `pet.json` and its assets. Supported animations include GIF/APNG/WebP, PNG frame sequences, and sprite sheets. See the [format guide](pets/README.md) and [JSON Schema](schema/pet.schema.json).

The separate [Snapshot asset library](catalog/README.md) provides a [catalog](catalog.json) and [downloadable GIF packages](https://github.com/Maxworkinghard/Pets/releases/tag/snapshot-assets-v1). These packages use Snapshot's manifest format. Original materials are documented in [sources](sources/README.md).

## License

Code licensing is **UNLICENSED**, as declared in [desktop/package.json](desktop/package.json); no open-source code license is provided. Pet artwork and source materials follow their individual `pet.json` license fields and accompanying notices.

The public asset library currently declares no separate asset license. See [asset licensing](catalog/README.md#素材许可) and each ZIP's `ASSET-LICENSE.txt`. Public availability does not grant an open or commercial-use license.
