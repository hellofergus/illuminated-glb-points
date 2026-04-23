import * as THREE from 'three';
import type { HistorySnapshot, SceneRefs } from '../types/app';

export const createHistorySnapshot = (sceneRef: SceneRefs | null): HistorySnapshot | null => {
  if (!sceneRef?.points) return null;

  const geometry = sceneRef.points.geometry;
  const visibilityAttr = geometry.getAttribute('visibility') as THREE.BufferAttribute;
  const positionAttr = geometry.getAttribute('position') as THREE.BufferAttribute;

  return {
    visibility: new Float32Array(visibilityAttr.array as ArrayLike<number>),
    positions: new Float32Array(positionAttr.array as ArrayLike<number>)
  };
};

export const applyHistorySnapshot = (
  sceneRef: SceneRefs | null,
  snapshot: HistorySnapshot,
  syncPointIndexLabelVisibility: () => void,
  syncPointIndexLabelPositions: () => void
) => {
  if (!sceneRef?.points) return;

  const geometry = sceneRef.points.geometry;
  const visibilityAttr = geometry.getAttribute('visibility') as THREE.BufferAttribute;
  const positionAttr = geometry.getAttribute('position') as THREE.BufferAttribute;

  visibilityAttr.array.set(snapshot.visibility);
  visibilityAttr.needsUpdate = true;
  positionAttr.array.set(snapshot.positions);
  positionAttr.needsUpdate = true;

  syncPointIndexLabelVisibility();
  syncPointIndexLabelPositions();
};
