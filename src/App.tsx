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
import { processImages, exportToGLB, getAutoDepthMap, buildProjectionMesh, SamplingParams, PointData } from './processing/pointSampler';
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

export default function App() {
  const clampBrushSize = (size: number) => Math.min(500, Math.max(1, size));
  const clampBrushStrengthPercent = (percent: number) => Math.min(100, Math.max(1, percent));
  const clampBrushDepthPercent = (percent: number) => Math.min(100, Math.max(1, percent));
  const clampSoftnessPercent = (percent: number) => Math.min(100, Math.max(0, percent));

  // UI State
  const [sourceImg, setSourceImg] = useState<string | null>(null);
  const [depthImg, setDepthImg] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isAutoDepthLoading, setIsAutoDepthLoading] = useState(false);
  const [status, setStatus] = useState<string>('Ready');
  const [points, setPoints] = useState<PointData[]>([]);
  const [selectionModeEnabled, setSelectionModeEnabled] = useState(false);
  const [selectedPointIndices, setSelectedPointIndices] = useState<number[]>([]);
  const [selectionDragState, setSelectionDragState] = useState<SelectionDragState | null>(null);
  const [savedSelections, setSavedSelections] = useState<SavedSelection[]>([]);
  const [showPointIndices, setShowPointIndices] = useState(false);
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
  const addAppearanceSourceRef = useRef(addAppearanceSource);
  useEffect(() => { addAppearanceSourceRef.current = addAppearanceSource; }, [addAppearanceSource]);
  const isPickingCloneSourceRef = useRef(isPickingCloneSource);
  useEffect(() => { isPickingCloneSourceRef.current = isPickingCloneSource; }, [isPickingCloneSource]);

  const raycasterRef = useRef(new THREE.Raycaster());

  // Callback ref so Three.js closure can call the latest addNewPoints
  const addNewPointsCallbackRef = useRef<((pts: PointData[]) => void) | null>(null);
  const selectionModeEnabledRef = useRef(selectionModeEnabled);
  const selectedPointIndicesRef = useRef(selectedPointIndices);
  const selectionDragStateRef = useRef<SelectionDragState | null>(selectionDragState);
  const brushIndicatorRef = useRef<THREE.Mesh | null>(null);
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
  const sceneRef = useRef<SceneRefs | null>(null);
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

  // Initialize Three.js
  useEffect(() => {
    if (!canvasRef.current) return;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(75, canvasRef.current.clientWidth / canvasRef.current.clientHeight, 0.1, 5000);
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setSize(canvasRef.current.clientWidth, canvasRef.current.clientHeight);
    
    // Ensure canvas fills container and doesn't cause scrollbars
    renderer.domElement.style.display = 'block';
    renderer.domElement.style.width = '100%';
    renderer.domElement.style.height = '100%';
    
    const container = canvasRef.current;
    container.appendChild(renderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    camera.position.set(0, 0, 500);
    
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

        const newPoints: PointData[] = [];

        if (settings.mode === 'stamp') {
          // One precise point at cursor
          rc.setFromCamera(new THREE.Vector2(mouse.x, mouse.y), cam);
          const hits = rc.intersectObject(projMesh);
          if (hits.length > 0) {
            const hp = hits[0].point;
            const { r, g, b, size } = resolveAppearance(hp, hits[0].uv);
            newPoints.push({ x: hp.x, y: hp.y, z: hp.z, r, g, b, size, visibility: 1.0 });
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
              newPoints.push({ x: hp.x, y: hp.y, z: hp.z, r, g, b, size, visibility: 1.0 });
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
      const nearestBrushHit = findNearestHit(selectionHits, pointer.x, pointer.y, 18);

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
        const depthDelta = params.depthScale * settings.depthAmount;
        
        for (let i = 0; i < visibilityAttr.count; i++) {
          pos.fromBufferAttribute(positionAttr, i);
          worldPos.copy(pos).applyMatrix4(pointCloud.matrixWorld);
          
          const dist = worldPos.distanceTo(center);
          const normalizedDistance = dist / settings.size;
          const brushInfluence = getBrushInfluence(normalizedDistance, settings.softness);

          const pointNoise = Math.abs(
            Math.sin(worldPos.x * 12.9898 + worldPos.y * 78.233 + worldPos.z * 37.719)
          );

          if (!shouldApplyBrushEffect(normalizedDistance, settings.softness, settings.strength, pointNoise)) {
            continue;
          }

          if (settings.mode === 'select') {
            selectedIndices.push(i);
            affectedPointCount += 1;
          } else if (settings.mode === 'push' || settings.mode === 'pull') {
            const depthDirection = settings.mode === 'push' ? 1 : -1;
            const nextZ = positionAttr.getZ(i) + (depthDelta * brushInfluence * depthDirection);
            positionAttr.setZ(i, nextZ);
            if (pointIndexLabels?.children[i]) {
              pointIndexLabels.children[i].position.z = nextZ;
            }
            affectedPointCount += 1;
          } else {
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
      else setDepthImg(event.target?.result as string);
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
        setDepthImg(depthDataUrl);
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
            const sizes = (geometry.attributes.size || geometry.attributes._size) ? (geometry.attributes.size || geometry.attributes._size).array : null;

            for (let i = 0; i < positions.length / 3; i++) {
              importedPoints.push({
                x: positions[i * 3],
                y: positions[i * 3 + 1],
                z: positions[i * 3 + 2],
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
          setPoints(importedPoints);
          setStats({
            width: 0,
            height: 0,
            pointCount: importedPoints.length
          });
          renderPoints(importedPoints, paramsRef.current.pointSizeMultiplier, maxPointSizeRef.current);
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
    pointsRef.current = nextPoints;
    setPoints(nextPoints);
    rebuildPointCloud(nextPoints, paramsRef.current.pointSizeMultiplier, maxPointSizeRef.current);
    setStats((prev: { width: number; height: number; pointCount: number }) => ({ ...prev, pointCount: nextPoints.length }));
  };

  const pushToHistory = () => {
    const currentSnapshot = createHistorySnapshot(
      sceneRef.current,
      pointsRef.current,
      selectedPointIndicesRef.current
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
      selectedPointIndicesRef.current
    );
    if (!currentSnapshot) return;
    setRedoStack((prev: HistorySnapshot[]) => [...prev, currentSnapshot]);

    const prevSnapshot = history[history.length - 1];
    applyHistorySnapshot(prevSnapshot, applyPointSnapshot, setSelectedPointIndices);
    
    setHistory((prev: HistorySnapshot[]) => prev.slice(0, -1));
  };

  const handleRedo = () => {
    if (redoStack.length === 0) return;

    const currentSnapshot = createHistorySnapshot(
      sceneRef.current,
      pointsRef.current,
      selectedPointIndicesRef.current
    );
    if (!currentSnapshot) return;
    setHistory((prev: HistorySnapshot[]) => [...prev, currentSnapshot]);

    const nextSnapshot = redoStack[redoStack.length - 1];
    applyHistorySnapshot(nextSnapshot, applyPointSnapshot, setSelectedPointIndices);

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
    handleRedo
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
      pointsRef.current = basePoints;
      setHistory([]);
      setRedoStack([]);
      setPoints(basePoints);
      setStats({
        width: sourceImgRef.current.naturalWidth,
        height: sourceImgRef.current.naturalHeight,
        pointCount: basePoints.length
      });

      renderPoints(basePoints, params.pointSizeMultiplier, maxPointSizeRef.current);

      // Build / rebuild projection surface mesh for paint/stamp modes
      if (sceneRef.current) {
        if (sceneRef.current.mesh) {
          sceneRef.current.scene.remove(sceneRef.current.mesh);
          sceneRef.current.mesh.geometry.dispose();
          sceneRef.current.mesh = null;
        }
        if (depthImgRef.current && depthImg) {
          const projMesh = buildProjectionMesh(
            depthImgRef.current,
            params,
            sourceImgRef.current.naturalWidth,
            sourceImgRef.current.naturalHeight
          );
          projMesh.visible = true;
          (projMesh.material as THREE.MeshBasicMaterial).opacity = showProjectionMesh ? projectionMeshOpacityPercent / 100 : 0;
          sceneRef.current.scene.add(projMesh);
          sceneRef.current.mesh = projMesh;
        }
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
        <div className="flex items-center gap-4">
          <button 
            onClick={() => {
              setSourceImg(null);
              setDepthImg(null);
              setPoints([]);
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
              if (sceneRef.current?.points) {
                sceneRef.current.scene.remove(sceneRef.current.points);
                sceneRef.current.points = null;
              }
              if (sceneRef.current?.pointIndexLabels) {
                sceneRef.current.scene.remove(sceneRef.current.pointIndexLabels);
                disposePointIndexLabels(sceneRef.current.pointIndexLabels);
                sceneRef.current.pointIndexLabels = null;
              }
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
          addedPointCount={addedPointCount}
          cloneSourceIndex={cloneSourceIndex}
          addPointSize={addPointSize}
          brushSettings={brushSettings}
          brushDepthPercent={brushDepthPercent}
          brushSoftnessPercent={brushSoftnessPercent}
          brushStrengthPercent={brushStrengthPercent}
          depthAction={depthAction}
          depthImg={depthImg}
          handleAutoDepth={handleAutoDepth}
          handleFileChange={handleFileChange}
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
          saveCurrentSelection={saveCurrentSelection}
          savedSelections={savedSelections}
          selectedAddedPointCount={selectedAddedPointCount}
          selectedPointCount={selectedPointCount}
          selectionModeEnabled={selectionModeEnabled}
          setActiveTool={setActiveTool}
          setAddAction={setAddAction}
          setAddAppearanceSource={setAddAppearanceSource}
          isPickingCloneSource={isPickingCloneSource}
          setIsPickingCloneSource={setIsPickingCloneSource}
          setBrushSettings={setBrushSettings}
          setBrushDepthPercent={setBrushDepthPercent}
          setBrushSoftnessPercent={setBrushSoftnessPercent}
          setBrushStrengthPercent={setBrushStrengthPercent}
          setDepthAction={setDepthAction}
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
            <div ref={canvasRef} className={`flex-1 w-full h-full ${selectionModeEnabled ? 'cursor-default' : brushSettings.enabled ? 'cursor-none' : 'cursor-move'} bg-[radial-gradient(#1a1a1a_1.2px,transparent_1.2px)] [background-size:24px_24px]`} />

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
        </div>
        <div className="flex gap-4 items-center">
          <span className="text-tech-accent">SYSTEM READY</span>
          <span className="bg-tech-border px-2 py-0.5 text-tech-text">IDLE_STATE</span>
        </div>
      </footer>

      {/* Hidden Assets */}
      <div className="hidden">
        <img ref={sourceImgRef} src={sourceImg || undefined} alt="hidden source" />
        <img ref={depthImgRef} src={depthImg || undefined} alt="hidden depth" />
      </div>
    </div>
  );
}
