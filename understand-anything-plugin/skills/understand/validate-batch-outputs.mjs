#!/usr/bin/env node
/**
 * validate-batch-outputs.mjs
 *
 * Hard pre-merge gate for Phase 2. Compares expected batch indices from
 * batches.json with actual batch-*.json file-analyzer outputs. This prevents
 * local/weak models from deciding that a partial graph is "good enough" after
 * memory-guard or context failures.
 *
 * Usage:
 *   node validate-batch-outputs.mjs <project-root>
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

function parseJsonFile(path, label) {
  try {
    return JSON.parse(readFileSync(path, 'utf-8'));
  } catch (err) {
    fail(`Error: validate-batch-outputs: could not parse ${label} at ${path}: ${err.message}`);
  }
}

function summarize(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const preview = sorted.slice(0, 20).join(', ');
  const suffix = sorted.length > 20 ? ` (+${sorted.length - 20} more)` : '';
  return `${preview}${suffix}`;
}

function main() {
  const projectRoot = process.argv[2];
  if (!projectRoot) {
    fail('Usage: node validate-batch-outputs.mjs <project-root>');
  }

  const intermediateDir = join(resolve(projectRoot), '.understand-anything', 'intermediate');
  const batchesPath = join(intermediateDir, 'batches.json');
  if (!existsSync(batchesPath)) {
    fail(`Error: validate-batch-outputs: batches.json not found at ${batchesPath}`);
  }

  const batchesJson = parseJsonFile(batchesPath, 'batches.json');
  const batches = Array.isArray(batchesJson.batches) ? batchesJson.batches : null;
  if (!batches) {
    fail('Error: validate-batch-outputs: batches.json has no batches[] array');
  }

  const expected = new Set();
  for (const batch of batches) {
    if (!Number.isInteger(batch.batchIndex) || batch.batchIndex <= 0) {
      fail('Error: validate-batch-outputs: every batch must have a positive integer batchIndex');
    }
    expected.add(batch.batchIndex);
  }

  const actual = new Map();
  const unrecognized = [];
  const jsonErrors = [];
  const duplicateSingleAndParts = [];
  const missingPartSequences = [];

  for (const name of readdirSync(intermediateDir).filter(n => n.startsWith('batch-') && n.endsWith('.json'))) {
    const m = name.match(/^batch-(\d+)(?:-part-(\d+))?\.json$/);
    if (!m) {
      unrecognized.push(name);
      continue;
    }

    const batchIndex = Number(m[1]);
    const partIndex = m[2] ? Number(m[2]) : null;
    if (!actual.has(batchIndex)) {
      actual.set(batchIndex, { single: false, parts: new Set(), files: [] });
    }
    const entry = actual.get(batchIndex);
    if (partIndex === null) entry.single = true;
    else entry.parts.add(partIndex);
    entry.files.push(name);

    const fragment = parseJsonFile(join(intermediateDir, name), name);
    if (!Array.isArray(fragment.nodes) || !Array.isArray(fragment.edges)) {
      jsonErrors.push(`${name} (expected nodes[] and edges[])`);
    }
  }

  if (jsonErrors.length) {
    fail(
      `Error: validate-batch-outputs: invalid batch output JSON shape: ` +
      `${jsonErrors.slice(0, 10).join(', ')}${jsonErrors.length > 10 ? ` (+${jsonErrors.length - 10} more)` : ''}`,
    );
  }

  for (const [batchIndex, entry] of actual) {
    if (entry.single && entry.parts.size > 0) {
      duplicateSingleAndParts.push(batchIndex);
    }
    if (entry.parts.size > 0) {
      const parts = [...entry.parts].sort((a, b) => a - b);
      for (let i = 0; i < parts.length; i++) {
        if (parts[i] !== i + 1) {
          missingPartSequences.push(batchIndex);
          break;
        }
      }
    }
  }

  const missing = [...expected].filter(i => !actual.has(i));
  const unexpected = [...actual.keys()].filter(i => !expected.has(i));

  const errors = [];
  if (missing.length) {
    errors.push(`missing batch outputs: ${summarize(missing)}`);
  }
  if (unexpected.length) {
    errors.push(`unexpected/stale batch outputs: ${summarize(unexpected)}`);
  }
  if (unrecognized.length) {
    const preview = unrecognized.slice(0, 10).join(', ');
    const suffix = unrecognized.length > 10 ? ` (+${unrecognized.length - 10} more)` : '';
    errors.push(`unrecognized batch output filenames: ${preview}${suffix}`);
  }
  if (duplicateSingleAndParts.length) {
    errors.push(`batches with both single and part outputs: ${summarize(duplicateSingleAndParts)}`);
  }
  if (missingPartSequences.length) {
    errors.push(`batches with non-contiguous part outputs: ${summarize(missingPartSequences)}`);
  }

  if (errors.length) {
    fail(
      `Error: validate-batch-outputs: Phase 2 incomplete; refusing to merge partial graph. ` +
      `${errors.join('; ')}`,
    );
  }

  process.stderr.write(
    `Phase 2 batch output validation passed: ${actual.size}/${expected.size} logical batches complete.\n`,
  );
}

main();
