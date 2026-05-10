#!/usr/bin/env node
import { readdirSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import { join, dirname, resolve, extname } from 'node:path';

const ROOTS = ['src', 'test'];
let touched = 0;

function walk(dir) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) walk(full);
    else if (full.endsWith('.ts') && !full.endsWith('.d.ts')) processFile(full);
  }
}

function processFile(file) {
  const src = readFileSync(file, 'utf8');
  const re = /(from\s+['"]|import\s+['"])(\.{1,2}\/[^'"\n]+?)(['"])/g;
  let changed = false;
  const out = src.replace(re, (match, p1, spec, p3) => {
    if (extname(spec) === '.js') return match;
    const baseDir = dirname(file);
    const resolved = resolve(baseDir, spec);

    let replacement = null;
    try {
      if (statSync(resolved).isDirectory()) replacement = `${spec}/index.js`;
    } catch {}
    if (!replacement) {
      try {
        statSync(resolved + '.ts');
        replacement = `${spec}.js`;
      } catch {}
    }
    if (!replacement) {
      try {
        statSync(resolve(resolved, 'index.ts'));
        replacement = `${spec}/index.js`;
      } catch {}
    }

    if (!replacement) return match;
    changed = true;
    return `${p1}${replacement}${p3}`;
  });
  if (changed) {
    writeFileSync(file, out);
    touched++;
    console.log(`  ${file}`);
  }
}

console.log('Adding .js extensions to relative imports...');
for (const r of ROOTS) walk(r);
console.log(`Done. Modified ${touched} files.`);
