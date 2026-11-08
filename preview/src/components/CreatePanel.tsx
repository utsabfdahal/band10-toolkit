import { useState } from 'react'

interface CreatePanelProps {
  busy: boolean
  onWallpaper: (file: File, dim: number) => void
  onFontClock: (options: { font: File, size: number, weight: number, color: string }) => void
}

export function CreatePanel({ busy, onWallpaper, onFontClock }: CreatePanelProps) {
  const [dim, setDim] = useState(0.35)
  const [photo, setPhoto] = useState<File>()
  const [font, setFont] = useState<File>()
  const [size, setSize] = useState(96)
  const [weight, setWeight] = useState(700)
  const [color, setColor] = useState('#ffffff')
  return (
    <section className="simulator-panel">
      <div className="section-heading"><div><span className="eyebrow">Make it yours</span><h2>Create</h2></div></div>
      <p className="panel-help">Everything runs in your browser. Use “Download .face” in the toolbar when you are done, then install it with Notify for Xiaomi.</p>
      <div className="field-section">
        <h3>Photo wallpaper</h3>
        <label className="field"><span>Photo</span><input type="file" accept="image/*" onChange={(event) => setPhoto(event.target.files?.[0])} /></label>
        <label className="range-field"><span>Darken <strong>{Math.round(dim * 100)}%</strong></span><input type="range" min="0" max="0.8" step="0.05" value={dim} onChange={(event) => setDim(Number(event.target.value))} /></label>
        <button className="primary-button" disabled={!photo || busy} onClick={() => photo && onWallpaper(photo, dim)}>Set as wallpaper</button>
      </div>
      <div className="field-section">
        <h3>Clock from any font</h3>
        <label className="field"><span>Font file (.ttf, .otf, .woff2)</span><input type="file" accept=".ttf,.otf,.woff,.woff2" onChange={(event) => setFont(event.target.files?.[0])} /></label>
        <label className="range-field"><span>Size <strong>{size}px</strong></span><input type="range" min="16" max="160" value={size} onChange={(event) => setSize(Number(event.target.value))} /></label>
        <label className="range-field"><span>Weight <strong>{weight}</strong></span><input type="range" min="100" max="900" step="100" value={weight} onChange={(event) => setWeight(Number(event.target.value))} /></label>
        <label className="field"><span>Colour</span><input type="color" value={color} onChange={(event) => setColor(event.target.value)} /></label>
        <button className="primary-button" disabled={!font || busy} onClick={() => font && onFontClock({ font, size, weight, color })}>Create stacked clock</button>
      </div>
      <div className="simulation-note"><span>i</span><p>Keep digits at least 12 px tall and use high contrast; the band screen is only 1.72 inches.</p></div>
    </section>
  )
}
