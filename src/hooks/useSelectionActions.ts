import * as THREE from 'three';
import type { SavedSelection, SceneRefs } from '../types/app';

type UseSelectionActionsArgs = {
  pointsLength: number;
  savedSelections: SavedSelection[];
  selectedPointIndicesRef: { current: number[] };
  setSelectedPointIndices: (value: number[] | ((prev: number[]) => number[])) => void;
  setSavedSelections: (value: SavedSelection[] | ((prev: SavedSelection[]) => SavedSelection[])) => void;
  setSelectionModeEnabled: (value: boolean) => void;
  setBrushSettings: (value: any) => void;
  setStatus: (value: string) => void;
  pushToHistory: () => void;
  sceneRef: { current: SceneRefs | null };
  syncPointIndexLabelVisibility: () => void;
};

const createSavedSelectionId = () => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }

  return `selection-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
};

export const useSelectionActions = ({
  pointsLength,
  savedSelections,
  selectedPointIndicesRef,
  setSelectedPointIndices,
  setSavedSelections,
  setSelectionModeEnabled,
  setBrushSettings,
  setStatus,
  pushToHistory,
  sceneRef,
  syncPointIndexLabelVisibility
}: UseSelectionActionsArgs) => {
  const clearSelectionState = () => {
    setSelectedPointIndices([]);
    setSavedSelections([]);
  };

  const restoreSavedSelection = (indices: number[]) => {
    const validIndices = indices
      .filter((index) => index >= 0 && index < pointsLength)
      .sort((left, right) => left - right);

    setSelectedPointIndices(validIndices);
    if (validIndices.length > 0) {
      setSelectionModeEnabled(true);
      setBrushSettings((prev: any) => ({ ...prev, enabled: false }));
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

    setSavedSelections((prev: SavedSelection[]) => [...prev, nextSelection]);
    setStatus(`Saved ${nextSelection.name}`);
  };

  const updateSavedSelectionName = (selectionId: string, name: string) => {
    setSavedSelections((prev: SavedSelection[]) => prev.map((selection) => (
      selection.id === selectionId ? { ...selection, name } : selection
    )));
  };

  const deleteSavedSelection = (selectionId: string) => {
    setSavedSelections((prev: SavedSelection[]) => prev.filter((selection) => selection.id !== selectionId));
  };

  const applyVisibilityToSelectedPoints = (visibility: 0 | 1, statusMessage: string) => {
    if (!sceneRef.current?.points || selectedPointIndicesRef.current.length === 0) {
      setStatus('Notice: No points selected');
      return;
    }

    pushToHistory();

    const visibilityAttr = sceneRef.current.points.geometry.getAttribute('visibility') as THREE.BufferAttribute;
    selectedPointIndicesRef.current.forEach((index: number) => {
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

  return {
    clearSelectionState,
    deleteSavedSelection,
    hideSelectedPoints,
    restoreSavedSelection,
    restoreSelectedPoints,
    saveCurrentSelection,
    updateSavedSelectionName
  };
};
