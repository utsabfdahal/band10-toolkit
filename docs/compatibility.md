# Hardware compatibility

Status of each toolkit feature on real hardware. Update this table from [hardware test reports](https://github.com/utsabfdahal/band10-toolkit/issues/new?template=hardware-report.yml).

| Feature | Status | Evidence |
|---|---|---|
| Static images, wallpapers | ✅ Verified on Band 10 | Faces in this repo installed via Notify |
| Number widgets (time, date, steps, heart rate, battery, temperature) | ✅ Verified on Band 10 | Glass Lock, Carbon Signal |
| Image lists (weekday, month, weather, Nepali date) | ✅ Verified on Band 10 | Glass Lock |
| Always-on display theme | ✅ Verified on Band 10 | Faces in this repo |
| Indexed animations | 🟡 Renders in preview; device reports welcome | RLC Singularity, Circuit Link |
| Progress widgets (bar / arc) | 🟠 Experimental (`PROGRESS_EXPERIMENTAL`) | Reverse-engineered property block; not yet confirmed |
| Faces exported from the browser studio | 🟡 Structurally identical to CLI output; device reports welcome | `inspect`/`unpack` round-trip |
| Faces decompiled with `unpack` and repackaged | 🟡 Round-trip tested in CI | `tests/unpack-wallpaper.test.ts` |

## Devices

| Device | Status |
|---|---|
| Xiaomi Smart Band 10 (`o66`, 212×520) | ✅ Supported |
| Xiaomi Smart Band 9 / 9 Pro, Band 8 / 8 Pro, Redmi Watch | ❌ Not supported yet — different resolutions and binary variants. Device profiles need sample faces and testers; open an issue if you can help. |
