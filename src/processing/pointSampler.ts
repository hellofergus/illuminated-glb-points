import * as THREE from 'three';

interface AIPoint {
  x: number;
  y: number;
}

export interface PointData {
  x: number;
  y: number;
  z: number;
  r: number;
  g: number;
  b: number;
  size: number;
  visibility: number; // 0 to 1
}

export interface SamplingParams {
  samplingMode: 'grid' | 'blob' | 'stochastic';
  brightnessThreshold: number;
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
  aiPoints?: AIPoint[];
}

export async function processImages(
  sourceImage: HTMLImageElement,
  depthImage: HTMLImageElement | null,
  params: SamplingParams
): Promise<PointData[]> {
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

    const v11 = depthData[(y1 * width + x1) * 4] / 255;
    const v21 = depthData[(y1 * width + x2) * 4] / 255;
    const v12 = depthData[(y2 * width + x1) * 4] / 255;
    const v22 = depthData[(y2 * width + x2) * 4] / 255;

    return (v11 * (1 - fx) + v21 * fx) * (1 - fy) + (v12 * (1 - fx) + v22 * fx) * fy;
  };

  const getLuminosity = (idx: number) => {
    return (0.299 * sourceData[idx] + 0.587 * sourceData[idx + 1] + 0.114 * sourceData[idx + 2]) / 255;
  };

  if (params.samplingMode === 'stochastic') {
    // PROBABILISTIC SAMPLING (Best for stippled/dotted art)
    const baseDensity = params.stochasticDensity || 0.5;
    
    for (let y = 0; y < height; y += step) {
      for (let x = 0; x < width; x += step) {
        const idx = (y * width + x) * 4;
        const luminosity = getLuminosity(idx);
        
        if (luminosity > params.brightnessThreshold) {
          // If luminosity is 0.8, it has an 80% * density chance to spawn
          const prob = luminosity * baseDensity;
          if (Math.random() < prob) {
            const targetX = x + (Math.random() - 0.5) * step;
            const targetY = y + (Math.random() - 0.5) * step;
            
            const sampled = sampleSource(targetX, targetY);
            let dV = getDepthAt(targetX, targetY);
            if (params.invertDepth) dV = 1.0 - dV;

            points.push({
              x: (targetX - width / 2) * params.xyScale,
              y: -(targetY - height / 2) * params.xyScale,
              z: dV * params.depthScale,
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
    const isLit = (x: number, y: number) => {
      const idx = (y * width + x) * 4;
      const gray = (0.299 * sourceData[idx] + 0.587 * sourceData[idx + 1] + 0.114 * sourceData[idx + 2]) / 255;
      return gray >= params.brightnessThreshold;
    };

    for (let y = 0; y < height; y += step) {
      for (let x = 0; x < width; x += step) {
        const idx = y * width + x;
        if (visited[idx]) continue;
        if (!isLit(x, y)) {
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
              if (!visited[nidx] && isLit(nx, ny)) {
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

            points.push({
              x: (targetX - width / 2) * params.xyScale,
              y: -(targetY - height / 2) * params.xyScale,
              z: depthVal * params.depthScale,
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
        const idx = (y * width + x) * 4;
        const luminosity = (0.299 * sourceData[idx] + 0.587 * sourceData[idx+1] + 0.114 * sourceData[idx+2]) / 255;
        let shouldSample = luminosity >= params.brightnessThreshold || (edgeMask && edgeMask[y * width + x] > 128);

        if (shouldSample) {
          for (let d = 0; d < density; d++) {
            const offsetX = density > 1 ? (Math.random() - 0.5) * step : 0;
            const offsetY = density > 1 ? (Math.random() - 0.5) * step : 0;
            const targetX = Math.min(width - 1, Math.max(0, x + offsetX));
            const targetY = Math.min(height - 1, Math.max(0, y + offsetY));

            const sampled = sampleSource(targetX, targetY);
            let dV = getDepthAt(targetX, targetY);
            if (params.invertDepth) dV = 1.0 - dV;

            points.push({
              x: (targetX - width / 2) * params.xyScale,
              y: -(targetY - height / 2) * params.xyScale,
              z: dV * params.depthScale,
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

      points.push({
        x: (targetX - width / 2) * params.xyScale,
        y: -(targetY - height / 2) * params.xyScale,
        z: depthVal * params.depthScale,
        r: (params.whiteOnlyPoints ? 255 : (params.useSourceColors ? sampled.r : 255)) / 255,
        g: (params.whiteOnlyPoints ? 255 : (params.useSourceColors ? sampled.g : 128)) / 255,
        b: (params.whiteOnlyPoints ? 255 : (params.useSourceColors ? sampled.b : 50)) / 255,
        size: 1.5, // Anchors are slightly larger to stand out/be visible
        visibility: 1.0
      });
    }
  }

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

export async function exportToGLB(points: PointData[]): Promise<Blob> {
  // @ts-ignore
  const { GLTFExporter } = await import('three/examples/jsm/exporters/GLTFExporter');
  
  // Filter out points that are hidden (visibility < 0.1 as a safe threshold)
  const visiblePoints = points.filter(p => p.visibility > 0.05);
  
  const geometry = new THREE.BufferGeometry();
  const positions = new Float32Array(visiblePoints.length * 3);
  const colors = new Float32Array(visiblePoints.length * 3);

  visiblePoints.forEach((p, i) => {
    positions[i * 3] = p.x;
    positions[i * 3 + 1] = p.y;
    positions[i * 3 + 2] = p.z;
    colors[i * 3] = p.r;
    colors[i * 3 + 1] = p.g;
    colors[i * 3 + 2] = p.b;
  });

  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));

  // Export sizes as a custom attribute
  const sizes = new Float32Array(visiblePoints.length);
  const normals = new Float32Array(visiblePoints.length * 3);
  visiblePoints.forEach((p, i) => {
    sizes[i] = p.size || 1.0;
    normals[i * 3] = p.size || 1.0; // Abuse normal X for size for legacy importers
  });
  geometry.setAttribute('_size', new THREE.BufferAttribute(sizes, 1));
  geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));

  const material = new THREE.PointsMaterial({ size: 0.1, vertexColors: true, sizeAttenuation: true });
  const pointsMesh = new THREE.Points(geometry, material);
  
  const exporter = new GLTFExporter();
  
  return new Promise((resolve, reject) => {
    exporter.parse(
      pointsMesh,
      (gltf) => {
        if (gltf instanceof ArrayBuffer) {
          resolve(new Blob([gltf], { type: 'model/gltf-binary' }));
        } else {
          resolve(new Blob([JSON.stringify(gltf)], { type: 'application/json' }));
        }
      },
      (error) => reject(error),
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
  depthImage: HTMLImageElement,
  params: SamplingParams,
  sourceWidth: number,
  sourceHeight: number
): THREE.Mesh {
  const meshStep = 4; // 1 vertex per 4 pixels — enough detail without being heavy

  const canvas = document.createElement('canvas');
  // Use source image dimensions — processImages does the same: draws depth scaled to source size
  canvas.width = sourceWidth;
  canvas.height = sourceHeight;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Could not get 2D context for projection mesh');
  // Draw depth image stretched to source dimensions, exactly matching processImages coordinate space
  ctx.drawImage(depthImage, 0, 0, sourceWidth, sourceHeight);
  const depthData = ctx.getImageData(0, 0, sourceWidth, sourceHeight).data;

  const cols = Math.floor(sourceWidth / meshStep);
  const rows = Math.floor(sourceHeight / meshStep);
  const vertCount = cols * rows;

  const positions = new Float32Array(vertCount * 3);
  const indices: number[] = [];

  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const px = col * meshStep;
      const py = row * meshStep;
      const safeX = Math.min(px, sourceWidth - 1);
      const safeY = Math.min(py, sourceHeight - 1);
      const pi = (safeY * sourceWidth + safeX) * 4;

      let depthVal = depthData[pi] / 255;
      if (params.invertDepth) depthVal = 1 - depthVal;

      const i = row * cols + col;
      positions[i * 3]     = (px - sourceWidth / 2) * params.xyScale;
      positions[i * 3 + 1] = -(py - sourceHeight / 2) * params.xyScale;
      positions[i * 3 + 2] = depthVal * params.depthScale;

      if (col < cols - 1 && row < rows - 1) {
        const a = i;
        const b = i + 1;
        const c = i + cols;
        const d = i + cols + 1;
        indices.push(a, c, b, b, c, d);
      }
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setIndex(indices);

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
  // Invisible by default; toggle for debug view
  mesh.visible = false;
  return mesh;
}
