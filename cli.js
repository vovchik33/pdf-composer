#!/usr/bin/env node
import { createWriteStream } from 'node:fs';
import { access, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { stdin } from 'node:process';
import archiver from 'archiver';
import { input as promptInput, select } from '@inquirer/prompts';
import { createCanvas } from '@napi-rs/canvas';
import { PDFDocument } from 'pdf-lib';
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';

const OUTPUT_DIR = 'output';

const QUALITY = {
  lowest: { scale: 0.75, jpeg: 45 },
  lower: { scale: 1, jpeg: 55 },
  low: { scale: 1.25, jpeg: 65 },
  medium: { scale: 1.6, jpeg: 76 },
  high: { scale: 2, jpeg: 86 },
  highest: { scale: 2.5, jpeg: 94 },
};

const HELP = `PDF Composer - local PDF and image CLI

Usage:
  pdf-composer
  pdf-composer interactive
  pdf-composer pdf-to-images <input.pdf> [--quality medium] [--origin 0,0] [--rotate 0] [--shift 0,0] [--scale 1,1] [--crop 0,0,width,height] [--output images-folder]
  pdf-composer images-to-pdf <images-folder> [--output merged.pdf]
  pdf-composer compress <input.pdf> [--quality medium] [--origin 0,0] [--rotate 0] [--shift 0,0] [--scale 1,1] [--crop 0,0,width,height] [--output compressed.pdf]
  pdf-composer filter-pages <input.pdf> "1, 3, 5-7, 9-" [--output filtered.pdf]
  pdf-composer booklet <input.pdf> <start-page> <total-page-count> <booklet-count> [--output booklet.pdf]
  pdf-composer book <input.pdf> <start-page> <total-page-count> <booklet-count> [--output booklet.pdf]
  pdf-composer zip <first.pdf> <second.pdf> [--output alternating.pdf]
  pdf-composer merge <first.pdf> <second.pdf> [--output combined.pdf]

Commands:
  pdf-to-images  Render each PDF page to JPG files in a folder.
  images-to-pdf  Put all JPG/PNG files from a folder into one PDF by filename.
  compress       Rebuild a PDF with the selected image quality.
  filter-pages   Create a PDF containing selected pages and page ranges; use 9- for all pages from 9 to the end.
  booklet        Reorder pages for manual duplex booklet printing.
  zip            Create A1, B1, A2, B2 ...; remaining pages are kept at the end.
  merge          Put the complete second PDF after the complete first PDF.

Quality:
  lowest | lower | low | medium | high | highest
  Quality controls PDF-to-image resolution and JPEG compression.

Alignment:
  Interactive pdf-to-images and compress ask whether to align pages after quality.
  Values are in rendered pixels. Rotation is clockwise degrees around the origin.
  --origin 0,0
  --rotate 0
  --shift 0,0
  --scale 1,1
  --crop 0,0,width,height   width and height mean the full page size

Output:
  Generated PDFs are written under the output/ folder.
  --output takes a filename; for example --output report.pdf saves output/report.pdf.
  pdf-to-images writes a folder of JPGs next to the source PDF by default.
  images-to-pdf defaults to output/<images-folder-name>.pdf and avoids overwriting an existing file in interactive mode.
  Before processing, the equivalent pdf-composer command is printed so you can run it again.

Examples:
  pdf-composer
  pdf-composer pdf-to-images report.pdf --quality high
  pdf-composer pdf-to-images scan.pdf --quality high --rotate 1.2 --shift 8,-4 --crop 20,20,1200,1600
  pdf-composer images-to-pdf report-images --output report.pdf
  pdf-composer filter-pages report.pdf "1, 3, 5-7, 9-" --output selected.pdf
  pdf-composer booklet report.pdf 1 80 2 --output report-booklet.pdf
  pdf-composer zip left.pdf right.pdf --output booklet.pdf
`;

const ACTIONS = [
  ['pdf-to-images', 'PDF -> images'],
  ['images-to-pdf', 'Images -> PDF'],
  ['compress', 'Compress a PDF'],
  ['filter-pages', 'Filter pages in PDF'],
  ['booklet', 'Make a booklet'],
  ['zip', 'Zip 2 PDF'],
  ['merge', 'Merge 2 PDF'],
  ['exit', 'Exit'],
];

function fail(message) {
  console.error(`Error: ${message}`);
  process.exitCode = 1;
}

function shellQuote(value) {
  const text = String(value);
  if (text === '') return "''";
  if (/^[A-Za-z0-9_./:@%+=,-]+$/.test(text)) return text;
  return `'${text.replace(/'/g, `'\\''`)}'`;
}

function formatCliCommand(args) {
  return ['pdf-composer', ...args.map(shellQuote)].join(' ');
}

function alignmentFlags(alignment) {
  if (!alignment) return [];
  const cropWidth = alignment.cropWidth ?? 'width';
  const cropHeight = alignment.cropHeight ?? 'height';
  return [
    '--origin', `${alignment.originX},${alignment.originY}`,
    '--rotate', String(alignment.rotate),
    '--shift', `${alignment.shiftX},${alignment.shiftY}`,
    '--scale', `${alignment.scaleX},${alignment.scaleY}`,
    '--crop', `${alignment.cropX},${alignment.cropY},${cropWidth},${cropHeight}`,
  ];
}

function printReplayCommand(args) {
  console.log(formatCliCommand(args));
}

function parseArgs(args) {
  const positional = [];
  const options = {};
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument.startsWith('--')) {
      const [key, inlineValue] = argument.slice(2).split('=', 2);
      if (key === 'output' && index !== args.length - 2 && inlineValue === undefined) {
        throw new Error('--output must be the last parameter.');
      }
      if (key === 'output' && index !== args.length - 1 && inlineValue !== undefined) {
        throw new Error('--output must be the last parameter.');
      }
      options[key] = inlineValue ?? args[++index];
    } else {
      positional.push(argument);
    }
  }
  return { positional, options };
}

function qualityProfile(value) {
  if (!value) return QUALITY.medium;
  if (!QUALITY[value]) throw new Error(`Unknown quality "${value}". Use: ${Object.keys(QUALITY).join(', ')}`);
  return QUALITY[value];
}

function parseNumberToken(value, label) {
  const number = Number(value);
  if (!Number.isFinite(number)) throw new Error(`Invalid ${label} "${value}".`);
  return number;
}

function parseNumberList(value, expected, label) {
  const parts = String(value ?? '').replace(/[\[\]()]/g, '').split(',').map((part) => part.trim()).filter(Boolean);
  if (parts.length !== expected) throw new Error(`${label} must have ${expected} values.`);
  return parts;
}

function parseAlignment(values) {
  const [originX, originY] = parseNumberList(values.origin ?? '0,0', 2, 'Origin point').map((part) => parseNumberToken(part, 'origin'));
  const rotate = parseNumberToken(String(values.rotate ?? '0').replace(/[\[\]()]/g, '').trim(), 'rotate');
  const [shiftX, shiftY] = parseNumberList(values.shift ?? '0,0', 2, 'Shift Page').map((part) => parseNumberToken(part, 'shift'));
  const [scaleX, scaleY] = parseNumberList(values.scale ?? '1,1', 2, 'Scale Page').map((part) => parseNumberToken(part, 'scale'));
  const cropParts = parseNumberList(values.crop ?? '0,0,width,height', 4, 'Crop page');
  const cropX = parseNumberToken(cropParts[0], 'crop');
  const cropY = parseNumberToken(cropParts[1], 'crop');
  const cropWidth = /^(width|w)$/i.test(cropParts[2]) ? null : parseNumberToken(cropParts[2], 'crop');
  const cropHeight = /^(height|h)$/i.test(cropParts[3]) ? null : parseNumberToken(cropParts[3], 'crop');
  return { originX, originY, rotate, shiftX, shiftY, scaleX, scaleY, cropX, cropY, cropWidth, cropHeight };
}

function alignmentFromOptions(options) {
  if (!options.origin && options.rotate === undefined && !options.shift && !options.scale && !options.crop) return null;
  return parseAlignment(options);
}

function isIdentityAlignment(alignment, width, height) {
  if (!alignment) return true;
  const cropWidth = alignment.cropWidth ?? width;
  const cropHeight = alignment.cropHeight ?? height;
  return alignment.rotate === 0
    && alignment.shiftX === 0
    && alignment.shiftY === 0
    && alignment.scaleX === 1
    && alignment.scaleY === 1
    && alignment.cropX === 0
    && alignment.cropY === 0
    && cropWidth === width
    && cropHeight === height;
}

function applyPageAlignment(sourceCanvas, alignment) {
  const width = sourceCanvas.width;
  const height = sourceCanvas.height;
  if (isIdentityAlignment(alignment, width, height)) return sourceCanvas;

  const cropWidth = Math.round(alignment.cropWidth ?? width);
  const cropHeight = Math.round(alignment.cropHeight ?? height);
  if (cropWidth < 1 || cropHeight < 1) throw new Error('Crop width and height must be positive.');

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

function resolveOutputPath(requestedPath) {
  const relative = path.isAbsolute(requestedPath) ? path.basename(requestedPath) : requestedPath;
  const withoutOutputPrefix = relative.replace(/^(?:\.\/)?output[/\\]/, '');
  return path.join(OUTPUT_DIR, withoutOutputPrefix);
}

function outputName(input, suffix, extension) {
  return resolveOutputPath(`${path.basename(input, path.extname(input))}-${suffix}.${extension}`);
}

function defaultImagesFolder(inputPath) {
  const resolvedInput = path.resolve(inputPath);
  return path.join(path.dirname(resolvedInput), `${path.basename(resolvedInput, path.extname(resolvedInput))}-images`);
}

function defaultImagesPdfOutput(imagesFolder) {
  return resolveOutputPath(`${path.basename(path.resolve(imagesFolder))}.pdf`);
}

async function fileExists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function nextAvailableOutput(outputPath) {
  const extension = path.extname(outputPath);
  const basename = outputPath.slice(0, -extension.length);
  let index = 1;
  let candidate = `${basename}-${index}${extension}`;
  while (await fileExists(candidate)) {
    index += 1;
    candidate = `${basename}-${index}${extension}`;
  }
  return candidate;
}

function resolvePdfToImagesOutput(inputPath, requestedOutput) {
  if (!requestedOutput) return defaultImagesFolder(inputPath);
  if (path.isAbsolute(requestedOutput) || path.dirname(requestedOutput) !== '.') return requestedOutput;
  return resolveOutputPath(requestedOutput);
}

function cleanInput(value) {
  return value.trim().replace(/^['"]|['"]$/g, '');
}

async function promptText(ask, message, defaultValue) {
  const answer = cleanInput(await ask(message, defaultValue));
  return answer || defaultValue;
}

async function promptChoice(ask, title, choices) {
  if (stdin.isTTY) {
    return select({
      message: title.trim(),
      choices: choices.map(([value, name]) => ({ name, value })),
    });
  }

  console.log(`\n${title}`);
  choices.forEach((choice, index) => console.log(`  ${index + 1}. ${choice[1]}`));
  while (true) {
    const answer = await ask('Choose a number: ');
    const index = Number(answer.trim()) - 1;
    if (Number.isInteger(index) && choices[index]) return choices[index][0];
    console.log(`Please choose a number from 1 to ${choices.length}.`);
  }
}

async function promptFiles(ask, message, count) {
  const files = [];
  for (let index = 0; index < count; index += 1) {
    files.push(await promptText(ask, `${message} ${index + 1}`, undefined));
  }
  return files.filter(Boolean);
}

async function promptQuality(ask) {
  return promptChoice(ask, 'Choose image quality:', Object.keys(QUALITY).map((name) => [name, name]));
}

async function promptAlignment(ask) {
  const answer = (await promptText(ask, 'Align pages? (y/n)', 'n')).toLowerCase();
  if (answer !== 'y' && answer !== 'yes') return null;
  return parseAlignment({
    origin: await promptText(ask, 'Origin point', '0,0'),
    rotate: await promptText(ask, 'Rotate Page by angle clockwise direction', '0'),
    shift: await promptText(ask, 'Shift Page', '0,0'),
    scale: await promptText(ask, 'Scale Page', '1,1'),
    crop: await promptText(ask, 'Crop page', '0,0,width,height'),
  });
}

async function interactive() {
  const scriptedAnswers = [];
  if (!stdin.isTTY) {
    let scriptedInput = '';
    for await (const chunk of stdin) scriptedInput += chunk.toString();
    scriptedAnswers.push(...scriptedInput.split(/\r?\n/));
  }
  const ask = async (message, defaultValue) => {
    if (stdin.isTTY) return promptInput({ message, default: defaultValue });
    const answer = scriptedAnswers.shift() ?? '';
    const suffix = defaultValue ? ` [${defaultValue}]` : '';
    process.stdout.write(`${message}${suffix}: ${answer}\n`);
    return answer;
  };
  console.log('PDF Composer - interactive mode');
  console.log('Files are processed locally. Enter paths exactly as they appear on disk.');
  let keepGoing = true;
  while (keepGoing) {
      const command = await promptChoice(ask, '\nWhat would you like to do?', ACTIONS);
      if (command === 'exit') break;

      if (command === 'pdf-to-images') {
        const inputPath = await promptText(ask, 'Input PDF');
        if (!inputPath) throw new Error('Input PDF is required.');
        const outputPath = await promptText(ask, 'Output folder', defaultImagesFolder(inputPath));
        const quality = await promptQuality(ask);
        const alignment = await promptAlignment(ask);
        await pdfToImages(inputPath, outputPath, quality, alignment);
      } else if (command === 'compress') {
        const inputPath = await promptText(ask, 'Input PDF');
        if (!inputPath) throw new Error('Input PDF is required.');
        const quality = await promptQuality(ask);
        const alignment = await promptAlignment(ask);
        const outputPath = await promptText(ask, 'Target PDF', outputName(inputPath, 'compressed', 'pdf'));
        await compressPdf(inputPath, outputPath, quality, alignment);
      } else if (command === 'filter-pages') {
        const inputPath = await promptText(ask, 'Input PDF');
        if (!inputPath) throw new Error('Input PDF is required.');
        const totalPages = await getPdfPageCount(inputPath);
        const pageSelection = await promptText(ask, `Pages (${totalPages}) (for example: 1, 3, 5-7, 9-)`);
        const outputPath = await promptText(ask, 'Target PDF', outputName(inputPath, 'filtered', 'pdf'));
        await filterPages(inputPath, pageSelection, outputPath);
      } else if (command === 'booklet') {
        const inputPath = await promptText(ask, 'Input PDF');
        if (!inputPath) throw new Error('Input PDF is required.');
        const startPage = await promptText(ask, 'First page number');
        const pageCount = await promptText(ask, 'Total number of pages');
        const bookletCount = await promptText(ask, 'Number of booklets', '1');
        const outputPath = await promptText(ask, 'Target PDF', bookletOutputName(inputPath));
        if (!outputPath) throw new Error('Target PDF is required.');
        await createBooklet(inputPath, startPage, pageCount, bookletCount, outputPath);
      } else if (command === 'images-to-pdf') {
        const imagesFolder = await promptText(ask, 'Images folder');
        if (!imagesFolder) throw new Error('Images folder is required.');
        const defaultOutput = defaultImagesPdfOutput(imagesFolder);
        let outputPath = await promptText(ask, 'Output PDF', defaultOutput);
        if (await fileExists(resolveOutputPath(outputPath))) {
          const overwrite = (await promptText(ask, `Overwrite ${resolveOutputPath(outputPath)}? (y/n)`, 'n')).toLowerCase();
          if (overwrite !== 'y' && overwrite !== 'yes') {
            outputPath = await nextAvailableOutput(resolveOutputPath(outputPath));
            console.log(`Using available output: ${outputPath}`);
          }
        }
        await imagesToPdf(imagesFolder, outputPath);
      } else {
        const files = await promptFiles(ask, 'Input PDF', 2);
        const defaultOutput = command === 'merge' ? 'combined.pdf' : 'alternating-pages.pdf';
        const outputPath = await promptText(ask, 'Output PDF', defaultOutput);
        await combine(files, command, outputPath);
      }

      const again = await promptText(ask, 'Process another file set? (y/n)', 'n');
      keepGoing = again.toLowerCase() === 'y' || again.toLowerCase() === 'yes';
  }
}

async function renderPages(inputPath, quality, alignment) {
  const bytes = await readFile(inputPath);
  const standardFontDataUrl = `${path.resolve('node_modules/pdfjs-dist/standard_fonts')}${path.sep}`;
  const document = await pdfjsLib.getDocument({ data: new Uint8Array(bytes), disableWorker: true, standardFontDataUrl }).promise;
  const profile = qualityProfile(quality);
  const pages = [];
  for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
    const page = await document.getPage(pageNumber);
    const viewport = page.getViewport({ scale: profile.scale });
    const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
    await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
    const aligned = applyPageAlignment(canvas, alignment);
    pages.push({ name: `page-${String(pageNumber).padStart(3, '0')}.jpg`, bytes: aligned.toBuffer('image/jpeg', profile.jpeg) });
  }
  return pages;
}

async function pdfToImages(inputPath, requestedOutput, quality, alignment) {
  const outputPath = resolvePdfToImagesOutput(inputPath, requestedOutput);
  printReplayCommand([
    'pdf-to-images',
    inputPath,
    '--quality',
    quality || 'medium',
    ...alignmentFlags(alignment),
    '--output',
    outputPath,
  ]);
  const pages = await renderPages(inputPath, quality, alignment);
  const writeZip = outputPath.toLowerCase().endsWith('.zip');
  await mkdir(writeZip ? path.dirname(path.resolve(outputPath)) : outputPath, { recursive: true });
  if (writeZip) {
    await new Promise((resolve, reject) => {
      const archive = archiver('zip', { zlib: { level: 9 } });
      const stream = createWriteStream(outputPath);
      stream.on('close', resolve);
      stream.on('error', reject);
      archive.on('error', reject);
      archive.pipe(stream);
      pages.forEach((page) => archive.append(page.bytes, { name: page.name }));
      archive.finalize();
    });
  } else {
    await Promise.all(pages.map((page) => writeFile(path.join(outputPath, page.name), page.bytes)));
  }
  console.log(`Created ${outputPath} (${pages.length} images, ${quality || 'medium'} quality)`);
}

async function compressPdf(inputPath, requestedOutput, quality, alignment) {
  const outputPath = resolveOutputPath(requestedOutput || outputName(inputPath, 'compressed', 'pdf'));
  printReplayCommand([
    'compress',
    inputPath,
    '--quality',
    quality || 'medium',
    ...alignmentFlags(alignment),
    '--output',
    outputPath,
  ]);
  const pages = await renderPages(inputPath, quality, alignment);
  const pdf = await PDFDocument.create();

  for (const pageImage of pages) {
    const image = await pdf.embedJpg(pageImage.bytes);
    const page = pdf.addPage([image.width, image.height]);
    page.drawImage(image, { x: 0, y: 0, width: image.width, height: image.height });
  }

  await writePdf(pdf, outputPath);
  console.log(`Created ${outputPath} (${pages.length} pages, ${quality || 'medium'} quality)`);
}

async function getPdfPageCount(inputPath) {
  const source = await PDFDocument.load(await readFile(inputPath));
  return source.getPageCount();
}

function parsePageSelection(value, sourcePageCount) {
  const selections = value.split(',').map((part) => part.trim()).filter(Boolean);
  if (selections.length === 0) throw new Error('Provide at least one page number or range.');

  const pageNumbers = [];
  for (const selection of selections) {
    const match = /^(\d+)(?:\s*-\s*(\d*))?$/.exec(selection);
    if (!match) throw new Error(`Invalid page selection "${selection}". Use values like 4, ranges like 4-8, or 4- for the rest.`);
    const first = Number(match[1]);
    const hasRange = match[2] !== undefined;
    const last = hasRange && match[2] === '' ? sourcePageCount : Number(match[2] || match[1]);
    if (first < 1 || last < first) {
      throw new Error(`Invalid page range "${selection}".`);
    }
    for (let pageNumber = first; pageNumber <= last; pageNumber += 1) {
      pageNumbers.push(pageNumber);
    }
  }
  return pageNumbers;
}

async function filterPages(inputPath, requestedPages, requestedOutput) {
  const outputPath = resolveOutputPath(requestedOutput || outputName(inputPath, 'filtered', 'pdf'));
  printReplayCommand(['filter-pages', inputPath, requestedPages, '--output', outputPath]);
  const source = await PDFDocument.load(await readFile(inputPath));
  const sourcePageCount = source.getPageCount();
  const pageNumbers = parsePageSelection(requestedPages, sourcePageCount);
  const invalidPage = pageNumbers.find((pageNumber) => pageNumber > sourcePageCount);
  if (invalidPage) {
    throw new Error(`Page ${invalidPage} is outside the PDF range 1-${sourcePageCount}.`);
  }

  const output = await PDFDocument.create();
  const pages = await output.copyPages(source, pageNumbers.map((pageNumber) => pageNumber - 1));
  pages.forEach((page) => output.addPage(page));
  await writePdf(output, outputPath);
  console.log(`Created ${outputPath} (${pages.length} selected pages)`);
}

async function createBooklet(inputPath, requestedStartPage, requestedTotalPageCount, requestedBookletCount, requestedOutput) {
  const startPage = Number(requestedStartPage);
  const totalPageCount = Number(requestedTotalPageCount);
  const bookletCount = Number(requestedBookletCount);
  if (!Number.isInteger(startPage) || startPage < 1) {
    throw new Error('The first page number must be a positive whole number.');
  }
  if (!Number.isInteger(totalPageCount) || totalPageCount < 1) {
    throw new Error('The total number of pages must be a positive whole number.');
  }
  if (!Number.isInteger(bookletCount) || bookletCount < 1) {
    throw new Error('The number of booklets must be a positive whole number.');
  }
  const pageCount = Math.ceil(totalPageCount / (bookletCount * 4)) * 4;
  const paddedTotalPageCount = pageCount * bookletCount;

  const outputPath = resolveOutputPath(requestedOutput || bookletOutputName(inputPath));
  printReplayCommand(['booklet', inputPath, startPage, totalPageCount, bookletCount, '--output', outputPath]);
  const source = await PDFDocument.load(await readFile(inputPath));
  const output = await PDFDocument.create();
  const sourcePageCount = source.getPageCount();
  const endPage = startPage + totalPageCount - 1;
  if (endPage > sourcePageCount) {
    throw new Error(`The selected range ends at page ${endPage}, but the PDF has ${sourcePageCount} pages.`);
  }
  const blankPageCount = paddedTotalPageCount - totalPageCount;
  if (blankPageCount > 0) {
    const { width, height } = source.getPage(startPage - 1).getSize();
    for (let blankIndex = 0; blankIndex < blankPageCount; blankIndex += 1) {
      source.addPage([width, height]);
    }
  }

  const sheetCount = pageCount / 4;
  for (let bookletIndex = 0; bookletIndex < bookletCount; bookletIndex += 1) {
    const bookletStart = startPage - 1 + bookletIndex * pageCount;
    for (let sheetIndex = 0; sheetIndex < sheetCount; sheetIndex += 1) {
      const first = sheetIndex * 2;
      const last = pageCount - 1 - (sheetIndex * 2);
      const pages = await output.copyPages(source, [bookletStart + last, bookletStart + first]);
      pages.forEach((page) => output.addPage(page));
    }
  }

  for (let bookletIndex = 0; bookletIndex < bookletCount; bookletIndex += 1) {
    const bookletStart = startPage - 1 + bookletIndex * pageCount;
    for (let sheetIndex = 0; sheetIndex < sheetCount; sheetIndex += 1) {
      const first = sheetIndex * 2;
      const last = pageCount - 1 - (sheetIndex * 2);
      const pages = await output.copyPages(source, [bookletStart + first + 1, bookletStart + last - 1]);
      pages.forEach((page) => output.addPage(page));
    }
  }

  await writePdf(output, outputPath);
  const paddingMessage = blankPageCount > 0 ? `, added ${blankPageCount} blank page${blankPageCount === 1 ? '' : 's'}` : '';
  console.log(`Created ${outputPath} (${bookletCount} booklets, pages ${startPage}-${endPage}${paddingMessage}, fronts and backs per booklet)`);
}

function bookletOutputName(inputPath) {
  return resolveOutputPath(`${path.basename(inputPath, path.extname(inputPath))}_booklet.pdf`);
}

async function imagesToPdf(imagesFolder, requestedOutput) {
  const entries = await readdir(imagesFolder, { withFileTypes: true });
  const imageEntries = entries
    .filter((entry) => entry.isFile() && /\.(jpe?g|png)$/i.test(entry.name))
    .sort((first, second) => first.name.localeCompare(second.name, undefined, { numeric: true, sensitivity: 'base' }));
  if (imageEntries.length === 0) throw new Error(`No JPG or PNG images found in "${imagesFolder}".`);
  const inputPaths = imageEntries.map((entry) => path.join(imagesFolder, entry.name));
  const outputPath = resolveOutputPath(requestedOutput || 'merged-images.pdf');
  printReplayCommand(['images-to-pdf', imagesFolder, '--output', outputPath]);
  const pdf = await PDFDocument.create();
  for (const inputPath of inputPaths) {
    const bytes = await readFile(inputPath);
    const extension = path.extname(inputPath).toLowerCase();
    const image = extension === '.png' ? await pdf.embedPng(bytes) : await pdf.embedJpg(bytes);
    const page = pdf.addPage([image.width, image.height]);
    page.drawImage(image, { x: 0, y: 0, width: image.width, height: image.height });
  }
  await writePdf(pdf, outputPath);
  console.log(`Created ${outputPath} (${inputPaths.length} images)`);
}

async function combine(inputPaths, mode, requestedOutput) {
  const outputPath = resolveOutputPath(requestedOutput || (mode === 'merge' ? 'combined.pdf' : 'alternating-pages.pdf'));
  printReplayCommand([mode, ...inputPaths, '--output', outputPath]);
  const output = await PDFDocument.create();
  const documents = await Promise.all(inputPaths.map(async (inputPath) => PDFDocument.load(await readFile(inputPath))));
  if (mode === 'merge') {
    for (const document of documents) {
      const pages = await output.copyPages(document, document.getPageIndices());
      pages.forEach((page) => output.addPage(page));
    }
  } else {
    const [first, second] = documents;
    for (let index = 0; index < Math.max(first.getPageCount(), second.getPageCount()); index += 1) {
      if (index < first.getPageCount()) output.addPage((await output.copyPages(first, [index]))[0]);
      if (index < second.getPageCount()) output.addPage((await output.copyPages(second, [index]))[0]);
    }
  }
  await writePdf(output, outputPath);
  console.log(`Created ${outputPath} (${output.getPageCount()} pages)`);
}

async function writePdf(document, outputPath) {
  await mkdir(path.dirname(path.resolve(outputPath)), { recursive: true });
  await writeFile(outputPath, await document.save());
}

async function main() {
  const [command, ...rawArgs] = process.argv.slice(2);
  if (!command) {
    await interactive();
    return;
  }
  if (command === 'interactive' || command === '-i') {
    await interactive();
    return;
  }
  if (command === '--help' || command === '-h') {
    console.log(HELP);
    return;
  }
  const { positional, options } = parseArgs(rawArgs);
  if (command === 'pdf-to-images') {
    if (positional.length !== 1) throw new Error('Usage: pdf-to-images <input.pdf> [--quality medium] [--origin 0,0] [--rotate 0] [--shift 0,0] [--scale 1,1] [--crop 0,0,width,height] [--output images-folder]');
    await pdfToImages(positional[0], options.output, options.quality, alignmentFromOptions(options));
  } else if (command === 'images-to-pdf') {
    if (positional.length !== 1) throw new Error('Usage: images-to-pdf <images-folder> [--output merged.pdf]');
    await imagesToPdf(positional[0], options.output);
  } else if (command === 'compress') {
    if (positional.length !== 1) throw new Error('Usage: compress <input.pdf> [--quality medium] [--origin 0,0] [--rotate 0] [--shift 0,0] [--scale 1,1] [--crop 0,0,width,height] [--output compressed.pdf]');
    await compressPdf(positional[0], options.output, options.quality, alignmentFromOptions(options));
  } else if (command === 'filter-pages' || command === 'filter') {
    if (positional.length !== 2) throw new Error('Usage: filter-pages <input.pdf> "1, 3, 5-7, 9-" [--output filtered.pdf]');
    await filterPages(positional[0], positional[1], options.output);
  } else if (command === 'booklet' || command === 'book') {
    if (positional.length !== 4) throw new Error('Usage: booklet <input.pdf> <start-page> <page-count> <booklet-count> [--output booklet.pdf]');
    await createBooklet(positional[0], positional[1], positional[2], positional[3], options.output);
  } else if (command === 'zip' || command === 'merge') {
    if (positional.length !== 2) throw new Error(`${command} requires exactly two PDF files.`);
    await combine(positional, command, options.output);
  } else {
    throw new Error(`Unknown command "${command}". Run with --help for usage.`);
  }
}

main().catch((error) => fail(error.message));
