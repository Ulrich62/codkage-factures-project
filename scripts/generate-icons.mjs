import sharp from 'sharp';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const publicDir = resolve(__dirname, '../public');
const svg = readFileSync(resolve(publicDir, 'favicon.svg'));
const maskableSvg = readFileSync(resolve(publicDir, 'icon-maskable.svg'));

await Promise.all([
  sharp(svg).resize(192, 192).png().toFile(resolve(publicDir, 'icon-192.png')),
  sharp(svg).resize(512, 512).png().toFile(resolve(publicDir, 'icon-512.png')),
  sharp(svg).resize(180, 180).png().toFile(resolve(publicDir, 'apple-touch-icon.png')),
  sharp(maskableSvg).resize(512, 512).png().toFile(resolve(publicDir, 'icon-maskable-512.png')),
]);

console.log('Icons generated successfully.');
