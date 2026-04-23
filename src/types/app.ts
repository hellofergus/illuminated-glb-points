import * as THREE from 'three';
// @ts-ignore
import type { OrbitControls } from 'three/examples/jsm/controls/OrbitControls';

export type SavedSelection = {
  id: string;
  name: string;
  indices: number[];
};

export type SelectionDragState = {
  startX: number;
  startY: number;
  currentX: number;
  currentY: number;
  append: boolean;
  remove: boolean;
};

export type HistorySnapshot = {
  positions: Float32Array;
  visibility: Float32Array;
};

export type SceneRefs = {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  renderer: THREE.WebGLRenderer;
  controls: OrbitControls;
  points: THREE.Points | null;
  pointIndexLabels: THREE.Group | null;
  mesh: THREE.Mesh | null;
};
