import * as THREE from 'three';
// @ts-ignore
import type { OrbitControls } from 'three/examples/jsm/controls/OrbitControls';
import type { PointData } from '../processing/pointSampler';

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
  points: PointData[];
  selectedPointIndices: number[];
};

export type ActiveTool = 'visibility' | 'depth' | 'add';

export type ToolInteractionMode = 'arrow' | 'brush';

export type VisibilityBrushAction = 'hide' | 'reveal' | 'select';

export type DepthAction = 'push' | 'pull';

export type AddAction = 'single' | 'brush';

export type AddAppearanceSource = 'image' | 'clone-selected';

export type SceneRefs = {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  renderer: THREE.WebGLRenderer;
  controls: OrbitControls;
  points: THREE.Points | null;
  pointIndexLabels: THREE.Group | null;
  mesh: THREE.Mesh | null;
};
