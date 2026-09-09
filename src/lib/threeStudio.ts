import {
  Box3, Color, DataTexture, LinearFilter, RGBAFormat, SRGBColorSpace, Vector3,
  type Group, type OrthographicCamera,
} from 'three';
import { brand, type BrandPalette } from './palette';

/** A local, static light sweep that glass can refract, rather than an external HDR asset. */
export function createStudioBackground(palette: BrandPalette): DataTexture {
  const size = 96;
  const pixels = new Uint8Array(size * size * 4);
  const base = new Color(palette.surface.body);
  const light = new Color(palette.surface.card);
  const tint = new Color(brand.cool[300]);
  const color = new Color();
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / (size - 1);
      const v = y / (size - 1);
      const glow = Math.max(0, 1 - Math.hypot(u - 0.7, v - 0.75));
      const diagonal = (u - v * 0.65 - 0.12) / 0.12;
      const sweep = Math.exp(-(diagonal * diagonal));
      color.copy(base).lerp(light, 0.25 + glow * 0.65)
        .lerp(tint, sweep * (palette.mode === 'dark' ? 0.055 : 0.035))
        .convertLinearToSRGB();
      const index = (y * size + x) * 4;
      pixels[index] = Math.round(color.r * 255);
      pixels[index + 1] = Math.round(color.g * 255);
      pixels[index + 2] = Math.round(color.b * 255);
      pixels[index + 3] = 255;
    }
  }
  const texture = new DataTexture(pixels, size, size, RGBAFormat);
  texture.colorSpace = SRGBColorSpace;
  texture.minFilter = LinearFilter;
  texture.magFilter = LinearFilter;
  texture.needsUpdate = true;
  return texture;
}

/** Frame the rotated object with consistent breathing room, retaining the user's zoom. */
export function fitStudioCamera(camera: OrthographicCamera, objects: Group, aspect: number): void {
  camera.updateMatrixWorld();
  const bounds = new Box3().setFromObject(objects);
  let halfHeight = 0.25;
  if (!bounds.isEmpty()) {
    for (const x of [bounds.min.x, bounds.max.x]) {
      for (const y of [bounds.min.y, bounds.max.y]) {
        for (const z of [bounds.min.z, bounds.max.z]) {
          const corner = new Vector3(x, y, z).applyMatrix4(camera.matrixWorldInverse);
          halfHeight = Math.max(halfHeight, Math.abs(corner.y), Math.abs(corner.x) / aspect);
        }
      }
    }
  }
  camera.top = halfHeight * 1.25;
  camera.bottom = -camera.top;
  camera.right = camera.top * aspect;
  camera.left = -camera.right;
  camera.updateProjectionMatrix();
}
