# Contributing

1. Open an issue describing the device/firmware and evidence source before changing binary semantics.
2. Add a minimal self-authored fixture and tests for every codec/parser change.
3. Preserve unknown bytes; do not assign field meanings from a single unexplained sample.
4. Run `npm run build` and `npm run package` before submitting.
5. State whether a change was browser-tested, structurally tested, closed-compiler compared, or physically tested.

Do not submit proprietary compiler binaries, AuthKeys/tokens, paid/official face dumps, or assets without a clear redistribution license.

Physical test reports should include model/region, firmware, phone/OS, installer/version, package backend/hash, and recovery result. Use the **Hardware test report** issue template; confirmed results update [docs/compatibility.md](docs/compatibility.md).

## Contributing a face

1. Create `examples/<name>/` with `manifest.json` (unique 9-digit `id`), `layout.json`, `assets/`, and a `README.md` with active/AOD screenshots. Prefer a deterministic `scripts/generate-<name>-assets.ts`; render text with `builder/text.ts` so it looks the same on every OS.
2. Run `npm run band10 -- validate examples/<name>` — no errors and no `LEGIBILITY_*` warnings.
3. Add `generate:`, `validate:`, `package:`, and `preview:` scripts to `package.json`, and add the example to `scripts/collect-release.ts` and `scripts/build-studio-site.ts` so it ships in releases and as a studio template.
4. Only include artwork and fonts you can redistribute (your own, MIT, OFL, CC0, CC-BY).