import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { after, before, test } from 'node:test';

const root = path.resolve('.');
const port = 4400 + Math.floor(Math.random() * 500);
const token = 'test-token';
let server;
let workDir;

async function waitForServer() {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    try {
      return await fetch(`http://127.0.0.1:${port}/api/health`, {
        headers: { Authorization: `Bearer ${token}` },
      });
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  throw new Error('Web server did not start.');
}

before(async () => {
  workDir = await mkdtemp(path.join(os.tmpdir(), 'pdf-composer-test-'));
  server = spawn(process.execPath, ['web-server.js'], {
    cwd: root,
    env: { ...process.env, PORT: String(port), WEB_AUTH_TOKEN: token, WORK_DIR: workDir },
    stdio: 'ignore',
  });
  const response = await waitForServer();
  assert.equal(response.status, 200);
});

after(async () => {
  server.kill();
  await rm(workDir, { recursive: true, force: true });
});

test('requires authentication for API requests', async () => {
  const response = await fetch(`http://127.0.0.1:${port}/api/health`);
  assert.equal(response.status, 401);
});

test('serves the web application', async () => {
  const response = await fetch(`http://127.0.0.1:${port}/`);
  assert.equal(response.status, 200);
  assert.match(await response.text(), /Combine PDFs and images/);
});

test('rejects an empty upload job', async () => {
  const response = await fetch(`http://127.0.0.1:${port}/api/jobs`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
  });
  assert.equal(response.status, 400);
  assert.equal((await response.json()).error, 'Add at least one PDF or image file.');
});

test('rejects an invalid reorder payload', async () => {
  const response = await fetch(`http://127.0.0.1:${port}/api/jobs/${randomUUID()}/order`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ itemIds: [] }),
  });
  assert.equal(response.status, 404);
});

test('uploads, reorders, and exports image items', async () => {
  const image = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');
  const form = new FormData();
  form.append('files', new Blob([image], { type: 'image/png' }), 'page-2.png');
  form.append('files', new Blob([image], { type: 'image/png' }), 'page-1.png');
  const upload = await fetch(`http://127.0.0.1:${port}/api/jobs`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });
  assert.equal(upload.status, 201);
  const job = await upload.json();
  assert.deepEqual(job.items.map((item) => item.filename), ['page-1.png', 'page-2.png']);

  const reordered = await fetch(`http://127.0.0.1:${port}/api/jobs/${job.id}/order`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ itemIds: job.items.map((item) => item.id).reverse() }),
  });
  assert.equal(reordered.status, 200);

  const pdf = await fetch(`http://127.0.0.1:${port}/api/jobs/${job.id}/export/pdf`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  assert.equal(pdf.status, 200);
  assert.equal(pdf.headers.get('content-type'), 'application/pdf');

  const images = await fetch(`http://127.0.0.1:${port}/api/jobs/${job.id}/export/images`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  assert.equal(images.status, 200);
  assert.match(images.headers.get('content-type'), /application\/zip/);
});
