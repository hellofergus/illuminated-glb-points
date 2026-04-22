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
  const [showPointIndices, setShowPointIndices] = useState(false);
  const [stats, setStats] = useState({
    width: 0,
    height: 0,
    pointCount: 0
  });

  // Brush State
  const [brushSettings, setBrushSettings] = useState({
    enabled: false,
    size: 20,
    strength: 1.0,
    softness: 0.5,
    mode: 'hide' as 'hide' | 'reveal'
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
  const brushIndicatorRef = useRef<THREE.Mesh | null>(null);
  useEffect(() => { brushSettingsRef.current = brushSettings; }, [brushSettings]);
  useEffect(() => { isBrushingRef.current = isBrushing; }, [isBrushing]);
  useEffect(() => { isAltNavigationRef.current = isAltNavigationActive; }, [isAltNavigationActive]);

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
      sceneRef.current.controls.enableRotate = !brushSettings.enabled || isAltNavigationActive;
    }
    if (brushIndicatorRef.current) {
      brushIndicatorRef.current.visible = brushSettings.enabled && !isAltNavigationActive;
      brushIndicatorRef.current.scale.set(brushSettings.size, brushSettings.size, 1);
    }
  }, [brushSettings.enabled, brushSettings.size, isAltNavigationActive]);

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

    const raycaster = new THREE.Raycaster();
    raycaster.params.Points = { threshold: 5 }; // Increased threshold for easier selection
    const mouse = new THREE.Vector2();

    sceneRef.current = { scene, camera, renderer, controls, points: null, pointIndexLabels: null };

    // Brush Application Function
    const applyBrush = (clientX: number, clientY: number, forcePaint: boolean = false) => {
      if (!sceneRef.current || !sceneRef.current.points || !canvasRef.current) return;
      
      const rect = canvasRef.current.getBoundingClientRect();
      mouse.x = ((clientX - rect.left) / rect.width) * 2 - 1;
      mouse.y = -((clientY - rect.top) / rect.height) * 2 + 1;
      
      raycaster.setFromCamera(mouse, sceneRef.current.camera);
      const intersects = raycaster.intersectObject(sceneRef.current.points);
      
      const settings = brushSettingsRef.current;
      const indicator = brushIndicatorRef.current;

      if (indicator) {
        if (settings.enabled && !isAltNavigationRef.current) {
          indicator.visible = true;
          indicator.scale.set(settings.size, settings.size, 1);
          
          if (intersects.length > 0) {
            indicator.position.copy(intersects[0].point);
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
      if (intersects.length > 0 && settings.enabled && !isAltNavigationRef.current && (isBrushingRef.current || forcePaint)) {
        const pointCloud = sceneRef.current.points;
        const geometry = pointCloud.geometry;
        const visibilityAttr = geometry.getAttribute('visibility') as THREE.BufferAttribute;
        const positionAttr = geometry.getAttribute('position') as THREE.BufferAttribute;
        
        const center = intersects[0].point;
        const pos = new THREE.Vector3();
        const worldPos = new THREE.Vector3();
        
        for (let i = 0; i < visibilityAttr.count; i++) {
          pos.fromBufferAttribute(positionAttr, i);
          worldPos.copy(pos).applyMatrix4(pointCloud.matrixWorld);
          
          const dist = worldPos.distanceTo(center);
          const normalizedDistance = dist / settings.size;
          if (normalizedDistance >= 1) continue;

          const featherStart = 1 - settings.softness;
          let coverage = normalizedDistance <= featherStart ? 1 : 0;

          if (coverage === 0 && settings.softness > 0) {
            const featherProgress = (normalizedDistance - featherStart) / settings.softness;
            coverage = 1 - Math.min(Math.max(featherProgress, 0), 1);
          }

          const pointNoise = Math.abs(
            Math.sin(worldPos.x * 12.9898 + worldPos.y * 78.233 + worldPos.z * 37.719)
          );
          const effectProbability = coverage * settings.strength;

          if (effectProbability >= pointNoise) {
            visibilityAttr.setX(i, settings.mode === 'hide' ? 0.0 : 1.0);
          }
        }
        visibilityAttr.needsUpdate = true;
        syncPointIndexLabelVisibility();
      }
    };

    const handleMouseDown = (e: MouseEvent) => {
      if (brushSettingsRef.current.enabled && e.button === 0 && !e.altKey) {
        pushToHistory();
        setIsBrushing(true);
        applyBrush(e.clientX, e.clientY, true);
      }
    };

    const handleMouseMove = (e: MouseEvent) => {
      if (e.altKey && isBrushingRef.current) {
        setIsBrushing(false);
      }

      if (brushSettingsRef.current.enabled) {
        applyBrush(e.clientX, e.clientY);
      }
    };

    const handleMouseUp = () => {
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
    geometry.setAttribute('visibility', new THREE.BufferAttribute(visibilities, 1));

    const material = new THREE.ShaderMaterial({
      uniforms: {
        uPointSizeScale: { value: params.pointSizeMultiplier }
      },
      vertexShader: `
        uniform float uPointSizeScale;
        attribute float size;
        attribute float visibility;
        varying vec3 vColor;
        varying float vVisibility;
        void main() {
          vColor = color;
          vVisibility = visibility;
          vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = size * uPointSizeScale * (500.0 / -mvPosition.z);
          gl_Position = projectionMatrix * mvPosition;
        }
      `,
      fragmentShader: `
        varying vec3 vColor;
        varying float vVisibility;
        void main() {
          // Hard threshold for boolean visibility
          if (vVisibility < 0.5) discard;
          
          if (length(gl_PointCoord - vec2(0.5, 0.5)) > 0.5) discard;
          
          // Force full opacity, no partial transparency
          gl_FragColor = vec4(vColor, 1.0);
        }
      `,
      transparent: false,
      vertexColors: true
    });

    const pointsMesh = new THREE.Points(geometry, material);
    sceneRef.current.scene.add(pointsMesh);
    sceneRef.current.points = pointsMesh;
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
        {/* Left Sidebar: Controls */}
        <aside className="w-[320px] border-r border-tech-border bg-tech-sidebar p-6 flex flex-col gap-8 overflow-y-auto scrollbar-hide">
          
          {/* Sampling Mode Selection */}
          <section className="space-y-4">
            <div className="mono-label text-tech-accent uppercase">00 // Core Strategy</div>
            <div className="grid grid-cols-3 gap-2">
              <button 
                onClick={() => setParams({...params, samplingMode: 'grid'})}
                className={`flex flex-col items-center justify-center py-3 border rounded transition-all ${params.samplingMode === 'grid' ? 'bg-tech-border border-tech-accent text-tech-accent' : 'bg-tech-bg/50 border-tech-border text-tech-muted opacity-60'}`}
              >
                <div className="font-mono text-[9px] mb-1">GRID</div>
              </button>
              <button 
                onClick={() => setParams({...params, samplingMode: 'blob'})}
                className={`flex flex-col items-center justify-center py-3 border rounded transition-all ${params.samplingMode === 'blob' ? 'bg-tech-border border-tech-accent text-tech-accent' : 'bg-tech-bg/50 border-tech-border text-tech-muted opacity-60'}`}
              >
                <div className="font-mono text-[9px] mb-1">BLOB</div>
              </button>
              <button 
                onClick={() => setParams({...params, samplingMode: 'stochastic'})}
                className={`flex flex-col items-center justify-center py-3 border rounded transition-all ${params.samplingMode === 'stochastic' ? 'bg-tech-border border-tech-accent text-tech-accent' : 'bg-tech-bg/50 border-tech-border text-tech-muted opacity-60'}`}
              >
                <div className="font-mono text-[9px] mb-1">STIPPLE</div>
              </button>
            </div>
          </section>

          {/* File Uploads */}
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

          {/* Sampling Parameters */}
          <section className="space-y-4">
            <div className="mono-label text-tech-accent">02 // Sampling Logic</div>
            <div className="space-y-4">
              <div>
                <div className="flex justify-between mono-value mb-1 font-mono"><span className="opacity-50">Threshold</span><span>{(params.brightnessThreshold * 100).toFixed(0)}%</span></div>
                <input 
                  type="range" min="0" max="1" step="0.01" 
                  value={params.brightnessThreshold} 
                  onChange={(e) => setParams({...params, brightnessThreshold: parseFloat(e.target.value)})}
                  className="w-full accent-tech-accent h-1 bg-tech-border rounded-lg appearance-none cursor-pointer"
                />
              </div>
              <div>
                <div className="flex justify-between mono-value mb-1 font-mono"><span className="opacity-50">Sampling Step</span><span>{params.samplingStep}PX</span></div>
                <input 
                  type="range" min="1" max="20" step="1" 
                  value={params.samplingStep} 
                  onChange={(e) => setParams({...params, samplingStep: parseInt(e.target.value)})}
                  className="w-full accent-tech-accent h-1 bg-tech-border rounded-lg appearance-none cursor-pointer"
                />
              </div>
              <div>
                <div className="flex justify-between mono-value mb-1 font-mono"><span className="opacity-50">Visual Point Scale</span><span>{params.pointSizeMultiplier.toFixed(1)}X</span></div>
                <input 
                  type="range" min="0.1" max="50" step="0.1" 
                  value={params.pointSizeMultiplier} 
                  onChange={(e) => setParams({...params, pointSizeMultiplier: parseFloat(e.target.value)})}
                  className="w-full accent-tech-accent h-1 bg-tech-border rounded-lg appearance-none cursor-pointer"
                />
              </div>
              <div className="pt-2 border-t border-tech-border/30">
                <div className="flex justify-between mono-value mb-1 font-mono"><span className="opacity-50 font-bold text-tech-accent/80">Density Multiplier</span><span>{params.pointDensityFactor}X</span></div>
                <input 
                  type="range" min="1" max="16" step="1" 
                  value={params.pointDensityFactor} 
                  onChange={(e) => setParams({...params, pointDensityFactor: parseInt(e.target.value)})}
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
                  onChange={(e) => setParams({...params, stochasticDensity: parseFloat(e.target.value)})}
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
                    onChange={(e) => setParams({...params, maxBlobSize: parseInt(e.target.value)})}
                    className="w-full accent-tech-accent h-1 bg-tech-border rounded-lg appearance-none cursor-pointer"
                  />
                  <div className="text-[8px] opacity-30 mt-1 font-mono uppercase">Reduces "chunky" clusters</div>
                </div>
              )}
              <div className="flex items-center justify-between py-1 border-b border-tech-border/30">
                <span className="mono-value opacity-50 font-mono">Edge Inclusion</span>
                <button 
                  onClick={() => setParams({...params, edgeInclusion: !params.edgeInclusion})}
                  className={`w-8 h-4 rounded-full transition-colors relative ${params.edgeInclusion ? 'bg-tech-accent' : 'bg-tech-border'}`}
                >
                  <div className={`absolute top-1 w-2 h-2 rounded-full bg-white transition-all ${params.edgeInclusion ? 'right-1' : 'left-1'}`} />
                </button>
              </div>
            </div>
          </section>

          {/* Transform Parameters */}
          <section className="space-y-4">
            <div className="mono-label text-tech-accent uppercase flex justify-between items-center">
              <span>03 // Brush Tool</span>
              <button 
                onClick={() => setBrushSettings({...brushSettings, enabled: !brushSettings.enabled})}
                className={`text-[9px] px-2 py-0.5 border rounded transition-all ${brushSettings.enabled ? 'bg-tech-accent text-black border-tech-accent' : 'border-tech-subtle-border opacity-50'}`}
              >
                {brushSettings.enabled ? '[ ACTIVE ]' : '[ INACTIVE ]'}
              </button>
            </div>
            
            {brushSettings.enabled && (
              <div className="space-y-4 p-3 bg-tech-header/50 border border-tech-border rounded animate-in fade-in slide-in-from-top-2 duration-300">
                <div className="flex gap-2">
                  <button 
                    onClick={() => setBrushSettings({...brushSettings, mode: 'hide'})}
                    className={`flex-1 py-1.5 flex items-center justify-center gap-2 border rounded text-[10px] uppercase font-mono transition-all ${brushSettings.mode === 'hide' ? 'border-tech-accent bg-tech-accent/10 text-tech-accent' : 'border-tech-border opacity-40'}`}
                  >
                    <Eraser className="w-3 h-3" /> Hide
                  </button>
                  <button 
                    onClick={() => setBrushSettings({...brushSettings, mode: 'reveal'})}
                    className={`flex-1 py-1.5 flex items-center justify-center gap-2 border rounded text-[10px] uppercase font-mono transition-all ${brushSettings.mode === 'reveal' ? 'border-tech-accent bg-tech-accent/10 text-tech-accent' : 'border-tech-border opacity-40'}`}
                  >
                    <Paintbrush className="w-3 h-3" /> Reveal
                  </button>
                </div>

                <div className="flex gap-2 border-t border-tech-border/30 pt-3">
                  <button 
                    onClick={handleUndo}
                    disabled={history.length === 0}
                    className="flex-1 py-1 flex items-center justify-center gap-2 border border-tech-border rounded text-[9px] uppercase font-mono hover:border-tech-accent disabled:opacity-20 transition-all"
                  >
                    <Undo className="w-3 h-3" /> Undo
                  </button>
                  <button 
                    onClick={handleRedo}
                    disabled={redoStack.length === 0}
                    className="flex-1 py-1 flex items-center justify-center gap-2 border border-tech-border rounded text-[9px] uppercase font-mono hover:border-tech-accent disabled:opacity-20 transition-all"
                  >
                    <Redo className="w-3 h-3" /> Redo
                  </button>
                </div>

                <div>
                  <div className="flex justify-between mono-value mb-1 font-mono text-[9px]"><span className="opacity-50">Brush Radius</span><span>{brushSettings.size}PX</span></div>
                  <input 
                    type="range" min="1" max="500" step="1" 
                    value={brushSettings.size} 
                    onChange={(e) => setBrushSettings({...brushSettings, size: parseInt(e.target.value)})}
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

                <div className="text-[8px] opacity-40 font-mono italic">Strength changes how many points are affected, not opacity. Shortcuts: [ and ] adjust radius, , and . adjust strength, 1-0 set softness from 10% to 100%, Ctrl+Z undo, Ctrl+Shift+Z redo.</div>
              </div>
            )}
          </section>

          {/* Coordinate Transform */}
          <section className="space-y-4">
            <div className="mono-label text-tech-accent">04 // Coordinate Transform</div>
            <div className="space-y-4">
              <div>
                <div className="flex justify-between mono-value mb-1 font-mono"><span className="opacity-50">Depth Scale</span><span>{params.depthScale.toFixed(1)}</span></div>
                <input 
                  type="range" min="1" max="200" step="1" 
                  value={params.depthScale} 
                  onChange={(e) => setParams({...params, depthScale: parseInt(e.target.value)})}
                  className="w-full accent-tech-accent h-1 bg-tech-border rounded-lg appearance-none cursor-pointer"
                />
              </div>
              <div className="flex items-center justify-between">
                <span className="mono-value opacity-50 font-mono">Invert Depth</span>
                <button 
                  onClick={() => setParams({...params, invertDepth: !params.invertDepth})}
                  className={`w-8 h-4 border border-tech-subtle-border rounded-full transition-colors relative ${params.invertDepth ? 'bg-tech-accent' : 'bg-tech-border'}`}
                >
                  <div className={`absolute top-1 w-2 h-2 rounded-full bg-tech-text/60 transition-all ${params.invertDepth ? 'right-1' : 'left-1'}`} />
                </button>
              </div>
            </div>
          </section>

          <section className="space-y-4">
            <div className="mono-label text-tech-accent uppercase">05 // Debug View</div>
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

          {/* Generation Trigger */}
          <button 
            onClick={handleGenerate}
            disabled={isProcessing || !sourceImg}
            className="mt-auto w-full py-4 bg-tech-accent text-black font-bold text-xs tracking-widest uppercase hover:bg-white disabled:opacity-30 disabled:cursor-not-allowed transition-all active:scale-[0.98]"
          >
            {isProcessing ? 'SYSTEM_RUNNING...' : 'Generate Point Cloud'}
          </button>
        </aside>

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
            </div>

            {/* Three.js Canvas */}
            <div ref={canvasRef} className="flex-1 w-full h-full cursor-move bg-[radial-gradient(#1a1a1a_1.2px,transparent_1.2px)] [background-size:24px_24px]" />
            
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
