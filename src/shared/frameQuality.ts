/** Higher means more fine detail: a blurred frame scores low. Mean absolute difference of neighbouring pixels. */
export function sharpnessOf(pixels: Uint8ClampedArray, width: number, height: number): number {
  let total = 0;
  let count = 0;
  for (let y = 0; y < height - 1; y += 2) {
    for (let x = 0; x < width - 1; x += 2) {
      const index = (y * width + x) * 4;
      const here = pixels[index] * 0.3 + pixels[index + 1] * 0.59 + pixels[index + 2] * 0.11;
      const right = pixels[index + 4] * 0.3 + pixels[index + 5] * 0.59 + pixels[index + 6] * 0.11;
      const below =
        pixels[index + width * 4] * 0.3 +
        pixels[index + width * 4 + 1] * 0.59 +
        pixels[index + width * 4 + 2] * 0.11;
      total += Math.abs(here - right) + Math.abs(here - below);
      count += 1;
    }
  }
  return count > 0 ? total / count : 0;
}
