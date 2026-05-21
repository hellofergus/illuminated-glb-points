import { useEffect } from 'react';
import type { BrushMode } from '../processing/pointInteraction';

type UseKeyboardShortcutsArgs = {
  brushEnabled: boolean;
  cloneSourceShortcutEnabled: boolean;
  isScaleBrushActive: boolean;
  isEditableTarget: (target: EventTarget | null) => boolean;
  selectionModeEnabledRef: { current: boolean };
  hideSelectedPoints: () => void;
  adjustBrushSize: (delta: number) => void;
  adjustBrushStrengthPercent: (delta: number) => void;
  setBrushSoftnessPercent: (percent: number) => void;
  toggleScaleAction: () => void;
  handleUndo: () => void;
  handleRedo: () => void;
  handleSaveSessionToFile: () => void | Promise<void>;
  toggleCloneSourcePicking: () => void;
};

export const useKeyboardShortcuts = ({
  brushEnabled,
  cloneSourceShortcutEnabled,
  isScaleBrushActive,
  isEditableTarget,
  selectionModeEnabledRef,
  hideSelectedPoints,
  adjustBrushSize,
  adjustBrushStrengthPercent,
  setBrushSoftnessPercent,
  toggleScaleAction,
  handleUndo,
  handleRedo,
  handleSaveSessionToFile,
  toggleCloneSourcePicking
}: UseKeyboardShortcutsArgs) => {
  useEffect(() => {
    const handleShortcutKeyDown = (event: KeyboardEvent) => {
      if (event.ctrlKey && event.shiftKey && !event.altKey && !event.metaKey && event.key.toLowerCase() === 's') {
        event.preventDefault();
        handleSaveSessionToFile();
        return;
      }

      if (event.ctrlKey && !event.shiftKey && !event.altKey && !event.metaKey && event.key.toLowerCase() === 's') {
        event.preventDefault();
        handleSaveSessionToFile();
        return;
      }

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

      if (!event.ctrlKey && !event.shiftKey && !event.altKey && !event.metaKey && event.key.toLowerCase() === 'p' && cloneSourceShortcutEnabled) {
        event.preventDefault();
        toggleCloneSourcePicking();
        return;
      }

      if (!brushEnabled || event.altKey || event.metaKey) return;

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

      if (!event.ctrlKey && !event.shiftKey && event.key.toLowerCase() === 'i' && isScaleBrushActive) {
        event.preventDefault();
        toggleScaleAction();
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
  }, [
    adjustBrushSize,
    adjustBrushStrengthPercent,
    brushEnabled,
    cloneSourceShortcutEnabled,
    handleRedo,
    handleSaveSessionToFile,
    handleUndo,
    hideSelectedPoints,
    isEditableTarget,
    isScaleBrushActive,
    selectionModeEnabledRef,
    setBrushSoftnessPercent,
    toggleCloneSourcePicking,
    toggleScaleAction
  ]);
};
