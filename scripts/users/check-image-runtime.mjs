import assert from 'node:assert/strict';
import sharp from 'sharp';
import { normalizeImage } from '../../services/file-service/dist/files.js';

const jpeg = await sharp({
  create: { width: 800, height: 600, channels: 3, background: '#124833' },
})
  .withMetadata({ orientation: 6 })
  .jpeg()
  .toBuffer();
const result = await sharp(await normalizeImage(jpeg)).metadata();
assert.equal(result.format, 'webp');
assert.equal(result.width, 384);
assert.equal(result.height, 512);
assert.equal(result.exif, undefined);
console.log('Image runtime: JPEG orientation, resize, WebP encoding and metadata removal passed.');
