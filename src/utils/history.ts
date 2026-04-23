import * as THREE from 'three';
import type { HistorySnapshot, SceneRefs } from '../types/app';
import type { PointData } from '../processing/pointSampler';

const clonePoints = (points: PointData[]) => points.map((point) => ({ ...point }));

const syncPointsFromScene = (
  sceneRef: SceneRefs | null,
  currentPoints: PointData[]
): PointData[] => {
  if (!sceneRef?.points) {
    return clonePoints(currentPoints);
  }

  const geometry = sceneRef.points.geometry;
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

export const createHistorySnapshot = (
  sceneRef: SceneRefs | null,
  currentPoints: PointData[],
  selectedPointIndices: number[]
): HistorySnapshot | null => {
  if (currentPoints.length === 0) return null;

  return {
    points: syncPointsFromScene(sceneRef, currentPoints),
    selectedPointIndices: [...selectedPointIndices]
  };
};

export const applyHistorySnapshot = (
  snapshot: HistorySnapshot,
  applyPoints: (points: PointData[]) => void,
  applySelection: (selectedPointIndices: number[]) => void
) => {
  const nextPoints = clonePoints(snapshot.points);
  applyPoints(nextPoints);
  applySelection(snapshot.selectedPointIndices.filter((index) => index >= 0 && index < nextPoints.length));
};
