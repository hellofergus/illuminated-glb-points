import * as THREE from 'three';

interface AIPoint {
  x: number;
  y: number;
}

export interface PointData {
  x: number;
  y: number;
  z: number;
  u?: number;
  v?: number;
  depthSample?: number;
  zOffset?: number;
  r: number;
  g: number;
  b: number;
  size: number;
  visibility: number; // 0 to 1
  isAdded?: boolean;
}

export interface SamplingParams {
  samplingMode: 'grid' | 'blob' | 'stochastic' | 'pixel-exact' | 'dot-detect';
  depthColorSpace: 'raw' | 'srgb-linear';
  brightnessThreshold: number;
  detailBoost: number;
  fineDetailRescue: number;
  samplingStep: number;
  stochasticDensity: number;
  pointSizeMultiplier: number;
  pointDensityFactor: number; // For "inbetween points"
  maxBlobSize: number;        // To fix "chunky ones"
  depthScale: number;
  xyScale: number;
  edgeInclusion: boolean;
  edgeWeight: number;
  invertDepth: boolean;
  useSourceColors: boolean;
  whiteOnlyPoints: boolean;
  extrusionSteps: number; // 0 = no wall geometry, 1-8 = subdivided walls at cliff edges
  aiPoints?: AIPoint[];
}

export type DepthPixelSource = {
  data: Uint8ClampedArray;
  width: number;
  height: number;
};

type GLBExportOptions = {
  imageWidth: number;
  imageHeight: number;
  xyScale: number;
};

export async function processImages(
  sourceImage: HTMLImageElement,
  depthImage: HTMLImageElement | null,
  params: SamplingParams
): Promise<PointData[]> {
  type PixelExactCandidate = {
    sourceX: number;
    sourceY: number;
    depth: number;
    size: number;
    r: number;
    g: number;
    b: number;
    weight: number;
  };

  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('Could not get canvas context');

  const width = sourceImage.naturalWidth || sourceImage.width;
  const height = sourceImage.naturalHeight || sourceImage.height;
  
  if (width === 0 || height === 0) {
    throw new Error('Source image has zero dimensions. Ensure it is fully loaded.');
  }

  canvas.width = width;
  canvas.height = height;

  // Draw source image
  ctx.drawImage(sourceImage, 0, 0, width, height);
  const sourceData = ctx.getImageData(0, 0, width, height).data;

  // Draw depth image if available
  let depthData: Uint8ClampedArray | null = null;
  if (depthImage) {
    ctx.clearRect(0, 0, width, height);
    ctx.drawImage(depthImage, 0, 0, width, height);
    depthData = ctx.getImageData(0, 0, width, height).data;
  }

  const points: PointData[] = [];
  const step = Math.max(1, Math.round(params.samplingStep));
  const density = Math.max(1, Math.round(params.pointDensityFactor || 1));

  const srgbToLinear = (value: number) => {
    if (value <= 0.04045) {
      return value / 12.92;
    }

    return Math.pow((value + 0.055) / 1.055, 2.4);
  };

  const normalizeDepthValue = (value: number) => {
    const normalizedValue = Math.max(0, Math.min(1, value));
    return params.depthColorSpace === 'srgb-linear'
      ? srgbToLinear(normalizedValue)
      : normalizedValue;
  };

  // Helper for bi-linear color/depth sampling
  const sampleSource = (x: number, y: number): {r: number, g: number, b: number, a: number} => {
    const x1 = Math.floor(x);
    const y1 = Math.floor(y);
    const x2 = Math.min(x1 + 1, width - 1);
    const y2 = Math.min(y1 + 1, height - 1);
    const fx = x - x1;
    const fy = y - y1;

    const getPixel = (px: number, py: number) => {
      const i = (py * width + px) * 4;
      return { r: sourceData[i], g: sourceData[i+1], b: sourceData[i+2], a: sourceData[i+3] };
    };

    const p11 = getPixel(x1, y1);
    const p21 = getPixel(x2, y1);
    const p12 = getPixel(x1, y2);
    const p22 = getPixel(x2, y2);

    const r = (p11.r * (1 - fx) + p21.r * fx) * (1 - fy) + (p12.r * (1 - fx) + p22.r * fx) * fy;
    const g = (p11.g * (1 - fx) + p21.g * fx) * (1 - fy) + (p12.g * (1 - fx) + p22.g * fx) * fy;
    const b = (p11.b * (1 - fx) + p21.b * fx) * (1 - fy) + (p12.b * (1 - fx) + p22.b * fx) * fy;
    return { r, g, b, a: 255 };
  };

  const getDepthAt = (x: number, y: number): number => {
    if (!depthData) return 0.5;
    const x1 = Math.floor(x);
    const y1 = Math.floor(y);
    const x2 = Math.min(x1 + 1, width - 1);
    const y2 = Math.min(y1 + 1, height - 1);
    const fx = x - x1;
    const fy = y - y1;

    const v11 = normalizeDepthValue(depthData[(y1 * width + x1) * 4] / 255);
    const v21 = normalizeDepthValue(depthData[(y1 * width + x2) * 4] / 255);
    const v12 = normalizeDepthValue(depthData[(y2 * width + x1) * 4] / 255);
    const v22 = normalizeDepthValue(depthData[(y2 * width + x2) * 4] / 255);

    return (v11 * (1 - fx) + v21 * fx) * (1 - fy) + (v12 * (1 - fx) + v22 * fx) * fy;
  };

  const getLuminosity = (idx: number) => {
    return (0.299 * sourceData[idx] + 0.587 * sourceData[idx + 1] + 0.114 * sourceData[idx + 2]) / 255;
  };

  const getWeightedLuminanceAt = (x: number, y: number) => {
    const idx = (y * width + x) * 4;
    const alpha = sourceData[idx + 3] / 255;
    return getLuminosity(idx) * alpha;
  };

  const getNormalizedUv = (sourceX: number, sourceY: number) => ({
    u: width > 1 ? sourceX / (width - 1) : 0,
    v: height > 1 ? 1 - (sourceY / (height - 1)) : 0
  });

  const detailBoost = Math.max(0, Math.min(1, params.detailBoost ?? 0));
  const strictThreshold = Math.max(0.005, params.brightnessThreshold);

  const isRecoverablePeak = (x: number, y: number) => {
    const centerLuminance = getWeightedLuminanceAt(x, y);
    const softThreshold = Math.max(0.005, params.brightnessThreshold * 0.55);
    if (centerLuminance < softThreshold) return false;

    let maxNeighborLuminance = 0;
    let minNeighborLuminance = centerLuminance;

    for (let offsetY = -1; offsetY <= 1; offsetY++) {
      for (let offsetX = -1; offsetX <= 1; offsetX++) {
        if (offsetX === 0 && offsetY === 0) continue;

        const nextX = x + offsetX;
        const nextY = y + offsetY;
        if (nextX < 0 || nextX >= width || nextY < 0 || nextY >= height) continue;

        const neighborLuminance = getWeightedLuminanceAt(nextX, nextY);
        maxNeighborLuminance = Math.max(maxNeighborLuminance, neighborLuminance);
        minNeighborLuminance = Math.min(minNeighborLuminance, neighborLuminance);
      }
    }

    return centerLuminance >= maxNeighborLuminance && (centerLuminance - minNeighborLuminance) >= 0.02;
  };

  const isStrictLitAt = (x: number, y: number) => {
    return getWeightedLuminanceAt(x, y) >= strictThreshold;
  };

  const isLitAt = (x: number, y: number) => {
    return isStrictLitAt(x, y) || isRecoverablePeak(x, y);
  };

  const appendDetailBoostPoints = () => {
    if (detailBoost <= 0) {
      return;
    }

    const extraThreshold = Math.max(0.01, strictThreshold - (detailBoost * 0.16));
    const existingSourcePoints = points
      .filter((point) => typeof point.u === 'number' && typeof point.v === 'number')
      .map((point) => ({
        x: (point.u ?? 0) * (width - 1),
        y: (1 - (point.v ?? 0)) * (height - 1)
      }));

    const hasNearbyExistingPoint = (sourceX: number, sourceY: number, radius: number) => {
      const radiusSquared = radius * radius;

      return existingSourcePoints.some((existingPoint) => {
        const dx = existingPoint.x - sourceX;
        const dy = existingPoint.y - sourceY;
        return ((dx * dx) + (dy * dy)) <= radiusSquared;
      });
    };

    for (let y = 1; y < height - 1; y++) {
      for (let x = 1; x < width - 1; x++) {
        const luminance = getWeightedLuminanceAt(x, y);
        if (luminance < extraThreshold && !isRecoverablePeak(x, y)) {
          continue;
        }

        let isPeak = true;
        let localContrast = 0;

        for (let offsetY = -1; offsetY <= 1 && isPeak; offsetY++) {
          for (let offsetX = -1; offsetX <= 1; offsetX++) {
            if (offsetX === 0 && offsetY === 0) continue;

            const neighborLuminance = getWeightedLuminanceAt(x + offsetX, y + offsetY);
            if (neighborLuminance > luminance) {
              isPeak = false;
              break;
            }

            localContrast = Math.max(localContrast, luminance - neighborLuminance);
          }
        }

        if (!isPeak || localContrast < 0.015) {
          continue;
        }

        const dedupeRadius = Math.max(1, 2.5 - detailBoost);
        if (hasNearbyExistingPoint(x, y, dedupeRadius)) {
          continue;
        }

        const sampled = sampleSource(x, y);
        let depthVal = getDepthAt(x, y);
        if (params.invertDepth) depthVal = 1.0 - depthVal;
        const { u, v } = getNormalizedUv(x, y);

        points.push({
          x: (x - width / 2) * params.xyScale,
          y: -(y - height / 2) * params.xyScale,
          z: depthVal * params.depthScale,
          u,
          v,
          depthSample: getDepthAt(x, y),
          zOffset: 0,
          r: (params.whiteOnlyPoints ? 255 : (params.useSourceColors ? sampled.r : 255)) / 255,
          g: (params.whiteOnlyPoints ? 255 : (params.useSourceColors ? sampled.g : 128)) / 255,
          b: (params.whiteOnlyPoints ? 255 : (params.useSourceColors ? sampled.b : 50)) / 255,
          size: Math.max(0.7, 1.05 - (detailBoost * 0.15)),
          visibility: 1.0
        });

        existingSourcePoints.push({ x, y });
      }
    }
  };

  const appendFineDetailRescuePoints = () => {
    const rescueStrength = Math.max(0, Math.min(1, params.fineDetailRescue ?? 0));
    if (rescueStrength <= 0) {
      return;
    }

    const visited = new Uint8Array(width * height);
    const rescueThreshold = Math.max(0.01, strictThreshold - (rescueStrength * 0.18));
    const maxComponentPixels = Math.round(18 + (rescueStrength * 220));
    const maxComponentSpan = Math.round(10 + (rescueStrength * 26));
    const existingSourcePoints = points
      .filter((point) => typeof point.u === 'number' && typeof point.v === 'number')
      .map((point) => ({
        x: (point.u ?? 0) * (width - 1),
        y: (1 - (point.v ?? 0)) * (height - 1)
      }));

    const isRescueLitAt = (x: number, y: number) => {
      const luminance = getWeightedLuminanceAt(x, y);
      return luminance >= rescueThreshold || isRecoverablePeak(x, y);
    };

    const hasNearbyExistingPoint = (sourceX: number, sourceY: number, radius: number) => {
      const radiusSquared = radius * radius;

      return existingSourcePoints.some((existingPoint) => {
        const dx = existingPoint.x - sourceX;
        const dy = existingPoint.y - sourceY;
        return ((dx * dx) + (dy * dy)) <= radiusSquared;
      });
    };

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const seedIndex = y * width + x;
        if (visited[seedIndex]) continue;

        visited[seedIndex] = 1;
        if (!isRescueLitAt(x, y)) continue;

        const queue: Array<{ x: number; y: number }> = [{ x, y }];
        let head = 0;
        let weightedX = 0;
        let weightedY = 0;
        let weightedDepth = 0;
        let weightedR = 0;
        let weightedG = 0;
        let weightedB = 0;
        let totalWeight = 0;
        let pixelCount = 0;
        const componentPixels: Array<{ x: number; y: number; weight: number }> = [];
        let minX = x;
        let maxX = x;
        let minY = y;
        let maxY = y;

        while (head < queue.length) {
          const current = queue[head++];
          const currentLuminance = getWeightedLuminanceAt(current.x, current.y);
          if (currentLuminance < rescueThreshold && !isRecoverablePeak(current.x, current.y)) {
            continue;
          }

          const sampled = sampleSource(current.x, current.y);
          let depthVal = getDepthAt(current.x, current.y);
          if (params.invertDepth) depthVal = 1.0 - depthVal;

          const weight = Math.max(currentLuminance, 0.001);
          weightedX += current.x * weight;
          weightedY += current.y * weight;
          weightedDepth += depthVal * weight;
          weightedR += sampled.r * weight;
          weightedG += sampled.g * weight;
          weightedB += sampled.b * weight;
          totalWeight += weight;
          pixelCount += 1;
          componentPixels.push({ x: current.x, y: current.y, weight });
          minX = Math.min(minX, current.x);
          maxX = Math.max(maxX, current.x);
          minY = Math.min(minY, current.y);
          maxY = Math.max(maxY, current.y);

          for (let offsetY = -1; offsetY <= 1; offsetY++) {
            for (let offsetX = -1; offsetX <= 1; offsetX++) {
              if (offsetX === 0 && offsetY === 0) continue;

              const nextX = current.x + offsetX;
              const nextY = current.y + offsetY;
              if (nextX < 0 || nextX >= width || nextY < 0 || nextY >= height) continue;

              const nextIndex = nextY * width + nextX;
              if (visited[nextIndex]) continue;

              visited[nextIndex] = 1;
              if (isRescueLitAt(nextX, nextY)) {
                queue.push({ x: nextX, y: nextY });
              }
            }
          }
        }

        if (pixelCount < 2 || pixelCount > maxComponentPixels || totalWeight <= 0) {
          continue;
        }

        const bboxWidth = maxX - minX + 1;
        const bboxHeight = maxY - minY + 1;
        const bboxMaxSpan = Math.max(bboxWidth, bboxHeight);
        if (bboxMaxSpan > maxComponentSpan) {
          continue;
        }

        const targetX = weightedX / totalWeight;
        const targetY = weightedY / totalWeight;
        const componentDedupeRadius = Math.max(1.25, Math.min(6, Math.sqrt(pixelCount) * 0.45));
        if (hasNearbyExistingPoint(targetX, targetY, componentDedupeRadius)) {
          continue;
        }

        const detailStride = rescueStrength >= 0.8 ? 1 : rescueStrength >= 0.4 ? 2 : 3;
        const candidatePixels = [...componentPixels].sort((left, right) => right.weight - left.weight);
        const maxRescuePoints = Math.max(1, Math.min(candidatePixels.length, Math.round(pixelCount * (0.35 + rescueStrength * 0.65))));
        const rescueSize = Math.max(0.65, Math.min(1.35, 0.65 + (rescueStrength * 0.45)));
        let emittedPointCount = 0;

        for (const componentPixel of candidatePixels) {
          if (emittedPointCount >= maxRescuePoints) {
            break;
          }

          const shouldKeepByStride = ((componentPixel.x + componentPixel.y) % detailStride) === 0;
          const shouldKeepAsPeak = componentPixel.weight >= (rescueThreshold + 0.08) || isRecoverablePeak(componentPixel.x, componentPixel.y);
          if (!shouldKeepByStride && !shouldKeepAsPeak) {
            continue;
          }

          if (hasNearbyExistingPoint(componentPixel.x, componentPixel.y, Math.max(0.85, detailStride * 0.75))) {
            continue;
          }

          const sampled = sampleSource(componentPixel.x, componentPixel.y);
          let depthVal = getDepthAt(componentPixel.x, componentPixel.y);
          if (params.invertDepth) depthVal = 1.0 - depthVal;
          const { u, v } = getNormalizedUv(componentPixel.x, componentPixel.y);

          points.push({
            x: (componentPixel.x - width / 2) * params.xyScale,
            y: -(componentPixel.y - height / 2) * params.xyScale,
            z: depthVal * params.depthScale,
            u,
            v,
            depthSample: getDepthAt(componentPixel.x, componentPixel.y),
            zOffset: 0,
            r: (params.whiteOnlyPoints ? 255 : (params.useSourceColors ? sampled.r : 255)) / 255,
            g: (params.whiteOnlyPoints ? 255 : (params.useSourceColors ? sampled.g : 128)) / 255,
            b: (params.whiteOnlyPoints ? 255 : (params.useSourceColors ? sampled.b : 50)) / 255,
            size: rescueSize,
            visibility: 1.0
          });

          existingSourcePoints.push({ x: componentPixel.x, y: componentPixel.y });
          emittedPointCount += 1;
        }

        if (emittedPointCount === 0) {
          const { u, v } = getNormalizedUv(targetX, targetY);
          points.push({
            x: (targetX - width / 2) * params.xyScale,
            y: -(targetY - height / 2) * params.xyScale,
            z: (weightedDepth / totalWeight) * params.depthScale,
            u,
            v,
            depthSample: getDepthAt(targetX, targetY),
            zOffset: 0,
            r: (params.whiteOnlyPoints ? 255 : (params.useSourceColors ? (weightedR / totalWeight) : 255)) / 255,
            g: (params.whiteOnlyPoints ? 255 : (params.useSourceColors ? (weightedG / totalWeight) : 128)) / 255,
            b: (params.whiteOnlyPoints ? 255 : (params.useSourceColors ? (weightedB / totalWeight) : 50)) / 255,
            size: rescueSize,
            visibility: 1.0
          });

          existingSourcePoints.push({ x: targetX, y: targetY });
        }
      }
    }
  };

  if (params.samplingMode === 'dot-detect') {
    type DotPeak = { x: number; y: number; strength: number };

    const peaks: DotPeak[] = [];
    const localRadius = Math.max(1, Math.round(step));
    const supportRadius = Math.max(2, localRadius + 1);
    const componentRadius = Math.max(supportRadius + 1, Math.round(localRadius * 3));
    const suppressionRadius = Math.max(componentRadius, Math.round(localRadius * 2.5));
    const suppressionRadiusSquared = suppressionRadius * suppressionRadius;
    const softThreshold = Math.max(0.01, params.brightnessThreshold * 0.45);

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const centerValue = getWeightedLuminanceAt(x, y);
        if (centerValue < softThreshold) continue;

        let isLocalMaximum = true;
        let localMin = centerValue;

        for (let offsetY = -localRadius; offsetY <= localRadius && isLocalMaximum; offsetY++) {
          for (let offsetX = -localRadius; offsetX <= localRadius; offsetX++) {
            if (offsetX === 0 && offsetY === 0) continue;

            const nextX = x + offsetX;
            const nextY = y + offsetY;
            if (nextX < 0 || nextX >= width || nextY < 0 || nextY >= height) continue;

            const neighborValue = getWeightedLuminanceAt(nextX, nextY);
            localMin = Math.min(localMin, neighborValue);

            if (neighborValue > centerValue) {
              isLocalMaximum = false;
              break;
            }
          }
        }

        if (!isLocalMaximum) continue;
        if ((centerValue - localMin) < 0.02) continue;

        peaks.push({ x, y, strength: centerValue });
      }
    }

    peaks.sort((left, right) => right.strength - left.strength);

    const keptPeaks: DotPeak[] = [];
    const consumedDotPixels = new Uint8Array(width * height);
    const claimedDots: Array<{ x: number; y: number; radiusSquared: number }> = [];
    for (const peak of peaks) {
      let suppressed = false;

      for (const keptPeak of keptPeaks) {
        const dx = peak.x - keptPeak.x;
        const dy = peak.y - keptPeak.y;
        if ((dx * dx) + (dy * dy) <= suppressionRadiusSquared) {
          suppressed = true;
          break;
        }
      }

      if (!suppressed) {
        keptPeaks.push(peak);
      }
    }

    for (const peak of keptPeaks) {
      const peakIndex = peak.y * width + peak.x;
      if (consumedDotPixels[peakIndex]) continue;

      let overlapsClaimedDot = false;
      for (const claimedDot of claimedDots) {
        const dx = peak.x - claimedDot.x;
        const dy = peak.y - claimedDot.y;
        if ((dx * dx) + (dy * dy) <= claimedDot.radiusSquared) {
          overlapsClaimedDot = true;
          break;
        }
      }
      if (overlapsClaimedDot) continue;

      let depthSum = 0;
      let supportPixelCount = 0;
      let minX = peak.x;
      let maxX = peak.x;
      let minY = peak.y;
      let maxY = peak.y;
      const componentPixels: Array<{ x: number; y: number }> = [];
      const componentVisited = new Uint8Array(width * height);
      const componentQueue: Array<{ x: number; y: number }> = [{ x: peak.x, y: peak.y }];
      componentVisited[peakIndex] = 1;

      let queueIndex = 0;

      while (queueIndex < componentQueue.length) {
        const current = componentQueue[queueIndex++];
        const currentIndex = current.y * width + current.x;
        const dxFromPeak = current.x - peak.x;
        const dyFromPeak = current.y - peak.y;
        const distanceFromPeak = Math.sqrt((dxFromPeak * dxFromPeak) + (dyFromPeak * dyFromPeak));
        if (distanceFromPeak > componentRadius) continue;

        const luminance = getWeightedLuminanceAt(current.x, current.y);
        if (luminance < softThreshold) continue;

        let depthVal = getDepthAt(current.x, current.y);
        if (params.invertDepth) depthVal = 1.0 - depthVal;

  componentPixels.push(current);
  depthSum += depthVal;
        supportPixelCount += 1;
  minX = Math.min(minX, current.x);
  maxX = Math.max(maxX, current.x);
  minY = Math.min(minY, current.y);
  maxY = Math.max(maxY, current.y);
        consumedDotPixels[currentIndex] = 1;

        for (let offsetY = -1; offsetY <= 1; offsetY++) {
          for (let offsetX = -1; offsetX <= 1; offsetX++) {
            if (offsetX === 0 && offsetY === 0) continue;

            const nextX = current.x + offsetX;
            const nextY = current.y + offsetY;
            if (nextX < 0 || nextX >= width || nextY < 0 || nextY >= height) continue;

            const nextIndex = nextY * width + nextX;
            if (componentVisited[nextIndex]) continue;

            componentVisited[nextIndex] = 1;
            componentQueue.push({ x: nextX, y: nextY });
          }
        }
      }

      if (componentPixels.length === 0) continue;

      const sortedXs = componentPixels.map((pixel) => pixel.x).sort((left, right) => left - right);
      const sortedYs = componentPixels.map((pixel) => pixel.y).sort((left, right) => left - right);
      const middleIndex = Math.floor(sortedXs.length / 2);
      const targetX = sortedXs[middleIndex];
      const targetY = sortedYs[middleIndex];
      const averageDepth = depthSum / componentPixels.length;
      const blobWidth = Math.max(1, maxX - minX + 1);
      const blobHeight = Math.max(1, maxY - minY + 1);
      const effectiveCount = Math.min(componentPixels.length, params.maxBlobSize || 1000);
      const baseSize = Math.max(
        0.8,
        Math.sqrt(effectiveCount) * 0.4 * Math.min(1.6, Math.max(blobWidth, blobHeight) / Math.max(1, supportRadius))
      );
      const claimRadius = Math.max(
        componentRadius * 1.35,
        Math.sqrt(Math.max(blobWidth * blobWidth + blobHeight * blobHeight, supportPixelCount)) + (componentRadius * 0.35)
      );
      const sampled = sampleSource(targetX, targetY);

      claimedDots.push({
        x: targetX,
        y: targetY,
        radiusSquared: claimRadius * claimRadius
      });

      const { u, v } = getNormalizedUv(targetX, targetY);

      points.push({
        x: (targetX - width / 2) * params.xyScale,
        y: -(targetY - height / 2) * params.xyScale,
        z: averageDepth * params.depthScale,
        u,
        v,
        depthSample: getDepthAt(targetX, targetY),
        zOffset: 0,
        r: (params.whiteOnlyPoints ? 255 : (params.useSourceColors ? sampled.r : 255)) / 255,
        g: (params.whiteOnlyPoints ? 255 : (params.useSourceColors ? sampled.g : 128)) / 255,
        b: (params.whiteOnlyPoints ? 255 : (params.useSourceColors ? sampled.b : 50)) / 255,
        size: baseSize,
        visibility: 1.0
      });
    }
  } else if (params.samplingMode === 'pixel-exact') {
    const visited = new Uint8Array(width * height);
    const pixelExactCandidates: PixelExactCandidate[] = [];

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const seedIndex = y * width + x;
        if (visited[seedIndex]) continue;

        visited[seedIndex] = 1;
        if (!isLitAt(x, y)) continue;

        const queue: Array<{ x: number; y: number }> = [{ x, y }];
        let head = 0;
        let weightedX = 0;
        let weightedY = 0;
        let weightedDepth = 0;
        let weightedSize = 0;
        let weightedR = 0;
        let weightedG = 0;
        let weightedB = 0;
        let totalWeight = 0;
        let pixelCount = 0;

        while (head < queue.length) {
          const current = queue[head++];
          const idx = (current.y * width + current.x) * 4;
          const alpha = sourceData[idx + 3] / 255;
          const luminosity = getLuminosity(idx);
          const weight = Math.max(luminosity * alpha, 0.001);

          const sampled = sampleSource(current.x, current.y);
          let depthVal = getDepthAt(current.x, current.y);
          if (params.invertDepth) depthVal = 1.0 - depthVal;

          weightedX += current.x * weight;
          weightedY += current.y * weight;
          weightedDepth += depthVal * weight;
          weightedSize += (0.8 + luminosity * 0.4) * weight;
          weightedR += sampled.r * weight;
          weightedG += sampled.g * weight;
          weightedB += sampled.b * weight;
          totalWeight += weight;
          pixelCount += 1;

          for (let offsetY = -2; offsetY <= 2; offsetY++) {
            for (let offsetX = -2; offsetX <= 2; offsetX++) {
              if (offsetX === 0 && offsetY === 0) continue;

              const nextX = current.x + offsetX;
              const nextY = current.y + offsetY;
              if (nextX < 0 || nextX >= width || nextY < 0 || nextY >= height) continue;

              const nextIndex = nextY * width + nextX;
              if (visited[nextIndex]) continue;

              visited[nextIndex] = 1;
              if (isLitAt(nextX, nextY)) {
                queue.push({ x: nextX, y: nextY });
              }
            }
          }
        }

        if (totalWeight <= 0) continue;

        const targetX = weightedX / totalWeight;
        const targetY = weightedY / totalWeight;
        const averageDepth = weightedDepth / totalWeight;
        const averageSize = weightedSize / totalWeight;
        const baseSize = Math.max(0.8, averageSize * Math.min(1.6, Math.sqrt(pixelCount)));

        pixelExactCandidates.push({
          sourceX: targetX,
          sourceY: targetY,
          depth: averageDepth,
          r: (params.whiteOnlyPoints ? 255 : (params.useSourceColors ? (weightedR / totalWeight) : 255)) / 255,
          g: (params.whiteOnlyPoints ? 255 : (params.useSourceColors ? (weightedG / totalWeight) : 128)) / 255,
          b: (params.whiteOnlyPoints ? 255 : (params.useSourceColors ? (weightedB / totalWeight) : 50)) / 255,
          size: baseSize,
          weight: totalWeight
        });
      }
    }

    const merged = new Array(pixelExactCandidates.length).fill(false);
    const mergeRadiusPixels = 2.75;
    const mergeRadiusSquared = mergeRadiusPixels * mergeRadiusPixels;
    const colorDistanceThreshold = 0.28;

    for (let index = 0; index < pixelExactCandidates.length; index++) {
      if (merged[index]) continue;

      const clusterQueue = [index];
      merged[index] = true;
      let queueIndex = 0;
      let weightedX = 0;
      let weightedY = 0;
      let weightedDepth = 0;
      let weightedSize = 0;
      let weightedR = 0;
      let weightedG = 0;
      let weightedB = 0;
      let totalWeight = 0;

      while (queueIndex < clusterQueue.length) {
        const clusterMemberIndex = clusterQueue[queueIndex++];
        const clusterMember = pixelExactCandidates[clusterMemberIndex];

        weightedX += clusterMember.sourceX * clusterMember.weight;
        weightedY += clusterMember.sourceY * clusterMember.weight;
        weightedDepth += clusterMember.depth * clusterMember.weight;
        weightedSize += clusterMember.size * clusterMember.weight;
        weightedR += clusterMember.r * clusterMember.weight;
        weightedG += clusterMember.g * clusterMember.weight;
        weightedB += clusterMember.b * clusterMember.weight;
        totalWeight += clusterMember.weight;

        for (let innerIndex = index + 1; innerIndex < pixelExactCandidates.length; innerIndex++) {
          if (merged[innerIndex]) continue;

          const candidate = pixelExactCandidates[innerIndex];
          const dx = candidate.sourceX - clusterMember.sourceX;
          const dy = candidate.sourceY - clusterMember.sourceY;
          const sourceDistanceSquared = (dx * dx) + (dy * dy);
          if (sourceDistanceSquared > mergeRadiusSquared) continue;

          const colorDistance = Math.sqrt(
            Math.pow(candidate.r - clusterMember.r, 2) +
            Math.pow(candidate.g - clusterMember.g, 2) +
            Math.pow(candidate.b - clusterMember.b, 2)
          );

          if (colorDistance > colorDistanceThreshold) continue;

          merged[innerIndex] = true;
          clusterQueue.push(innerIndex);
        }
      }

      points.push({
        x: ((weightedX / totalWeight) - width / 2) * params.xyScale,
        y: -((weightedY / totalWeight) - height / 2) * params.xyScale,
        z: (weightedDepth / totalWeight) * params.depthScale,
        ...getNormalizedUv(weightedX / totalWeight, weightedY / totalWeight),
        depthSample: getDepthAt(weightedX / totalWeight, weightedY / totalWeight),
        zOffset: 0,
        r: weightedR / totalWeight,
        g: weightedG / totalWeight,
        b: weightedB / totalWeight,
        size: weightedSize / totalWeight,
        visibility: 1.0
      });
    }
  } else if (params.samplingMode === 'stochastic') {
    // PROBABILISTIC SAMPLING (Best for stippled/dotted art)
    const baseDensity = params.stochasticDensity || 0.5;
    
    for (let y = 0; y < height; y += step) {
      for (let x = 0; x < width; x += step) {
        const luminosity = getWeightedLuminanceAt(x, y);
        
        if (luminosity > strictThreshold) {
          // If luminosity is 0.8, it has an 80% * density chance to spawn
          const prob = luminosity * baseDensity;
          if (Math.random() < prob) {
            const targetX = x + (Math.random() - 0.5) * step;
            const targetY = y + (Math.random() - 0.5) * step;
            
            const sampled = sampleSource(targetX, targetY);
            let dV = getDepthAt(targetX, targetY);
            if (params.invertDepth) dV = 1.0 - dV;
            const { u, v } = getNormalizedUv(targetX, targetY);

            points.push({
              x: (targetX - width / 2) * params.xyScale,
              y: -(targetY - height / 2) * params.xyScale,
              z: dV * params.depthScale,
              u,
              v,
              depthSample: getDepthAt(targetX, targetY),
              zOffset: 0,
              r: (params.whiteOnlyPoints ? 255 : (params.useSourceColors ? sampled.r : 255)) / 255,
              g: (params.whiteOnlyPoints ? 255 : (params.useSourceColors ? sampled.g : 128)) / 255,
              b: (params.whiteOnlyPoints ? 255 : (params.useSourceColors ? sampled.b : 50)) / 255,
              size: 0.8 + (luminosity * 0.4),
              visibility: 1.0
            });
          }
        }
      }
    }
  } else if (params.samplingMode === 'blob') {
    // BLOB DETECTION MODE
    const visited = new Uint8Array(width * height);

    for (let y = 0; y < height; y += step) {
      for (let x = 0; x < width; x += step) {
        const idx = y * width + x;
        if (visited[idx]) continue;
        if (!isLitAt(x, y)) {
          visited[idx] = 1;
          continue;
        }

        const blobPixels: {x: number, y: number}[] = [];
        const queue: {x: number, y: number}[] = [{x, y}];
        visited[idx] = 1;

        while (queue.length > 0) {
          const curr = queue.shift()!;
          blobPixels.push(curr);
          
          const neighbors = [
            {nx: curr.x + step, ny: curr.y}, {nx: curr.x - step, ny: curr.y},
            {nx: curr.x, ny: curr.y + step}, {nx: curr.x, ny: curr.y - step},
          ];

          for (const {nx, ny} of neighbors) {
            if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
              const nidx = ny * width + nx;
              if (!visited[nidx] && isLitAt(nx, ny)) {
                visited[nidx] = 1;
                queue.push({x: nx, y: ny});
              }
            }
          }
          if (blobPixels.length > 2000) break; // Hard internal cap
        }

        if (blobPixels.length > 0) {
          // Normalize size by user param
          const effectiveCount = Math.min(blobPixels.length, params.maxBlobSize || 1000);
          const baseSize = Math.sqrt(effectiveCount) * 0.4;
          
          let sumX = 0, sumY = 0, sumR = 0, sumG = 0, sumB = 0;
          for (const p of blobPixels) {
            sumX += p.x; sumY += p.y;
            const cidx = (p.y * width + p.x) * 4;
            sumR += sourceData[cidx]; sumG += sourceData[cidx + 1]; sumB += sourceData[cidx + 2];
          }
          
          const midX = sumX / blobPixels.length;
          const midY = sumY / blobPixels.length;

          // Add points based on Density Factor
          for (let d = 0; d < density; d++) {
            // If density > 1, spread points around the centroid
            const offsetX = density > 1 ? (Math.random() - 0.5) * step : 0;
            const offsetY = density > 1 ? (Math.random() - 0.5) * step : 0;
            const targetX = Math.min(width - 1, Math.max(0, midX + offsetX));
            const targetY = Math.min(height - 1, Math.max(0, midY + offsetY));

            const sampled = sampleSource(targetX, targetY);
            let depthVal = getDepthAt(targetX, targetY);
            if (params.invertDepth) depthVal = 1.0 - depthVal;
            const { u, v } = getNormalizedUv(targetX, targetY);

            points.push({
              x: (targetX - width / 2) * params.xyScale,
              y: -(targetY - height / 2) * params.xyScale,
              z: depthVal * params.depthScale,
              u,
              v,
              depthSample: getDepthAt(targetX, targetY),
              zOffset: 0,
              r: (params.whiteOnlyPoints ? 255 : (params.useSourceColors ? sampled.r : 255)) / 255,
              g: (params.whiteOnlyPoints ? 255 : (params.useSourceColors ? sampled.g : 128)) / 255,
              b: (params.whiteOnlyPoints ? 255 : (params.useSourceColors ? sampled.b : 50)) / 255,
              size: baseSize / Math.sqrt(density), // Spread mass across points
              visibility: 1.0
            });
          }
        }
      }
    }
  } else {
    // GRID MODE
    let edgeMask: Uint8Array | null = null;
    if (params.edgeInclusion) edgeMask = computeEdgeMask(sourceData, width, height);

    for (let y = 0; y < height; y += step) {
      for (let x = 0; x < width; x += step) {
        const luminosity = getWeightedLuminanceAt(x, y);
        let shouldSample = luminosity >= strictThreshold || isRecoverablePeak(x, y) || (edgeMask && edgeMask[y * width + x] > 128);

        if (shouldSample) {
          for (let d = 0; d < density; d++) {
            const offsetX = density > 1 ? (Math.random() - 0.5) * step : 0;
            const offsetY = density > 1 ? (Math.random() - 0.5) * step : 0;
            const targetX = Math.min(width - 1, Math.max(0, x + offsetX));
            const targetY = Math.min(height - 1, Math.max(0, y + offsetY));

            const sampled = sampleSource(targetX, targetY);
            let dV = getDepthAt(targetX, targetY);
            if (params.invertDepth) dV = 1.0 - dV;
            const { u, v } = getNormalizedUv(targetX, targetY);

            points.push({
              x: (targetX - width / 2) * params.xyScale,
              y: -(targetY - height / 2) * params.xyScale,
              z: dV * params.depthScale,
              u,
              v,
              depthSample: getDepthAt(targetX, targetY),
              zOffset: 0,
              r: (params.whiteOnlyPoints ? 255 : (params.useSourceColors ? sampled.r : 255)) / 255,
              g: (params.whiteOnlyPoints ? 255 : (params.useSourceColors ? sampled.g : 128)) / 255,
              b: (params.whiteOnlyPoints ? 255 : (params.useSourceColors ? sampled.b : 50)) / 255,
              size: 1.0 / Math.sqrt(density),
              visibility: 1.0
            });
          }
        }
      }
    }
  }

  // INTEGRATE AI ANCHOR POINTS
  if (params.aiPoints && params.aiPoints.length > 0) {
    for (const ap of params.aiPoints) {
      // ap.x and ap.y are percentages
      const targetX = (ap.x / 100) * width;
      const targetY = (ap.y / 100) * height;

      const sampled = sampleSource(targetX, targetY);
      let depthVal = getDepthAt(targetX, targetY);
      if (params.invertDepth) depthVal = 1.0 - depthVal;
      const { u, v } = getNormalizedUv(targetX, targetY);

      points.push({
        x: (targetX - width / 2) * params.xyScale,
        y: -(targetY - height / 2) * params.xyScale,
        z: depthVal * params.depthScale,
        u,
        v,
        depthSample: getDepthAt(targetX, targetY),
        zOffset: 0,
        r: (params.whiteOnlyPoints ? 255 : (params.useSourceColors ? sampled.r : 255)) / 255,
        g: (params.whiteOnlyPoints ? 255 : (params.useSourceColors ? sampled.g : 128)) / 255,
        b: (params.whiteOnlyPoints ? 255 : (params.useSourceColors ? sampled.b : 50)) / 255,
        size: 1.5, // Anchors are slightly larger to stand out/be visible
        visibility: 1.0
      });
    }
  }

  appendDetailBoostPoints();
  appendFineDetailRescuePoints();

  return points;
}

function computeEdgeMask(data: Uint8ClampedArray, width: number, height: number): Uint8Array {
  const mask = new Uint8Array(width * height);
  const grayscale = new Uint8Array(width * height);
  
  for (let i = 0; i < width * height; i++) {
    const idx = i * 4;
    grayscale[i] = (data[idx] + data[idx+1] + data[idx+2]) / 3;
  }

  // Simple Sobel edge detection
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const gx = 
        -grayscale[(y-1)*width + (x-1)] + grayscale[(y-1)*width + (x+1)] +
        -2*grayscale[y*width + (x-1)] + 2*grayscale[y*width + (x+1)] +
        -grayscale[(y+1)*width + (x-1)] + grayscale[(y+1)*width + (x+1)];
        
      const gy = 
        -grayscale[(y-1)*width + (x-1)] - 2*grayscale[(y-1)*width + x] - grayscale[(y-1)*width + (x+1)] +
        grayscale[(y+1)*width + (x-1)] + 2*grayscale[(y+1)*width + x] + grayscale[(y+1)*width + (x+1)];
        
      const mag = Math.sqrt(gx*gx + gy*gy);
      mask[y*width + x] = mag > 50 ? 255 : 0;
    }
  }
  
  return mask;
}

export async function exportToGLB(points: PointData[], options: GLBExportOptions): Promise<Blob> {
  // @ts-ignore
  const { GLTFExporter } = await import('three/examples/jsm/exporters/GLTFExporter');
  
  // Filter out points that are hidden (visibility < 0.1 as a safe threshold)
  const visiblePoints = points.filter(p => p.visibility > 0.05);
  
  const geometry = new THREE.BufferGeometry();
  const positions = new Float32Array(visiblePoints.length * 3);
  const colors = new Float32Array(visiblePoints.length * 3);
  const uvs = new Float32Array(visiblePoints.length * 2);
  const depthSamples = new Float32Array(visiblePoints.length);
  const zOffsets = new Float32Array(visiblePoints.length);

  visiblePoints.forEach((p, i) => {
    positions[i * 3] = p.x;
    positions[i * 3 + 1] = p.y;
    positions[i * 3 + 2] = p.z;
    colors[i * 3] = p.r;
    colors[i * 3 + 1] = p.g;
    colors[i * 3 + 2] = p.b;
    uvs[i * 2] = p.u ?? 0;
    uvs[i * 2 + 1] = p.v ?? 0;
    depthSamples[i] = p.depthSample ?? 0.5;
    zOffsets[i] = p.zOffset ?? 0;
  });

  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geometry.setAttribute('_depth', new THREE.BufferAttribute(depthSamples, 1));
  geometry.setAttribute('_zOffset', new THREE.BufferAttribute(zOffsets, 1));

  // Export sizes as a custom attribute
  const sizes = new Float32Array(visiblePoints.length);
  visiblePoints.forEach((p, i) => {
    sizes[i] = p.size || 1.0;
  });
  geometry.setAttribute('_size', new THREE.BufferAttribute(sizes, 1));

  const material = new THREE.PointsMaterial({ size: 0.1, vertexColors: true, sizeAttenuation: true });
  const pointsMesh = new THREE.Points(geometry, material);
  pointsMesh.name = 'PointCloud';

  const halfWidth = (options.imageWidth * options.xyScale) / 2;
  const halfHeight = (options.imageHeight * options.xyScale) / 2;
  const quadGeometry = new THREE.BufferGeometry();
  const quadPositions = new Float32Array([
    -halfWidth, halfHeight, 0,
    halfWidth, halfHeight, 0,
    -halfWidth, -halfHeight, 0,
    halfWidth, -halfHeight, 0,
  ]);
  const quadUvs = new Float32Array([
    0, 1,
    1, 1,
    0, 0,
    1, 0,
  ]);

  quadGeometry.setAttribute('position', new THREE.BufferAttribute(quadPositions, 3));
  quadGeometry.setAttribute('uv', new THREE.BufferAttribute(quadUvs, 2));
  quadGeometry.setIndex([0, 2, 1, 2, 3, 1]);
  quadGeometry.computeVertexNormals();

  const quadMaterial = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    side: THREE.DoubleSide,
    transparent: true,
    opacity: 0.18,
  });
  const imageQuad = new THREE.Mesh(quadGeometry, quadMaterial);
  imageQuad.name = 'ImageQuad';

  const exportRoot = new THREE.Group();
  exportRoot.name = 'PointCloudExport';
  exportRoot.add(imageQuad);
  exportRoot.add(pointsMesh);
  
  const exporter = new GLTFExporter();
  
  return new Promise((resolve, reject) => {
    exporter.parse(
      exportRoot,
      (gltf: ArrayBuffer | object) => {
        if (gltf instanceof ArrayBuffer) {
          resolve(new Blob([gltf], { type: 'model/gltf-binary' }));
        } else {
          resolve(new Blob([JSON.stringify(gltf)], { type: 'application/json' }));
        }
      },
      (error: unknown) => reject(error),
      { binary: true }
    );
  });
}

/**
 * Phase 2 Hook: Automatic Depth Generation
 * In a real implementation, this would call a ML model (e.g., ZoeDepth, MiDaS)
 * either via a local worker or an API endpoint.
 */
export async function getAutoDepthMap(image: HTMLImageElement): Promise<string | null> {
  console.log('Auto-depth requested for image:', image.src.substring(0, 50));
  // Placeholder logic that returns null to indicate provider is unavailable
  // Alternatively, could return a simple gradient map as a "mock"
  return null;
}

/**
 * Build an invisible displacement mesh from a depth image that can be used
 * as a projection surface for raycasting — so new points can be painted
 * in 3D space by anchoring mouse clicks to a real Z value.
 *
 * The coordinate transform matches processImages() exactly:
 *   x = (px - width/2)  * xyScale
 *   y = -(py - height/2) * xyScale
 *   z = depthValue * depthScale
 */
export function buildProjectionMesh(
  depthSource: DepthPixelSource,
  params: SamplingParams,
  sourceWidth: number,
  sourceHeight: number
): THREE.Mesh {
  const meshStep = 4; // 1 vertex per 4 pixels — enough detail without being heavy
  const depthData = depthSource.data;

  const srgbToLinear = (value: number) => {
    if (value <= 0.04045) {
      return value / 12.92;
    }

    return Math.pow((value + 0.055) / 1.055, 2.4);
  };

  const normalizeDepthValue = (value: number) => {
    const normalizedValue = Math.max(0, Math.min(1, value));
    return params.depthColorSpace === 'srgb-linear'
      ? srgbToLinear(normalizedValue)
      : normalizedValue;
  };

  const cols = Math.floor(sourceWidth / meshStep);
  const rows = Math.floor(sourceHeight / meshStep);
  const vertCount = cols * rows;

  const positions = new Float32Array(vertCount * 3);
  const uvs = new Float32Array(vertCount * 2);
  const indices: number[] = [];

  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const px = col * meshStep;
      const py = row * meshStep;
      const safeX = Math.min(px, depthSource.width - 1);
      const safeY = Math.min(py, depthSource.height - 1);
      const pi = (safeY * depthSource.width + safeX) * 4;

      let depthVal = normalizeDepthValue(depthData[pi] / 255);
      if (params.invertDepth) depthVal = 1 - depthVal;

      const i = row * cols + col;
      positions[i * 3]     = (px - sourceWidth / 2) * params.xyScale;
      positions[i * 3 + 1] = -(py - sourceHeight / 2) * params.xyScale;
      positions[i * 3 + 2] = depthVal * params.depthScale;
      uvs[i * 2] = sourceWidth > 1 ? px / (sourceWidth - 1) : 0;
      uvs[i * 2 + 1] = sourceHeight > 1 ? 1 - (py / (sourceHeight - 1)) : 0;

      if (col < cols - 1 && row < rows - 1) {
        const a = i;
        const b = i + 1;
        const c = i + cols;
        const d = i + cols + 1;
        indices.push(a, c, b, b, c, d);
      }
    }
  }

  // ── Extrusion wall geometry ───────────────────────────────────────────────
  // At each silhouette cliff edge (one vertex significantly higher than its
  // neighbour), drop a subdivided VERTICAL wall panel straight down to z=0.
  // This creates proper extrusion side-walls that the paint brush can hit.
  const wallPos: number[] = [];
  const wallUv: number[] = [];
  const wallIdx: number[] = [];

  if (params.extrusionSteps > 0) {
    // Only trigger at true silhouette cliffs: neighbour Z drop > 35% of depth range.
    const wallThreshold = params.depthScale * 0.35;
    const steps = Math.max(1, Math.round(params.extrusionSteps));

    const addWall = (
      ax: number, ay: number, az: number, au: number, av: number,
      bx: number, by: number, bz: number, bu: number, bv: number
    ) => {
      // Cliff condition: large relative Z drop between the two neighbours.
      const zDiff = Math.abs(az - bz);
      if (zDiff < wallThreshold) return;

      // Wall always drops straight down to the ground plane (z=0), giving
      // a proper vertical extrusion side-wall rather than an angled skirt.
      const zHi = Math.max(az, bz);
      const zLo = 0;

      // (steps+1) rows × 2 verts per row = one strip per vertical slot.
      const baseVert = vertCount + wallPos.length / 3;

      for (let s = 0; s <= steps; s++) {
        const z = zLo + (zHi - zLo) * (s / steps);
        wallPos.push(ax, ay, z,  bx, by, z);
        wallUv.push(au, av,      bu, bv);
      }

      for (let s = 0; s < steps; s++) {
        const a0 = baseVert + s * 2;
        const a1 = baseVert + s * 2 + 1;
        const a2 = baseVert + s * 2 + 2;
        const a3 = baseVert + s * 2 + 3;
        wallIdx.push(a0, a2, a1,  a1, a2, a3);
      }
    };

    // Horizontal edges: (row, col) → (row, col+1)
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols - 1; col++) {
        const iA = row * cols + col;
        const iB = row * cols + col + 1;
        addWall(
          positions[iA*3], positions[iA*3+1], positions[iA*3+2], uvs[iA*2], uvs[iA*2+1],
          positions[iB*3], positions[iB*3+1], positions[iB*3+2], uvs[iB*2], uvs[iB*2+1]
        );
      }
    }

    // Vertical edges: (row, col) → (row+1, col)
    for (let row = 0; row < rows - 1; row++) {
      for (let col = 0; col < cols; col++) {
        const iA = row * cols + col;
        const iB = (row + 1) * cols + col;
        addWall(
          positions[iA*3], positions[iA*3+1], positions[iA*3+2], uvs[iA*2], uvs[iA*2+1],
          positions[iB*3], positions[iB*3+1], positions[iB*3+2], uvs[iB*2], uvs[iB*2+1]
        );
      }
    }
  }

  // Merge top-face + wall geometry
  const mergedPos = new Float32Array(positions.length + wallPos.length);
  mergedPos.set(positions);
  mergedPos.set(wallPos, positions.length);

  const mergedUv = new Float32Array(uvs.length + wallUv.length);
  mergedUv.set(uvs);
  mergedUv.set(wallUv, uvs.length);

  const mergedIdx = [...indices, ...wallIdx];
  // ─────────────────────────────────────────────────────────────────────────

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(mergedPos, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(mergedUv, 2));
  geo.setIndex(mergedIdx);

  const mat = new THREE.MeshBasicMaterial({
    color: 0x00ccff,
    wireframe: true,
    transparent: true,
    opacity: 0,
    side: THREE.DoubleSide,
    depthWrite: false
  });

  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'projectionSurface';
  // Keep the mesh raycastable at all times; the app controls visibility via opacity.
  mesh.visible = true;
  return mesh;
}
