import React from 'react';
import { Upload, Box, Eraser, Paintbrush, Undo, Redo, Layers } from 'lucide-react';
import { SamplingParams } from '../processing/pointSampler';
import { BrushMode } from '../processing/pointInteraction';
import type { ActiveTool, AddAction, AddAppearanceSource, DepthAction, ToolInteractionMode, VisibilityBrushAction } from '../types/app';

type SavedSelection = {
  id: string;
  name: string;
  indices: number[];
};

type BrushSettings = {
  enabled: boolean;
  size: number;
  strength: number;
  softness: number;
  mode: BrushMode;
};

type ControlSidebarProps = {
  activeTool: ActiveTool;
  addAction: AddAction;
  addAppearanceSource: AddAppearanceSource;
  applySelectedPointColor: (hexColor: string) => void;
  addedPointCount: number;
  cloneSourceIndex: number | null;
  brushSettings: BrushSettings;
  brushDepthPercent: number;
  brushSoftnessPercent: number;
  brushStrengthPercent: number;
  depthAction: DepthAction;
  depthOverlayOpacityPercent: number;
  depthImg: string | null;
  handleAutoDepth: () => void;
  handleFileChange: (e: React.ChangeEvent<HTMLInputElement>, type: 'source' | 'depth') => void;
  handleGenerate: () => void;
  handleGlbUpload: (e: React.ChangeEvent<HTMLInputElement>) => void;
  handleRedo: () => void;
  handleRemoveSelectedAddedPoints: () => void;
  handleClearAddedPoints: () => void;
  handleUndo: () => void;
  hideSelectedPoints: () => void;
  historyLength: number;
  isAutoDepthLoading: boolean;
  isProcessing: boolean;
  params: SamplingParams;
  redoStackLength: number;
  restoreSavedSelection: (indices: number[]) => void;
  restoreSelectedPoints: () => void;
  saveCurrentSelection: () => void;
  savedSelections: SavedSelection[];
  isPickingCloneSource: boolean;
  isPickingPointColor: boolean;
  selectedAddedPointCount: number;
  selectedPointColorHex: string | null;
  selectedPointColorMixed: boolean;
  selectedPointCount: number;
  selectionModeEnabled: boolean;
  showDepthOverlay: boolean;
  setActiveTool: React.Dispatch<React.SetStateAction<ActiveTool>>;
  setAddAction: React.Dispatch<React.SetStateAction<AddAction>>;
  setAddAppearanceSource: React.Dispatch<React.SetStateAction<AddAppearanceSource>>;
  setIsPickingCloneSource: (value: boolean) => void;
  setIsPickingPointColor: (value: boolean) => void;
  setBrushSettings: React.Dispatch<React.SetStateAction<BrushSettings>>;
  setBrushDepthPercent: (percent: number) => void;
  setBrushSoftnessPercent: (percent: number) => void;
  setBrushStrengthPercent: (percent: number) => void;
  setDepthAction: React.Dispatch<React.SetStateAction<DepthAction>>;
  setDepthOverlayOpacityPercent: (value: number) => void;
  setParams: React.Dispatch<React.SetStateAction<SamplingParams>>;
  setShowDepthOverlay: (value: boolean) => void;
  setSelectedPointIndices: React.Dispatch<React.SetStateAction<number[]>>;
  setShowPointIndices: React.Dispatch<React.SetStateAction<boolean>>;
  setToolInteractionMode: React.Dispatch<React.SetStateAction<ToolInteractionMode>>;
  setVisibilityBrushAction: React.Dispatch<React.SetStateAction<VisibilityBrushAction>>;
  showPointIndices: boolean;
  projectionMeshOpacityPercent: number;
  setProjectionMeshOpacityPercent: (value: number) => void;
  toolInteractionMode: ToolInteractionMode;
  sourceImg: string | null;
  updateSavedSelectionName: (selectionId: string, name: string) => void;
  deleteSavedSelection: (selectionId: string) => void;
  visibilityBrushAction: VisibilityBrushAction;
  maxPointSize: number;
  setMaxPointSize: (value: number) => void;
  addPointSize: number;
  setAddPointSize: (value: number) => void;
  showProjectionMesh: boolean;
  setShowProjectionMesh: (value: boolean) => void;
};

export function ControlSidebar({
  activeTool,
  addAction,
  addAppearanceSource,
  applySelectedPointColor,
  addedPointCount,
  cloneSourceIndex,
  brushSettings,
  brushDepthPercent,
  brushSoftnessPercent,
  brushStrengthPercent,
  depthAction,
  depthOverlayOpacityPercent,
  depthImg,
  handleAutoDepth,
  handleFileChange,
  handleGenerate,
  handleGlbUpload,
  handleRedo,
  handleRemoveSelectedAddedPoints,
  handleClearAddedPoints,
  handleUndo,
  hideSelectedPoints,
  historyLength,
  isAutoDepthLoading,
  isProcessing,
  params,
  redoStackLength,
  restoreSavedSelection,
  restoreSelectedPoints,
  saveCurrentSelection,
  savedSelections,
  isPickingCloneSource,
  isPickingPointColor,
  selectedAddedPointCount,
  selectedPointColorHex,
  selectedPointColorMixed,
  selectedPointCount,
  selectionModeEnabled,
  showDepthOverlay,
  setActiveTool,
  setAddAction,
  setAddAppearanceSource,
  setIsPickingCloneSource,
  setIsPickingPointColor,
  setBrushSettings,
  setBrushDepthPercent,
  setBrushSoftnessPercent,
  setBrushStrengthPercent,
  setDepthAction,
  setDepthOverlayOpacityPercent,
  setParams,
  setShowDepthOverlay,
  setSelectedPointIndices,
  setShowPointIndices,
  setToolInteractionMode,
  setVisibilityBrushAction,
  showPointIndices,
  projectionMeshOpacityPercent,
  setProjectionMeshOpacityPercent,
  toolInteractionMode,
  sourceImg,
  updateSavedSelectionName,
  deleteSavedSelection,
  visibilityBrushAction,
  maxPointSize,
  setMaxPointSize,
  addPointSize,
  setAddPointSize,
  showProjectionMesh,
  setShowProjectionMesh
}: ControlSidebarProps) {
  const [selectedPointColorDraft, setSelectedPointColorDraft] = React.useState(selectedPointColorHex ?? '#FFFFFF');

  React.useEffect(() => {
    setSelectedPointColorDraft(selectedPointColorHex ?? '#FFFFFF');
  }, [selectedPointColorHex]);

  return (
    <aside className="w-[320px] border-r border-tech-border bg-tech-sidebar p-6 flex flex-col gap-8 overflow-y-auto scrollbar-hide">
      <section className="space-y-4">
        <div className="mono-label text-tech-accent uppercase">00 // Core Strategy</div>
        <div className="grid grid-cols-5 gap-2">
          <button
            onClick={() => setParams({ ...params, samplingMode: 'grid' })}
            className={`flex flex-col items-center justify-center py-3 border rounded transition-all ${params.samplingMode === 'grid' ? 'bg-tech-border border-tech-accent text-tech-accent' : 'bg-tech-bg/50 border-tech-border text-tech-muted opacity-60'}`}
          >
            <div className="font-mono text-[9px] mb-1">GRID</div>
          </button>
          <button
            onClick={() => setParams({ ...params, samplingMode: 'blob' })}
            className={`flex flex-col items-center justify-center py-3 border rounded transition-all ${params.samplingMode === 'blob' ? 'bg-tech-border border-tech-accent text-tech-accent' : 'bg-tech-bg/50 border-tech-border text-tech-muted opacity-60'}`}
          >
            <div className="font-mono text-[9px] mb-1">BLOB</div>
          </button>
          <button
            onClick={() => setParams({ ...params, samplingMode: 'stochastic' })}
            className={`flex flex-col items-center justify-center py-3 border rounded transition-all ${params.samplingMode === 'stochastic' ? 'bg-tech-border border-tech-accent text-tech-accent' : 'bg-tech-bg/50 border-tech-border text-tech-muted opacity-60'}`}
          >
            <div className="font-mono text-[9px] mb-1">STIPPLE</div>
          </button>
          <button
            onClick={() => setParams({ ...params, samplingMode: 'pixel-exact' })}
            className={`flex flex-col items-center justify-center py-3 border rounded transition-all ${params.samplingMode === 'pixel-exact' ? 'bg-tech-border border-tech-accent text-tech-accent' : 'bg-tech-bg/50 border-tech-border text-tech-muted opacity-60'}`}
          >
            <div className="font-mono text-[9px] mb-1">PIXEL</div>
          </button>
          <button
            onClick={() => setParams({ ...params, samplingMode: 'dot-detect' })}
            className={`flex flex-col items-center justify-center py-3 border rounded transition-all ${params.samplingMode === 'dot-detect' ? 'bg-tech-border border-tech-accent text-tech-accent' : 'bg-tech-bg/50 border-tech-border text-tech-muted opacity-60'}`}
          >
            <div className="font-mono text-[9px] mb-1">DOT</div>
          </button>
        </div>
      </section>

      <section className="space-y-4">
        <div className="mono-label text-tech-accent">01 // Input Assets</div>
        <div className="flex flex-col gap-3">
          <label className="block group cursor-pointer">
            <input type="file" className="hidden" onChange={(e) => handleFileChange(e, 'source')} />
            <div className="w-full h-10 border border-dashed border-tech-subtle-border rounded flex items-center justify-between px-3 text-[11px] group-hover:border-tech-accent transition-colors bg-tech-bg/30">
              <span className="opacity-60 uppercase font-mono">Source Illustration</span>
              {sourceImg ? (
                <span className="text-[10px] bg-tech-input-bg px-1 border border-tech-border text-tech-accent">IMAGE_LOADED</span>
              ) : (
                <Upload className="w-3 h-3 opacity-40 group-hover:text-tech-accent" />
              )}
            </div>
          </label>

          <label className="block group cursor-pointer">
            <input type="file" className="hidden" onChange={(e) => handleFileChange(e, 'depth')} />
            <div className="flex flex-col gap-1">
              <div className="w-full h-10 border border-dashed border-tech-subtle-border rounded flex items-center justify-between px-3 text-[11px] group-hover:border-tech-accent transition-colors bg-tech-bg/30">
                <span className="opacity-60 uppercase font-mono">Depth Map</span>
                {depthImg ? (
                  <span className="text-[10px] bg-tech-input-bg px-1 border border-tech-border text-tech-accent">MAP_LOADED</span>
                ) : (
                  <Upload className="w-3 h-3 opacity-40 group-hover:text-tech-accent" />
                )}
              </div>
              <button
                onClick={(e) => { e.preventDefault(); e.stopPropagation(); handleAutoDepth(); }}
                disabled={!sourceImg || isAutoDepthLoading}
                className="text-[9px] font-mono text-tech-accent hover:underline disabled:opacity-30 self-end tracking-tighter"
              >
                {isAutoDepthLoading ? 'RUNNING_GEN...' : '[ EXECUTE_AUTO_DEPTH ]'}
              </button>
              <div className="space-y-2 border-t border-tech-border/30 pt-2 mt-1">
                <div className="flex items-center justify-between">
                  <span className="mono-value text-[9px] opacity-50 font-mono uppercase">Depth Map Encoding</span>
                  <span className="mono-value text-[9px] text-tech-accent">{params.depthColorSpace === 'srgb-linear' ? 'LINEARIZED' : 'RAW'}</span>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    onClick={(e) => { e.preventDefault(); e.stopPropagation(); setParams({ ...params, depthColorSpace: 'raw' }); }}
                    className={`py-1.5 border rounded text-[10px] uppercase font-mono transition-all ${params.depthColorSpace === 'raw' ? 'border-tech-accent bg-tech-accent/10 text-tech-accent' : 'border-tech-border opacity-50'}`}
                  >
                    Raw
                  </button>
                  <button
                    onClick={(e) => { e.preventDefault(); e.stopPropagation(); setParams({ ...params, depthColorSpace: 'srgb-linear' }); }}
                    className={`py-1.5 border rounded text-[10px] uppercase font-mono transition-all ${params.depthColorSpace === 'srgb-linear' ? 'border-tech-accent bg-tech-accent/10 text-tech-accent' : 'border-tech-border opacity-50'}`}
                  >
                    sRGB to Linear
                  </button>
                </div>
              </div>
            </div>
          </label>

          <div className="pt-2 border-t border-tech-border/30">
            <label className="block group cursor-pointer">
              <input type="file" className="hidden" accept=".glb" onChange={handleGlbUpload} />
              <div className="w-full h-10 border border-dashed border-tech-accent/30 rounded flex items-center justify-between px-3 text-[11px] group-hover:border-tech-accent transition-colors bg-tech-accent/5">
                <span className="text-tech-accent/70 uppercase font-mono">External Point GLB</span>
                <Box className="w-3 h-3 text-tech-accent/40 group-hover:text-tech-accent" />
              </div>
            </label>
            <div className="text-[8px] opacity-30 mt-1 font-mono uppercase">Import existing points to brush</div>
          </div>
        </div>
      </section>

      <section className="space-y-4">
        <div className="mono-label text-tech-accent">02 // Sampling Logic</div>
        <div className="space-y-4">
          <div>
            <div className="flex justify-between mono-value mb-1 font-mono"><span className="opacity-50">Threshold</span><span>{(params.brightnessThreshold * 100).toFixed(0)}%</span></div>
            <input
              type="range" min="0" max="1" step="0.01"
              value={params.brightnessThreshold}
              onChange={(e) => setParams({ ...params, brightnessThreshold: parseFloat(e.target.value) })}
              className="w-full accent-tech-accent h-1 bg-tech-border rounded-lg appearance-none cursor-pointer"
            />
          </div>
          <div>
            <div className="flex justify-between mono-value mb-1 font-mono"><span className="opacity-50">Sampling Step</span><span>{params.samplingStep}PX</span></div>
            <input
              type="range" min="1" max="20" step="1"
              value={params.samplingStep}
              onChange={(e) => setParams({ ...params, samplingStep: parseInt(e.target.value) })}
              className="w-full accent-tech-accent h-1 bg-tech-border rounded-lg appearance-none cursor-pointer"
            />
          </div>
          <div>
            <div className="flex justify-between mono-value mb-1 font-mono"><span className="opacity-50">Visual Point Scale</span><span>{params.pointSizeMultiplier.toFixed(1)}X</span></div>
            <input
              type="range" min="0.1" max="50" step="0.1"
              value={params.pointSizeMultiplier}
              onChange={(e) => setParams({ ...params, pointSizeMultiplier: parseFloat(e.target.value) })}
              className="w-full accent-tech-accent h-1 bg-tech-border rounded-lg appearance-none cursor-pointer"
            />
          </div>
          <div>
            <div className="flex justify-between mono-value mb-1 font-mono"><span className="opacity-50">Max Point Size</span><span>{maxPointSize}px</span></div>
            <input
              type="range" min="1" max="500" step="1"
              value={maxPointSize}
              onChange={(e) => setMaxPointSize(parseInt(e.target.value))}
              className="w-full accent-tech-accent h-1 bg-tech-border rounded-lg appearance-none cursor-pointer"
            />
          </div>
          <div className="pt-2 border-t border-tech-border/30">
            <div className="flex justify-between mono-value mb-1 font-mono"><span className="opacity-50 font-bold text-tech-accent/80">Density Multiplier</span><span>{params.pointDensityFactor}X</span></div>
            <input
              type="range" min="1" max="16" step="1"
              value={params.pointDensityFactor}
              onChange={(e) => setParams({ ...params, pointDensityFactor: parseInt(e.target.value) })}
              className="w-full accent-tech-accent h-1 bg-tech-border rounded-lg appearance-none cursor-pointer"
            />
            <div className="text-[8px] opacity-30 mt-1 font-mono uppercase">Inbetween upsampling + jitter</div>
          </div>
          {params.samplingMode === 'stochastic' && (
            <div className="space-y-2">
              <div className="flex justify-between items-center">
                <label className="text-[10px] uppercase tracking-tighter opacity-70">Stipple Probability</label>
                <span className="text-[10px] text-tech-accent">{params.stochasticDensity.toFixed(2)}</span>
              </div>
              <input
                type="range" min="0.05" max="2.0" step="0.05"
                value={params.stochasticDensity}
                onChange={(e) => setParams({ ...params, stochasticDensity: parseFloat(e.target.value) })}
                className="w-full accent-tech-accent"
              />
            </div>
          )}

          {params.samplingMode === 'blob' && (
            <div>
              <div className="flex justify-between mono-value mb-1 font-mono"><span className="opacity-50">Blob Size Cap</span><span>{params.maxBlobSize}PX</span></div>
              <input
                type="range" min="10" max="2000" step="10"
                value={params.maxBlobSize}
                onChange={(e) => setParams({ ...params, maxBlobSize: parseInt(e.target.value) })}
                className="w-full accent-tech-accent h-1 bg-tech-border rounded-lg appearance-none cursor-pointer"
              />
              <div className="text-[8px] opacity-30 mt-1 font-mono uppercase">Reduces chunky clusters</div>
            </div>
          )}
          {params.samplingMode === 'pixel-exact' && (
            <div className="text-[8px] opacity-30 mt-1 font-mono uppercase">Full-resolution connected-pixel detection. Best for one-dot-one-point bitmap capture.</div>
          )}
          {params.samplingMode === 'dot-detect' && (
            <div className="text-[8px] opacity-30 mt-1 font-mono uppercase">Local-maxima dot center detection with non-maximum suppression. Best for halftone and dot-field artwork.</div>
          )}
          <div className="flex items-center justify-between py-1 border-b border-tech-border/30">
            <span className="mono-value opacity-50 font-mono">Edge Inclusion</span>
            <button
              onClick={() => setParams({ ...params, edgeInclusion: !params.edgeInclusion })}
              className={`w-8 h-4 rounded-full transition-colors relative ${params.edgeInclusion ? 'bg-tech-accent' : 'bg-tech-border'}`}
            >
              <div className={`absolute top-1 w-2 h-2 rounded-full bg-white transition-all ${params.edgeInclusion ? 'right-1' : 'left-1'}`} />
            </button>
          </div>
        </div>
      </section>

      <section className="space-y-4">
        <div className="mono-label text-tech-accent uppercase">03 // Tool Stack</div>

        <div className="space-y-3 p-3 bg-tech-header/50 border border-tech-border rounded">
          <div className="grid grid-cols-3 gap-2">
            <button
              onClick={() => setActiveTool('visibility')}
              className={`py-2 border rounded text-[10px] uppercase font-mono transition-all ${activeTool === 'visibility' ? 'border-tech-accent bg-tech-accent/10 text-tech-accent' : 'border-tech-border opacity-50'}`}
            >
              Visibility
            </button>
            <button
              onClick={() => { setActiveTool('depth'); setToolInteractionMode('brush'); }}
              className={`py-2 border rounded text-[10px] uppercase font-mono transition-all ${activeTool === 'depth' ? 'border-tech-accent bg-tech-accent/10 text-tech-accent' : 'border-tech-border opacity-50'}`}
            >
              Depth
            </button>
            <button
              onClick={() => {
                setActiveTool('add');
                setToolInteractionMode(addAction === 'single' ? 'arrow' : 'brush');
              }}
              className={`py-2 border rounded text-[10px] uppercase font-mono transition-all ${activeTool === 'add' ? 'border-tech-accent bg-tech-accent/10 text-tech-accent' : 'border-tech-border opacity-50'}`}
            >
              Add Points
            </button>
          </div>

          {activeTool === 'visibility' && (
            <div className="space-y-2 border-t border-tech-border/30 pt-3">
              <div className="flex items-center justify-between">
                <span className="mono-value text-[9px] opacity-50 font-mono uppercase">Interaction</span>
                <span className="mono-value text-[9px] text-tech-accent">{toolInteractionMode === 'arrow' ? 'ARROW' : 'BRUSH'}</span>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <button
                  onClick={() => setToolInteractionMode('arrow')}
                  className={`py-1.5 border rounded text-[10px] uppercase font-mono transition-all ${toolInteractionMode === 'arrow' ? 'border-tech-accent bg-tech-accent/10 text-tech-accent' : 'border-tech-border opacity-50'}`}
                >
                  Arrow
                </button>
                <button
                  onClick={() => setToolInteractionMode('brush')}
                  className={`py-1.5 border rounded text-[10px] uppercase font-mono transition-all ${toolInteractionMode === 'brush' ? 'border-tech-accent bg-tech-accent/10 text-tech-accent' : 'border-tech-border opacity-50'}`}
                >
                  Brush
                </button>
              </div>
            </div>
          )}

          {activeTool === 'visibility' && (
            <>
              {toolInteractionMode === 'brush' && (
                <div className="space-y-3 border-t border-tech-border/30 pt-3">
                  <div className="grid grid-cols-3 gap-2">
                    <button
                      onClick={() => setVisibilityBrushAction('hide')}
                      className={`py-1.5 border rounded text-[10px] uppercase font-mono transition-all ${visibilityBrushAction === 'hide' ? 'border-tech-accent bg-tech-accent/10 text-tech-accent' : 'border-tech-border opacity-50'}`}
                    >
                      Hide
                    </button>
                    <button
                      onClick={() => setVisibilityBrushAction('reveal')}
                      className={`py-1.5 border rounded text-[10px] uppercase font-mono transition-all ${visibilityBrushAction === 'reveal' ? 'border-tech-accent bg-tech-accent/10 text-tech-accent' : 'border-tech-border opacity-50'}`}
                    >
                      Reveal
                    </button>
                    <button
                      onClick={() => setVisibilityBrushAction('select')}
                      className={`py-1.5 border rounded text-[10px] uppercase font-mono transition-all ${visibilityBrushAction === 'select' ? 'border-tech-accent bg-tech-accent/10 text-tech-accent' : 'border-tech-border opacity-50'}`}
                    >
                      Select
                    </button>
                  </div>

                  <div>
                    <div className="flex justify-between mono-value mb-1 font-mono text-[9px]"><span className="opacity-50">Brush Radius</span><span>{brushSettings.size}PX</span></div>
                    <input
                      type="range" min="1" max="500" step="1"
                      value={brushSettings.size}
                      onChange={(e) => setBrushSettings({ ...brushSettings, size: parseInt(e.target.value) })}
                      className="w-full accent-tech-accent h-1 bg-tech-border rounded-lg appearance-none cursor-pointer"
                    />
                  </div>

                  <div>
                    <div className="flex justify-between mono-value mb-1 font-mono text-[9px]"><span className="opacity-50">Brush Strength</span><span>{brushStrengthPercent}%</span></div>
                    <input
                      type="range" min="1" max="100" step="1"
                      value={brushStrengthPercent}
                      onChange={(e) => setBrushStrengthPercent(parseInt(e.target.value))}
                      className="w-full accent-tech-accent h-1 bg-tech-border rounded-lg appearance-none cursor-pointer"
                    />
                  </div>

                  <div>
                    <div className="flex justify-between mono-value mb-1 font-mono text-[9px]"><span className="opacity-50">Brush Softness</span><span>{brushSoftnessPercent}%</span></div>
                    <input
                      type="range" min="0" max="100" step="1"
                      value={brushSoftnessPercent}
                      onChange={(e) => setBrushSoftnessPercent(parseInt(e.target.value))}
                      className="w-full accent-tech-accent h-1 bg-tech-border rounded-lg appearance-none cursor-pointer"
                    />
                  </div>
                </div>
              )}

              <div className="space-y-3 border-t border-tech-border/30 pt-3">
                <div className="flex items-center justify-between border-b border-tech-border/30 pb-2">
                  <div>
                    <div className="mono-value text-[10px] text-tech-accent font-bold">{selectedPointCount} SELECTED</div>
                    <div className="text-[8px] opacity-40 font-mono uppercase">
                      {toolInteractionMode === 'arrow'
                        ? 'Click selects, drag draws box, Shift adds, Ctrl removes'
                        : 'Brush select accumulates points inside the current brush area'}
                    </div>
                  </div>
                  <button
                    onClick={() => setSelectedPointIndices([])}
                    disabled={selectedPointCount === 0}
                    className="px-2 py-1 border border-tech-border rounded text-[9px] uppercase font-mono hover:border-tech-accent disabled:opacity-20 transition-all"
                  >
                    Clear
                  </button>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <button
                    onClick={hideSelectedPoints}
                    disabled={selectedPointCount === 0}
                    className="py-1.5 border border-tech-border rounded text-[9px] uppercase font-mono hover:border-tech-accent disabled:opacity-20 transition-all"
                  >
                    Hide Selected
                  </button>
                  <button
                    onClick={restoreSelectedPoints}
                    disabled={selectedPointCount === 0}
                    className="py-1.5 border border-tech-border rounded text-[9px] uppercase font-mono hover:border-tech-accent disabled:opacity-20 transition-all"
                  >
                    Bring Back
                  </button>
                  <button
                    onClick={saveCurrentSelection}
                    disabled={selectedPointCount === 0}
                    className="col-span-2 py-1.5 border border-tech-border rounded text-[9px] uppercase font-mono hover:border-tech-accent disabled:opacity-20 transition-all"
                  >
                    Save Current Selection
                  </button>
                </div>

                {selectedPointCount > 0 && (
                  <div className="space-y-3 border-t border-tech-border/30 pt-3">
                    <div className="flex items-center justify-between">
                      <span className="mono-value text-[9px] opacity-50 font-mono uppercase">Color Attribute</span>
                      <span className="mono-value text-[9px] text-tech-accent font-mono">
                        {selectedPointColorMixed ? 'MIXED' : (selectedPointColorHex ?? 'UNSET')}
                      </span>
                    </div>
                    <div className="flex gap-2 items-center">
                      <input
                        type="color"
                        value={selectedPointColorDraft}
                        onChange={(e) => setSelectedPointColorDraft(e.target.value.toUpperCase())}
                        className="h-9 w-12 cursor-pointer rounded border border-tech-border bg-transparent p-1"
                      />
                      <input
                        type="text"
                        value={selectedPointColorDraft}
                        onChange={(e) => setSelectedPointColorDraft(e.target.value.toUpperCase())}
                        placeholder="#RRGGBB"
                        className="flex-1 bg-transparent border border-tech-border/50 rounded px-2 py-2 text-[10px] font-mono text-tech-text uppercase focus:border-tech-accent outline-none"
                      />
                    </div>
                    <button
                      onClick={() => applySelectedPointColor(selectedPointColorDraft)}
                      className="w-full py-1.5 border border-tech-border rounded text-[9px] uppercase font-mono hover:border-tech-accent transition-all"
                    >
                      Apply Color To Selected
                    </button>
                    <button
                      onClick={() => setIsPickingPointColor(!isPickingPointColor)}
                      className={`w-full py-1.5 border rounded text-[9px] uppercase font-mono transition-all ${isPickingPointColor ? 'border-tech-accent text-tech-accent bg-tech-accent/10' : 'border-tech-border hover:border-tech-accent'}`}
                    >
                      {isPickingPointColor ? 'Click Viewport To Pick' : 'Pick From Viewport'}
                    </button>
                    <div className="text-[8px] opacity-40 font-mono italic">Selected points keep their stored RGB attribute even though the viewport highlights selections with the selection overlay color.</div>
                  </div>
                )}

                <div className="space-y-2 border-t border-tech-border/30 pt-3">
                  <div className="flex items-center justify-between">
                    <span className="mono-value text-[9px] opacity-50 font-mono uppercase">Stored Selections</span>
                    <span className="mono-value text-[9px] text-tech-accent">{savedSelections.length}</span>
                  </div>

                  {savedSelections.length === 0 ? (
                    <div className="text-[8px] opacity-30 font-mono uppercase">No saved selections yet</div>
                  ) : (
                    <div className="space-y-2 max-h-40 overflow-y-auto scrollbar-hide pr-1">
                      {savedSelections.map((selection) => (
                        <div
                          key={selection.id}
                          onDoubleClick={() => restoreSavedSelection(selection.indices)}
                          className="space-y-2 border border-tech-border/60 rounded px-2 py-2 bg-tech-bg/30"
                        >
                          <div className="flex items-center gap-2">
                            <input
                              type="text"
                              value={selection.name}
                              onChange={(e) => updateSavedSelectionName(selection.id, e.target.value)}
                              className="flex-1 bg-transparent border border-tech-border/50 rounded px-2 py-1 text-[10px] font-mono text-tech-text focus:border-tech-accent outline-none"
                            />
                            <button
                              onClick={() => deleteSavedSelection(selection.id)}
                              className="px-2 py-1 border border-tech-border rounded text-[8px] uppercase font-mono hover:border-red-500 hover:text-red-400 transition-all"
                            >
                              X
                            </button>
                          </div>
                          <div className="flex items-center justify-between text-[8px] font-mono uppercase opacity-50">
                            <span>{selection.indices.length} points</span>
                            <span>Double click to restore</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div className="text-[8px] opacity-40 font-mono italic">Visibility is now one tool: use Arrow for precise stored selections or Brush for gestural hide, reveal, and brush-select.</div>
              </div>
            </>
          )}

          {activeTool === 'depth' && (
            <div className="space-y-3 border-t border-tech-border/30 pt-3">
              <div className="grid grid-cols-2 gap-2">
                <button
                  onClick={() => setDepthAction('push')}
                  className={`py-1.5 border rounded text-[10px] uppercase font-mono transition-all ${depthAction === 'push' ? 'border-tech-accent bg-tech-accent/10 text-tech-accent' : 'border-tech-border opacity-50'}`}
                >
                  Depth Out
                </button>
                <button
                  onClick={() => setDepthAction('pull')}
                  className={`py-1.5 border rounded text-[10px] uppercase font-mono transition-all ${depthAction === 'pull' ? 'border-tech-accent bg-tech-accent/10 text-tech-accent' : 'border-tech-border opacity-50'}`}
                >
                  Depth In
                </button>
              </div>

              <div>
                <div className="flex justify-between mono-value mb-1 font-mono text-[9px]"><span className="opacity-50">Brush Radius</span><span>{brushSettings.size}PX</span></div>
                <input
                  type="range" min="1" max="500" step="1"
                  value={brushSettings.size}
                  onChange={(e) => setBrushSettings({ ...brushSettings, size: parseInt(e.target.value) })}
                  className="w-full accent-tech-accent h-1 bg-tech-border rounded-lg appearance-none cursor-pointer"
                />
              </div>

              <div>
                <div className="flex justify-between mono-value mb-1 font-mono text-[9px]"><span className="opacity-50">Brush Strength</span><span>{brushStrengthPercent}%</span></div>
                <input
                  type="range" min="1" max="100" step="1"
                  value={brushStrengthPercent}
                  onChange={(e) => setBrushStrengthPercent(parseInt(e.target.value))}
                  className="w-full accent-tech-accent h-1 bg-tech-border rounded-lg appearance-none cursor-pointer"
                />
              </div>

              <div>
                <div className="flex justify-between mono-value mb-1 font-mono text-[9px]"><span className="opacity-50">Depth Amount</span><span>{brushDepthPercent}% SCALE</span></div>
                <input
                  type="range" min="1" max="100" step="1"
                  value={brushDepthPercent}
                  onChange={(e) => setBrushDepthPercent(parseInt(e.target.value))}
                  className="w-full accent-tech-accent h-1 bg-tech-border rounded-lg appearance-none cursor-pointer"
                />
              </div>

              <div>
                <div className="flex justify-between mono-value mb-1 font-mono text-[9px]"><span className="opacity-50">Brush Softness</span><span>{brushSoftnessPercent}%</span></div>
                <input
                  type="range" min="0" max="100" step="1"
                  value={brushSoftnessPercent}
                  onChange={(e) => setBrushSoftnessPercent(parseInt(e.target.value))}
                  className="w-full accent-tech-accent h-1 bg-tech-border rounded-lg appearance-none cursor-pointer"
                />
              </div>

              <div className="flex items-center justify-between py-1 border-t border-tech-border/30 pt-3">
                <span className="mono-value opacity-50 font-mono text-[9px]">Depth Overlay</span>
                <button
                  onClick={() => setShowDepthOverlay(!showDepthOverlay)}
                  className={`w-8 h-4 rounded-full transition-colors relative ${showDepthOverlay ? 'bg-tech-accent' : 'bg-tech-border'}`}
                >
                  <div className={`absolute top-1 w-2 h-2 rounded-full bg-white transition-all ${showDepthOverlay ? 'right-1' : 'left-1'}`} />
                </button>
              </div>

              <div>
                <div className="flex justify-between mono-value mb-1 font-mono text-[9px]"><span className="opacity-50">Overlay Opacity</span><span>{depthOverlayOpacityPercent}%</span></div>
                <input
                  type="range" min="0" max="100" step="1"
                  value={depthOverlayOpacityPercent}
                  onChange={(e) => setDepthOverlayOpacityPercent(parseInt(e.target.value))}
                  disabled={!showDepthOverlay || !depthImg}
                  className="w-full accent-tech-accent h-1 bg-tech-border rounded-lg appearance-none cursor-pointer disabled:opacity-30"
                />
              </div>

              <div className="text-[8px] opacity-40 font-mono italic">Depth painting is brush-only. Toggle the depth overlay to watch the grayscale map update behind the point cloud while you paint.</div>
            </div>
          )}

          {activeTool === 'add' && (
            <div className="space-y-3 border-t border-tech-border/30 pt-3">
              <div className="grid grid-cols-2 gap-2">
                <button
                  onClick={() => { setToolInteractionMode('arrow'); setAddAction('single'); }}
                  className={`py-1.5 border rounded text-[10px] uppercase font-mono transition-all ${toolInteractionMode === 'arrow' && addAction === 'single' ? 'border-tech-accent bg-tech-accent/10 text-tech-accent' : 'border-tech-border opacity-50'}`}
                >
                  One Point
                </button>
                <button
                  onClick={() => { setToolInteractionMode('brush'); setAddAction('brush'); }}
                  className={`py-1.5 border rounded text-[10px] uppercase font-mono transition-all ${toolInteractionMode === 'brush' && addAction === 'brush' ? 'border-tech-accent bg-tech-accent/10 text-tech-accent' : 'border-tech-border opacity-50'}`}
                >
                  Paint Points
                </button>
              </div>

              <div className="space-y-2 border-t border-tech-border/30 pt-3">
                <div className="flex items-center justify-between">
                  <span className="mono-value text-[9px] opacity-50 font-mono uppercase">Appearance Source</span>
                  <span className="mono-value text-[9px] text-tech-accent">{addAppearanceSource === 'clone-selected' ? 'CLONED POINT' : 'SOURCE IMAGE'}</span>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    onClick={() => {
                      setAddAppearanceSource('image');
                      setIsPickingCloneSource(false);
                    }}
                    className={`py-1.5 border rounded text-[10px] uppercase font-mono transition-all ${addAppearanceSource === 'image' ? 'border-tech-accent bg-tech-accent/10 text-tech-accent' : 'border-tech-border opacity-50'}`}
                  >
                    Image Color
                  </button>
                  <button
                    onClick={() => {
                      setAddAppearanceSource('clone-selected');
                      setIsPickingCloneSource(true);
                    }}
                    className={`py-1.5 border rounded text-[10px] uppercase font-mono transition-all ${addAppearanceSource === 'clone-selected' ? 'border-tech-accent bg-tech-accent/10 text-tech-accent' : 'border-tech-border opacity-50'}`}
                  >
                    Clone Selected
                  </button>
                </div>
                {addAppearanceSource === 'clone-selected' && (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between rounded border border-tech-border/40 px-2 py-1.5">
                      <span className="mono-value text-[9px] opacity-50 font-mono uppercase">Source Point</span>
                      <span className="mono-value text-[9px] text-tech-accent font-mono">{cloneSourceIndex !== null ? `#${cloneSourceIndex}` : 'NONE LOCKED'}</span>
                    </div>
                    <button
                      onClick={() => setIsPickingCloneSource(!isPickingCloneSource)}
                      className={`w-full py-1.5 border rounded text-[10px] uppercase font-mono transition-all ${isPickingCloneSource ? 'border-tech-accent bg-tech-accent/10 text-tech-accent' : 'border-tech-border opacity-70 hover:border-tech-accent/60'}`}
                    >
                      {isPickingCloneSource ? 'Click Viewport To Pick' : 'Pick Source Point'}
                    </button>
                    <div className="text-[8px] opacity-40 font-mono italic">Lock one visible point as the style source, then stamp or paint new points with its size and color.</div>
                  </div>
                )}
              </div>

              {toolInteractionMode === 'brush' && (
                <>
                  <div>
                    <div className="flex justify-between mono-value mb-1 font-mono text-[9px]"><span className="opacity-50">Brush Radius</span><span>{brushSettings.size}PX</span></div>
                    <input
                      type="range" min="1" max="500" step="1"
                      value={brushSettings.size}
                      onChange={(e) => setBrushSettings({ ...brushSettings, size: parseInt(e.target.value) })}
                      className="w-full accent-tech-accent h-1 bg-tech-border rounded-lg appearance-none cursor-pointer"
                    />
                  </div>

                  <div>
                    <div className="flex justify-between mono-value mb-1 font-mono text-[9px]"><span className="opacity-50">Paint Density</span><span>{brushStrengthPercent}%</span></div>
                    <input
                      type="range" min="1" max="100" step="1"
                      value={brushStrengthPercent}
                      onChange={(e) => setBrushStrengthPercent(parseInt(e.target.value))}
                      className="w-full accent-tech-accent h-1 bg-tech-border rounded-lg appearance-none cursor-pointer"
                    />
                  </div>
                </>
              )}

              <div>
                <div className="flex justify-between mono-value mb-1 font-mono text-[9px]">
                  <span className="opacity-50">New Point Size</span>
                  <span>{addPointSize.toFixed(2)}</span>
                </div>
                <input
                  type="range" min="0.1" max="5" step="0.05"
                  value={addPointSize}
                  onChange={(e) => setAddPointSize(parseFloat(e.target.value))}
                  className="w-full accent-tech-accent h-1 bg-tech-border rounded-lg appearance-none cursor-pointer"
                />
              </div>

              <div className="flex items-center justify-between py-1">
                <span className="mono-value opacity-50 font-mono text-[9px]">Show Surface Mesh</span>
                <button
                  onClick={() => setShowProjectionMesh(!showProjectionMesh)}
                  className={`w-8 h-4 border border-tech-subtle-border rounded-full transition-colors relative ${showProjectionMesh ? 'bg-tech-accent' : 'bg-tech-border'}`}
                >
                  <div className={`absolute top-1 w-2 h-2 rounded-full bg-tech-text/60 transition-all ${showProjectionMesh ? 'right-1' : 'left-1'}`} />
                </button>
              </div>

              <div>
                <div className="flex justify-between mono-value mb-1 font-mono text-[9px]">
                  <span className="opacity-50">Surface Transparency</span>
                  <span>{projectionMeshOpacityPercent}%</span>
                </div>
                <input
                  type="range" min="0" max="100" step="1"
                  value={projectionMeshOpacityPercent}
                  onChange={(e) => setProjectionMeshOpacityPercent(parseInt(e.target.value))}
                  className="w-full accent-tech-accent h-1 bg-tech-border rounded-lg appearance-none cursor-pointer"
                />
              </div>

              <div className="space-y-2 border-t border-tech-border/30 pt-3">
                <div className="flex items-center justify-between rounded border border-tech-border/40 px-2 py-1.5">
                  <span className="mono-value text-[9px] opacity-50 font-mono uppercase">Added Layer</span>
                  <span className="mono-value text-[9px] text-tech-accent font-mono">{addedPointCount} PTS</span>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    onClick={handleRemoveSelectedAddedPoints}
                    disabled={selectedAddedPointCount === 0}
                    className="py-1.5 border rounded text-[10px] uppercase font-mono transition-all border-tech-border hover:border-tech-accent disabled:opacity-30 disabled:hover:border-tech-border"
                  >
                    Remove Selected
                  </button>
                  <button
                    onClick={handleClearAddedPoints}
                    disabled={addedPointCount === 0}
                    className="py-1.5 border rounded text-[10px] uppercase font-mono transition-all border-tech-border hover:border-tech-accent disabled:opacity-30 disabled:hover:border-tech-border"
                  >
                    Clear Added
                  </button>
                </div>
                <div className="text-[8px] opacity-40 font-mono italic">These actions only affect hand-added points, leaving the generated base cloud untouched.</div>
              </div>

              <div className="text-[8px] opacity-40 font-mono italic">Add Points supports either one-point precision or brush painting. Use Clone Selected to inherit size and color from one selected source point, or Image Color to sample from the illustration.</div>
            </div>
          )}

          <div className="flex gap-2 border-t border-tech-border/30 pt-3">
            <button
              onClick={handleUndo}
              disabled={historyLength === 0}
              className="flex-1 py-1 flex items-center justify-center gap-2 border border-tech-border rounded text-[9px] uppercase font-mono hover:border-tech-accent disabled:opacity-20 transition-all"
            >
              <Undo className="w-3 h-3" /> Undo
            </button>
            <button
              onClick={handleRedo}
              disabled={redoStackLength === 0}
              className="flex-1 py-1 flex items-center justify-center gap-2 border border-tech-border rounded text-[9px] uppercase font-mono hover:border-tech-accent disabled:opacity-20 transition-all"
            >
              <Redo className="w-3 h-3" /> Redo
            </button>
          </div>
        </div>
      </section>

      <section className="space-y-4">
        <div className="mono-label text-tech-accent">05 // Coordinate Transform</div>
        <div className="space-y-4">
          <div>
            <div className="flex justify-between mono-value mb-1 font-mono"><span className="opacity-50">Depth Scale</span><span>{params.depthScale.toFixed(1)}</span></div>
            <input
              type="range" min="1" max="200" step="1"
              value={params.depthScale}
              onChange={(e) => setParams({ ...params, depthScale: parseInt(e.target.value) })}
              className="w-full accent-tech-accent h-1 bg-tech-border rounded-lg appearance-none cursor-pointer"
            />
          </div>
          <div className="flex items-center justify-between">
            <span className="mono-value opacity-50 font-mono">Invert Depth</span>
            <button
              onClick={() => setParams({ ...params, invertDepth: !params.invertDepth })}
              className={`w-8 h-4 border border-tech-subtle-border rounded-full transition-colors relative ${params.invertDepth ? 'bg-tech-accent' : 'bg-tech-border'}`}
            >
              <div className={`absolute top-1 w-2 h-2 rounded-full bg-tech-text/60 transition-all ${params.invertDepth ? 'right-1' : 'left-1'}`} />
            </button>
          </div>
        </div>
      </section>

      <section className="space-y-4">
        <div className="mono-label text-tech-accent uppercase">06 // Debug View</div>
        <div className="flex items-center justify-between py-1 border-b border-tech-border/30">
          <span className="mono-value opacity-50 font-mono">Point Index Labels</span>
          <button
            onClick={() => setShowPointIndices(!showPointIndices)}
            className={`w-8 h-4 border border-tech-subtle-border rounded-full transition-colors relative ${showPointIndices ? 'bg-tech-accent' : 'bg-tech-border'}`}
          >
            <div className={`absolute top-1 w-2 h-2 rounded-full bg-tech-text/60 transition-all ${showPointIndices ? 'right-1' : 'left-1'}`} />
          </button>
        </div>
        <div className="text-[8px] opacity-30 mt-1 font-mono uppercase">Render numeric ids above every visible point</div>
      </section>

    </aside>
  );
}
