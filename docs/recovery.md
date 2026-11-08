# Recovery: when a custom face misbehaves

Custom faces are unofficial. A malformed face can show garbage, freeze the face screen, or make the band reboot. These steps go from least to most drastic. Menu names vary slightly between firmware versions and languages.

## The face looks wrong but the band works

- Long-press the watch face on the band and switch to a built-in face.
- Delete the custom face from the band (long-press → delete) or from Notify's watch-face list.
- Rebuild and check it first: `npm run band10 -- validate <project>` and `npm run band10 -- inspect <file>.face`.

## The face screen is stuck or crashes

1. Restart the band: **Settings → System → Restart** on the band. If the menu is unreachable, keep the band charging; most firmware restarts on its own after a crash.
2. After the restart, switch to a built-in face immediately and delete the custom one.
3. Open Mi Fitness (or Notify) and sync so the face list on the phone matches the band.

## The band keeps rebooting into the bad face

1. Let the battery run flat, then charge it; it usually boots to the default face.
2. If it still loops, factory-reset from the band: **Settings → System → Factory reset**.
3. Pair it again in Mi Fitness. Your health data that already synced to your Xiaomi account is kept; unsynced data on the band is lost.

## Avoid problems

- Install faces built from this toolkit only after `validate` reports no errors.
- Progress widgets are reverse-engineered (`PROGRESS_EXPERIMENTAL`); test them on a band you can afford to reset.
- Keep animations out of always-on mode.
- Report what happened with the **Hardware test report** issue template so others can learn from it.
