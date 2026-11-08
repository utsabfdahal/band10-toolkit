import { useCallback, useEffect, useMemo, useState } from 'react'
import type {
  DataSourceKey,
  SimulationState,
  WatchFaceLayout,
  WatchFaceManifest,
  WatchFaceWidget,
  WidgetType,
} from '../../core/types.ts'
import { DATA_SOURCES, WEATHER_CONDITIONS } from '../../core/dataSources.ts'
import { DEFAULT_SIMULATION } from '../../core/simulator.ts'
import { WatchCanvas } from './components/WatchCanvas.tsx'
import { Inspector } from './components/Inspector.tsx'
import { Simulator } from './components/Simulator.tsx'
import { WidgetPalette } from './components/WidgetPalette.tsx'
import { CreatePanel } from './components/CreatePanel.tsx'
import { exportFace, makeDigitSet, makeWallpaper } from './browserTools.ts'
import './App.css'

// 212×520 px over a 1.72" diagonal is ~326 ppi; CSS assumes 96 px per inch.
const ACTUAL_SIZE_ZOOM = 96 / (Math.hypot(212, 520) / 1.72)

type PreviewMode = 'normal' | 'aod'
type RightPanel = 'inspect' | 'simulate' | 'create' | 'source'

interface TemplateEntry {
  id: string
  name: string
}

interface ProjectPayload {
  manifest: WatchFaceManifest
  layout: WatchFaceLayout
  simulation: SimulationState
  fprj: string
}

const selectedTemplate = new URLSearchParams(window.location.search).get('template')
const projectBase = selectedTemplate && /^[a-z0-9-]+$/.test(selectedTemplate) ? `templates/${selectedTemplate}/` : 'project/'

async function loadTemplates(): Promise<TemplateEntry[]> {
  const response = await fetch('templates/index.json')
  return response.ok ? (await response.json()) as TemplateEntry[] : []
}

async function loadProject(): Promise<ProjectPayload> {
  const responses = await Promise.all([
    fetch(`${projectBase}manifest.json`),
    fetch(`${projectBase}layout.json`),
    fetch(`${projectBase}simulation.json`),
    fetch(`${projectBase}project.fprj`),
  ])
  for (const response of responses) {
    if (!response.ok) throw new Error(`Preview project is not synchronized (${response.status} ${response.statusText})`)
  }
  const [manifest, layout, simulation] = await Promise.all(responses.slice(0, 3).map((response) => response.json()))
  const fprj = await responses[3]!.text()
  return {
    manifest: manifest as WatchFaceManifest,
    layout: layout as WatchFaceLayout,
    simulation: simulation as SimulationState,
    fprj,
  }
}

function cloneLayout(layout: WatchFaceLayout): WatchFaceLayout {
  return structuredClone(layout)
}

function makeWidget(type: WidgetType, x: number, y: number, z: number, layout: WatchFaceLayout): WatchFaceWidget {
  const firstDigitSet = Object.keys(layout.assets.digitSets)[0] ?? 'default'
  const digitSet = layout.assets.digitSets[firstDigitSet]
  const firstAsset = digitSet?.digits[0] ?? `${projectBase}preview.png`
  const id = `${type}-${Date.now().toString(36)}`
  const common = { id, x: Math.round(x), y: Math.round(y), z, opacity: 1 }
  switch (type) {
    case 'image': return { ...common, type, asset: firstAsset }
    case 'number': return { ...common, type, source: 'hour', digitSet: firstDigitSet, digits: 2, align: 'left', spacing: 1, leadingZero: true }
    case 'image-list': return { ...common, type, source: 'battery', fallback: 'floor', items: [{ value: 0, asset: firstAsset }] }
    case 'progress': return { ...common, type, source: 'stepProgress', maximum: 100, shape: 'bar', width: 120, height: 6, thickness: 6, foreground: firstAsset }
    case 'animation': return { ...common, type, frames: [firstAsset, firstAsset], intervalMs: 500, repeat: 0 }
  }
}

function downloadJson(fileName: string, value: unknown): void {
  downloadText(fileName, `${JSON.stringify(value, null, 2)}\n`, 'application/json')
}

function downloadText(fileName: string, value: string, type: string): void {
  downloadBlob(fileName, new Blob([value], { type }))
}

function downloadBlob(fileName: string, blob: Blob): void {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = fileName
  anchor.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

function App() {
  const [payload, setPayload] = useState<ProjectPayload>()
  const [baseline, setBaseline] = useState<WatchFaceLayout>()
  const [loadError, setLoadError] = useState<string>()
  const [mode, setMode] = useState<PreviewMode>('normal')
  const [panel, setPanel] = useState<RightPanel>('inspect')
  const [selectedId, setSelectedId] = useState<string>()
  const [simulation, setSimulation] = useState<SimulationState>(DEFAULT_SIMULATION)
  const [sourceText, setSourceText] = useState('')
  const [xmlText, setXmlText] = useState('')
  const [sourceFormat, setSourceFormat] = useState<'json' | 'xml'>('json')
  const [sourceError, setSourceError] = useState<string>()
  const [snap, setSnap] = useState(true)
  const [showGrid, setShowGrid] = useState(true)
  const [zoom, setZoom] = useState(1)
  const [liveTime, setLiveTime] = useState(false)
  const [templates, setTemplates] = useState<TemplateEntry[]>([])
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string>()

  useEffect(() => {
    loadTemplates().then(setTemplates).catch(() => setTemplates([]))
  }, [])

  useEffect(() => {
    loadProject()
      .then((project) => {
        setPayload(project)
        setBaseline(cloneLayout(project.layout))
        setSimulation(project.simulation)
        setSourceText(JSON.stringify(project.layout, null, 2))
        setXmlText(project.fprj)
      })
      .catch((error: unknown) => setLoadError(error instanceof Error ? error.message : String(error)))
  }, [])

  useEffect(() => {
    if (!liveTime) return
    const update = () => setSimulation((current) => ({ ...current, dateTime: new Date().toISOString().slice(0, 19) }))
    update()
    const timer = window.setInterval(update, 1000)
    return () => window.clearInterval(timer)
  }, [liveTime])

  const layout = payload?.layout
  const activeMode: PreviewMode = mode === 'aod' && !layout?.aod?.enabled ? 'normal' : mode
  const widgets = useMemo(() => {
    if (!layout) return []
    return activeMode === 'aod' && layout.aod?.enabled ? layout.aod.widgets : layout.normal.widgets
  }, [activeMode, layout])
  const selected = widgets.find((widget) => widget.id === selectedId)
  const dirty = Boolean(layout && baseline && JSON.stringify(layout) !== JSON.stringify(baseline))

  const updateLayout = useCallback((nextLayout: WatchFaceLayout) => {
    setPayload((current) => current ? { ...current, layout: nextLayout } : current)
    setSourceText(JSON.stringify(nextLayout, null, 2))
  }, [])

  const setWidgets = useCallback((nextWidgets: WatchFaceWidget[]) => {
    if (!layout) return
    const next = cloneLayout(layout)
    if (activeMode === 'aod' && next.aod?.enabled) next.aod.widgets = nextWidgets
    else next.normal.widgets = nextWidgets
    updateLayout(next)
  }, [activeMode, layout, updateLayout])

  const updateWidget = useCallback((id: string, patch: Partial<WatchFaceWidget>) => {
    setWidgets(widgets.map((widget) => widget.id === id ? ({ ...widget, ...patch } as WatchFaceWidget) : widget))
  }, [setWidgets, widgets])

  const addWidget = useCallback((type: WidgetType, x = 30, y = 30) => {
    if (!layout) return
    const maximumZ = widgets.reduce((maximum, widget) => Math.max(maximum, widget.z), 0)
    const widget = makeWidget(type, x, y, maximumZ + 1, layout)
    setWidgets([...widgets, widget])
    setSelectedId(widget.id)
    setPanel('inspect')
  }, [layout, setWidgets, widgets])

  const removeSelected = useCallback(() => {
    if (!selectedId) return
    setWidgets(widgets.filter((widget) => widget.id !== selectedId))
    setSelectedId(undefined)
  }, [selectedId, setWidgets, widgets])

  const duplicateSelected = useCallback(() => {
    if (!selected) return
    const duplicate = { ...structuredClone(selected), id: `${selected.id}-copy-${Date.now().toString(36)}`, x: selected.x + 8, y: selected.y + 8, z: selected.z + 1 }
    setWidgets([...widgets, duplicate])
    setSelectedId(duplicate.id)
  }, [selected, setWidgets, widgets])

  const applySource = () => {
    try {
      const next = JSON.parse(sourceText) as WatchFaceLayout
      if (next.canvas?.width !== 212 || next.canvas?.height !== 520 || !next.normal?.widgets) {
        throw new Error('Expected a 212×520 layout with normal.widgets')
      }
      updateLayout(next)
      setSourceError(undefined)
    } catch (error) {
      setSourceError(error instanceof Error ? error.message : String(error))
    }
  }

  const reset = () => {
    if (!baseline) return
    const next = cloneLayout(baseline)
    updateLayout(next)
    setSelectedId(undefined)
    setSourceError(undefined)
  }

  const runTask = async (label: string, task: () => Promise<void>) => {
    setBusy(true)
    setNotice(`${label}…`)
    try {
      await task()
      setNotice(undefined)
    } catch (error) {
      setNotice(`${label} failed: ${error instanceof Error ? error.message : String(error)}`)
    } finally {
      setBusy(false)
    }
  }

  const downloadFace = () => runTask('Packing .face', async () => {
    if (!payload || !layout) return
    downloadBlob(`${payload.manifest.output}.face`, await exportFace(payload.manifest, layout))
  })

  const addWallpaper = (file: File, dim: number) => runTask('Preparing wallpaper', async () => {
    if (!layout) return
    const asset = await makeWallpaper(file, dim)
    const next = cloneLayout(layout)
    const minimumZ = next.normal.widgets.reduce((minimum, widget) => Math.min(minimum, widget.z), 1)
    next.normal.widgets = [
      { id: `wallpaper-${Date.now().toString(36)}`, label: 'Photo wallpaper', type: 'image', asset, x: 0, y: 0, z: minimumZ - 1, allowOverlap: true },
      ...next.normal.widgets.filter((widget) => !widget.id.startsWith('wallpaper')),
    ]
    updateLayout(next)
    setMode('normal')
  })

  const addFontClock = (options: { font: File, size: number, weight: number, color: string }) => runTask('Rendering font', async () => {
    if (!layout) return
    const { set, height } = await makeDigitSet(options)
    const next = cloneLayout(layout)
    const name = `font-${Date.now().toString(36)}`
    next.assets.digitSets[name] = set
    const maximumZ = next.normal.widgets.reduce((maximum, widget) => Math.max(maximum, widget.z), 0)
    const top = Math.max(0, Math.round(260 - height - 4))
    next.normal.widgets.push(
      { id: `${name}-hours`, label: 'Hours', type: 'number', source: 'hour', digitSet: name, digits: 2, align: 'center', leadingZero: true, x: 106, y: top, z: maximumZ + 1, allowOverlap: true },
      { id: `${name}-minutes`, label: 'Minutes', type: 'number', source: 'minute', digitSet: name, digits: 2, align: 'center', leadingZero: true, x: 106, y: top + height + 8, z: maximumZ + 1, allowOverlap: true },
    )
    updateLayout(next)
    setMode('normal')
  })

  if (loadError) {
    return (
      <main className="empty-state">
        <div className="empty-mark">B10</div>
        <h1>No preview project</h1>
        <p>{loadError}</p>
        <code>npm run preview</code>
      </main>
    )
  }
  if (!payload || !layout) return <main className="loading-state"><span className="spinner" />Loading workspace…</main>

  return (
    <div className="studio-shell">
      <header className="topbar">
        <div className="brand-block">
          <div className="brand-mark"><span>B</span>10</div>
          <div>
            <div className="project-name">{payload.manifest.name}</div>
            <div className="project-meta">o66 · 212 × 520 · {payload.manifest.version}</div>
          </div>
          {dirty && <span className="dirty-dot" title="Unsaved preview changes" />}
        </div>
        <div className="mode-switch" role="group" aria-label="Preview theme">
          <button className={activeMode === 'normal' ? 'active' : ''} onClick={() => setMode('normal')}>Active</button>
          <button className={activeMode === 'aod' ? 'active' : ''} disabled={!layout.aod?.enabled} onClick={() => setMode('aod')}>AOD</button>
        </div>
        <div className="toolbar-actions">
          {templates.length > 0 && (
            <select
              className="template-select"
              aria-label="Start from a template"
              value={selectedTemplate ?? ''}
              onChange={(event) => { window.location.search = event.target.value ? `?template=${event.target.value}` : '' }}
            >
              <option value="">Templates…</option>
              {templates.map((template) => <option key={template.id} value={template.id}>{template.name}</option>)}
            </select>
          )}
          <button className="icon-button" onClick={() => setShowGrid((value) => !value)} aria-pressed={showGrid} title="Toggle grid">#</button>
          <button className="toolbar-button" onClick={reset} disabled={!dirty}>Reset</button>
          <button className="toolbar-button" onClick={() => downloadJson('layout.json', layout)}>Export JSON</button>
          <button className="primary-button" onClick={downloadFace} disabled={busy}>Download .face</button>
        </div>
      </header>

      <aside className="palette-panel">
        <WidgetPalette onAdd={addWidget} />
        <div className="layers-heading">
          <span>Layers</span>
          <span className="count-pill">{widgets.length}</span>
        </div>
        <div className="layer-list">
          {[...widgets].sort((left, right) => right.z - left.z).map((widget) => (
            <button
              key={widget.id}
              className={`layer-row ${widget.id === selectedId ? 'selected' : ''}`}
              onClick={() => { setSelectedId(widget.id); setPanel('inspect') }}
            >
              <span className={`layer-icon type-${widget.type}`}>{widget.type === 'number' ? '12' : widget.type === 'image-list' ? '≡' : widget.type === 'animation' ? '▶' : widget.type === 'progress' ? '◒' : '◇'}</span>
              <span className="layer-copy"><strong>{widget.label || widget.id}</strong><small>{widget.type}</small></span>
              <span className={`visibility-dot ${widget.visible === false ? 'off' : ''}`} />
            </button>
          ))}
        </div>
        <div className="palette-footer">
          <span>Device target</span>
          <strong>Xiaomi Band 10</strong>
          <small>miwear.watch.o66</small>
        </div>
      </aside>

      <main className="canvas-workspace">
        <div className="canvas-tools">
          <div className="tool-group">
            <button className={snap ? 'selected' : ''} onClick={() => setSnap((value) => !value)}>Snap 2 px</button>
            <span className="tool-divider" />
            <button onClick={() => setZoom((value) => Math.max(0.65, value - 0.1))}>−</button>
            <span className="zoom-readout">{zoom === ACTUAL_SIZE_ZOOM ? '1:1' : `${Math.round(zoom * 100)}%`}</span>
            <button onClick={() => setZoom((value) => Math.min(1.5, Math.max(0.65, value + 0.1)))}>+</button>
            <button
              className={zoom === ACTUAL_SIZE_ZOOM ? 'selected' : ''}
              title="Approximate physical size of the 1.72-inch Band 10 screen"
              onClick={() => setZoom((value) => (value === ACTUAL_SIZE_ZOOM ? 1 : ACTUAL_SIZE_ZOOM))}
            >
              Actual size
            </button>
          </div>
          <div className="resolution-badge"><span className="status-led" /> Pixel-accurate SVG</div>
        </div>
        <div className="canvas-stage" onClick={() => setSelectedId(undefined)}>
          <div className="watch-hardware" style={{ '--watch-zoom': zoom } as React.CSSProperties}>
            <div className="watch-crown" />
            <div className="watch-glass">
              <WatchCanvas
                layout={layout}
                mode={activeMode}
                simulation={simulation}
                selectedId={selectedId}
                snap={snap ? 2 : 1}
                showGrid={showGrid}
                onSelect={(id) => { setSelectedId(id); setPanel('inspect') }}
                onMove={(id, x, y) => updateWidget(id, { x, y })}
                onDropWidget={addWidget}
              />
            </div>
          </div>
          <div className="canvas-caption">
            <span>{activeMode === 'aod' ? 'Always-on display' : 'Active display'}</span>
            <span>AMOLED · 60 Hz / AOD 5 Hz</span>
          </div>
        </div>
      </main>

      <aside className="properties-panel">
        <nav className="panel-tabs">
          <button className={panel === 'inspect' ? 'active' : ''} onClick={() => setPanel('inspect')}>Inspect</button>
          <button className={panel === 'simulate' ? 'active' : ''} onClick={() => setPanel('simulate')}>Simulate</button>
          <button className={panel === 'create' ? 'active' : ''} onClick={() => setPanel('create')}>Create</button>
          <button className={panel === 'source' ? 'active' : ''} onClick={() => setPanel('source')}>Source</button>
        </nav>
        <div className="panel-content">
          {panel === 'inspect' && (
            <Inspector
              widget={selected}
              digitSets={Object.keys(layout.assets.digitSets)}
              sources={Object.keys(DATA_SOURCES) as DataSourceKey[]}
              onChange={(patch) => selected && updateWidget(selected.id, patch)}
              onDelete={removeSelected}
              onDuplicate={duplicateSelected}
            />
          )}
          {panel === 'simulate' && (
            <Simulator
              value={simulation}
              liveTime={liveTime}
              weatherConditions={WEATHER_CONDITIONS}
              onChange={setSimulation}
              onLiveTime={setLiveTime}
              onReset={() => { setSimulation(DEFAULT_SIMULATION); setLiveTime(false) }}
            />
          )}
          {panel === 'create' && <CreatePanel busy={busy} onWallpaper={addWallpaper} onFontClock={addFontClock} />}
          {panel === 'source' && (
            <section className="source-panel">
              <div className="section-heading"><div><span className="eyebrow">Project source</span><h2>{sourceFormat === 'json' ? 'layout.json' : `${payload.manifest.output}.fprj`}</h2></div><div className="source-format-switch"><button className={sourceFormat === 'json' ? 'active' : ''} onClick={() => setSourceFormat('json')}>JSON</button><button className={sourceFormat === 'xml' ? 'active' : ''} onClick={() => setSourceFormat('xml')}>XML</button></div></div>
              {sourceFormat === 'json' ? (
                <>
                  <p className="panel-help">Canonical JSON changes apply to the live renderer. Export and replace the project source to persist them.</p>
                  <textarea value={sourceText} onChange={(event) => setSourceText(event.target.value)} spellCheck={false} aria-label="Layout JSON" />
                  {sourceError && <div className="source-error">{sourceError}</div>}
                  <div className="source-actions">
                    <button className="toolbar-button" onClick={() => setSourceText(JSON.stringify(layout, null, 2))}>Format</button>
                    <button className="primary-button" onClick={applySource}>Apply JSON</button>
                  </div>
                </>
              ) : (
                <>
                  <p className="panel-help">Generated Band 10 FPRJ XML compiler intermediate. Edit/download it for Mi Create/EasyFace; XML edits do not mutate canonical JSON.</p>
                  <textarea value={xmlText} onChange={(event) => setXmlText(event.target.value)} spellCheck={false} aria-label="FPRJ XML" />
                  <div className="source-actions">
                    <button className="toolbar-button" onClick={() => setXmlText(payload.fprj)}>Reset XML</button>
                    <button className="primary-button" onClick={() => downloadText(`${payload.manifest.output}.fprj`, xmlText, 'application/xml')}>Export XML</button>
                  </div>
                </>
              )}
            </section>
          )}
        </div>
        <footer className="validation-strip">
          <span className="status-led" />
          <div><strong>{notice ?? 'Preview schema loaded'}</strong><small>Run CLI validation before packaging</small></div>
        </footer>
      </aside>
    </div>
  )
}

export default App
