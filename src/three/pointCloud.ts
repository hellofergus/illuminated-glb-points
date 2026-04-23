import * as THREE from 'three';
import type { PointData } from '../processing/pointSampler';
import type { SceneRefs } from '../types/app';

type BuildPointCloudArgs = {
  targetPoints: PointData[];
  pointSizeMultiplier: number;
  maxPointSize: number;
};

type CreatePointCloudManagerArgs = {
  sceneRef: { current: SceneRefs | null };
  showPointIndices: boolean;
  getSelectedIndices: () => number[];
};

const vertexShader = `
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
`;

const fragmentShader = `
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
`;

const buildPointCloud = ({
  targetPoints,
  pointSizeMultiplier,
  maxPointSize
}: BuildPointCloudArgs) => {
  const geometry = new THREE.BufferGeometry();
  const positions = new Float32Array(targetPoints.length * 3);
  const colors = new Float32Array(targetPoints.length * 3);
  const sizes = new Float32Array(targetPoints.length);
  const selected = new Float32Array(targetPoints.length);
  const visibilities = new Float32Array(targetPoints.length);

  targetPoints.forEach((point, index) => {
    positions[index * 3] = point.x;
    positions[index * 3 + 1] = point.y;
    positions[index * 3 + 2] = point.z;
    colors[index * 3] = point.r;
    colors[index * 3 + 1] = point.g;
    colors[index * 3 + 2] = point.b;
    sizes[index] = point.size || 1.0;
    visibilities[index] = point.visibility ?? 1.0;
  });

  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geometry.setAttribute('size', new THREE.BufferAttribute(sizes, 1));
  geometry.setAttribute('selected', new THREE.BufferAttribute(selected, 1));
  geometry.setAttribute('visibility', new THREE.BufferAttribute(visibilities, 1));

  const material = new THREE.ShaderMaterial({
    uniforms: {
      uPointSizeScale: { value: pointSizeMultiplier },
      uMaxPointSize: { value: maxPointSize }
    },
    vertexShader,
    fragmentShader,
    transparent: false,
    vertexColors: true
  });

  return new THREE.Points(geometry, material);
};

export const disposePointIndexLabels = (labelGroup: THREE.Group | null) => {
  if (!labelGroup) return;

  labelGroup.children.forEach((child) => {
    const sprite = child as THREE.Sprite;
    const material = sprite.material as THREE.SpriteMaterial;
    material.map?.dispose();
    material.dispose();
  });
};

const createPointIndexLabels = (targetPoints: PointData[], showPointIndices: boolean) => {
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

export const createPointCloudManager = ({
  sceneRef,
  showPointIndices,
  getSelectedIndices
}: CreatePointCloudManagerArgs) => {
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

  const rebuildPointIndexLabels = (targetPoints: PointData[]) => {
    if (!sceneRef.current) return;

    if (sceneRef.current.pointIndexLabels) {
      sceneRef.current.scene.remove(sceneRef.current.pointIndexLabels);
      disposePointIndexLabels(sceneRef.current.pointIndexLabels);
      sceneRef.current.pointIndexLabels = null;
    }

    if (!showPointIndices || targetPoints.length === 0) return;

    const labelGroup = createPointIndexLabels(targetPoints, showPointIndices);
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

  const syncPointIndexLabelPositions = () => {
    if (!sceneRef.current?.points || !sceneRef.current.pointIndexLabels) return;

    const positionAttr = sceneRef.current.points.geometry.getAttribute('position') as THREE.BufferAttribute;
    const sizeAttr = sceneRef.current.points.geometry.getAttribute('size') as THREE.BufferAttribute;

    sceneRef.current.pointIndexLabels.children.forEach((child, index) => {
      child.position.set(
        positionAttr.getX(index),
        positionAttr.getY(index) + Math.max(sizeAttr.getX(index) * 4, 4),
        positionAttr.getZ(index)
      );
    });
  };

  const cleanupCurrentPointCloud = () => {
    if (!sceneRef.current) return;

    if (sceneRef.current.points) {
      sceneRef.current.scene.remove(sceneRef.current.points);
    }

    if (sceneRef.current.pointIndexLabels) {
      sceneRef.current.scene.remove(sceneRef.current.pointIndexLabels);
      disposePointIndexLabels(sceneRef.current.pointIndexLabels);
      sceneRef.current.pointIndexLabels = null;
    }
  };

  const rebuildPointCloud = (
    targetPoints: PointData[],
    pointSizeMultiplier: number,
    maxPointSize: number
  ) => {
    if (!sceneRef.current) return;

    cleanupCurrentPointCloud();

    const pointsMesh = buildPointCloud({
      targetPoints,
      pointSizeMultiplier,
      maxPointSize
    });

    sceneRef.current.scene.add(pointsMesh);
    sceneRef.current.points = pointsMesh;
    syncSelectedPointVisibility(getSelectedIndices());
    rebuildPointIndexLabels(targetPoints);
  };

  const renderPoints = (
    targetPoints: PointData[],
    pointSizeMultiplier: number,
    maxPointSize: number
  ) => {
    if (!sceneRef.current) return;

    rebuildPointCloud(targetPoints, pointSizeMultiplier, maxPointSize);

    if (!sceneRef.current.points) return;

    const box = new THREE.Box3().setFromObject(sceneRef.current.points);
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z);
    const safeMaxDim = Math.max(maxDim, 100);
    const fov = sceneRef.current.camera.fov * (Math.PI / 180);
    const cameraZ = Math.abs(safeMaxDim / 2 / Math.tan(fov / 2)) * 1.8;

    sceneRef.current.camera.position.set(center.x, center.y, center.z + cameraZ);
    sceneRef.current.camera.updateProjectionMatrix();
    sceneRef.current.controls.target.copy(center);
    sceneRef.current.controls.update();
  };

  return {
    cleanupCurrentPointCloud,
    rebuildPointCloud,
    rebuildPointIndexLabels,
    renderPoints,
    syncPointIndexLabelPositions,
    syncPointIndexLabelVisibility,
    syncSelectedPointVisibility
  };
};
