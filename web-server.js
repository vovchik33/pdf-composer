import crypto from 'node:crypto';
import { mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import archiver from 'archiver';
import express from 'express';
import multer from 'multer';
import { createPdfFromImages, renderPdfPages } from './lib/pdf-processing.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '0.0.0.0';
const MAX_FILE_SIZE = Number(process.env.MAX_FILE_SIZE || 25 * 1024 * 1024);
const MAX_TOTAL_UPLOAD = Number(process.env.MAX_TOTAL_UPLOAD || 100 * 1024 * 1024);
const MAX_FILES = Number(process.env.MAX_FILES || 50);
const JOB_TTL_MS = Number(process.env.JOB_TTL_MS || 60 * 60 * 1000);
const WORK_DIR = path.resolve(process.env.WORK_DIR || path.join(__dirname, '.web-data'));
const WEB_AUTH_TOKEN = process.env.WEB_AUTH_TOKEN || '';
const jobs = new Map();
const requestCounts = new Map();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_SIZE, files: MAX_FILES },
});

if (process.env.NODE_ENV === 'production' && !WEB_AUTH_TOKEN) {
  throw new Error('WEB_AUTH_TOKEN must be configured in production.');
}

function fail(message, status = 400) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function extensionFor(file) {
  return path.extname(file.originalname).toLowerCase();
}

function isSupported(file) {
  return ['.pdf', '.jpg', '.jpeg', '.png'].includes(extensionFor(file));
}

function validateUploadSize(files) {
  const total = (files || []).reduce((sum, file) => sum + file.size, 0);
  if (total > MAX_TOTAL_UPLOAD) {
    throw fail(`The combined upload must be smaller than ${Math.round(MAX_TOTAL_UPLOAD / 1024 / 1024)} MB.`);
  }
}

function hasPdfSignature(buffer) {
  return buffer.subarray(0, 5).toString() === '%PDF-';
}

function hasImageSignature(buffer, extension) {
  if (extension === '.png') return buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  return buffer.subarray(0, 3).equals(Buffer.from([255, 216, 255]));
}

function safeName(value) {
  return path.basename(value).replace(/[^a-zA-Z0-9._-]/g, '_') || 'file';
}

function publicItem(item) {
  return {
    id: item.id,
    name: item.name,
    source: item.source,
    filename: item.filename,
    previewUrl: `/api/jobs/${item.jobId}/items/${item.id}`,
  };
}

function jobResponse(job) {
  return { id: job.id, items: job.items.map(publicItem), createdAt: job.createdAt };
}

async function persistJob(job) {
  const manifest = {
    id: job.id,
    createdAt: job.createdAt,
    touchedAt: job.touchedAt,
    items: job.items.map((item) => ({
      id: item.id,
      name: item.name,
      source: item.source,
      filename: item.filename,
      file: path.basename(item.path),
    })),
  };
  const temporaryPath = path.join(job.dir, '.job.json.tmp');
  await writeFile(temporaryPath, JSON.stringify(manifest));
  await rename(temporaryPath, path.join(job.dir, 'job.json'));
}

async function loadJobs() {
  const entries = await readdir(WORK_DIR, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const jobDir = path.join(WORK_DIR, entry.name);
    try {
      const manifest = JSON.parse(await readFile(path.join(jobDir, 'job.json'), 'utf8'));
      if (manifest.id !== entry.name || !Array.isArray(manifest.items)) continue;
      const items = manifest.items.map((item) => ({
        id: item.id,
        jobId: manifest.id,
        name: item.name,
        source: item.source,
        filename: item.filename,
        path: path.join(jobDir, path.basename(item.file)),
      }));
      const job = {
        id: manifest.id,
        dir: jobDir,
        items,
        createdAt: manifest.createdAt,
        touchedAt: manifest.touchedAt,
      };
      jobs.set(job.id, job);
    } catch {
      // Ignore incomplete or expired job directories.
    }
  }
}

async function appendFiles(job, files) {
  if (!files?.length) throw fail('Add at least one PDF or image file.');
  const orderedFiles = [...files].sort((first, second) => first.originalname.localeCompare(second.originalname, undefined, { numeric: true, sensitivity: 'base' }));
  for (const file of orderedFiles) {
      const extension = extensionFor(file);
      if (!isSupported(file)) throw fail(`Unsupported file type: ${file.originalname}`);
      if (extension === '.pdf' && !hasPdfSignature(file.buffer)) throw fail(`Invalid PDF file: ${file.originalname}`);
      if (extension !== '.pdf' && !hasImageSignature(file.buffer, extension)) throw fail(`Invalid image file: ${file.originalname}`);
      const sourceName = safeName(file.originalname);
      if (extension === '.pdf') {
        const sourcePath = path.join(job.dir, `${crypto.randomUUID()}.pdf`);
        await writeFile(sourcePath, file.buffer);
        const pages = await renderPdfPages(sourcePath);
        if (!pages.length) throw fail(`PDF has no pages: ${file.originalname}`);
        for (const [index, page] of pages.entries()) {
          const itemId = crypto.randomUUID();
          const itemPath = path.join(job.dir, `${itemId}.jpg`);
          await writeFile(itemPath, page.bytes);
          job.items.push({
            id: itemId,
            jobId: job.id,
            name: `${sourceName} — page ${index + 1}`,
            source: 'pdf',
            filename: `${path.basename(sourceName, extension)}-page-${index + 1}.jpg`,
            path: itemPath,
          });
        }
      } else {
        const itemId = crypto.randomUUID();
        const itemPath = path.join(job.dir, `${itemId}${extension}`);
        await writeFile(itemPath, file.buffer);
        job.items.push({
          id: itemId,
          jobId: job.id,
          name: sourceName,
          source: 'image',
          filename: sourceName,
          path: itemPath,
        });
      }
  }
  await persistJob(job);
}

async function createJob(files) {
  const id = crypto.randomUUID();
  const jobDir = path.join(WORK_DIR, id);
  await mkdir(jobDir, { recursive: true });
  const job = { id, dir: jobDir, items: [], createdAt: Date.now(), touchedAt: Date.now() };
  try {
    await appendFiles(job, files);
  } catch (error) {
    await rm(jobDir, { recursive: true, force: true });
    throw error;
  }
  await persistJob(job);
  jobs.set(id, job);
  return job;
}

function getJob(id) {
  const job = jobs.get(id);
  if (!job) throw fail('Job not found or expired.', 404);
  job.touchedAt = Date.now();
  return job;
}

function getItem(job, itemId) {
  const item = job.items.find((candidate) => candidate.id === itemId);
  if (!item) throw fail('Item not found.', 404);
  return item;
}

async function removeJob(job) {
  jobs.delete(job.id);
  await rm(job.dir, { recursive: true, force: true });
}

function requireAuth(req, res, next) {
  if (!WEB_AUTH_TOKEN) return next();
  const supplied = req.get('authorization')?.replace(/^Bearer\s+/i, '') || req.get('x-web-token');
  if (supplied !== WEB_AUTH_TOKEN) return res.status(401).json({ error: 'Authentication required.' });
  return next();
}

function rateLimit(req, res, next) {
  const now = Date.now();
  const key = req.ip;
  const current = requestCounts.get(key) || { count: 0, startedAt: now };
  if (now - current.startedAt > 60_000) {
    current.count = 0;
    current.startedAt = now;
  }
  current.count += 1;
  requestCounts.set(key, current);
  if (current.count > 120) return res.status(429).json({ error: 'Too many requests. Try again later.' });
  return next();
}

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '1mb' }));
app.use('/api', rateLimit, requireAuth);
app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/health', (req, res) => res.json({ ok: true }));

app.post('/api/jobs', upload.array('files', MAX_FILES), async (req, res, next) => {
  try {
    validateUploadSize(req.files);
    const job = await createJob(req.files);
    res.status(201).json(jobResponse(job));
  } catch (error) {
    next(error);
  }
});

app.post('/api/jobs/:jobId/files', upload.array('files', MAX_FILES), async (req, res, next) => {
  try {
    validateUploadSize(req.files);
    const job = getJob(req.params.jobId);
    await appendFiles(job, req.files);
    res.json(jobResponse(job));
  } catch (error) {
    next(error);
  }
});

app.get('/api/jobs/:jobId', (req, res, next) => {
  try {
    res.json(jobResponse(getJob(req.params.jobId)));
  } catch (error) {
    next(error);
  }
});

app.put('/api/jobs/:jobId/order', async (req, res, next) => {
  try {
    const job = getJob(req.params.jobId);
    const ids = req.body?.itemIds;
    if (!Array.isArray(ids) || ids.length !== job.items.length || new Set(ids).size !== ids.length) {
      throw fail('itemIds must contain every item exactly once.');
    }
    const byId = new Map(job.items.map((item) => [item.id, item]));
    if (ids.some((id) => !byId.has(id))) throw fail('Unknown item ID in itemIds.');
    job.items = ids.map((id) => byId.get(id));
    await persistJob(job);
    res.json(jobResponse(job));
  } catch (error) {
    next(error);
  }
});

app.delete('/api/jobs/:jobId/items/:itemId', async (req, res, next) => {
  try {
    const job = getJob(req.params.jobId);
    const item = getItem(job, req.params.itemId);
    job.items = job.items.filter((candidate) => candidate.id !== item.id);
    await rm(item.path, { force: true });
    if (!job.items.length) await removeJob(job);
    else await persistJob(job);
    res.status(204).end();
  } catch (error) {
    next(error);
  }
});

app.get('/api/jobs/:jobId/items/:itemId', (req, res, next) => {
  try {
    const item = getItem(getJob(req.params.jobId), req.params.itemId);
    res.sendFile(item.path, { dotfiles: 'allow' });
  } catch (error) {
    next(error);
  }
});

app.get('/api/jobs/:jobId/export/pdf', async (req, res, next) => {
  try {
    const job = getJob(req.params.jobId);
    if (!job.items.length) throw fail('Add at least one item before exporting.');
    const outputPath = path.join(job.dir, 'download.pdf');
    await createPdfFromImages(job.items.map((item) => item.path), outputPath);
    res.download(outputPath, 'pdf-composer.pdf', { dotfiles: 'allow' }, (error) => {
      if (error && !res.headersSent) next(error);
    });
  } catch (error) {
    next(error);
  }
});

app.get('/api/jobs/:jobId/export/images', (req, res, next) => {
  try {
    const job = getJob(req.params.jobId);
    if (!job.items.length) throw fail('Add at least one item before exporting.');
    res.attachment('pdf-composer-images.zip');
    const archive = archiver('zip', { zlib: { level: 9 } });
    archive.on('error', next);
    archive.pipe(res);
    job.items.forEach((item, index) => archive.file(item.path, { name: `${String(index + 1).padStart(3, '0')}-${safeName(item.filename)}` }));
    archive.finalize();
  } catch (error) {
    next(error);
  }
});

app.use((error, req, res, next) => {
  if (res.headersSent) return next(error);
  if (error instanceof multer.MulterError) {
    const message = error.code === 'LIMIT_FILE_SIZE' ? `Each file must be smaller than ${Math.round(MAX_FILE_SIZE / 1024 / 1024)} MB.` : error.message;
    return res.status(400).json({ error: message });
  }
  const status = error.status || 500;
  return res.status(status).json({ error: status === 500 ? 'Server error.' : error.message });
});

setInterval(async () => {
  const cutoff = Date.now() - JOB_TTL_MS;
  for (const job of jobs.values()) {
    if (job.touchedAt < cutoff) await removeJob(job);
  }
}, Math.min(JOB_TTL_MS, 60 * 60 * 1000)).unref();

await mkdir(WORK_DIR, { recursive: true });
await loadJobs();
app.listen(PORT, HOST, () => {
  console.log(`PDF Composer web app listening on http://${HOST}:${PORT}`);
  if (!WEB_AUTH_TOKEN) console.warn('WEB_AUTH_TOKEN is not set; remote deployments should configure authentication.');
});
