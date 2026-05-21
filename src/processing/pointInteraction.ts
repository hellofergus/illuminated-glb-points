export type BrushMode = 'hide' | 'reveal' | 'select' | 'push' | 'pull' | 'soften' | 'grow' | 'shrink' | 'paint' | 'stamp';

export type ScreenPointHit = {
  index: number;
  x: number;
  y: number;
};

export const findNearestHit = (
  hits: ScreenPointHit[],
  pointerX: number,
  pointerY: number,
  maxDistance: number
): ScreenPointHit | null => {
  let nearestHit: ScreenPointHit | null = null;
  let nearestDistance = maxDistance;

  hits.forEach((hit) => {
    const currentDistance = Math.hypot(hit.x - pointerX, hit.y - pointerY);
    if (currentDistance <= nearestDistance) {
      nearestHit = hit;
      nearestDistance = currentDistance;
    }
  });

  return nearestHit;
};

export const getIndicesInRectangle = (
  hits: ScreenPointHit[],
  left: number,
  right: number,
  top: number,
  bottom: number
): number[] => {
  return hits
    .filter((hit) => hit.x >= left && hit.x <= right && hit.y >= top && hit.y <= bottom)
    .map((hit) => hit.index);
};

export const mergeSelectionIndices = (
  previousIndices: number[],
  nextIndices: number[],
  append: boolean,
  remove: boolean
): number[] => {
  const mergedIndices = remove
    ? new Set<number>(previousIndices)
    : new Set<number>(append ? previousIndices : []);

  nextIndices.forEach((index) => {
    if (remove) {
      mergedIndices.delete(index);
    } else {
      mergedIndices.add(index);
    }
  });

  return Array.from(mergedIndices).sort((left, right) => left - right);
};

export const getBrushInfluence = (
  normalizedDistance: number,
  softness: number
): number => {
  if (normalizedDistance >= 1) return 0;

  const featherStart = 1 - softness;
  let coverage = normalizedDistance <= featherStart ? 1 : 0;

  if (coverage === 0 && softness > 0) {
    const featherProgress = (normalizedDistance - featherStart) / softness;
    const t = Math.min(Math.max(featherProgress, 0), 1);
    // Smoothstep cubic: eases in/out vs abrupt linear, giving a perceptibly gradual ramp.
    const smoothed = t * t * (3 - 2 * t);
    coverage = 1 - smoothed;
  }

  return coverage;
};

export const shouldApplyBrushEffect = (
  normalizedDistance: number,
  softness: number,
  strength: number,
  noiseValue: number
): boolean => {
  const coverage = getBrushInfluence(normalizedDistance, softness);
  return coverage * strength >= noiseValue;
};
