# Your first face in 5 minutes

No coding needed. You need a browser, an Android phone (or an Android phone you can borrow), and a Xiaomi Smart Band 10.

## 1. Design it

1. Open **[Band 10 Studio](https://utsabfdahal.github.io/band10-toolkit/)**.
2. Pick a starting point from **Templates…** in the top bar. *Glass Lock* is the most readable.
3. Open the **Create** tab on the right:
   - **Photo wallpaper** — choose a photo, keep *Darken* around 30–45% so white text stays readable, click **Set as wallpaper**.
   - **Clock from any font** — choose a `.ttf`/`.otf`/`.woff2` file (for example from [Google Fonts](https://fonts.google.com)), pick size and colour, click **Create stacked clock**.
4. Drag widgets on the watch to move them. Select one to change it in **Inspect**; delete what you do not need.
5. Click **Actual size** to see roughly how big it will look on your wrist. If you have to squint, make it bigger.
6. Try different times, steps, and weather in **Simulate**.

## 2. Download it

Click **Download .face**. The file is built inside your browser; nothing is uploaded.

## 3. Install it

Copy the `.face` to your Android phone and install it with Notify for Xiaomi — see the [step-by-step guide](installation.md#notify-for-xiaomi-route). Bands paired to an iPhone are covered there too.

## Tips

- Keep numbers at least ~12 px tall and bright on a dark background.
- Fewer, bigger things beat many small ones on a 1.72" screen.
- The band keeps at most 10 faces; delete old ones first if installing fails.
- Something wrong on the band? See [Recovery](recovery.md).

## Prefer code?

Clone the repo and follow the [README](../README.md#getting-started-build--open-the-simulator). The CLI adds validation (including legibility checks), decompiling existing faces with `band10 unpack`, and reproducible builds.
