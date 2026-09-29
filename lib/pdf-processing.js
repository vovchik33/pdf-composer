import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createCanvas } from '@napi-rs/canvas';
import { PDFDocument } from 'pdf-lib';
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';

export const QUALITY = {
  lowest: { scale: 0.75, jpeg: 45 },
  lower: { scale: 1, jpeg: 55 },
  low: { scale: 1.25, jpeg: 65 },
  medium: { scale: 1.6, jpeg: 76 },
  high: { scale: 2, jpeg: 86 },
  highest: { scale: 2.5, jpeg: 94 },
};

function applyAlignment(sourceCanvas, alignment) {
  if (!alignment) return sourceCanvas;
  const width = sourceCanvas.width;
  const height = sourceCanvas.height;
  const cropWidth = Math.round(alignment.cropWidth ?? width);
  const cropHeight = Math.round(alignment.cropHeight ?? height);
  const output = createCanvas(cropWidth, cropHeight);
  const context = output.getContext('2d');
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, cropWidth, cropHeight);
  context.translate(-alignment.cropX, -alignment.cropY);
  context.translate(alignment.shiftX, alignment.shiftY);
  context.translate(alignment.originX, alignment.originY);
  context.rotate((alignment.rotate * Math.PI) / 180);
  context.scale(alignment.scaleX, alignment.scaleY);
  context.translate(-alignment.originX, -alignment.originY);
  context.drawImage(sourceCanvas, 0, 0);
  return output;
}

export async function renderPdfPages(inputPath, quality = 'medium', alignment = null) {
  const bytes = await readFile(inputPath);
  const standardFontDataUrl = `${path.resolve('node_modules/pdfjs-dist/standard_fonts')}${path.sep}`;
  const document = await pdfjsLib.getDocument({
    data: new Uint8Array(bytes),
    disableWorker: true,
    standardFontDataUrl,
  }).promise;
  const profile = QUALITY[quality] || QUALITY.medium;
  const pages = [];
  for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
    const page = await document.getPage(pageNumber);
    const viewport = page.getViewport({ scale: profile.scale });
    const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
    await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
    const aligned = applyAlignment(canvas, alignment);
    pages.push({
      name: `page-${String(pageNumber).padStart(3, '0')}.jpg`,
      bytes: aligned.toBuffer('image/jpeg', profile.jpeg),
      width: aligned.width,
      height: aligned.height,
    });
  }
  return pages;
}

export async function createPdfFromImages(imagePaths, outputPath) {
  const pdf = await PDFDocument.create();
  for (const imagePath of imagePaths) {
    const bytes = await readFile(imagePath);
    const extension = path.extname(imagePath).toLowerCase();
    const image = extension === '.png' ? await pdf.embedPng(bytes) : await pdf.embedJpg(bytes);
    const page = pdf.addPage([image.width, image.height]);
    page.drawImage(image, { x: 0, y: 0, width: image.width, height: image.height });
  }
  await writeFile(outputPath, await pdf.save());
}
