#!/usr/bin/env node
// Gera os ícones do app (icon.png, icon.icns, icon.ico) a partir de build/source.png.
// Usado pelo electron-builder para gerar os instaladores de mac/win/linux.
//
// Uso:
//   npm run build:icons
//
// Pré-requisito: existir o arquivo build/source.png (idealmente 1024x1024, quadrado).

import { promises as fs } from 'node:fs';
import path from 'node:path';
import png2icons from 'png2icons';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const BUILD_DIR = path.join(ROOT, 'build');
const SOURCE = path.join(BUILD_DIR, 'source.png');
const ICON_PNG = path.join(BUILD_DIR, 'icon.png');
const ICON_ICNS = path.join(BUILD_DIR, 'icon.icns');
const ICON_ICO = path.join(BUILD_DIR, 'icon.ico');

async function main() {
  let src;
  try {
    src = await fs.readFile(SOURCE);
  } catch (err) {
    console.error(`[icons] Não encontrei ${SOURCE}.`);
    console.error('         Coloque a imagem original (PNG quadrado, idealmente 1024x1024) nesse caminho e tente de novo.');
    process.exit(1);
  }

  // icon.png — usado pelo Linux e como fallback para qualquer plataforma.
  await fs.copyFile(SOURCE, ICON_PNG);
  console.log(`[icons] ${path.relative(ROOT, ICON_PNG)} ok`);

  // icon.icns — macOS.
  const icns = png2icons.createICNS(src, png2icons.BILINEAR, 0);
  if (!icns) throw new Error('Falha ao gerar icon.icns');
  await fs.writeFile(ICON_ICNS, icns);
  console.log(`[icons] ${path.relative(ROOT, ICON_ICNS)} ok`);

  // icon.ico — Windows (16,24,32,48,64,128,256).
  const ico = png2icons.createICO(src, png2icons.BILINEAR, 0, false);
  if (!ico) throw new Error('Falha ao gerar icon.ico');
  await fs.writeFile(ICON_ICO, ico);
  console.log(`[icons] ${path.relative(ROOT, ICON_ICO)} ok`);
}

main().catch((err) => {
  console.error('[icons] erro:', err);
  process.exit(1);
});
