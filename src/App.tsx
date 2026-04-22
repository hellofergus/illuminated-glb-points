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
import { processImages, exportToGLB, getAutoDepthMap, SamplingParams, PointData } from './processing/pointSampler';
import { BrushMode, findNearestHit, getIndicesInRectangle, mergeSelectionIndices, shouldApplyBrushEffect, type ScreenPointHit } from './processing/pointInteraction';
import { ControlSidebar } from './components/ControlSidebar';

type SavedSelection = {
  id: string;
  name: string;
  indices: number[];
};

type SelectionDragState = {
  startX: number;
  startY: number;
  currentX: number;
  currentY: number;
  append: boolean;
  remove: boolean;
};

export default function App() {
  const clampBrushSize = (size: number) => Math.min(500, Math.max(1, size));
  const clampBrushStrengthPercent = (percent: number) => Math.min(100, Math.max(1, percent));
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

  // Brush State
  const [brushSettings, setBrushSettings] = useState({
    enabled: false,
    size: 20,
    strength: 1.0,
    softness: 0.5,
    mode: 'hide' as BrushMode
  });
  const [isBrushing, setIsBrushing] = useState(false);
  const [isAltNavigationActive, setIsAltNavigationActive] = useState(false);

  // History State
  const [history, setHistory] = useState<Float32Array[]>([]);
  const [redoStack, setRedoStack] = useState<Float32Array[]>([]);

  // Sync refs to avoid stale closures in event listeners
  const brushSettingsRef = useRef(brushSettings);
  const isBrushingRef = useRef(isBrushing);
  const isAltNavigationRef = useRef(isAltNavigationActive);
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

  const isEditableTarget = (target: EventTarget | null) => {
    return target instanceof HTMLElement && (
      target.isContentEditable ||
      target.tagName === 'INPUT' ||
      target.tagName === 'TEXTAREA' ||
      target.tagName === 'SELECT'
    );
  };

  const createSavedSelectionId = () => {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }

    return `selection-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
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

  // Parameters
  const [params, setParams] = useState<SamplingParams>({
    samplingMode: 'stochastic',
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

  // Refs
  const canvasRef = useRef<HTMLDivElement>(null);
  const sourceImgRef = useRef<HTMLImageElement>(null);
  const depthImgRef = useRef<HTMLImageElement>(null);
  const sceneRef = useRef<{
    scene: THREE.Scene;
    camera: THREE.PerspectiveCamera;
    renderer: THREE.WebGLRenderer;
    controls: OrbitControls;
    points: THREE.Points | null;
    pointIndexLabels: THREE.Group | null;
  } | null>(null);
  const brushStrengthPercent = Math.round(brushSettings.strength * 100);
  const brushSoftnessPercent = Math.round(brushSettings.softness * 100);
  const sortedSelectedPointIndices = [...selectedPointIndices].sort((left, right) => left - right);
  const selectedPointCount = sortedSelectedPointIndices.length;
  const selectionRect = selectionDragState ? {
    left: Math.min(selectionDragState.startX, selectionDragState.currentX),
    top: Math.min(selectionDragState.startY, selectionDragState.currentY),
    width: Math.abs(selectionDragState.currentX - selectionDragState.startX),
    height: Math.abs(selectionDragState.currentY - selectionDragState.startY)
  } : null;

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

    sceneRef.current = { scene, camera, renderer, controls, points: null, pointIndexLabels: null };

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

        const center = new THREE.Vector3().fromBufferAttribute(positionAttr, nearestBrushHit.index).applyMatrix4(pointCloud.matrixWorld);
        const pos = new THREE.Vector3();
        const worldPos = new THREE.Vector3();
        const selectedIndices: number[] = [];
        
        for (let i = 0; i < visibilityAttr.count; i++) {
          pos.fromBufferAttribute(positionAttr, i);
          worldPos.copy(pos).applyMatrix4(pointCloud.matrixWorld);
          
          const dist = worldPos.distanceTo(center);
          const normalizedDistance = dist / settings.size;

          const pointNoise = Math.abs(
            Math.sin(worldPos.x * 12.9898 + worldPos.y * 78.233 + worldPos.z * 37.719)
          );

          if (!shouldApplyBrushEffect(normalizedDistance, settings.softness, settings.strength, pointNoise)) {
            continue;
          }

          if (settings.mode === 'select') {
            selectedIndices.push(i);
          } else {
            visibilityAttr.setX(i, settings.mode === 'hide' ? 0.0 : 1.0);
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
                visibility: 1.0
              });
            }
          }
        });

        if (importedPoints.length > 0) {
          clearSelectionState();
          setPoints(importedPoints);
          setStats({
            width: 0,
            height: 0,
            pointCount: importedPoints.length
          });
          renderPoints(importedPoints);
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

  const pushToHistory = () => {
    if (!sceneRef.current?.points) return;
    const visibilityAttr = sceneRef.current.points.geometry.getAttribute('visibility') as THREE.BufferAttribute;
    const currentBuffer = new Float32Array(visibilityAttr.array);
    
    setHistory(prev => [...prev.slice(-19), currentBuffer]); // Keep last 20 steps
    setRedoStack([]); // Clear redo on new action
  };

  const handleUndo = () => {
    if (history.length === 0 || !sceneRef.current?.points) return;
    
    const visibilityAttr = sceneRef.current.points.geometry.getAttribute('visibility') as THREE.BufferAttribute;
    const currentBuffer = new Float32Array(visibilityAttr.array);
    setRedoStack(prev => [...prev, currentBuffer]);

    const prevBuffer = history[history.length - 1];
    visibilityAttr.array.set(prevBuffer);
    visibilityAttr.needsUpdate = true;
    syncPointIndexLabelVisibility();
    
    setHistory(prev => prev.slice(0, -1));
  };

  const handleRedo = () => {
    if (redoStack.length === 0 || !sceneRef.current?.points) return;

    const visibilityAttr = sceneRef.current.points.geometry.getAttribute('visibility') as THREE.BufferAttribute;
    const currentBuffer = new Float32Array(visibilityAttr.array);
    setHistory(prev => [...prev, currentBuffer]);

    const nextBuffer = redoStack[redoStack.length - 1];
    visibilityAttr.array.set(nextBuffer);
    visibilityAttr.needsUpdate = true;
    syncPointIndexLabelVisibility();

    setRedoStack(prev => prev.slice(0, -1));
  };

  const syncSelectedPointVisibility = (indices: number[]) => {
    if (!sceneRef.current?.points) return;

    const selectedAttr = sceneRef.current.points.geometry.getAttribute('selected') as THREE.BufferAttribute | undefined;
    if (!selectedAttr) return;

    const selectedArray = selectedAttr.array as Float32Array;
    selectedArray.fill(0);

    indices.forEach((index) => {
      if (index >= 0 && index < selectedAttr.count) {
        selectedAttr.setX(index, 1);
      }
    });

    selectedAttr.needsUpdate = true;
  };

  const clearSelectionState = () => {
    setSelectedPointIndices([]);
    setSavedSelections([]);
  };

  const restoreSavedSelection = (indices: number[]) => {
    const validIndices = indices
      .filter((index) => index >= 0 && index < points.length)
      .sort((left, right) => left - right);

    setSelectedPointIndices(validIndices);
    if (validIndices.length > 0) {
      setSelectionModeEnabled(true);
      setBrushSettings((prev) => ({ ...prev, enabled: false }));
      setStatus(`Selection restored (${validIndices.length} points)`);
    }
  };

  const saveCurrentSelection = () => {
    if (selectedPointIndicesRef.current.length === 0) {
      setStatus('Notice: No points selected');
      return;
    }

    const nextSelection: SavedSelection = {
      id: createSavedSelectionId(),
      name: `Selection ${savedSelections.length + 1}`,
      indices: [...selectedPointIndicesRef.current].sort((left, right) => left - right)
    };

    setSavedSelections((prev) => [...prev, nextSelection]);
    setStatus(`Saved ${nextSelection.name}`);
  };

  const updateSavedSelectionName = (selectionId: string, name: string) => {
    setSavedSelections((prev) => prev.map((selection) => (
      selection.id === selectionId ? { ...selection, name } : selection
    )));
  };

  const deleteSavedSelection = (selectionId: string) => {
    setSavedSelections((prev) => prev.filter((selection) => selection.id !== selectionId));
  };

  const applyVisibilityToSelectedPoints = (visibility: 0 | 1, statusMessage: string) => {
    if (!sceneRef.current?.points || selectedPointIndicesRef.current.length === 0) {
      setStatus('Notice: No points selected');
      return;
    }

    pushToHistory();

    const visibilityAttr = sceneRef.current.points.geometry.getAttribute('visibility') as THREE.BufferAttribute;
    selectedPointIndicesRef.current.forEach((index) => {
      if (index >= 0 && index < visibilityAttr.count) {
        visibilityAttr.setX(index, visibility);
      }
    });

    visibilityAttr.needsUpdate = true;
    syncPointIndexLabelVisibility();
    setStatus(statusMessage);
  };

  const hideSelectedPoints = () => {
    applyVisibilityToSelectedPoints(0, 'Selected points hidden');
  };

  const restoreSelectedPoints = () => {
    applyVisibilityToSelectedPoints(1, 'Selected points restored');
  };

  useEffect(() => {
    syncSelectedPointVisibility(selectedPointIndices);
  }, [selectedPointIndices, points]);

  useEffect(() => {
    const handleShortcutKeyDown = (event: KeyboardEvent) => {
      if (isEditableTarget(event.target)) return;

      if (event.ctrlKey && !event.altKey && !event.metaKey && event.key.toLowerCase() === 'z') {
        event.preventDefault();
        if (event.shiftKey) {
          handleRedo();
        } else {
          handleUndo();
        }
        return;
      }

      if (selectionModeEnabledRef.current && event.key === 'Backspace') {
        event.preventDefault();
        hideSelectedPoints();
        return;
      }

      if (!brushSettings.enabled || event.altKey || event.metaKey) return;

      if (event.key === '[') {
        event.preventDefault();
        adjustBrushSize(-5);
        return;
      }

      if (event.key === ']') {
        event.preventDefault();
        adjustBrushSize(5);
        return;
      }

      if (event.key === ',') {
        event.preventDefault();
        adjustBrushStrengthPercent(-5);
        return;
      }

      if (event.key === '.') {
        event.preventDefault();
        adjustBrushStrengthPercent(5);
        return;
      }

      if (!event.ctrlKey && /^[0-9]$/.test(event.key)) {
        event.preventDefault();
        setBrushSoftnessPercent(event.key === '0' ? 100 : Number(event.key) * 10);
      }
    };

    window.addEventListener('keydown', handleShortcutKeyDown);

    return () => {
      window.removeEventListener('keydown', handleShortcutKeyDown);
    };
  }, [brushSettings.enabled, handleRedo, handleUndo]);

  const disposePointIndexLabels = (labelGroup: THREE.Group | null) => {
    if (!labelGroup) return;

    labelGroup.children.forEach((child) => {
      const sprite = child as THREE.Sprite;
      const material = sprite.material as THREE.SpriteMaterial;
      material.map?.dispose();
      material.dispose();
    });
  };

  const rebuildPointIndexLabels = (targetPoints: PointData[]) => {
    if (!sceneRef.current) return;

    if (sceneRef.current.pointIndexLabels) {
      sceneRef.current.scene.remove(sceneRef.current.pointIndexLabels);
      disposePointIndexLabels(sceneRef.current.pointIndexLabels);
      sceneRef.current.pointIndexLabels = null;
    }

    if (!showPointIndices || targetPoints.length === 0) return;

    const labelGroup = createPointIndexLabels(targetPoints);
    sceneRef.current.scene.add(labelGroup);
    sceneRef.current.pointIndexLabels = labelGroup;
    syncPointIndexLabelVisibility();
  };

  const syncPointIndexLabelVisibility = () => {
    if (!sceneRef.current?.points || !sceneRef.current.pointIndexLabels) return;

    const visibilityAttr = sceneRef.current.points.geometry.getAttribute('visibility') as THREE.BufferAttribute;
    sceneRef.current.pointIndexLabels.children.forEach((child, index) => {
      child.visible = visibilityAttr.getX(index) >= 0.5;
    });
  };

  const createPointIndexLabels = (targetPoints: PointData[]) => {
    const labelGroup = new THREE.Group();
    labelGroup.visible = showPointIndices;

    targetPoints.forEach((point, index) => {
      const canvas = document.createElement('canvas');
      canvas.width = 128;
      canvas.height = 64;
      const ctx = canvas.getContext('2d');

      if (!ctx) return;

      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = 'rgba(11, 13, 16, 0.82)';
      ctx.fillRect(8, 8, canvas.width - 16, canvas.height - 16);
      ctx.strokeStyle = 'rgba(242, 125, 38, 0.95)';
      ctx.lineWidth = 2;
      ctx.strokeRect(8, 8, canvas.width - 16, canvas.height - 16);
      ctx.fillStyle = '#f7f3ea';
      ctx.font = 'bold 28px monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(index), canvas.width / 2, canvas.height / 2);

      const texture = new THREE.CanvasTexture(canvas);
      texture.needsUpdate = true;

      const material = new THREE.SpriteMaterial({
        map: texture,
        transparent: true,
        depthTest: false,
        depthWrite: false,
        sizeAttenuation: true
      });

      const sprite = new THREE.Sprite(material);
      sprite.position.set(point.x, point.y + Math.max(point.size * 4, 4), point.z);
      sprite.scale.set(10, 5, 1);
      sprite.renderOrder = 10;
      labelGroup.add(sprite);
    });

    return labelGroup;
  };

  const renderPoints = (targetPoints: PointData[]) => {
    if (!sceneRef.current) return;
    
    // Cleanup previous points
    if (sceneRef.current.points) {
      sceneRef.current.scene.remove(sceneRef.current.points);
    }
    if (sceneRef.current.pointIndexLabels) {
      sceneRef.current.scene.remove(sceneRef.current.pointIndexLabels);
      disposePointIndexLabels(sceneRef.current.pointIndexLabels);
      sceneRef.current.pointIndexLabels = null;
    }

    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(targetPoints.length * 3);
    const colors = new Float32Array(targetPoints.length * 3);
    const sizes = new Float32Array(targetPoints.length);
    const selected = new Float32Array(targetPoints.length);
    const visibilities = new Float32Array(targetPoints.length);

    targetPoints.forEach((p, i) => {
      positions[i * 3] = p.x;
      positions[i * 3 + 1] = p.y;
      positions[i * 3 + 2] = p.z;
      colors[i * 3] = p.r;
      colors[i * 3 + 1] = p.g;
      colors[i * 3 + 2] = p.b;
      sizes[i] = p.size || 1.0;
      visibilities[i] = p.visibility ?? 1.0;
    });

    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geometry.setAttribute('size', new THREE.BufferAttribute(sizes, 1));
    geometry.setAttribute('selected', new THREE.BufferAttribute(selected, 1));
    geometry.setAttribute('visibility', new THREE.BufferAttribute(visibilities, 1));

    const material = new THREE.ShaderMaterial({
      uniforms: {
        uPointSizeScale: { value: params.pointSizeMultiplier },
        uMaxPointSize: { value: maxPointSizeRef.current }
      },
      vertexShader: `
        uniform float uPointSizeScale;
        uniform float uMaxPointSize;
        attribute float size;
        attribute float selected;
        attribute float visibility;
        varying vec3 vColor;
        varying float vSelected;
        varying float vVisibility;
        void main() {
          vColor = color;
          vSelected = selected;
          vVisibility = visibility;
          vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = min(size * uPointSizeScale * mix(1.0, 1.75, selected) * (500.0 / -mvPosition.z), uMaxPointSize);
          gl_Position = projectionMatrix * mvPosition;
        }
      `,
      fragmentShader: `
        varying vec3 vColor;
        varying float vSelected;
        varying float vVisibility;
        void main() {
          if (length(gl_PointCoord - vec2(0.5, 0.5)) > 0.5) discard;

          bool isHidden = vVisibility < 0.5;
          bool isSelected = vSelected > 0.5;

          if (isHidden && !isSelected) discard;
          
          vec3 visibleSelectionColor = vec3(1.0, 0.55, 0.12);
          vec3 hiddenSelectionColor = vec3(0.45, 0.8, 1.0);
          vec3 finalColor = vColor;

          if (isSelected) {
            finalColor = isHidden ? hiddenSelectionColor : visibleSelectionColor;
          }

          gl_FragColor = vec4(finalColor, 1.0);
        }
      `,
      transparent: false,
      vertexColors: true
    });

    const pointsMesh = new THREE.Points(geometry, material);
    sceneRef.current.scene.add(pointsMesh);
    sceneRef.current.points = pointsMesh;
    syncSelectedPointVisibility(selectedPointIndicesRef.current);
    rebuildPointIndexLabels(targetPoints);
    
    // Fit camera to object
    const box = new THREE.Box3().setFromObject(pointsMesh);
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z);
    const safeMaxDim = Math.max(maxDim, 100);
    const fov = sceneRef.current.camera.fov * (Math.PI / 180);
    let cameraZ = Math.abs(safeMaxDim / 2 / Math.tan(fov / 2)) * 1.8;
    sceneRef.current.camera.position.set(center.x, center.y, center.z + cameraZ);
    sceneRef.current.camera.updateProjectionMatrix();
    sceneRef.current.controls.target.copy(center);
    sceneRef.current.controls.update();
  };

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

      clearSelectionState();
      setPoints(result);
      setStats({
        width: sourceImgRef.current.naturalWidth,
        height: sourceImgRef.current.naturalHeight,
        pointCount: result.length
      });

      renderPoints(result);
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
        for (let i = 0; i < exportedPoints.length; i++) {
          exportedPoints[i].visibility = visibilityAttr.getX(i);
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
          <span className="font-mono text-sm tracking-widest uppercase font-bold text-tech-text">ILLUMINATED // v1.2.0-STYLIZED</span>
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
              setSelectionModeEnabled(false);
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
          brushSettings={brushSettings}
          brushSoftnessPercent={brushSoftnessPercent}
          brushStrengthPercent={brushStrengthPercent}
          depthImg={depthImg}
          handleAutoDepth={handleAutoDepth}
          handleFileChange={handleFileChange}
          handleGenerate={handleGenerate}
          handleGlbUpload={handleGlbUpload}
          handleRedo={handleRedo}
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
          selectedPointCount={selectedPointCount}
          selectionModeEnabled={selectionModeEnabled}
          setBrushSettings={setBrushSettings}
          setBrushSoftnessPercent={setBrushSoftnessPercent}
          setBrushStrengthPercent={setBrushStrengthPercent}
          setParams={setParams}
          setSelectedPointIndices={setSelectedPointIndices}
          setSelectionModeEnabled={setSelectionModeEnabled}
          setShowPointIndices={setShowPointIndices}
          showPointIndices={showPointIndices}
          sourceImg={sourceImg}
          updateSavedSelectionName={updateSavedSelectionName}
          deleteSavedSelection={deleteSavedSelection}
          maxPointSize={maxPointSize}
          setMaxPointSize={setMaxPointSize}
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
