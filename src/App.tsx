/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useRef, useEffect } from 'react';
import * as THREE from 'three';
// @ts-ignore
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls';
// @ts-ignore
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader';
import { 
  Upload, 
  Settings, 
  Layers, 
  Download, 
  RotateCcw, 
  Image as ImageIcon,
  ChevronRight,
  Info,
  Maximize2,
  Box,
  Eraser,
  Paintbrush,
  Undo,
  Redo
} from 'lucide-react';
import { initializeCanvas, readPsd } from 'ag-psd';
import { processImages, exportToGLB, getAutoDepthMap, buildProjectionMesh, SamplingParams, PointData, type DepthPixelSource } from './processing/pointSampler';
import { BrushMode, findNearestHit, getBrushInfluence, getIndicesInRectangle, mergeSelectionIndices, shouldApplyBrushEffect, type ScreenPointHit } from './processing/pointInteraction';
import { ControlSidebar } from './components/ControlSidebar';
import { createPointCloudManager, disposePointIndexLabels } from './three/pointCloud';
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts';
import { useSelectionActions } from './hooks/useSelectionActions';
import { applyHistorySnapshot, createHistorySnapshot } from './utils/history';
import type {
  ActiveTool,
  AddAction,
  AddAppearanceSource,
  DepthAction,
  HistorySnapshot,
  SavedSelection,
  SceneRefs,
  SelectionDragState,
  ToolInteractionMode,
  VisibilityBrushAction
} from './types/app';

const SESSION_STORAGE_KEY = 'illuminated-session-v1';
const SESSION_STORAGE_VERSION = 1;

type PersistedSession = {
  version: number;
  sourceImg: string | null;
  depthImg: string | null;
  paintedDepthImg?: string | null;
  showDepthOverlay?: boolean;
  depthOverlayOpacityPercent?: number;
  colorTransformPalettes?: {
    red: string;
    blue: string;
    white: string;
  };
  camera?: {
    position: [number, number, number];
    target: [number, number, number];
  };
  points: PointData[];
  stats: {
    width: number;
    height: number;
    pointCount: number;
  };
  params: SamplingParams;
  maxPointSize: number;
  addPointSize: number;
  showProjectionMesh: boolean;
  projectionMeshOpacityPercent: number;
  activeTool: ActiveTool;
  toolInteractionMode: ToolInteractionMode;
  visibilityBrushAction: VisibilityBrushAction;
  depthAction: DepthAction;
  addAction: AddAction;
  addAppearanceSource: AddAppearanceSource;
  isPickingCloneSource: boolean;
  brushSettings: {
    enabled: boolean;
    size: number;
    strength: number;
    softness: number;
    depthAmount: number;
    mode: BrushMode;
  };
  selectionModeEnabled: boolean;
  selectedPointIndices: number[];
  savedSelections: SavedSelection[];
  showPointIndices: boolean;
};

type BrowserFileWindow = Window & typeof globalThis & {
  showSaveFilePicker?: (options?: any) => Promise<any>;
  showOpenFilePicker?: (options?: any) => Promise<any[]>;
};

export default function App() {
  const clampBrushSize = (size: number) => Math.min(500, Math.max(1, size));
  const clampBrushStrengthPercent = (percent: number) => Math.min(100, Math.max(1, percent));
  const clampBrushDepthPercent = (percent: number) => Math.min(100, Math.max(1, percent));
  const clampSoftnessPercent = (percent: number) => Math.min(100, Math.max(0, percent));
  const defaultColorTransformPalettes = {
    red: '#7A1F1F, #B73737, #E88787',
    blue: '#183A74, #2F61B8, #8FB0F1',
    white: '#FFFFFF, #E5E5E5, #CFCFCF'
  };
  const toHexChannel = (value: number) => Math.round(Math.max(0, Math.min(1, value)) * 255).toString(16).padStart(2, '0').toUpperCase();
  const rgbToHex = (point: PointData) => `#${toHexChannel(point.r)}${toHexChannel(point.g)}${toHexChannel(point.b)}`;

  const parseHexColor = (value: string) => {
    const normalizedValue = value.trim().replace(/^#/, '');
    const expandedValue = normalizedValue.length === 3
      ? normalizedValue.split('').map((char) => `${char}${char}`).join('')
      : normalizedValue;

    if (!/^[0-9A-Fa-f]{6}$/.test(expandedValue)) {
      return null;
    }

    return {
      r: parseInt(expandedValue.slice(0, 2), 16) / 255,
      g: parseInt(expandedValue.slice(2, 4), 16) / 255,
      b: parseInt(expandedValue.slice(4, 6), 16) / 255
    };
  };

  const parsePaletteInput = (value: string) => {
    return value
      .split(/[\n,;]+/)
      .map((token) => token.trim())
      .filter(Boolean)
      .map((token) => parseHexColor(token))
      .filter((color): color is NonNullable<ReturnType<typeof parseHexColor>> => color !== null);
  };

  const getColorDistance = (
    left: { r: number; g: number; b: number },
    right: { r: number; g: number; b: number }
  ) => Math.hypot(left.r - right.r, left.g - right.g, left.b - right.b);

  // UI State
  const [sourceImg, setSourceImg] = useState<string | null>(null);
  const [depthImg, setDepthImg] = useState<string | null>(null);
  const [paintedDepthImg, setPaintedDepthImg] = useState<string | null>(null);
  const [showDepthOverlay, setShowDepthOverlay] = useState(false);
  const [depthOverlayOpacityPercent, setDepthOverlayOpacityPercent] = useState<number>(45);
  const [linkedDepthPsdName, setLinkedDepthPsdName] = useState<string | null>(null);
  const [colorTransformPalettes, setColorTransformPalettes] = useState(defaultColorTransformPalettes);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isAutoDepthLoading, setIsAutoDepthLoading] = useState(false);
  const [status, setStatus] = useState<string>('Ready');
  const [points, setPoints] = useState<PointData[]>([]);
  const [selectionModeEnabled, setSelectionModeEnabled] = useState(false);
  const [selectedPointIndices, setSelectedPointIndices] = useState<number[]>([]);
  const [selectionDragState, setSelectionDragState] = useState<SelectionDragState | null>(null);
  const [savedSelections, setSavedSelections] = useState<SavedSelection[]>([]);
  const [showPointIndices, setShowPointIndices] = useState(false);
  const [hasSavedSession, setHasSavedSession] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    return window.localStorage.getItem(SESSION_STORAGE_KEY) !== null;
  });
  const [hasSessionFileHandle, setHasSessionFileHandle] = useState(false);
  const [sessionFileName, setSessionFileName] = useState<string | null>(null);
  const [isSessionDirty, setIsSessionDirty] = useState(false);
  const [cameraRevision, setCameraRevision] = useState(0);
  const [stats, setStats] = useState({
    width: 0,
    height: 0,
    pointCount: 0
  });

  // Visual State
  const [maxPointSize, setMaxPointSize] = useState<number>(100);
  const maxPointSizeRef = useRef(maxPointSize);
  useEffect(() => { maxPointSizeRef.current = maxPointSize; }, [maxPointSize]);

  // Add-point tool state
  const [addPointSize, setAddPointSize] = useState<number>(1.0);
  const addPointSizeRef = useRef(addPointSize);
  useEffect(() => { addPointSizeRef.current = addPointSize; }, [addPointSize]);

  // Projection surface
  const [showProjectionMesh, setShowProjectionMesh] = useState(false);
  const [projectionMeshOpacityPercent, setProjectionMeshOpacityPercent] = useState<number>(20);

  // Tool model
  const [activeTool, setActiveTool] = useState<ActiveTool>('visibility');
  const [toolInteractionMode, setToolInteractionMode] = useState<ToolInteractionMode>('brush');
  const [visibilityBrushAction, setVisibilityBrushAction] = useState<VisibilityBrushAction>('hide');
  const [depthAction, setDepthAction] = useState<DepthAction>('push');
  const [addAction, setAddAction] = useState<AddAction>('single');
  const [addAppearanceSource, setAddAppearanceSource] = useState<AddAppearanceSource>('image');
  const [isPickingCloneSource, setIsPickingCloneSource] = useState(false);
  const [isPickingPointColor, setIsPickingPointColor] = useState(false);

  // Brush State
  const [brushSettings, setBrushSettings] = useState({
    enabled: false,
    size: 20,
    strength: 1.0,
    softness: 0.5,
    depthAmount: 0.1,
    mode: 'hide' as BrushMode
  });
  const [isBrushing, setIsBrushing] = useState(false);
  const [isAltNavigationActive, setIsAltNavigationActive] = useState(false);

  // History State
  const [history, setHistory] = useState<HistorySnapshot[]>([]);
  const [redoStack, setRedoStack] = useState<HistorySnapshot[]>([]);

  // Sync refs to avoid stale closures in event listeners
  const brushSettingsRef = useRef(brushSettings);
  const isBrushingRef = useRef(isBrushing);
  const isAltNavigationRef = useRef(isAltNavigationActive);

  // Stable refs for data accessed inside Three.js event-handler closures
  const pointsRef = useRef<PointData[]>(points);
  useEffect(() => { pointsRef.current = points; }, [points]);

  const sourcePixelDataRef = useRef<{ data: Uint8ClampedArray; width: number; height: number } | null>(null);
  const depthPixelDataRef = useRef<{ data: Uint8ClampedArray; width: number; height: number } | null>(null);
  const paintedDepthCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const hasPendingDepthPaintSyncRef = useRef(false);
  const addAppearanceSourceRef = useRef(addAppearanceSource);
  useEffect(() => { addAppearanceSourceRef.current = addAppearanceSource; }, [addAppearanceSource]);
  const isPickingCloneSourceRef = useRef(isPickingCloneSource);
  useEffect(() => { isPickingCloneSourceRef.current = isPickingCloneSource; }, [isPickingCloneSource]);
  const isPickingPointColorRef = useRef(isPickingPointColor);
  useEffect(() => { isPickingPointColorRef.current = isPickingPointColor; }, [isPickingPointColor]);

  const raycasterRef = useRef(new THREE.Raycaster());

  // Callback ref so Three.js closure can call the latest addNewPoints
  const addNewPointsCallbackRef = useRef<((pts: PointData[]) => void) | null>(null);
  const applySelectedPointColorCallbackRef = useRef<((hexColor: string) => void) | null>(null);
  const selectionModeEnabledRef = useRef(selectionModeEnabled);
  const selectedPointIndicesRef = useRef(selectedPointIndices);
  const selectionDragStateRef = useRef<SelectionDragState | null>(selectionDragState);
  const brushIndicatorRef = useRef<THREE.Mesh | null>(null);
  const hasRestoredSessionRef = useRef(false);
  const sessionFileHandleRef = useRef<any>(null);
  const lastSavedSessionFingerprintRef = useRef<string | null>(null);
  useEffect(() => { brushSettingsRef.current = brushSettings; }, [brushSettings]);
  useEffect(() => { isBrushingRef.current = isBrushing; }, [isBrushing]);
  useEffect(() => { isAltNavigationRef.current = isAltNavigationActive; }, [isAltNavigationActive]);
  useEffect(() => { selectionModeEnabledRef.current = selectionModeEnabled; }, [selectionModeEnabled]);
  useEffect(() => { selectedPointIndicesRef.current = selectedPointIndices; }, [selectedPointIndices]);
  useEffect(() => { selectionDragStateRef.current = selectionDragState; }, [selectionDragState]);

  const adjustBrushSize = (delta: number) => {
    setBrushSettings((prev) => ({
      ...prev,
      size: clampBrushSize(prev.size + delta)
    }));
  };

  const setBrushSoftnessPercent = (percent: number) => {
    const clampedPercent = clampSoftnessPercent(percent);
    setBrushSettings((prev) => ({
      ...prev,
      softness: clampedPercent / 100
    }));
  };

  const setBrushStrengthPercent = (percent: number) => {
    const clampedPercent = clampBrushStrengthPercent(percent);
    setBrushSettings((prev) => ({
      ...prev,
      strength: clampedPercent / 100
    }));
  };

  const adjustBrushStrengthPercent = (delta: number) => {
    setBrushStrengthPercent(Math.round(brushSettingsRef.current.strength * 100) + delta);
  };

  const setBrushDepthPercent = (percent: number) => {
    const clampedPercent = clampBrushDepthPercent(percent);
    setBrushSettings((prev: typeof brushSettings) => ({
      ...prev,
      depthAmount: clampedPercent / 100
    }));
  };

  const isEditableTarget = (target: EventTarget | null) => {
    return target instanceof HTMLElement && (
      target.isContentEditable ||
      target.tagName === 'INPUT' ||
      target.tagName === 'TEXTAREA' ||
      target.tagName === 'SELECT'
    );
  };

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.altKey) {
        setIsAltNavigationActive(true);
      }
    };

    const handleKeyUp = (event: KeyboardEvent) => {
      if (event.key === 'Alt' || !event.altKey) {
        setIsAltNavigationActive(false);
      }
    };

    const handleWindowBlur = () => {
      setIsAltNavigationActive(false);
      setIsBrushing(false);
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    window.addEventListener('blur', handleWindowBlur);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      window.removeEventListener('blur', handleWindowBlur);
    };
  }, []);

  // Lock rotation when brush is enabled
  useEffect(() => {
    if (sceneRef.current?.controls) {
      sceneRef.current.controls.enableRotate = (!brushSettings.enabled && !selectionModeEnabled) || isAltNavigationActive;
    }
    if (brushIndicatorRef.current) {
      brushIndicatorRef.current.visible = brushSettings.enabled && !selectionModeEnabled && !isAltNavigationActive;
      brushIndicatorRef.current.scale.set(brushSettings.size, brushSettings.size, 1);
    }
  }, [brushSettings.enabled, brushSettings.size, isAltNavigationActive, selectionModeEnabled]);

  // Bridge the higher-level tool model into the existing selection + brush engine.
  useEffect(() => {
    if (activeTool === 'visibility') {
      if (toolInteractionMode === 'arrow') {
        setSelectionModeEnabled(true);
        setBrushSettings((prev) => ({ ...prev, enabled: false, mode: 'select' }));
        return;
      }

      setSelectionModeEnabled(false);
      setBrushSettings((prev) => ({
        ...prev,
        enabled: true,
        mode: visibilityBrushAction
      }));
      return;
    }

    if (activeTool === 'depth') {
      setSelectionModeEnabled(false);
      setBrushSettings((prev) => ({
        ...prev,
        enabled: true,
        mode: depthAction
      }));
      return;
    }

    setSelectionModeEnabled(false);
    setBrushSettings((prev) => ({
      ...prev,
      enabled: true,
      mode: addAction === 'single' ? 'stamp' : 'paint'
    }));
  }, [activeTool, addAction, depthAction, toolInteractionMode, visibilityBrushAction]);

  // Parameters
  const [params, setParams] = useState<SamplingParams>({
    samplingMode: 'stochastic',
    depthColorSpace: 'raw',
    brightnessThreshold: 0.1,
    samplingStep: 2,
    stochasticDensity: 0.8,
    pointSizeMultiplier: 1.0,
    pointDensityFactor: 1,
    maxBlobSize: 400,
    depthScale: 50,
    xyScale: 0.5,
    edgeInclusion: true,
    edgeWeight: 1.0,
    invertDepth: false,
    useSourceColors: true,
    whiteOnlyPoints: false
  });

  const paramsRef = useRef(params);
  useEffect(() => { paramsRef.current = params; }, [params]);

  // Refs
  const canvasRef = useRef<HTMLDivElement>(null);
  const sourceImgRef = useRef<HTMLImageElement>(null);
  const depthImgRef = useRef<HTMLImageElement>(null);
  const sessionFileInputRef = useRef<HTMLInputElement>(null);
  const sceneRef = useRef<SceneRefs | null>(null);
  const linkedDepthPsdHandleRef = useRef<any>(null);
  const linkedDepthPsdLastModifiedRef = useRef<number | null>(null);
  const isRefreshingLinkedDepthPsdRef = useRef(false);
  const brushStrengthPercent = Math.round(brushSettings.strength * 100);
  const brushDepthPercent = Math.round(brushSettings.depthAmount * 100);
  const brushSoftnessPercent = Math.round(brushSettings.softness * 100);
  const sortedSelectedPointIndices = [...selectedPointIndices].sort((left, right) => left - right);
  const selectedPointCount = sortedSelectedPointIndices.length;
  const addedPointCount = points.reduce((count: number, point: PointData) => count + (point.isAdded ? 1 : 0), 0);
  const selectedAddedPointCount = sortedSelectedPointIndices.reduce(
    (count: number, index: number) => count + (points[index]?.isAdded ? 1 : 0),
    0
  );
  const cloneSourceIndex = selectedPointCount === 1 ? sortedSelectedPointIndices[0] : null;
  const primarySelectedPoint = cloneSourceIndex !== null ? points[cloneSourceIndex] ?? null : (selectedPointCount > 0 ? points[sortedSelectedPointIndices[0]] ?? null : null);
  const selectedPointColorHex = primarySelectedPoint ? rgbToHex(primarySelectedPoint) : null;
  const selectedPointColorMixed = selectedPointCount > 1 && !!primarySelectedPoint && sortedSelectedPointIndices.some((index) => {
    const point = points[index];
    return !!point && rgbToHex(point) !== selectedPointColorHex;
  });
  const selectionRect = selectionDragState ? {
    left: Math.min(selectionDragState.startX, selectionDragState.currentX),
    top: Math.min(selectionDragState.startY, selectionDragState.currentY),
    width: Math.abs(selectionDragState.currentX - selectionDragState.startX),
    height: Math.abs(selectionDragState.currentY - selectionDragState.startY)
  } : null;

  const {
    rebuildPointCloud,
    rebuildPointIndexLabels,
    renderPoints,
    syncPointIndexLabelPositions,
    syncPointIndexLabelVisibility,
    syncSelectedPointVisibility
  } = createPointCloudManager({
    sceneRef,
    showPointIndices,
    getSelectedIndices: () => selectedPointIndicesRef.current
  });

  const {
    clearSelectionState,
    deleteSavedSelection,
    hideSelectedPoints,
    restoreSavedSelection,
    restoreSelectedPoints,
    saveCurrentSelection,
    updateSavedSelectionName
  } = useSelectionActions({
    pointsLength: points.length,
    savedSelections,
    selectedPointIndicesRef,
    setSelectedPointIndices,
    setSavedSelections,
    setSelectionModeEnabled,
    setBrushSettings,
    setStatus,
    pushToHistory: () => pushToHistory(),
    sceneRef,
    syncPointIndexLabelVisibility
  });

  const clearProjectionMesh = () => {
    if (!sceneRef.current?.mesh) return;

    sceneRef.current.scene.remove(sceneRef.current.mesh);
    sceneRef.current.mesh.geometry.dispose();
    (sceneRef.current.mesh.material as THREE.Material).dispose();
    sceneRef.current.mesh = null;
  };

  const rebuildProjectionSurfaceMesh = (
    depthPixels: DepthPixelSource,
    currentParams: SamplingParams,
    sourceWidth: number,
    sourceHeight: number,
    visible: boolean,
    opacityPercent: number
  ) => {
    if (!sceneRef.current) return;

    clearProjectionMesh();

    const projMesh = buildProjectionMesh(
      depthPixels,
      currentParams,
      sourceWidth,
      sourceHeight
    );

    projMesh.visible = true;
    (projMesh.material as THREE.MeshBasicMaterial).opacity = visible ? opacityPercent / 100 : 0;
    sceneRef.current.scene.add(projMesh);
    sceneRef.current.mesh = projMesh;
  };

  const syncPaintedDepthImageState = () => {
    const paintedCanvas = paintedDepthCanvasRef.current;
    if (!paintedCanvas) return;
    hasPendingDepthPaintSyncRef.current = false;
    setPaintedDepthImg(paintedCanvas.toDataURL('image/png'));
  };

  const getSyncedPointsFromScene = (currentPoints: PointData[]) => {
    if (!sceneRef.current?.points) {
      return currentPoints.map((point) => ({ ...point }));
    }

    const geometry = sceneRef.current.points.geometry;
    const visibilityAttr = geometry.getAttribute('visibility') as THREE.BufferAttribute;
    const positionAttr = geometry.getAttribute('position') as THREE.BufferAttribute;

    return currentPoints.map((point, index) => ({
      ...point,
      x: index < positionAttr.count ? positionAttr.getX(index) : point.x,
      y: index < positionAttr.count ? positionAttr.getY(index) : point.y,
      z: index < positionAttr.count ? positionAttr.getZ(index) : point.z,
      visibility: index < visibilityAttr.count ? visibilityAttr.getX(index) : point.visibility
    }));
  };

  const syncPointsFromSceneState = () => {
    const syncedPoints = getSyncedPointsFromScene(pointsRef.current);
    pointsRef.current = syncedPoints;
    setPoints(syncedPoints);
    setStats((prev) => ({ ...prev, pointCount: syncedPoints.length }));
    return syncedPoints;
  };

  const clampDepthSample = (value: number) => Math.max(0, Math.min(1, value));

  const getStoredDepthSample = (point: PointData, currentParams: SamplingParams) => {
    if (typeof point.depthSample === 'number') {
      return clampDepthSample(point.depthSample);
    }

    if (currentParams.depthScale !== 0) {
      return clampDepthSample(point.z / currentParams.depthScale);
    }

    return 0.5;
  };

  const sampleDepthFromUv = (u?: number, v?: number) => {
    const depthPixels = depthPixelDataRef.current;
    if (!depthPixels || typeof u !== 'number' || typeof v !== 'number') {
      return null;
    }

    const clampedU = Math.max(0, Math.min(1, u));
    const clampedV = Math.max(0, Math.min(1, v));
    const px = Math.round(clampedU * (depthPixels.width - 1));
    const py = Math.round((1 - clampedV) * (depthPixels.height - 1));
    const pixelIndex = (py * depthPixels.width + px) * 4;
    const normalizedValue = depthPixels.data[pixelIndex] / 255;

    if (paramsRef.current.depthColorSpace === 'srgb-linear') {
      return normalizedValue <= 0.04045
        ? normalizedValue / 12.92
        : Math.pow((normalizedValue + 0.055) / 1.055, 2.4);
    }

    return normalizedValue;
  };

  const sampleSourceColorFromUv = (u?: number, v?: number) => {
    const sourcePixels = sourcePixelDataRef.current;
    if (!sourcePixels || typeof u !== 'number' || typeof v !== 'number') {
      return null;
    }

    const clampedU = Math.max(0, Math.min(1, u));
    const clampedV = Math.max(0, Math.min(1, v));
    const px = Math.round(clampedU * (sourcePixels.width - 1));
    const py = Math.round((1 - clampedV) * (sourcePixels.height - 1));
    const pixelIndex = (py * sourcePixels.width + px) * 4;

    return `#${sourcePixels.data[pixelIndex].toString(16).padStart(2, '0')}${sourcePixels.data[pixelIndex + 1].toString(16).padStart(2, '0')}${sourcePixels.data[pixelIndex + 2].toString(16).padStart(2, '0')}`.toUpperCase();
  };

  const paintDepthAtUv = (u: number, v: number, settings: typeof brushSettings, currentParams: SamplingParams) => {
    const paintedCanvas = paintedDepthCanvasRef.current;
    if (!paintedCanvas) {
      return 0;
    }

    const paintedCtx = paintedCanvas.getContext('2d', { willReadFrequently: true });
    if (!paintedCtx) {
      return 0;
    }

    const imageData = paintedCtx.getImageData(0, 0, paintedCanvas.width, paintedCanvas.height);
    const data = imageData.data;
    const centerX = Math.round(Math.max(0, Math.min(1, u)) * (paintedCanvas.width - 1));
    const centerY = Math.round((1 - Math.max(0, Math.min(1, v))) * (paintedCanvas.height - 1));
    const radius = Math.max(1, settings.size);
    const depthDirection = settings.mode === 'push' ? 1 : -1;
    const normalizedStep = settings.depthAmount * settings.strength * 0.01;
    const minX = Math.max(0, Math.floor(centerX - radius));
    const maxX = Math.min(paintedCanvas.width - 1, Math.ceil(centerX + radius));
    const minY = Math.max(0, Math.floor(centerY - radius));
    const maxY = Math.min(paintedCanvas.height - 1, Math.ceil(centerY + radius));
    let changedPixelCount = 0;

    for (let py = minY; py <= maxY; py++) {
      for (let px = minX; px <= maxX; px++) {
        const dist = Math.hypot(px - centerX, py - centerY);
        const normalizedDistance = dist / radius;
        const brushInfluence = getBrushInfluence(normalizedDistance, settings.softness);
        if (brushInfluence <= 0) {
          continue;
        }

        const pixelIndex = (py * paintedCanvas.width + px) * 4;
        const currentValue = data[pixelIndex] / 255;
        const nextValue = clampDepthSample(currentValue + (normalizedStep * brushInfluence * depthDirection));

        if (Math.abs(nextValue - currentValue) < 0.0005) {
          continue;
        }

        const encodedValue = Math.round(nextValue * 255);
        data[pixelIndex] = encodedValue;
        data[pixelIndex + 1] = encodedValue;
        data[pixelIndex + 2] = encodedValue;
        data[pixelIndex + 3] = 255;
        changedPixelCount += 1;
      }
    }

    if (changedPixelCount === 0) {
      return 0;
    }

    paintedCtx.putImageData(imageData, 0, 0);
    depthPixelDataRef.current = { data: imageData.data, width: paintedCanvas.width, height: paintedCanvas.height };
    hasPendingDepthPaintSyncRef.current = true;

    rebuildProjectionSurfaceMesh(
      depthPixelDataRef.current,
      currentParams,
      paintedCanvas.width,
      paintedCanvas.height,
      showProjectionMesh,
      projectionMeshOpacityPercent
    );

    if (pointsRef.current.length > 0) {
      applyPointSnapshot(pointsRef.current.map((point) => ({ ...point })));
    }

    return changedPixelCount;
  };

  const getActiveDepthSample = (point: PointData, currentParams: SamplingParams) => {
    const sampledDepth = sampleDepthFromUv(point.u, point.v);
    if (sampledDepth !== null) {
      return sampledDepth;
    }

    return getStoredDepthSample(point, currentParams);
  };

  const getClampedPointZOffset = (point: PointData, currentParams: SamplingParams, nextOffset: number) => {
    const depthSample = getActiveDepthSample(point, currentParams);
    const adjustedDepth = currentParams.invertDepth ? 1 - depthSample : depthSample;
    const baseDepthZ = adjustedDepth * currentParams.depthScale;
    return THREE.MathUtils.clamp(nextOffset, -baseDepthZ, currentParams.depthScale - baseDepthZ);
  };

  const getRenderedPointZ = (point: PointData, currentParams: SamplingParams) => {
    const depthSample = getActiveDepthSample(point, currentParams);
    const adjustedDepth = currentParams.invertDepth ? 1 - depthSample : depthSample;
    const clampedOffset = getClampedPointZOffset(point, currentParams, point.zOffset ?? 0);
    return (adjustedDepth * currentParams.depthScale) + clampedOffset;
  };

  const materializePointsForDepth = (targetPoints: PointData[], currentParams: SamplingParams) => {
    return targetPoints.map((point) => {
      const depthSample = getActiveDepthSample(point, currentParams);
      const adjustedDepth = currentParams.invertDepth ? 1 - depthSample : depthSample;
      const clampedOffset = getClampedPointZOffset(point, currentParams, point.zOffset ?? 0);

      return {
        ...point,
        depthSample,
        zOffset: clampedOffset,
        z: (adjustedDepth * currentParams.depthScale) + clampedOffset
      };
    });
  };

  const getCameraSnapshot = () => {
    if (!sceneRef.current) return undefined;

    const { camera, controls } = sceneRef.current;
    return {
      position: [camera.position.x, camera.position.y, camera.position.z] as [number, number, number],
      target: [controls.target.x, controls.target.y, controls.target.z] as [number, number, number]
    };
  };

  const getSessionFingerprint = (session: PersistedSession) => JSON.stringify({
    version: session.version,
    sourceImg: session.sourceImg,
    depthImg: session.depthImg,
    paintedDepthImg: session.paintedDepthImg,
    showDepthOverlay: session.showDepthOverlay ?? false,
    depthOverlayOpacityPercent: session.depthOverlayOpacityPercent ?? 45,
    colorTransformPalettes: session.colorTransformPalettes ?? defaultColorTransformPalettes,
    camera: session.camera
      ? {
          position: [...session.camera.position] as [number, number, number],
          target: [...session.camera.target] as [number, number, number]
        }
      : undefined,
    points: session.points.map((point) => ({
      x: point.x,
      y: point.y,
      z: point.z,
      u: point.u,
      v: point.v,
      r: point.r,
      g: point.g,
      b: point.b,
      size: point.size,
      visibility: point.visibility,
      isAdded: point.isAdded ?? false
    })),
    stats: session.stats,
    params: session.params,
    maxPointSize: session.maxPointSize,
    addPointSize: session.addPointSize,
    showProjectionMesh: session.showProjectionMesh,
    projectionMeshOpacityPercent: session.projectionMeshOpacityPercent,
    activeTool: session.activeTool,
    toolInteractionMode: session.toolInteractionMode,
    visibilityBrushAction: session.visibilityBrushAction,
    depthAction: session.depthAction,
    addAction: session.addAction,
    addAppearanceSource: session.addAppearanceSource,
    isPickingCloneSource: session.isPickingCloneSource,
    brushSettings: session.brushSettings,
    selectionModeEnabled: session.selectionModeEnabled,
    selectedPointIndices: [...session.selectedPointIndices],
    savedSelections: session.savedSelections.map((selection) => ({
      id: selection.id,
      name: selection.name,
      indices: [...selection.indices]
    })),
    showPointIndices: session.showPointIndices
  });

  const sessionHasMeaningfulContent = (session: PersistedSession | null | undefined) => {
    if (!session) return false;

    return Boolean(
      session.sourceImg ||
      session.depthImg ||
      session.paintedDepthImg ||
      (session.points?.length ?? 0) > 0
    );
  };

  useEffect(() => {
    initializeCanvas(
      (width, height) => {
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        return canvas;
      },
      (width, height) => new ImageData(width, height)
    );
  }, []);

  const clearLinkedDepthPsd = () => {
    linkedDepthPsdHandleRef.current = null;
    linkedDepthPsdLastModifiedRef.current = null;
    isRefreshingLinkedDepthPsdRef.current = false;
    setLinkedDepthPsdName(null);
  };

  const renderLinkedDepthPsdFile = async (fileHandle: any, suppressStatus: boolean = false) => {
    if (!fileHandle || isRefreshingLinkedDepthPsdRef.current) {
      return false;
    }

    isRefreshingLinkedDepthPsdRef.current = true;

    try {
      const file = await fileHandle.getFile();
      const psd = readPsd(await file.arrayBuffer()) as any;
      const compositeCanvas = psd.canvas as HTMLCanvasElement | undefined;

      if (!compositeCanvas) {
        setStatus('Error: PSD depth map is missing composite image data');
        return false;
      }

      setDepthImg(compositeCanvas.toDataURL('image/png'));
      setPaintedDepthImg(null);
      linkedDepthPsdHandleRef.current = fileHandle;
      linkedDepthPsdLastModifiedRef.current = file.lastModified;
      setLinkedDepthPsdName(typeof fileHandle.name === 'string' ? fileHandle.name : file.name);

      if (!suppressStatus) {
        setStatus(`Linked PSD depth loaded: ${typeof fileHandle.name === 'string' ? fileHandle.name : file.name}`);
      }

      return true;
    } catch (error) {
      console.error(error);
      setStatus('Error: Failed to read PSD depth map');
      return false;
    } finally {
      isRefreshingLinkedDepthPsdRef.current = false;
    }
  };

  const handleLinkDepthPsd = async () => {
    if (!supportsFileSessionSave()) {
      setStatus('Notice: Local PSD linking requires the browser file access API');
      return;
    }

    try {
      const browserWindow = window as BrowserFileWindow;
      const [fileHandle] = (await browserWindow.showOpenFilePicker?.({
        excludeAcceptAllOption: false,
        multiple: false,
        types: [
          {
            description: 'Photoshop document',
            accept: {
              'image/vnd.adobe.photoshop': ['.psd'],
              'application/octet-stream': ['.psd']
            }
          }
        ]
      })) ?? [];

      if (!fileHandle) {
        return;
      }

      clearLinkedDepthPsd();
      await renderLinkedDepthPsdFile(fileHandle);
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        return;
      }

      console.error(error);
      setStatus('Error: PSD depth linking failed');
    }
  };

  const handleRefreshLinkedDepthPsd = async () => {
    const fileHandle = linkedDepthPsdHandleRef.current;
    if (!fileHandle) {
      setStatus('Notice: No linked PSD depth map to refresh');
      return;
    }

    const refreshed = await renderLinkedDepthPsdFile(fileHandle, true);
    if (refreshed) {
      setStatus(`Linked PSD refreshed: ${typeof fileHandle.name === 'string' ? fileHandle.name : 'depth.psd'}`);
    }
  };

  const createPersistedSession = (): PersistedSession => {
    const syncedPoints = getSyncedPointsFromScene(pointsRef.current);

    return {
      version: SESSION_STORAGE_VERSION,
      sourceImg,
      depthImg,
      paintedDepthImg,
      showDepthOverlay,
      depthOverlayOpacityPercent,
      colorTransformPalettes,
      camera: getCameraSnapshot(),
      points: syncedPoints,
      stats: {
        ...stats,
        pointCount: syncedPoints.length
      },
      params,
      maxPointSize,
      addPointSize,
      showProjectionMesh,
      projectionMeshOpacityPercent,
      activeTool,
      toolInteractionMode,
      visibilityBrushAction,
      depthAction,
      addAction,
      addAppearanceSource,
      isPickingCloneSource,
      brushSettings,
      selectionModeEnabled,
      selectedPointIndices: selectedPointIndices.filter((index) => index >= 0 && index < syncedPoints.length),
      savedSelections,
      showPointIndices
    };
  };

  const persistSession = (session: PersistedSession) => {
    try {
      window.localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(session));
      setHasSavedSession(true);
      return true;
    } catch (primaryError) {
      try {
        window.localStorage.setItem(
          SESSION_STORAGE_KEY,
          JSON.stringify({
            ...session,
            sourceImg: null,
            depthImg: null
          })
        );
        setHasSavedSession(true);
        console.warn('Session save exceeded storage budget; images were omitted.', primaryError);
        return true;
      } catch (secondaryError) {
        console.error('Session save failed.', secondaryError);
        return false;
      }
    }
  };

  const loadImageForSession = async (src: string) => {
    const image = new Image();
    image.src = src;
    await image.decode();
    return image;
  };

  const applyPersistedSession = async (restoredSession: PersistedSession) => {
    setSourceImg(restoredSession.sourceImg ?? null);
    setDepthImg(restoredSession.depthImg ?? null);
    setPaintedDepthImg(restoredSession.paintedDepthImg ?? null);
    setShowDepthOverlay(restoredSession.showDepthOverlay ?? false);
    setDepthOverlayOpacityPercent(restoredSession.depthOverlayOpacityPercent ?? 45);
    setColorTransformPalettes(restoredSession.colorTransformPalettes ?? defaultColorTransformPalettes);
    setParams(restoredSession.params);
    paramsRef.current = restoredSession.params;
    setMaxPointSize(restoredSession.maxPointSize);
    maxPointSizeRef.current = restoredSession.maxPointSize;
    setAddPointSize(restoredSession.addPointSize);
    addPointSizeRef.current = restoredSession.addPointSize;
    setShowProjectionMesh(restoredSession.showProjectionMesh);
    setProjectionMeshOpacityPercent(restoredSession.projectionMeshOpacityPercent);
    setActiveTool(restoredSession.activeTool);
    setToolInteractionMode(restoredSession.toolInteractionMode);
    setVisibilityBrushAction(restoredSession.visibilityBrushAction);
    setDepthAction(restoredSession.depthAction);
    setAddAction(restoredSession.addAction);
    setAddAppearanceSource(restoredSession.addAppearanceSource);
    setIsPickingCloneSource(restoredSession.isPickingCloneSource);
    isPickingCloneSourceRef.current = restoredSession.isPickingCloneSource;
    setBrushSettings(restoredSession.brushSettings);
    brushSettingsRef.current = restoredSession.brushSettings;
    setSelectionModeEnabled(restoredSession.selectionModeEnabled);
    selectionModeEnabledRef.current = restoredSession.selectionModeEnabled;
    setSavedSelections(restoredSession.savedSelections ?? []);
    setShowPointIndices(restoredSession.showPointIndices);
    setHistory([]);
    setRedoStack([]);

    const restoredPoints = (restoredSession.points ?? []).map((point) => ({
      ...point,
      isAdded: point.isAdded ?? false
    }));
    const validSelectedIndices = (restoredSession.selectedPointIndices ?? []).filter(
      (index) => index >= 0 && index < restoredPoints.length
    );

    const renderedPoints = materializePointsForDepth(restoredPoints, restoredSession.params);
    pointsRef.current = renderedPoints;
    selectedPointIndicesRef.current = validSelectedIndices;
    setPoints(renderedPoints);
    setSelectedPointIndices(validSelectedIndices);
    setStats({
      ...restoredSession.stats,
      pointCount: renderedPoints.length
    });

    if (restoredSession.camera && sceneRef.current) {
      const { camera, controls } = sceneRef.current;
      camera.position.set(...restoredSession.camera.position);
      controls.target.set(...restoredSession.camera.target);
      camera.updateProjectionMatrix();
      controls.update();
    }

    if (renderedPoints.length > 0) {
      renderPoints(
        renderedPoints,
        restoredSession.params.pointSizeMultiplier,
        restoredSession.maxPointSize
      );
    }

    if (
      restoredPoints.length > 0 &&
      restoredSession.sourceImg &&
      restoredSession.depthImg
    ) {
      try {
        const [sourceImage, depthImage] = await Promise.all([
          loadImageForSession(restoredSession.sourceImg),
          loadImageForSession(restoredSession.paintedDepthImg ?? restoredSession.depthImg)
        ]);

        const canvas = document.createElement('canvas');
        canvas.width = sourceImage.naturalWidth;
        canvas.height = sourceImage.naturalHeight;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          throw new Error('Could not get canvas context for restored depth image');
        }

        ctx.drawImage(depthImage, 0, 0, canvas.width, canvas.height);
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);

        rebuildProjectionSurfaceMesh(
          { data: imageData.data, width: canvas.width, height: canvas.height },
          restoredSession.params,
          sourceImage.naturalWidth,
          sourceImage.naturalHeight,
          restoredSession.showProjectionMesh,
          restoredSession.projectionMeshOpacityPercent
        );
      } catch (error) {
        console.error(error);
      }
    } else {
      clearProjectionMesh();
    }

    setHasSavedSession(true);
    return renderedPoints;
  };

  const handleSaveSession = () => {
    const saved = persistSession(createPersistedSession());
    setStatus(saved ? 'Session saved' : 'Error: Session save failed');
  };

  const handleLoadSession = async (silentWhenMissing: boolean = false) => {
    try {
      const rawSession = window.localStorage.getItem(SESSION_STORAGE_KEY);
      if (!rawSession) {
        setHasSavedSession(false);
        if (!silentWhenMissing) {
          setStatus('Notice: No saved session found');
        }
        return;
      }

      const restoredSession = JSON.parse(rawSession) as PersistedSession;
      if (restoredSession.version !== SESSION_STORAGE_VERSION) {
        window.localStorage.removeItem(SESSION_STORAGE_KEY);
        setHasSavedSession(false);
        if (!silentWhenMissing) {
          setStatus('Notice: Saved session is from an older format');
        }
        return;
      }

      const restoredPoints = await applyPersistedSession(restoredSession);
      setStatus(restoredPoints.length > 0 ? 'Session loaded' : 'Session loaded (empty)');
    } catch (error) {
      console.error(error);
      window.localStorage.removeItem(SESSION_STORAGE_KEY);
      setHasSavedSession(false);
      if (!silentWhenMissing) {
        setStatus('Error: Session load failed');
      }
    }
  };

  const handleClearSavedSession = () => {
    window.localStorage.removeItem(SESSION_STORAGE_KEY);
    setHasSavedSession(false);
    setStatus('Saved session cleared');
  };

  const supportsFileSessionSave = () => {
    const browserWindow = window as BrowserFileWindow;
    return Boolean(browserWindow.showSaveFilePicker && browserWindow.showOpenFilePicker);
  };

  const getSessionFilePickerOptions = () => ({
    excludeAcceptAllOption: false,
    suggestedName: sessionFileName ?? 'illuminated-session.json',
    types: [
      {
        description: 'Illuminated session JSON',
        accept: {
          'application/json': ['.json'],
          'text/json': ['.json']
        }
      }
    ]
  });

  const ensureSessionFilePermission = async (fileHandle: any) => {
    const permissionOptions = { mode: 'readwrite' as const };

    if (typeof fileHandle.queryPermission === 'function') {
      const currentPermission = await fileHandle.queryPermission(permissionOptions);
      if (currentPermission === 'granted') {
        return true;
      }
    }

    if (typeof fileHandle.requestPermission === 'function') {
      const requestedPermission = await fileHandle.requestPermission(permissionOptions);
      return requestedPermission === 'granted';
    }

    return true;
  };

  const writeSessionToFileHandle = async (fileHandle: any) => {
    const session = createPersistedSession();
    const writable = await fileHandle.createWritable();
    await writable.write(`${JSON.stringify(session, null, 2)}\n`);
    await writable.close();

    sessionFileHandleRef.current = fileHandle;
    setHasSessionFileHandle(true);
    setSessionFileName(typeof fileHandle.name === 'string' ? fileHandle.name : 'illuminated-session.json');
    lastSavedSessionFingerprintRef.current = getSessionFingerprint(session);
    setIsSessionDirty(false);
  };

  const downloadSessionFile = (session: PersistedSession, fileName?: string) => {
    const targetFileName = fileName ?? sessionFileName ?? 'illuminated-session.json';
    const blob = new Blob([`${JSON.stringify(session, null, 2)}\n`], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = targetFileName;
    link.click();
    URL.revokeObjectURL(url);

    setSessionFileName(targetFileName);
    lastSavedSessionFingerprintRef.current = getSessionFingerprint(session);
    setIsSessionDirty(false);
  };

  const handleSaveSessionToFile = async (saveAs: boolean = false) => {
    if (!supportsFileSessionSave()) {
      const session = createPersistedSession();
      const fallbackFileName = saveAs || !sessionFileName ? 'illuminated-session.json' : sessionFileName;
      downloadSessionFile(session, fallbackFileName ?? undefined);
      setStatus(`Session downloaded as ${fallbackFileName}`);
      return;
    }

    try {
      const browserWindow = window as BrowserFileWindow;
      let fileHandle = sessionFileHandleRef.current;

      if (saveAs || !fileHandle) {
        fileHandle = await browserWindow.showSaveFilePicker?.(getSessionFilePickerOptions());
      }

      if (!fileHandle) {
        return;
      }

      const hasPermission = await ensureSessionFilePermission(fileHandle);
      if (!hasPermission) {
        setStatus('Notice: Session file write permission was denied');
        return;
      }

      await writeSessionToFileHandle(fileHandle);
      setStatus(`Session saved to ${typeof fileHandle.name === 'string' ? fileHandle.name : 'session file'}`);
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        return;
      }

      console.error(error);
      setStatus('Error: Session file save failed');
    }
  };

  const handleLoadSessionFromFile = async () => {
    if (!supportsFileSessionSave()) {
      sessionFileInputRef.current?.click();
      return;
    }

    try {
      const browserWindow = window as BrowserFileWindow;
      const [fileHandle] = (await browserWindow.showOpenFilePicker?.(getSessionFilePickerOptions())) ?? [];
      if (!fileHandle) {
        return;
      }

      const file = await fileHandle.getFile();
      const rawSession = await file.text();
      const restoredSession = JSON.parse(rawSession) as PersistedSession;

      if (restoredSession.version !== SESSION_STORAGE_VERSION) {
        setStatus('Notice: Selected session file uses an older format');
        return;
      }

      const restoredPoints = await applyPersistedSession(restoredSession);
      sessionFileHandleRef.current = fileHandle;
      setHasSessionFileHandle(true);
      setSessionFileName(typeof fileHandle.name === 'string' ? fileHandle.name : file.name);
      lastSavedSessionFingerprintRef.current = getSessionFingerprint(restoredSession);
      setIsSessionDirty(false);
      setStatus(restoredPoints.length > 0 ? `Session loaded from ${file.name}` : `Loaded empty session from ${file.name}`);
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        return;
      }

      console.error(error);
      setStatus('Error: Session file load failed');
    }
  };

  const handleSessionFileInputChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;

    try {
      const rawSession = await file.text();
      const restoredSession = JSON.parse(rawSession) as PersistedSession;

      if (restoredSession.version !== SESSION_STORAGE_VERSION) {
        setStatus('Notice: Selected session file uses an older format');
        return;
      }

      const restoredPoints = await applyPersistedSession(restoredSession);
      sessionFileHandleRef.current = null;
      setHasSessionFileHandle(false);
      setSessionFileName(file.name);
      lastSavedSessionFingerprintRef.current = getSessionFingerprint(restoredSession);
      setIsSessionDirty(false);
      setStatus(restoredPoints.length > 0 ? `Session loaded from ${file.name}` : `Loaded empty session from ${file.name}`);
    } catch (error) {
      console.error(error);
      setStatus('Error: Session file load failed');
    }
  };

  const handleForgetSessionFile = () => {
    sessionFileHandleRef.current = null;
    setHasSessionFileHandle(false);
    setSessionFileName(null);
    lastSavedSessionFingerprintRef.current = null;
    setIsSessionDirty(false);
    setStatus('Session file path forgotten');
  };

  useEffect(() => {
    if (!hasSessionFileHandle || !lastSavedSessionFingerprintRef.current) {
      setIsSessionDirty(false);
      return;
    }

    setIsSessionDirty(getSessionFingerprint(createPersistedSession()) !== lastSavedSessionFingerprintRef.current);
  }, [
    sourceImg,
    depthImg,
    paintedDepthImg,
    points,
    stats,
    params,
    maxPointSize,
    addPointSize,
    showProjectionMesh,
    projectionMeshOpacityPercent,
    activeTool,
    toolInteractionMode,
    visibilityBrushAction,
    depthAction,
    addAction,
    addAppearanceSource,
    isPickingCloneSource,
    brushSettings,
    selectionModeEnabled,
    selectedPointIndices,
    savedSelections,
    showPointIndices,
    hasSessionFileHandle,
    cameraRevision
  ]);

  // Initialize Three.js
  useEffect(() => {
    if (!canvasRef.current) return;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(75, canvasRef.current.clientWidth / canvasRef.current.clientHeight, 0.1, 5000);
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setClearColor(0x000000, 0);
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setSize(canvasRef.current.clientWidth, canvasRef.current.clientHeight);
    
    // Ensure canvas fills container and doesn't cause scrollbars
    renderer.domElement.style.display = 'block';
    renderer.domElement.style.width = '100%';
    renderer.domElement.style.height = '100%';
    renderer.domElement.style.backgroundColor = 'transparent';
    
    const container = canvasRef.current;
    container.appendChild(renderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    camera.position.set(0, 0, 500);
    const handleControlsEnd = () => {
      setCameraRevision((prev) => prev + 1);
    };
    controls.addEventListener('end', handleControlsEnd);
    
    // Create Brush Indicator (Circle)
    const ringGeometry = new THREE.RingGeometry(0.9, 1, 32);
    const ringMaterial = new THREE.MeshBasicMaterial({ color: 0xF27D26, side: THREE.DoubleSide });
    const brushIndicator = new THREE.Mesh(ringGeometry, ringMaterial);
    brushIndicator.visible = false;
    scene.add(brushIndicator);
    brushIndicatorRef.current = brushIndicator;

    const mouse = new THREE.Vector2();
    const projectedPoint = new THREE.Vector3();

    sceneRef.current = { scene, camera, renderer, controls, points: null, pointIndexLabels: null, mesh: null };

    const getRendererRect = () => renderer.domElement.getBoundingClientRect();

    const getCanvasPointer = (clientX: number, clientY: number) => {
      const rect = getRendererRect();
      return {
        x: clientX - rect.left,
        y: clientY - rect.top,
        width: rect.width,
        height: rect.height
      };
    };

    const getVisibleProjectedPointIndices = () => {
      if (!sceneRef.current?.points) return [] as ScreenPointHit[];

      const rect = getRendererRect();
      const pointCloud = sceneRef.current.points;
      const geometry = pointCloud.geometry;
      const positionAttr = geometry.getAttribute('position') as THREE.BufferAttribute;
      const visibilityAttr = geometry.getAttribute('visibility') as THREE.BufferAttribute;
      const localPoint = new THREE.Vector3();
      const worldPoint = new THREE.Vector3();
      const hits: ScreenPointHit[] = [];

      sceneRef.current.camera.updateMatrixWorld();
      pointCloud.updateMatrixWorld(true);

      for (let index = 0; index < positionAttr.count; index++) {
        if (visibilityAttr.getX(index) < 0.5) continue;

        localPoint.fromBufferAttribute(positionAttr, index);
        worldPoint.copy(localPoint).applyMatrix4(pointCloud.matrixWorld);
        projectedPoint.copy(worldPoint).project(sceneRef.current.camera);

        if (projectedPoint.z < -1 || projectedPoint.z > 1) continue;

        hits.push({
          index,
          x: ((projectedPoint.x + 1) / 2) * rect.width,
          y: ((1 - projectedPoint.y) / 2) * rect.height
        });
      }

      return hits;
    };

    // Brush Application Function
    const applyBrush = (clientX: number, clientY: number, forcePaint: boolean = false) => {
      if (!sceneRef.current || !sceneRef.current.points) return;
      
      const pointer = getCanvasPointer(clientX, clientY);
      if (!pointer) return;

      mouse.x = (pointer.x / pointer.width) * 2 - 1;
      mouse.y = -(pointer.y / pointer.height) * 2 + 1;
      
      const settings = brushSettingsRef.current;
      const indicator = brushIndicatorRef.current;

      if (settings.mode === 'push' || settings.mode === 'pull') {
        const projMesh = sceneRef.current.mesh;

        if (indicator && settings.enabled && !isAltNavigationRef.current) {
          indicator.visible = true;
          indicator.scale.set(settings.size, settings.size, 1);
          if (projMesh) {
            raycasterRef.current.setFromCamera(new THREE.Vector2(mouse.x, mouse.y), sceneRef.current.camera);
            const meshHits = raycasterRef.current.intersectObject(projMesh);
            if (meshHits.length > 0) {
              indicator.position.copy(meshHits[0].point);
              indicator.lookAt(sceneRef.current.camera.position);
            }
          }
        } else if (indicator) {
          indicator.visible = false;
        }

        if (!settings.enabled || isAltNavigationRef.current) return;
        if (!isBrushingRef.current && !forcePaint) return;
        if (!projMesh || !depthPixelDataRef.current) {
          setStatus('Notice: Load or generate a depth map to paint depth');
          return;
        }

        raycasterRef.current.setFromCamera(new THREE.Vector2(mouse.x, mouse.y), sceneRef.current.camera);
        const meshHits = raycasterRef.current.intersectObject(projMesh);
        const hitUv = meshHits[0]?.uv;
        if (!hitUv) {
          return;
        }

        const changedPixelCount = paintDepthAtUv(hitUv.x, hitUv.y, settings, paramsRef.current);
        if (changedPixelCount > 0 && forcePaint) {
          setStatus(`Painted depth ${settings.mode === 'push' ? 'out' : 'in'} across ${changedPixelCount} pixels`);
        }
        return;
      }

      // ── Paint / Stamp modes: raycast against the projection surface mesh ──────
      if (settings.mode === 'paint' || settings.mode === 'stamp') {
        const projMesh = sceneRef.current.mesh;
        const currentAppearanceSource = addAppearanceSourceRef.current;
        const currentIsPickingCloneSource = isPickingCloneSourceRef.current;

        // Update brush indicator position against the projection mesh
        if (indicator && settings.enabled && !isAltNavigationRef.current) {
          indicator.visible = true;
          // For stamp show a small dot; for paint show the full radius
          const indicatorSize = settings.mode === 'stamp' ? Math.max(10, settings.size * 0.15) : settings.size;
          indicator.scale.set(indicatorSize, indicatorSize, 1);
          if (projMesh) {
            raycasterRef.current.setFromCamera(new THREE.Vector2(mouse.x, mouse.y), sceneRef.current.camera);
            const meshHits = raycasterRef.current.intersectObject(projMesh);
            if (meshHits.length > 0) {
              indicator.position.copy(meshHits[0].point);
              indicator.lookAt(sceneRef.current.camera.position);
            } else {
              const dir = new THREE.Vector3(mouse.x, mouse.y, 0.5).unproject(sceneRef.current.camera).sub(sceneRef.current.camera.position).normalize();
              indicator.position.copy(sceneRef.current.camera.position).add(dir.multiplyScalar(200));
              indicator.lookAt(sceneRef.current.camera.position);
            }
          }
        } else if (indicator) {
          indicator.visible = false;
        }

        // Only add points on actual click/drag
        if (!settings.enabled || isAltNavigationRef.current) return;
        // stamp: only on initial click; paint: on every move while dragging
        if (settings.mode === 'stamp' && !forcePaint) return;
        if (!isBrushingRef.current && !forcePaint) return;
        if (!projMesh) {
          setStatus('Notice: Generate a point cloud first to enable paint mode');
          return;
        }

        if (currentAppearanceSource === 'clone-selected' && settings.mode === 'stamp' && forcePaint && currentIsPickingCloneSource) {
          const nearestCloneSourceHit = findNearestHit(
            getVisibleProjectedPointIndices(),
            pointer.x,
            pointer.y,
            16
          );

          if (nearestCloneSourceHit) {
            const cloneSourceHit = nearestCloneSourceHit;
            setSelectedPointIndices([cloneSourceHit.index]);
            setIsPickingCloneSource(false);
            setStatus(`Clone source set to point ${cloneSourceHit.index}`);
          } else {
            setStatus('Notice: Click a visible point to set the clone source');
          }

          return;
        }

        const cam = sceneRef.current.camera;
        const rc = raycasterRef.current;
        const currentParams = paramsRef.current;
        const pixelData = sourcePixelDataRef.current;
        const currentAddSize = addPointSizeRef.current;

        const getClonedPointAppearance = (): { r: number; g: number; b: number; size: number } | null => {
          if (!sceneRef.current?.points) return null;
          if (selectedPointIndicesRef.current.length !== 1) return null;

          const cloneIndex = selectedPointIndicesRef.current[0];
          const geometry = sceneRef.current.points.geometry;
          const colorAttr = geometry.getAttribute('color') as THREE.BufferAttribute;
          const sizeAttr = geometry.getAttribute('size') as THREE.BufferAttribute;

          if (cloneIndex < 0 || cloneIndex >= colorAttr.count || cloneIndex >= sizeAttr.count) {
            return null;
          }

          return {
            r: colorAttr.getX(cloneIndex),
            g: colorAttr.getY(cloneIndex),
            b: colorAttr.getZ(cloneIndex),
            size: sizeAttr.getX(cloneIndex)
          };
        };

        const getPixelColor = (px: number, py: number): { r: number; g: number; b: number } => {
          if (!pixelData) return { r: 1, g: 1, b: 1 };
          const cpx = Math.max(0, Math.min(pixelData.width - 1, px));
          const cpy = Math.max(0, Math.min(pixelData.height - 1, py));
          const pi = (cpy * pixelData.width + cpx) * 4;
          return {
            r: pixelData.data[pi] / 255,
            g: pixelData.data[pi + 1] / 255,
            b: pixelData.data[pi + 2] / 255
          };
        };

        const getColorLuminance = ({ r, g, b }: { r: number; g: number; b: number }) => {
          return (0.299 * r) + (0.587 * g) + (0.114 * b);
        };

        const getUvFromWorldPos = (worldPos: THREE.Vector3) => {
          if (!pixelData) return { u: 0, v: 0 };

          const px = Math.round(worldPos.x / currentParams.xyScale + pixelData.width / 2);
          const py = Math.round(-worldPos.y / currentParams.xyScale + pixelData.height / 2);

          return {
            u: pixelData.width > 1 ? Math.max(0, Math.min(pixelData.width - 1, px)) / (pixelData.width - 1) : 0,
            v: pixelData.height > 1 ? 1 - (Math.max(0, Math.min(pixelData.height - 1, py)) / (pixelData.height - 1)) : 0
          };
        };

        const findNearbyNonBackgroundColor = (centerPx: number, centerPy: number): { r: number; g: number; b: number } | null => {
          if (!pixelData) return null;

          const maxRadius = 12;
          const backgroundThreshold = 0.045;

          for (let radius = 1; radius <= maxRadius; radius++) {
            let bestColor: { r: number; g: number; b: number } | null = null;
            let bestLuminance = backgroundThreshold;

            for (let dy = -radius; dy <= radius; dy++) {
              for (let dx = -radius; dx <= radius; dx++) {
                const samplePx = Math.max(0, Math.min(pixelData.width - 1, centerPx + dx));
                const samplePy = Math.max(0, Math.min(pixelData.height - 1, centerPy + dy));
                const color = getPixelColor(samplePx, samplePy);
                const luminance = getColorLuminance(color);

                if (luminance > bestLuminance) {
                  bestColor = color;
                  bestLuminance = luminance;
                }
              }
            }

            if (bestColor) {
              return bestColor;
            }
          }

          return null;
        };

        const sampleImageColorFromUv = (uv?: THREE.Vector2 | null): { r: number; g: number; b: number } | null => {
          if (!pixelData || !uv) return null;

          const px = Math.round(Math.max(0, Math.min(1, uv.x)) * (pixelData.width - 1));
          const py = Math.round((1 - Math.max(0, Math.min(1, uv.y))) * (pixelData.height - 1));
          const directColor = getPixelColor(px, py);

          if (getColorLuminance(directColor) > 0.045) {
            return directColor;
          }

          return findNearbyNonBackgroundColor(px, py) ?? directColor;
        };

        const sampleColor = (worldPos: THREE.Vector3, uv?: THREE.Vector2 | null): { r: number; g: number; b: number } => {
          const uvColor = sampleImageColorFromUv(uv);
          if (uvColor) {
            return uvColor;
          }

          if (!pixelData) return { r: 1, g: 1, b: 1 };

          const px = Math.round(worldPos.x / currentParams.xyScale + pixelData.width / 2);
          const py = Math.round(-worldPos.y / currentParams.xyScale + pixelData.height / 2);
          const directColor = getPixelColor(px, py);

          if (getColorLuminance(directColor) > 0.045) {
            return directColor;
          }

          return findNearbyNonBackgroundColor(px, py) ?? directColor;
        };

        const clonedAppearance = currentAppearanceSource === 'clone-selected'
          ? getClonedPointAppearance()
          : null;

        if (currentAppearanceSource === 'clone-selected' && !clonedAppearance) {
          setStatus(currentIsPickingCloneSource
            ? 'Notice: Click a visible point to set the clone source'
            : 'Notice: Pick exactly one source point to clone its size and color');
          return;
        }

        const resolveAppearance = (worldPos: THREE.Vector3, uv?: THREE.Vector2 | null) => {
          if (clonedAppearance) {
            return clonedAppearance;
          }

          const sampledColor = sampleColor(worldPos, uv);
          return {
            ...sampledColor,
            size: currentAddSize
          };
        };

        const resolvePointUv = (worldPos: THREE.Vector3, uv?: THREE.Vector2 | null) => {
          if (uv) {
            return {
              u: Math.max(0, Math.min(1, uv.x)),
              v: Math.max(0, Math.min(1, uv.y))
            };
          }

          return getUvFromWorldPos(worldPos);
        };

        const resolveDepthSample = (worldPos: THREE.Vector3, uv?: THREE.Vector2 | null) => {
          const resolvedUv = uv
            ? { u: Math.max(0, Math.min(1, uv.x)), v: Math.max(0, Math.min(1, uv.y)) }
            : getUvFromWorldPos(worldPos);

          return sampleDepthFromUv(resolvedUv.u, resolvedUv.v) ?? 0.5;
        };

        const newPoints: PointData[] = [];

        if (settings.mode === 'stamp') {
          // One precise point at cursor
          rc.setFromCamera(new THREE.Vector2(mouse.x, mouse.y), cam);
          const hits = rc.intersectObject(projMesh);
          if (hits.length > 0) {
            const hp = hits[0].point;
            const { r, g, b, size } = resolveAppearance(hp, hits[0].uv);
            const { u, v } = resolvePointUv(hp, hits[0].uv);
            const depthSample = resolveDepthSample(hp, hits[0].uv);
            newPoints.push({ x: hp.x, y: hp.y, z: hp.z, u, v, depthSample, zOffset: 0, r, g, b, size, visibility: 1.0 });
          }
        } else {
          // Paint: scatter N points within brush radius
          const maxCount = Math.max(1, Math.round(settings.size / 30));
          for (let n = 0; n < maxCount; n++) {
            if (Math.random() > settings.strength) continue;
            const angle = Math.random() * Math.PI * 2;
            const dist = Math.sqrt(Math.random()) * settings.size; // sqrt for uniform disc distribution
            const ox = Math.cos(angle) * dist;
            const oy = Math.sin(angle) * dist;
            const nx = ((pointer.x + ox) / pointer.width) * 2 - 1;
            const ny = -((pointer.y + oy) / pointer.height) * 2 + 1;
            rc.setFromCamera(new THREE.Vector2(nx, ny), cam);
            const hits = rc.intersectObject(projMesh);
            if (hits.length > 0) {
              const hp = hits[0].point;
              const { r, g, b, size } = resolveAppearance(hp, hits[0].uv);
              const { u, v } = resolvePointUv(hp, hits[0].uv);
              const depthSample = resolveDepthSample(hp, hits[0].uv);
              newPoints.push({ x: hp.x, y: hp.y, z: hp.z, u, v, depthSample, zOffset: 0, r, g, b, size, visibility: 1.0 });
            }
          }
        }

        if (newPoints.length > 0) {
          addNewPointsCallbackRef.current?.(newPoints);
          setStatus(`Added ${newPoints.length} point${newPoints.length > 1 ? 's' : ''}`);
        }
        return;
      }
      // ─────────────────────────────────────────────────────────────────────────

      const selectionHits = getVisibleProjectedPointIndices();

      if (indicator) {
        if (settings.enabled && !isAltNavigationRef.current) {
          indicator.visible = true;
          indicator.scale.set(settings.size, settings.size, 1);
          const nearestHit = findNearestHit(selectionHits, pointer.x, pointer.y, Number.POSITIVE_INFINITY);

          if (nearestHit && sceneRef.current?.points) {
            const pointCloud = sceneRef.current.points;
            const positionAttr = pointCloud.geometry.getAttribute('position') as THREE.BufferAttribute;
            const localPoint = new THREE.Vector3().fromBufferAttribute(positionAttr, nearestHit.index);
            const worldPoint = localPoint.applyMatrix4(pointCloud.matrixWorld);
            indicator.position.copy(worldPoint);
            indicator.lookAt(sceneRef.current.camera.position);
          } else {
            const dir = new THREE.Vector3(mouse.x, mouse.y, 0.5).unproject(sceneRef.current.camera).sub(sceneRef.current.camera.position).normalize();
            indicator.position.copy(sceneRef.current.camera.position).add(dir.multiplyScalar(200));
            indicator.lookAt(sceneRef.current.camera.position);
          }
        } else {
          indicator.visible = false;
        }
      }

      // ONLY process point physics if we are actually clicking (or forced)
      const nearestBrushHit = findNearestHit(selectionHits, pointer.x, pointer.y, Math.max(settings.size, 18));

      if (nearestBrushHit && settings.enabled && !isAltNavigationRef.current && (isBrushingRef.current || forcePaint)) {
        const pointCloud = sceneRef.current.points;
        const geometry = pointCloud.geometry;
        const visibilityAttr = geometry.getAttribute('visibility') as THREE.BufferAttribute;
        const positionAttr = geometry.getAttribute('position') as THREE.BufferAttribute;
        const pointIndexLabels = sceneRef.current.pointIndexLabels;

        const center = new THREE.Vector3().fromBufferAttribute(positionAttr, nearestBrushHit.index).applyMatrix4(pointCloud.matrixWorld);
        const pos = new THREE.Vector3();
        const worldPos = new THREE.Vector3();
        const selectedIndices: number[] = [];
        let affectedPointCount = 0;
        const depthDelta = paramsRef.current.depthScale * settings.depthAmount * settings.strength * 0.02;
        
        for (let i = 0; i < visibilityAttr.count; i++) {
          pos.fromBufferAttribute(positionAttr, i);
          worldPos.copy(pos).applyMatrix4(pointCloud.matrixWorld);
          
          const dist = worldPos.distanceTo(center);
          const normalizedDistance = dist / settings.size;
          const brushInfluence = getBrushInfluence(normalizedDistance, settings.softness);

          if (settings.mode === 'select') {
            const pointNoise = Math.abs(
              Math.sin(worldPos.x * 12.9898 + worldPos.y * 78.233 + worldPos.z * 37.719)
            );

            if (!shouldApplyBrushEffect(normalizedDistance, settings.softness, settings.strength, pointNoise)) {
              continue;
            }

            selectedIndices.push(i);
            affectedPointCount += 1;
          } else if (settings.mode === 'push' || settings.mode === 'pull') {
            if (brushInfluence <= 0) {
              continue;
            }

            const depthDirection = settings.mode === 'push' ? 1 : -1;
            const point = pointsRef.current[i];
            if (!point) {
              continue;
            }

            point.zOffset = getClampedPointZOffset(
              point,
              paramsRef.current,
              (point.zOffset ?? 0) + (depthDelta * brushInfluence * depthDirection)
            );
            const nextZ = getRenderedPointZ(point, paramsRef.current);
            point.z = nextZ;
            positionAttr.setZ(i, nextZ);
            if (pointIndexLabels?.children[i]) {
              pointIndexLabels.children[i].position.z = nextZ;
            }
            affectedPointCount += 1;
          } else {
            const pointNoise = Math.abs(
              Math.sin(worldPos.x * 12.9898 + worldPos.y * 78.233 + worldPos.z * 37.719)
            );

            if (!shouldApplyBrushEffect(normalizedDistance, settings.softness, settings.strength, pointNoise)) {
              continue;
            }

            visibilityAttr.setX(i, settings.mode === 'hide' ? 0.0 : 1.0);
            affectedPointCount += 1;
          }
        }

        if (settings.mode === 'select') {
          if (selectedIndices.length > 0) {
            setSelectedPointIndices((prev) => mergeSelectionIndices(prev, selectedIndices, true, false));
            if (forcePaint) {
              setStatus(`Brush selected ${selectedIndices.length} points`);
            }
          }
        } else {
          if (settings.mode === 'push' || settings.mode === 'pull') {
            positionAttr.needsUpdate = true;
            if (forcePaint && affectedPointCount > 0) {
              setStatus(`Depth brushed ${affectedPointCount} points ${settings.mode === 'push' ? 'out' : 'in'}`);
            }
          }
          visibilityAttr.needsUpdate = true;
          syncPointIndexLabelVisibility();
        }
      }
    };

    const updateSelectedPoints = (indices: number[], append: boolean, remove: boolean) => {
      setSelectedPointIndices((prev) => mergeSelectionIndices(prev, indices, append, remove));
    };

    const selectPointAt = (clientX: number, clientY: number, append: boolean, remove: boolean) => {
      const pointer = getCanvasPointer(clientX, clientY);
      if (!pointer) return;

      const nearestHit = findNearestHit(getVisibleProjectedPointIndices(), pointer.x, pointer.y, 16);

      if (nearestHit) {
        updateSelectedPoints([nearestHit.index], append, remove);
        return;
      }

      if (!append && !remove) {
        setSelectedPointIndices([]);
      }
    };

    const selectPointsInRectangle = (dragState: SelectionDragState) => {
      const left = Math.min(dragState.startX, dragState.currentX);
      const right = Math.max(dragState.startX, dragState.currentX);
      const top = Math.min(dragState.startY, dragState.currentY);
      const bottom = Math.max(dragState.startY, dragState.currentY);

      const indices = getIndicesInRectangle(getVisibleProjectedPointIndices(), left, right, top, bottom);

      if (indices.length > 0) {
        updateSelectedPoints(indices, dragState.append, dragState.remove);
        return;
      }

      if (!dragState.append && !dragState.remove) {
        setSelectedPointIndices([]);
      }
    };

    const handleMouseDown = (e: MouseEvent) => {
      if (isPickingPointColorRef.current && e.button === 0 && !e.altKey) {
        e.preventDefault();
        const pointer = getCanvasPointer(e.clientX, e.clientY);
        if (!pointer) {
          setIsPickingPointColor(false);
          return;
        }

        let sampledHexColor: string | null = null;
        const nearestHit = findNearestHit(getVisibleProjectedPointIndices(), pointer.x, pointer.y, 16);
        if (nearestHit) {
          const sampledPoint = pointsRef.current[nearestHit.index];
          if (sampledPoint) {
            sampledHexColor = rgbToHex(sampledPoint);
          }
        }

        if (!sampledHexColor && sceneRef.current?.mesh) {
          mouse.x = (pointer.x / pointer.width) * 2 - 1;
          mouse.y = -(pointer.y / pointer.height) * 2 + 1;
          raycasterRef.current.setFromCamera(new THREE.Vector2(mouse.x, mouse.y), sceneRef.current.camera);
          const meshHits = raycasterRef.current.intersectObject(sceneRef.current.mesh);
          const uv = meshHits[0]?.uv;
          if (uv) {
            sampledHexColor = sampleSourceColorFromUv(uv.x, uv.y);
          }
        }

        setIsPickingPointColor(false);

        if (!sampledHexColor) {
          setStatus('Notice: Click a visible point or the projection mesh to sample a color');
          return;
        }

        applySelectedPointColorCallbackRef.current?.(sampledHexColor);
        return;
      }

      if (selectionModeEnabledRef.current && e.button === 0 && !e.altKey) {
        e.preventDefault();
        const pointer = getCanvasPointer(e.clientX, e.clientY);
        if (pointer) {
          setSelectionDragState({
            startX: pointer.x,
            startY: pointer.y,
            currentX: pointer.x,
            currentY: pointer.y,
            append: e.shiftKey,
            remove: e.ctrlKey || e.metaKey
          });
        }
        return;
      }

        if (brushSettingsRef.current.enabled && e.button === 0 && !e.altKey) {
        e.preventDefault();
        if (brushSettingsRef.current.mode !== 'select') {
          pushToHistory();
        }
        setIsBrushing(true);
        applyBrush(e.clientX, e.clientY, true);
      }
    };

    const handleMouseMove = (e: MouseEvent) => {
      if (e.altKey && isBrushingRef.current) {
        setIsBrushing(false);
      }

      if (selectionDragStateRef.current) {
        const pointer = getCanvasPointer(e.clientX, e.clientY);
        if (pointer) {
          setSelectionDragState((prev) => prev ? {
            ...prev,
            currentX: pointer.x,
            currentY: pointer.y
          } : prev);
        }
        return;
      }

      if (brushSettingsRef.current.enabled && !selectionModeEnabledRef.current) {
        applyBrush(e.clientX, e.clientY);
      }
    };

    const handleMouseUp = () => {
      if (selectionDragStateRef.current) {
        const dragState = selectionDragStateRef.current;
        const dragDistance = Math.hypot(
          dragState.currentX - dragState.startX,
          dragState.currentY - dragState.startY
        );

        if (dragDistance < 4) {
          const rect = getRendererRect();
          selectPointAt(rect.left + dragState.currentX, rect.top + dragState.currentY, dragState.append, dragState.remove);
        } else {
          selectPointsInRectangle(dragState);
        }

        setSelectionDragState(null);
      }

      const finishedBrushMode = brushSettingsRef.current.mode;
      if (
        isBrushingRef.current &&
        finishedBrushMode !== 'select' &&
        finishedBrushMode !== 'push' &&
        finishedBrushMode !== 'pull' &&
        finishedBrushMode !== 'paint' &&
        finishedBrushMode !== 'stamp'
      ) {
        syncPointsFromSceneState();
      }

      if (hasPendingDepthPaintSyncRef.current) {
        syncPaintedDepthImageState();
      }

      setIsBrushing(false);
    };

    renderer.domElement.addEventListener('mousedown', handleMouseDown);
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);

    const animate = () => {
      requestAnimationFrame(animate);
      controls.update();
      renderer.render(scene, camera);
    };
    animate();

    const resizeObserver = new ResizeObserver(() => {
      if (!container || !sceneRef.current) return;
      const { clientWidth, clientHeight } = container;
      sceneRef.current.camera.aspect = clientWidth / clientHeight;
      sceneRef.current.camera.updateProjectionMatrix();
      sceneRef.current.renderer.setSize(clientWidth, clientHeight);
    });
    
    resizeObserver.observe(container);

    return () => {
      controls.removeEventListener('end', handleControlsEnd);
      renderer.domElement.removeEventListener('mousedown', handleMouseDown);
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
      resizeObserver.disconnect();
      renderer.dispose();
      renderer.forceContextLoss();
      if (container.contains(renderer.domElement)) {
        container.removeChild(renderer.domElement);
      }
    };
  }, []);

  useEffect(() => {
    rebuildPointIndexLabels(points);
  }, [showPointIndices, points]);

  useEffect(() => {
    let cancelled = false;

    const restoreSession = async () => {
      try {
        if (!window.localStorage.getItem(SESSION_STORAGE_KEY)) {
          setHasSavedSession(false);
          return;
        }

        if (cancelled) return;

        await handleLoadSession(true);

        if (!cancelled) {
          setStatus(window.localStorage.getItem(SESSION_STORAGE_KEY) ? 'Session restored' : 'Ready');
        }
      } catch (error) {
        console.error(error);
        window.localStorage.removeItem(SESSION_STORAGE_KEY);
        setHasSavedSession(false);
      } finally {
        if (!cancelled) {
          hasRestoredSessionRef.current = true;
        }
      }
    };

    restoreSession();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!hasRestoredSessionRef.current) return;

    const saveTimeout = window.setTimeout(() => {
      const nextSession = createPersistedSession();
      const existingRawSession = window.localStorage.getItem(SESSION_STORAGE_KEY);
      const existingSession = existingRawSession ? JSON.parse(existingRawSession) as PersistedSession : null;

      if (!sessionHasMeaningfulContent(nextSession) && sessionHasMeaningfulContent(existingSession)) {
        return;
      }

      persistSession(nextSession);
    }, 300);

    return () => {
      window.clearTimeout(saveTimeout);
    };
  }, [
    sourceImg,
    depthImg,
    paintedDepthImg,
    points,
    stats,
    params,
    maxPointSize,
    addPointSize,
    showProjectionMesh,
    projectionMeshOpacityPercent,
    activeTool,
    toolInteractionMode,
    visibilityBrushAction,
    depthAction,
    addAction,
    addAppearanceSource,
    isPickingCloneSource,
    brushSettings,
    selectionModeEnabled,
    selectedPointIndices,
    savedSelections,
    showPointIndices,
    cameraRevision
  ]);

  useEffect(() => {
    if (!linkedDepthPsdHandleRef.current) {
      return;
    }

    const refreshInterval = window.setInterval(async () => {
      try {
        const fileHandle = linkedDepthPsdHandleRef.current;
        if (!fileHandle || isRefreshingLinkedDepthPsdRef.current) {
          return;
        }

        const file = await fileHandle.getFile();
        if (linkedDepthPsdLastModifiedRef.current === null || file.lastModified <= linkedDepthPsdLastModifiedRef.current) {
          return;
        }

        await renderLinkedDepthPsdFile(fileHandle, true);
        setStatus(`Linked PSD refreshed: ${typeof fileHandle.name === 'string' ? fileHandle.name : file.name}`);
      } catch (error) {
        console.error(error);
      }
    }, 1000);

    return () => {
      window.clearInterval(refreshInterval);
    };
  }, [linkedDepthPsdName]);

  // Capture source image pixel data so paint/stamp can sample colors
  useEffect(() => {
    if (!sourceImg || !sourceImgRef.current) {
      sourcePixelDataRef.current = null;
      return;
    }
    const img = sourceImgRef.current;
    const capture = () => {
      if (!img.naturalWidth) return;
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.drawImage(img, 0, 0);
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      sourcePixelDataRef.current = { data: imageData.data, width: canvas.width, height: canvas.height };
    };
    if (img.complete && img.naturalWidth > 0) capture();
    else img.addEventListener('load', capture, { once: true });
  }, [sourceImg]);

  useEffect(() => {
    if (!depthImg || !depthImgRef.current || !sourceImgRef.current) {
      depthPixelDataRef.current = null;
      paintedDepthCanvasRef.current = null;
      clearProjectionMesh();
      if (pointsRef.current.length > 0) {
        applyPointSnapshot(pointsRef.current.map((point) => ({ ...point })));
      }
      return;
    }

    const sourceImage = sourceImgRef.current;
    const depthImage = depthImgRef.current;

    const capture = () => {
      if (!depthImage.naturalWidth || !sourceImage.naturalWidth) return;

      const canvas = document.createElement('canvas');
      canvas.width = sourceImage.naturalWidth;
      canvas.height = sourceImage.naturalHeight;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      ctx.drawImage(depthImage, 0, 0, canvas.width, canvas.height);
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      depthPixelDataRef.current = { data: imageData.data, width: canvas.width, height: canvas.height };

      const paintedCanvas = document.createElement('canvas');
      paintedCanvas.width = canvas.width;
      paintedCanvas.height = canvas.height;
      const paintedCtx = paintedCanvas.getContext('2d', { willReadFrequently: true });
      if (!paintedCtx) return;
      paintedCtx.putImageData(imageData, 0, 0);
      paintedDepthCanvasRef.current = paintedCanvas;

      rebuildProjectionSurfaceMesh(
        { data: imageData.data, width: canvas.width, height: canvas.height },
        paramsRef.current,
        canvas.width,
        canvas.height,
        showProjectionMesh,
        projectionMeshOpacityPercent
      );

      if (pointsRef.current.length > 0) {
        applyPointSnapshot(pointsRef.current.map((point) => ({ ...point })));
      }
    };

    if (
      depthImage.complete &&
      depthImage.naturalWidth > 0 &&
      sourceImage.complete &&
      sourceImage.naturalWidth > 0
    ) {
      capture();
    } else {
      depthImage.addEventListener('load', capture, { once: true });
      sourceImage.addEventListener('load', capture, { once: true });
    }
  }, [depthImg, paintedDepthImg, sourceImg]);

  useEffect(() => {
    if (pointsRef.current.length === 0) return;
    applyPointSnapshot(pointsRef.current.map((point) => ({ ...point })));
  }, [params.depthScale, params.invertDepth, params.depthColorSpace]);

  useEffect(() => {
    if (!depthImg || !sourceImgRef.current || !depthPixelDataRef.current) return;

    const sourceImage = sourceImgRef.current;
    if (
      !sourceImage.complete ||
      sourceImage.naturalWidth === 0
    ) {
      return;
    }

    rebuildProjectionSurfaceMesh(
      depthPixelDataRef.current,
      params,
      sourceImage.naturalWidth,
      sourceImage.naturalHeight,
      showProjectionMesh,
      projectionMeshOpacityPercent
    );
  }, [
    depthImg,
    paintedDepthImg,
    sourceImg,
    params.depthScale,
    params.invertDepth,
    params.depthColorSpace,
    params.xyScale
  ]);

  // Toggle projection mesh wireframe visibility for debugging
  useEffect(() => {
    if (sceneRef.current?.mesh) {
      const mat = sceneRef.current.mesh.material as THREE.MeshBasicMaterial;
      sceneRef.current.mesh.visible = true;
      mat.opacity = showProjectionMesh ? projectionMeshOpacityPercent / 100 : 0;
    }
  }, [projectionMeshOpacityPercent, showProjectionMesh]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>, type: 'source' | 'depth') => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      if (type === 'source') setSourceImg(event.target?.result as string);
      else {
        clearLinkedDepthPsd();
        setDepthImg(event.target?.result as string);
        setPaintedDepthImg(null);
      }
    };
    reader.readAsDataURL(file);
  };

  // Live update for point size
  useEffect(() => {
    if (sceneRef.current?.points) {
      const material = sceneRef.current.points.material as THREE.ShaderMaterial;
      if (material.uniforms?.uPointSizeScale) {
        material.uniforms.uPointSizeScale.value = params.pointSizeMultiplier;
      }
    }
  }, [params.pointSizeMultiplier]);

  // Live update for max point size
  useEffect(() => {
    if (sceneRef.current?.points) {
      const material = sceneRef.current.points.material as THREE.ShaderMaterial;
      if (material.uniforms?.uMaxPointSize) {
        material.uniforms.uMaxPointSize.value = maxPointSize;
      }
    }
  }, [maxPointSize]);

  const handleAutoDepth = async () => {
    if (!sourceImgRef.current) return;
    setIsAutoDepthLoading(true);
    setStatus('Generating Depth...');
    try {
      const depthDataUrl = await getAutoDepthMap(sourceImgRef.current);
      if (depthDataUrl) {
        clearLinkedDepthPsd();
        setDepthImg(depthDataUrl);
        setPaintedDepthImg(null);
        setStatus('Success: Auto-depth generated');
      } else {
        setStatus('Notice: Auto-depth provider unavailable');
        alert('Automatic depth generation requires a local depth model (e.g., MiDaS) which is not currently installed. Please upload a depth map manually.');
      }
    } catch (err) {
      setStatus('Error: Auto-depth failed');
    } finally {
      setIsAutoDepthLoading(false);
    }
  };

  const handleGlbUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setStatus('Loading GLB...');
    const reader = new FileReader();
    reader.onload = async (event) => {
      const contents = event.target?.result as ArrayBuffer;
      const loader = new GLTFLoader();
      
      loader.parse(contents, '', (gltf: any) => {
        const importedPoints: PointData[] = [];
        
        gltf.scene.traverse((child: any) => {
          if (child.isPoints) {
            const geometry = child.geometry;
            const positions = geometry.attributes.position.array;
            const colors = geometry.attributes.color ? geometry.attributes.color.array : null;
            const uvs = geometry.attributes.uv ? geometry.attributes.uv.array : null;
            const depthSamples = geometry.attributes._depth ? geometry.attributes._depth.array : null;
            const sizes = (geometry.attributes.size || geometry.attributes._size) ? (geometry.attributes.size || geometry.attributes._size).array : null;
            const zOffsets = geometry.attributes._zOffset ? geometry.attributes._zOffset.array : null;

            for (let i = 0; i < positions.length / 3; i++) {
              importedPoints.push({
                x: positions[i * 3],
                y: positions[i * 3 + 1],
                z: positions[i * 3 + 2],
                u: uvs ? uvs[i * 2] : undefined,
                v: uvs ? uvs[i * 2 + 1] : undefined,
                depthSample: depthSamples ? depthSamples[i] : undefined,
                zOffset: zOffsets ? zOffsets[i] : 0,
                r: colors ? colors[i * 3] : 1,
                g: colors ? colors[i * 3 + 1] : 1,
                b: colors ? colors[i * 3 + 2] : 1,
                size: sizes ? sizes[i] : 1,
                visibility: 1.0,
                isAdded: false
              });
            }
          }
        });

        if (importedPoints.length > 0) {
          clearSelectionState();
          setHistory([]);
          setRedoStack([]);
          applyPointSnapshot(importedPoints);
          setStats({
            width: 0,
            height: 0,
            pointCount: importedPoints.length
          });
          setStatus(`Imported ${importedPoints.length} points`);
        } else {
          setStatus('Error: No points found in GLB');
        }
      }, (error: any) => {
        console.error(error);
        setStatus('Error parsing GLB');
      });
    };
    reader.readAsArrayBuffer(file);
  };

  const applyPointSnapshot = (nextPoints: PointData[]) => {
    const renderedPoints = materializePointsForDepth(nextPoints, paramsRef.current);
    pointsRef.current = renderedPoints;
    setPoints(renderedPoints);
    rebuildPointCloud(renderedPoints, paramsRef.current.pointSizeMultiplier, maxPointSizeRef.current);
    setStats((prev: { width: number; height: number; pointCount: number }) => ({ ...prev, pointCount: renderedPoints.length }));
  };

  const getCurrentPaintedDepthSnapshot = () => {
    if (paintedDepthCanvasRef.current) {
      return paintedDepthCanvasRef.current.toDataURL('image/png');
    }

    return paintedDepthImg;
  };

  const pushToHistory = () => {
    const currentSnapshot = createHistorySnapshot(
      sceneRef.current,
      pointsRef.current,
      selectedPointIndicesRef.current,
      getCurrentPaintedDepthSnapshot()
    );
    if (!currentSnapshot) return;
    
    setHistory((prev: HistorySnapshot[]) => [...prev.slice(-19), currentSnapshot]); // Keep last 20 steps
    setRedoStack([]); // Clear redo on new action
  };

  const handleUndo = () => {
    if (history.length === 0) return;

    const currentSnapshot = createHistorySnapshot(
      sceneRef.current,
      pointsRef.current,
      selectedPointIndicesRef.current,
      getCurrentPaintedDepthSnapshot()
    );
    if (!currentSnapshot) return;
    setRedoStack((prev: HistorySnapshot[]) => [...prev, currentSnapshot]);

    const prevSnapshot = history[history.length - 1];
    applyHistorySnapshot(prevSnapshot, applyPointSnapshot, setSelectedPointIndices, setPaintedDepthImg);
    
    setHistory((prev: HistorySnapshot[]) => prev.slice(0, -1));
  };

  const handleRedo = () => {
    if (redoStack.length === 0) return;

    const currentSnapshot = createHistorySnapshot(
      sceneRef.current,
      pointsRef.current,
      selectedPointIndicesRef.current,
      getCurrentPaintedDepthSnapshot()
    );
    if (!currentSnapshot) return;
    setHistory((prev: HistorySnapshot[]) => [...prev, currentSnapshot]);

    const nextSnapshot = redoStack[redoStack.length - 1];
    applyHistorySnapshot(nextSnapshot, applyPointSnapshot, setSelectedPointIndices, setPaintedDepthImg);

    setRedoStack((prev: HistorySnapshot[]) => prev.slice(0, -1));
  };

  useEffect(() => {
    syncSelectedPointVisibility(selectedPointIndices);
  }, [selectedPointIndices, points]);

  useKeyboardShortcuts({
    brushEnabled: brushSettings.enabled,
    isEditableTarget,
    selectionModeEnabledRef,
    hideSelectedPoints,
    adjustBrushSize,
    adjustBrushStrengthPercent,
    setBrushSoftnessPercent,
    handleUndo,
    handleRedo,
    handleSaveSessionToFile
  });

  const addNewPoints = (newPoints: PointData[]) => {
    const nextPoints = [
      ...pointsRef.current,
      ...newPoints.map((point) => ({ ...point, isAdded: true }))
    ];
    applyPointSnapshot(nextPoints);
  };

  const handleRemoveSelectedAddedPoints = () => {
    const selectedAddedIndices = selectedPointIndicesRef.current.filter((index: number) => pointsRef.current[index]?.isAdded);

    if (selectedAddedIndices.length === 0) {
      setStatus('Notice: Select added points to remove them from the added layer');
      return;
    }

    pushToHistory();
    const selectedAddedSet = new Set(selectedAddedIndices);
    const nextPoints = pointsRef.current.filter((_: PointData, index: number) => !selectedAddedSet.has(index));
    applyPointSnapshot(nextPoints);
    setSelectedPointIndices([]);
    setStatus(`Removed ${selectedAddedIndices.length} added point${selectedAddedIndices.length === 1 ? '' : 's'}`);
  };

  const handleClearAddedPoints = () => {
    const currentAddedPointCount = pointsRef.current.reduce((count: number, point: PointData) => count + (point.isAdded ? 1 : 0), 0);

    if (currentAddedPointCount === 0) {
      setStatus('Notice: No added points to clear');
      return;
    }

    pushToHistory();
    const nextPoints = pointsRef.current.filter((point: PointData) => !point.isAdded);
    applyPointSnapshot(nextPoints);
    setSelectedPointIndices([]);
    setStatus(`Cleared ${currentAddedPointCount} added point${currentAddedPointCount === 1 ? '' : 's'}`);
  };

  const applySelectedPointColor = (hexColor: string) => {
    if (selectedPointIndicesRef.current.length === 0) {
      setStatus('Notice: Select at least one point to change its color');
      return;
    }

    const parsedColor = parseHexColor(hexColor);
    if (!parsedColor) {
      setStatus('Notice: Enter a valid 6-digit hex color');
      return;
    }

    const selectedSet = new Set(selectedPointIndicesRef.current);
    const hasColorChange = selectedPointIndicesRef.current.some((index) => {
      const point = pointsRef.current[index];
      return !!point && (
        point.r !== parsedColor.r ||
        point.g !== parsedColor.g ||
        point.b !== parsedColor.b
      );
    });

    if (!hasColorChange) {
      setStatus('Notice: Selected points already use that color');
      return;
    }

    pushToHistory();
    const nextPoints = pointsRef.current.map((point, index) => (
      selectedSet.has(index)
        ? { ...point, r: parsedColor.r, g: parsedColor.g, b: parsedColor.b }
        : { ...point }
    ));
    applyPointSnapshot(nextPoints);
    setStatus(`Applied ${hexColor.toUpperCase()} to ${selectedSet.size} selected point${selectedSet.size === 1 ? '' : 's'}`);
  };

  const applyColorTransformPass = (nextPalettes: { red: string; blue: string; white: string }) => {
    if (pointsRef.current.length === 0) {
      setStatus('Notice: Generate or import points before running a color transform pass');
      return;
    }

    const parsedPalettes = {
      red: parsePaletteInput(nextPalettes.red),
      blue: parsePaletteInput(nextPalettes.blue),
      white: parsePaletteInput(nextPalettes.white)
    };

    if (parsedPalettes.red.length === 0 || parsedPalettes.blue.length === 0 || parsedPalettes.white.length === 0) {
      setStatus('Notice: Enter at least one valid hex color for red, blue, and white palettes');
      return;
    }

    setColorTransformPalettes(nextPalettes);

    const familyCounts = { red: 0, blue: 0, white: 0 };
    let changedPointCount = 0;

    const nextPoints = pointsRef.current.map((point) => {
      const pointColor = { r: point.r, g: point.g, b: point.b };
      const channelSpread = Math.max(
        Math.abs(pointColor.r - pointColor.g),
        Math.abs(pointColor.r - pointColor.b),
        Math.abs(pointColor.g - pointColor.b)
      );
      const family: 'red' | 'blue' | 'white' = channelSpread < 0.08
        ? 'white'
        : pointColor.r >= pointColor.b
          ? 'red'
          : 'blue';

      familyCounts[family] += 1;

      const nearestTarget = parsedPalettes[family].reduce((bestTarget, candidateTarget) => {
        return getColorDistance(pointColor, candidateTarget) < getColorDistance(pointColor, bestTarget)
          ? candidateTarget
          : bestTarget;
      }, parsedPalettes[family][0]);

      if (nearestTarget.r === point.r && nearestTarget.g === point.g && nearestTarget.b === point.b) {
        return { ...point };
      }

      changedPointCount += 1;
      return {
        ...point,
        r: nearestTarget.r,
        g: nearestTarget.g,
        b: nearestTarget.b
      };
    });

    if (changedPointCount === 0) {
      setStatus('Notice: The current palette pass would not change any point colors');
      return;
    }

    pushToHistory();
    applyPointSnapshot(nextPoints);
    setStatus(`Color transform applied to ${changedPointCount} points [R:${familyCounts.red} B:${familyCounts.blue} W:${familyCounts.white}]`);
  };

  applySelectedPointColorCallbackRef.current = applySelectedPointColor;

  // Keep the callback ref up to date so the Three.js closure can call addNewPoints
  useEffect(() => { addNewPointsCallbackRef.current = addNewPoints; });

  const handleGenerate = async () => {
    if (!sourceImgRef.current || !sourceImg) {
      setStatus('Error: Missing source image');
      return;
    }

    setIsProcessing(true);
    setStatus('Processing...');

    try {
      // Ensure image is actually decoded before processing
      await sourceImgRef.current.decode();
      if (depthImgRef.current && depthImg) {
        await depthImgRef.current.decode();
      }

      const result = await processImages(
        sourceImgRef.current,
        depthImgRef.current,
        params
      );
      const basePoints = result.map((point) => ({ ...point, isAdded: false }));

      clearSelectionState();
      setHistory([]);
      setRedoStack([]);
      applyPointSnapshot(basePoints);
      setStats({
        width: sourceImgRef.current.naturalWidth,
        height: sourceImgRef.current.naturalHeight,
        pointCount: basePoints.length
      });

      // Build / rebuild projection surface mesh for paint/stamp modes
      if (depthPixelDataRef.current && depthImg) {
        rebuildProjectionSurfaceMesh(
          depthPixelDataRef.current,
          params,
          sourceImgRef.current.naturalWidth,
          sourceImgRef.current.naturalHeight,
          showProjectionMesh,
          projectionMeshOpacityPercent
        );
      } else {
        clearProjectionMesh();
      }

      setStatus('Success: Points generated');
    } catch (err) {
      console.error(err);
      setStatus('Error during processing');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleExportGLB = async () => {
    if (points.length === 0) return;
    setStatus('Exporting GLB...');
    try {
      // Sync visibility from buffer attribute back to points for export
      const exportedPoints = [...points];
      if (sceneRef.current?.points) {
        const visibilityAttr = sceneRef.current.points.geometry.getAttribute('visibility');
        const positionAttr = sceneRef.current.points.geometry.getAttribute('position');
        for (let i = 0; i < exportedPoints.length; i++) {
          exportedPoints[i].visibility = visibilityAttr.getX(i);
          exportedPoints[i].x = positionAttr.getX(i);
          exportedPoints[i].y = positionAttr.getY(i);
          exportedPoints[i].z = positionAttr.getZ(i);
        }
      }

      const blob = await exportToGLB(exportedPoints);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'pointcloud.glb';
      a.click();
      setStatus('Export complete');
    } catch (err) {
      console.error(err);
      setStatus('Export failed');
    }
  };

  const handleExportJSON = () => {
    if (points.length === 0) return;
    
    // Sync visibility 
    const exportedPoints = [...points];
    if (sceneRef.current?.points) {
      const visibilityAttr = sceneRef.current.points.geometry.getAttribute('visibility');
      for (let i = 0; i < exportedPoints.length; i++) {
        exportedPoints[i].visibility = visibilityAttr.getX(i);
      }
    }

    const blob = new Blob([JSON.stringify(exportedPoints)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'pointcloud.json';
    a.click();
    setStatus('Export complete');
  };

  const fileSessionSaveSupported = typeof window !== 'undefined' && supportsFileSessionSave();
  const effectiveDepthOverlaySrc = paintedDepthImg ?? depthImg;
  const depthOverlayCanvasStyle = showDepthOverlay && effectiveDepthOverlaySrc
    ? {
        backgroundImage: `linear-gradient(rgba(0, 0, 0, ${1 - (depthOverlayOpacityPercent / 100)}), rgba(0, 0, 0, ${1 - (depthOverlayOpacityPercent / 100)})), url(${effectiveDepthOverlaySrc})`,
        backgroundPosition: 'center',
        backgroundRepeat: 'no-repeat',
        backgroundSize: 'contain'
      }
    : undefined;

  return (
    <div className="w-full h-screen bg-tech-bg text-tech-text font-sans flex flex-col overflow-hidden">
      {/* Header */}
      <header className="h-14 border-b border-tech-border flex items-center justify-between px-6 bg-tech-header">
        <div className="flex items-center gap-3">
          <div className="w-3 h-3 bg-tech-accent rounded-full shadow-[0_0_8px_rgba(242,125,38,0.5)]"></div>
          <span className="font-mono text-sm tracking-widest uppercase font-bold text-tech-text">ILLUMINATED // v1.2.0</span>
        </div>
        <div className="flex-1 px-8">
           <div className="mono-label opacity-40">Pipeline Status: <span className={status.includes('Error') ? 'text-red-500' : 'text-[#00FF41]'}>{status}</span></div>
        </div>
        <div className="flex items-center gap-3">
          <div className="hidden xl:flex items-center gap-2 text-[9px] font-mono uppercase text-tech-muted">
            <span>Session:</span>
            <span className={hasSessionFileHandle ? (isSessionDirty ? 'text-tech-accent' : 'text-[#00FF41]') : 'opacity-50'}>
              {hasSessionFileHandle ? (isSessionDirty ? 'Dirty' : 'Clean') : 'Unlinked'}
            </span>
            <span className="max-w-[180px] truncate opacity-60">{sessionFileName ?? 'No file'}</span>
          </div>
          <button
            onClick={() => handleSaveSessionToFile(!hasSessionFileHandle)}
            className={`px-3 py-1.5 border text-[10px] font-mono transition-colors uppercase tracking-widest ${isSessionDirty ? 'border-tech-accent text-tech-accent hover:bg-tech-accent/10' : 'border-tech-subtle-border hover:bg-tech-border'}`}
          >
            {hasSessionFileHandle ? 'Save Session' : 'Save Session As'}
          </button>
          <button
            onClick={handleLoadSessionFromFile}
            className="px-3 py-1.5 border border-tech-subtle-border text-[10px] font-mono hover:bg-tech-border transition-colors uppercase tracking-widest"
          >
            Load Session
          </button>
          <button
            onClick={handleForgetSessionFile}
            disabled={!hasSessionFileHandle}
            className="px-3 py-1.5 border border-tech-subtle-border text-[10px] font-mono hover:bg-tech-border transition-colors uppercase tracking-widest disabled:opacity-30"
          >
            Forget Session
          </button>
          <button 
            onClick={() => {
              setSourceImg(null);
              setDepthImg(null);
              setPaintedDepthImg(null);
              clearLinkedDepthPsd();
              setShowDepthOverlay(false);
              setDepthOverlayOpacityPercent(45);
              setPoints([]);
              pointsRef.current = [];
              setActiveTool('visibility');
              setToolInteractionMode('brush');
              setVisibilityBrushAction('hide');
              setDepthAction('push');
              setAddAction('single');
              setAddAppearanceSource('image');
              setIsPickingCloneSource(false);
              setProjectionMeshOpacityPercent(20);
              setSelectionModeEnabled(false);
              setHistory([]);
              setRedoStack([]);
              clearSelectionState();
              setStatus('Ready');
              window.localStorage.removeItem(SESSION_STORAGE_KEY);
              setHasSavedSession(false);
              if (sceneRef.current?.points) {
                sceneRef.current.scene.remove(sceneRef.current.points);
                sceneRef.current.points = null;
              }
              if (sceneRef.current?.pointIndexLabels) {
                sceneRef.current.scene.remove(sceneRef.current.pointIndexLabels);
                disposePointIndexLabels(sceneRef.current.pointIndexLabels);
                sceneRef.current.pointIndexLabels = null;
              }
              clearProjectionMesh();
            }}
            className="px-4 py-1.5 bg-transparent border border-tech-subtle-border text-[10px] font-mono hover:bg-tech-border transition-colors uppercase tracking-widest"
          >
            RESET SYSTEM
          </button>
        </div>
      </header>

      <main className="flex-1 flex overflow-hidden">
        <ControlSidebar
          activeTool={activeTool}
          addAction={addAction}
          addAppearanceSource={addAppearanceSource}
          applyColorTransformPass={applyColorTransformPass}
          addedPointCount={addedPointCount}
          cloneSourceIndex={cloneSourceIndex}
          addPointSize={addPointSize}
          brushSettings={brushSettings}
          brushDepthPercent={brushDepthPercent}
          brushSoftnessPercent={brushSoftnessPercent}
          brushStrengthPercent={brushStrengthPercent}
          colorTransformPalettes={colorTransformPalettes}
          depthAction={depthAction}
          depthImg={depthImg}
          linkedDepthPsdName={linkedDepthPsdName}
          showDepthOverlay={showDepthOverlay}
          depthOverlayOpacityPercent={depthOverlayOpacityPercent}
          handleAutoDepth={handleAutoDepth}
          handleFileChange={handleFileChange}
          handleRefreshLinkedDepthPsd={handleRefreshLinkedDepthPsd}
          handleLinkDepthPsd={handleLinkDepthPsd}
          handleGenerate={handleGenerate}
          handleGlbUpload={handleGlbUpload}
          handleRedo={handleRedo}
          handleRemoveSelectedAddedPoints={handleRemoveSelectedAddedPoints}
          handleClearAddedPoints={handleClearAddedPoints}
          handleUndo={handleUndo}
          hideSelectedPoints={hideSelectedPoints}
          historyLength={history.length}
          isAutoDepthLoading={isAutoDepthLoading}
          isProcessing={isProcessing}
          params={params}
          redoStackLength={redoStack.length}
          restoreSavedSelection={restoreSavedSelection}
          restoreSelectedPoints={restoreSelectedPoints}
          applySelectedPointColor={applySelectedPointColor}
          saveCurrentSelection={saveCurrentSelection}
          savedSelections={savedSelections}
          isPickingPointColor={isPickingPointColor}
          selectedAddedPointCount={selectedAddedPointCount}
          selectedPointColorHex={selectedPointColorHex}
          selectedPointColorMixed={selectedPointColorMixed}
          selectedPointCount={selectedPointCount}
          selectionModeEnabled={selectionModeEnabled}
          setActiveTool={setActiveTool}
          pointCount={points.length}
          setAddAction={setAddAction}
          setAddAppearanceSource={setAddAppearanceSource}
          isPickingCloneSource={isPickingCloneSource}
          setIsPickingCloneSource={setIsPickingCloneSource}
          setIsPickingPointColor={setIsPickingPointColor}
          setBrushSettings={setBrushSettings}
          setBrushDepthPercent={setBrushDepthPercent}
          setBrushSoftnessPercent={setBrushSoftnessPercent}
          setBrushStrengthPercent={setBrushStrengthPercent}
          setDepthAction={setDepthAction}
          setShowDepthOverlay={setShowDepthOverlay}
          setDepthOverlayOpacityPercent={setDepthOverlayOpacityPercent}
          setParams={setParams}
          setSelectedPointIndices={setSelectedPointIndices}
          setShowPointIndices={setShowPointIndices}
          setToolInteractionMode={setToolInteractionMode}
          setVisibilityBrushAction={setVisibilityBrushAction}
          showPointIndices={showPointIndices}
          projectionMeshOpacityPercent={projectionMeshOpacityPercent}
          setProjectionMeshOpacityPercent={setProjectionMeshOpacityPercent}
          toolInteractionMode={toolInteractionMode}
          sourceImg={sourceImg}
          updateSavedSelectionName={updateSavedSelectionName}
          deleteSavedSelection={deleteSavedSelection}
          visibilityBrushAction={visibilityBrushAction}
          maxPointSize={maxPointSize}
          setMaxPointSize={setMaxPointSize}
          setAddPointSize={setAddPointSize}
          showProjectionMesh={showProjectionMesh}
          setShowProjectionMesh={setShowProjectionMesh}
        />

        {/* Right Content: Previews & Visualizers */}
        <div className="flex-1 flex flex-col p-3 gap-3 bg-tech-main overflow-hidden min-h-0">
          {/* Main 3D Viewport - Takes most space */}
          <div className="flex-1 relative border border-tech-border rounded overflow-hidden bg-black flex flex-col shadow-inner min-h-0">
            <div className="absolute top-3 left-4 z-10 mono-label opacity-40 pointer-events-none tracking-[0.2em]">3D // SPATIAL_VISUALIZER</div>
            
            {/* Stats Overlay */}
            <div className="absolute top-3 right-4 z-10 flex flex-col items-end pointer-events-none gap-1 bg-black/40 backdrop-blur-sm p-1 px-2 rounded border border-tech-border/30">
              <div className="flex gap-4">
                <span className="mono-value text-[9px] opacity-60">RESOLUTION: {stats.width}x{stats.height}</span>
                <span className="mono-value text-[9px] text-tech-accent font-bold">NODES: {stats.pointCount.toLocaleString()}</span>
              </div>
              <div className="mono-value text-[9px] opacity-60">SELECTED: {selectedPointCount.toLocaleString()}</div>
            </div>

            {/* Three.js Canvas */}
            <div ref={canvasRef} style={depthOverlayCanvasStyle} className={`relative z-[1] flex-1 w-full h-full ${selectionModeEnabled ? 'cursor-default' : brushSettings.enabled ? 'cursor-none' : 'cursor-move'} ${showDepthOverlay && effectiveDepthOverlaySrc ? 'bg-transparent' : 'bg-[radial-gradient(#1a1a1a_1.2px,transparent_1.2px)] [background-size:24px_24px]'}`} />

            {selectionRect && (
              <div
                className="absolute border border-tech-accent bg-tech-accent/10 pointer-events-none"
                style={{
                  left: `${selectionRect.left}px`,
                  top: `${selectionRect.top}px`,
                  width: `${selectionRect.width}px`,
                  height: `${selectionRect.height}px`
                }}
              />
            )}
            
            {/* Legend / Status Inlay */}
            <div className="absolute bottom-4 left-4 z-10 p-2 bg-tech-sidebar/90 border border-tech-border backdrop-blur-md pointer-events-none flex items-center gap-3">
               <div className="flex items-center gap-2">
                  <div className="w-2 h-2 bg-tech-accent rounded-full animate-pulse shadow-[0_0_8px_rgba(242,125,38,0.4)]" />
                  <span className="mono-label text-[8px] tracking-widest">PROJECTION_ACTIVE</span>
               </div>
               <div className="w-px h-3 bg-tech-border" />
               <div className="mono-value text-[9px] opacity-40">WEBGL_ACCELERATED_CORE</div>
            </div>

            <button
              onClick={handleGenerate}
              disabled={isProcessing || !sourceImg}
              className="absolute bottom-4 right-4 z-10 px-4 py-2 bg-tech-accent text-black font-bold text-[10px] tracking-widest uppercase hover:bg-white disabled:opacity-30 disabled:cursor-not-allowed transition-all active:scale-[0.98] border border-black/10"
            >
              {isProcessing ? 'SYSTEM_RUNNING...' : 'Generate Point Cloud'}
            </button>
          </div>

          {/* Bottom Panels: Logs & Actions */}
          <div className="h-44 border border-tech-border bg-tech-sidebar flex animate-in slide-in-from-bottom-4 duration-500 rounded-sm">
            {/* Logs Area */}
            <div className="w-2/3 p-3 border-r border-tech-border flex flex-col overflow-hidden">
              <div className="mono-label text-tech-muted mb-2 tracking-[0.1em] flex justify-between">
                <span>Output Logs</span>
                <span className="opacity-20">SYSTEM_STREAM_ACTIVE</span>
              </div>
              <div className="flex-1 font-mono text-[10px] text-[#44BB44] space-y-1 overflow-y-auto scrollbar-hide">
                <div className="flex gap-2">
                  <span className="opacity-40">[{new Date().toLocaleTimeString([], {hour:'2-digit', minute:'2-digit', second:'2-digit'})}]</span>
                  <span>System initialized. Root node active.</span>
                </div>
                {points.length > 0 && (
                  <>
                    <div className="flex gap-2">
                      <span className="opacity-40">[{new Date().toLocaleTimeString()}]</span>
                      <span>Point count generated: {stats.pointCount} nodes.</span>
                    </div>
                    <div className="flex gap-2">
                      <span className="opacity-40">[{new Date().toLocaleTimeString()}]</span>
                      <span>Transform matrix applied successfully.</span>
                    </div>
                  </>
                )}
                {isProcessing && (
                  <div className="flex gap-2 text-white animate-pulse">
                    <span className="opacity-40">[{new Date().toLocaleTimeString()}]</span>
                    <span>Sampling pixel data... Buffer overflow protected.</span>
                  </div>
                )}
                <div className="opacity-40 border-t border-tech-border/30 mt-2 pt-2">Awaiting user command...</div>
              </div>
            </div>

            {/* Actions Area */}
            <div className="w-1/3 p-4 flex flex-col justify-between whitespace-nowrap overflow-hidden">
               <div className="space-y-1">
                 <div className="flex justify-between text-[10px] font-mono"><span className="text-tech-muted uppercase">VERTS:</span><span>{stats.pointCount.toLocaleString()}</span></div>
                 <div className="flex justify-between text-[10px] font-mono"><span className="text-tech-muted uppercase">LOAD:</span><span>{(stats.pointCount * 0.0001).toFixed(1)} MB</span></div>
                 <div className="flex justify-between text-[10px] font-mono"><span className="text-tech-muted uppercase">TIME:</span><span>{isProcessing ? '--' : '1.4s'}</span></div>
               </div>
               <div className="flex flex-col gap-2 mt-4">
                 <button 
                  onClick={handleExportJSON}
                  disabled={points.length === 0}
                  className="w-full py-2 bg-tech-border border border-tech-subtle-border text-[9px] font-mono uppercase hover:border-tech-accent transition-all disabled:opacity-30"
                 >
                   Export JSON
                 </button>
                 <button 
                  onClick={handleExportGLB}
                  disabled={points.length === 0}
                  className="w-full py-2 bg-tech-accent/10 border border-tech-accent text-tech-accent text-[9px] font-mono uppercase hover:bg-tech-accent hover:text-black transition-all font-bold disabled:opacity-30"
                 >
                   Export GLB Model
                 </button>
               </div>
            </div>
          </div>
        </div>
      </main>

      {/* Footer Status Bar */}
      <footer className="h-8 border-t border-tech-border bg-tech-bg flex items-center px-4 justify-between text-[9px] font-mono text-tech-muted uppercase overflow-hidden">
        <div className="flex gap-6">
          <span className="flex items-center gap-1.5"><div className="w-1 h-1 bg-[#00FF41] rounded-full" /> NODE_STATE: STABLE</span>
          <span>PROCESS_ID: {Math.random().toString(36).substring(2, 8).toUpperCase()}</span>
          <span>PROVIDER: {(depthImg && !isAutoDepthLoading) ? 'MANUAL_MAP' : isAutoDepthLoading ? 'AUTO_GENERATING' : 'READY'}</span>
          <span>SESSION: LOCAL_AUTOSAVE</span>
          <span>FILE_SESSION: {hasSessionFileHandle ? (isSessionDirty ? 'DIRTY' : 'CLEAN') : 'UNLINKED'}</span>
        </div>
        <div className="flex gap-4 items-center">
          <span className="text-tech-accent">SYSTEM READY</span>
          <span className="bg-tech-border px-2 py-0.5 text-tech-text">IDLE_STATE</span>
        </div>
      </footer>

      {/* Hidden Assets */}
      <div className="hidden">
        <input
          ref={sessionFileInputRef}
          type="file"
          accept=".json,application/json,text/json"
          onChange={handleSessionFileInputChange}
        />
        <img ref={sourceImgRef} src={sourceImg || undefined} alt="hidden source" />
        <img ref={depthImgRef} src={(paintedDepthImg ?? depthImg) || undefined} alt="hidden depth" />
      </div>
    </div>
  );
}
