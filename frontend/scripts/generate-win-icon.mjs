import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pngToIco from 'png-to-ico';
import sharp from 'sharp';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

const sourcePng = path.join(rootDir, 'public', 'santipab.png');
const targetIco = path.join(rootDir, 'build', 'santipab.ico');
const iconSizes = [256, 128, 64, 48, 32, 24, 16];

async function main() {
  await fs.access(sourcePng);
  await fs.mkdir(path.dirname(targetIco), { recursive: true });

  const resizedPngBuffers = await Promise.all(
    iconSizes.map((size) =>
      sharp(sourcePng)
        .resize(size, size, { fit: 'contain' })
        .png()
        .toBuffer()
    )
  );

  const icoBuffer = await pngToIco(resizedPngBuffers);
  await fs.writeFile(targetIco, icoBuffer);

  console.log(`[icon] Generated ${targetIco} from ${sourcePng} (${iconSizes.join(', ')})`);
}

main().catch((error) => {
  console.error('[icon] Failed to generate Windows icon:', error);
  process.exit(1);
});
