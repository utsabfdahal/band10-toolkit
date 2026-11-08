# Build, install, and publish

## Local prerequisites

- macOS, Linux, or Windows;
- Node.js 22+ and npm;
- optional Android Platform Tools (`adb`) for staging;
- optional Android phone for Gadgetbridge/Notify installation;
- a physical Xiaomi Smart Band 10 for final verification;
- optional Wine/Windows plus a user-obtained Mi Create/EasyFace compiler for comparison builds.

No API key or secret is required for local build/preview. Device pairing may require a Band AuthKey; never commit it or pass it through the toolkit.

## Build commands

From the repository root:

```sh
npm install
npm run generate:assets
npm run validate
npm run build:example
npm run package
npm run inspect
npm run preview
```

Direct CLI equivalents:

```sh
npm run band10 -- validate examples/minimal-amoled
npm run band10 -- build examples/minimal-amoled
npm run band10 -- package examples/minimal-amoled --target native
npm run band10 -- inspect examples/minimal-amoled/dist/carbon-signal.face
```

## External compiler comparison

The GPL Mi Create application explicitly excludes its third-party compiler from the GPL source. This repository does not redistribute that binary.

Set `BAND10_COMPILER` to your own `compile.exe`, then select `mi-create`. On non-Windows systems, the adapter invokes `wine` (override executable with `BAND10_WINE`).

For the Java community packer, set `BAND10_MI8_TOOL` to a `.java` or `.jar`. Its public repository has no license, so it is not vendored here. Its Band 10 parser failed the two public valid samples tested during this research; treat results as experimental.

## Android staging

First package and inspect. Then:

```sh
npm run band10 -- install examples/minimal-amoled/dist/carbon-signal.bin
```

This pushes the file to `/sdcard/Download/`. Open it in Android's file manager and choose Gadgetbridge FW/App Installer or Notify for Xiaomi.

To open Gadgetbridge's confirmation activity automatically after the push:

```sh
npm run band10 -- install examples/minimal-amoled/dist/carbon-signal.bin --launch-gadgetbridge
```

The adapter uses Gadgetbridge's public/exported `FileInstallerActivity`, `ACTION_VIEW`, and `application/octet-stream` manifest contract. It does **not** press Install.

### Gadgetbridge route

1. Install a current Gadgetbridge release from [Codeberg](https://codeberg.org/Freeyourgadget/Gadgetbridge/releases/) or F-Droid. The old GitHub repository is an archived mirror.
2. Pair Band 10. Gadgetbridge documents it as “mostly supported”; AuthKey extraction/migration can still be difficult.
3. Open the `.bin` with Gadgetbridge's installer.
4. Confirm it is recognized as a watch face for the connected Xiaomi device.
5. Read the risk/model warning, then install manually.

Sources: [Band 10 support](https://gadgetbridge.org/gadgets/wearables/xiaomi/#device__xiaomi_mi_band_10), [installer documentation](https://gadgetbridge.org/internals/features/installer/), [Android manifest](https://codeberg.org/Freeyourgadget/Gadgetbridge/src/branch/master/app/src/main/AndroidManifest.xml).

### Notify for Xiaomi route

Notify for Xiaomi (Android, `com.mc.xiaomi1`) can install local `.face` files. It reuses the band's existing Mi Fitness pairing instead of pairing from scratch. Mi Fitness and Notify compete for the same Bluetooth connection, so only one may hold it at a time.

#### 1. Build the face

```sh
npm run package:glass   # or any other package:* script
```

The file is written to `examples/<face>/dist/<name>.face`. Copy it to the Android phone (Google Drive, Telegram, email, or `npm run band10 -- install <file>` over ADB).

#### 2. One-time Notify setup

1. Pair and update the band in **Mi Fitness** first.
2. Install **Notify for Xiaomi** from the Play Store.
3. In the setup wizard choose **Xiaomi Smart Band 10** and the option that keeps **Mi Fitness** as the main app. Do **not** choose “pair without Mi Fitness”: it resets the band and unbinds it from your Xiaomi account.
4. Obtain the auth key automatically by signing in with the **same Xiaomi account** used by Mi Fitness.
5. Allow Bluetooth/Nearby devices, location, and notification permissions.

#### 3. Install the face (every time)

1. Open Mi Fitness once so the band is synced.
2. Android Settings → Apps → **Mi Fitness** → Permissions → **Nearby devices → Don't allow**.
3. Android Settings → Apps → **Notify** → Permissions → **Nearby devices → Allow**; set Notify battery usage to **Unrestricted**.
4. Open Notify, dismiss popups, and wait until the band shows as connected.
5. **Watchface** → custom/local file → pick the `.face`. Start from inside Notify, not from the file manager. Keep the phone next to the band until it reaches 100%.
6. Reverse steps 3 and 2 so Mi Fitness owns the band again.

#### Band paired to an iPhone

Notify is Android-only, and Mi Fitness on iOS cannot install custom faces. Borrow an Android phone and keep the iPhone pairing:

1. Sync in Mi Fitness on the iPhone, then **power the iPhone off** (Control Center Bluetooth toggle is not enough; iOS may reconnect).
2. On Android, set up Notify as above with the same Xiaomi account and the automatic auth key.
3. As soon as Notify shows **Paired**, install the face. Dashboard values may show 0% — that only means data sync failed; watch-face install usually still works.
4. Close Notify and power the iPhone back on; the band reconnects to Mi Fitness with the new face.

If Notify only offers to reset/pair as a new device, stop: moving back to the iPhone would require another reset, which erases custom faces.

#### Troubleshooting

- **0% everywhere / connects then drops:** another phone (usually the iPhone) is reclaiming the band, or the auth key is wrong. Power the other phone off, restart Android Bluetooth, re-fetch the key.
- **Install fails:** delete the previous version of the same face from the band; keep at most 10 faces installed; ensure Mi Fitness has no Nearby devices permission.
- **Nepali date faces:** BS lookups cover one AD month; rebuild and reinstall at the start of each month.

Source: [Band 10 creation/install article](https://mateusznowak.dev/articles/designing-watchfaces-xiaomi-band-10).

Notify is proprietary/ad-supported; behavior can change. This toolkit cannot audit it.

### Mi Fitness mod / EasyFace server route

Mi Create documents a Telegram-admin/dev-server workflow in which a modified Mi Fitness app exposes a test category. It requires sharing the wearable MAC address with server administrators. EasyFace documents the same ecosystem.

This route is **not open source**, requires trusting modified health software and third-party servers, and is not the default recommendation. Use a dedicated test phone/account if you choose it.

Sources: [Mi Create testing](https://ooflet.github.io/docs/quickstart/testing/), [EasyFace](https://github.com/m0tral/EasyFace).

## Device limits and troubleshooting

Official Xiaomi facts:

- eight preinstalled faces;
- at most nine downloaded market faces;
- roughly 20 MB reserved storage;
- deleting preinstalled faces does not increase the downloaded limit.

Community troubleshooting:

- remove the previous build with the same ID before installing;
- launch from the companion/file installer, not by assuming every file manager handles `.face`;
- rename `.face` to `.bin` when an installer filters extensions;
- keep Bluetooth connected and companion active;
- reduce transparent/large resources;
- check the package's device/resolution before confirming.

Sources: [Xiaomi FAQ](https://www.mi.com/global/support/faq/details/KA-579104), [Mi Create testing](https://ooflet.github.io/docs/quickstart/testing/), [Band 10 article](https://mateusznowak.dev/articles/designing-watchfaces-xiaomi-band-10).

## Recovery and safety

- Test only on hardware you own and can reset/recover.
- Keep official Mi Fitness and firmware current before experiments.
- Never flash a package for another resolution/model.
- Do not confuse watch faces with firmware or RPK apps in an installer.
- Keep the original face/source and package hash.
- If the face crashes display selection, try switching to a stock face or remove/reset through the companion before repeated installs.
- A factory reset erases unsynchronized health data and non-preinstalled faces (official Xiaomi FAQ).

## Publishing and sharing

### Official Xiaomi channel

Xiaomi advertises a market and paid faces, but this research found no public Band 10-specific package specification or open global submission portal. Generic Xiaomi developer agreements/design pages do not expose the runtime codec. Official access can be partner/region-controlled.

Do not describe Zepp OS's documented submission process as Band 10's official path: Band 10 is a Xiaomi protobuf/Vela-family device, and applicability is not established.

### Community channels

- [AmazfitWatchFaces](https://amazfitwatchfaces.com/) accepts community wearable resources; follow its current model/category rules.
- [AstroBox](https://github.com/AstralSightStudios/AstroBox-Repo) identifies `xmb10` and `xmb10nfc` distribution targets and has submission/review requirements.
- Mi Create/EasyFace's private server workflow can publish into a modified Mi Fitness catalog.
- GitHub/GitLab releases are the most transparent source-first route.

### Release checklist

Publish:

- source project and asset license;
- `.face` and `.bin` aliases only if needed (state that bytes are identical);
- SHA-256 checksums;
- 212×520 preview and AOD preview;
- Band model/region, firmware, phone, installer, and successful test date;
- compiler backend/version/hash;
- known defects and unsupported locale/date format;
- explicit “hardware-tested” or “not hardware-tested” status.

Do not upload ports of commercial/official faces or unlicensed artwork. Xiaomi developer terms and ordinary copyright/trademark rules still apply.
