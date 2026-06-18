import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCRIPT = resolve(
  __dirname,
  '../../../understand-anything-plugin/skills/understand/validate-batch-outputs.mjs',
);

function makeProject(batchIndices) {
  const root = mkdtempSync(join(tmpdir(), 'ua-vbo-test-'));
  const intermediate = join(root, '.understand-anything', 'intermediate');
  mkdirSync(intermediate, { recursive: true });
  writeFileSync(
    join(intermediate, 'batches.json'),
    JSON.stringify({
      batches: batchIndices.map(batchIndex => ({ batchIndex, files: [] })),
    }, null, 2),
  );
  return { root, intermediate };
}

function writeBatch(intermediate, name) {
  writeFileSync(join(intermediate, name), JSON.stringify({ nodes: [], edges: [] }, null, 2));
}

function run(root) {
  return spawnSync('node', [SCRIPT, root], { encoding: 'utf-8' });
}

describe('validate-batch-outputs.mjs', () => {
  let root;

  afterEach(() => {
    if (root) rmSync(root, { recursive: true, force: true });
  });

  it('passes when every expected batch has an output', () => {
    const project = makeProject([1, 2, 3]);
    root = project.root;
    writeBatch(project.intermediate, 'batch-1.json');
    writeBatch(project.intermediate, 'batch-2-part-1.json');
    writeBatch(project.intermediate, 'batch-2-part-2.json');
    writeBatch(project.intermediate, 'batch-3.json');

    const result = run(root);
    expect(result.status).toBe(0);
    expect(result.stderr).toContain('3/3 logical batches complete');
  });

  it('fails when an expected batch output is missing', () => {
    const project = makeProject([1, 2, 3]);
    root = project.root;
    writeBatch(project.intermediate, 'batch-1.json');
    writeBatch(project.intermediate, 'batch-3.json');

    const result = run(root);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('missing batch outputs: 2');
    expect(result.stderr).toContain('refusing to merge partial graph');
  });

  it('fails on stale extra batch outputs from an older run', () => {
    const project = makeProject([1, 2]);
    root = project.root;
    writeBatch(project.intermediate, 'batch-1.json');
    writeBatch(project.intermediate, 'batch-2.json');
    writeBatch(project.intermediate, 'batch-3.json');

    const result = run(root);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('unexpected/stale batch outputs: 3');
  });

  it('fails on non-contiguous part outputs', () => {
    const project = makeProject([1]);
    root = project.root;
    writeBatch(project.intermediate, 'batch-1-part-2.json');

    const result = run(root);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('non-contiguous part outputs: 1');
  });
});
