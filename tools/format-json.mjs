#!/usr/bin/env node

import { readFile, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const indentUnit = '  ';
const execFileAsync = promisify(execFile);

function indent(depth) {
  return indentUnit.repeat(depth);
}

function isScalar(value) {
  return value === null || typeof value !== 'object';
}

function formatValue(value, depth = 0) {
  if (isScalar(value)) return JSON.stringify(value);
  if (Array.isArray(value)) {
    if (value.length === 0) return '[]';
    if (value.every(isScalar)) {
      const items = value.map((item) => formatValue(item, depth + 1));
      return `[${items.join(', ')}]`;
    }
    if (value.every((item) => Array.isArray(item) && item.every(isScalar))) {
      const lines = value.map(
        (item) => `${indent(depth + 1)}${formatValue(item, depth + 1)}`,
      );
      return `[
${lines.join(',\n')}
${indent(depth)}]`;
    }
    const lines = value.map((item) => `${indent(depth + 1)}${formatValue(item, depth + 1)}`);
    return `[
${lines.join(',\n')}
${indent(depth)}]`;
  }
  const entries = Object.entries(value);
  if (entries.length === 0) return '{}';
  const lines = entries.map(
    ([key, child]) => `${indent(depth + 1)}${JSON.stringify(key)}: ${formatValue(child, depth + 1)}`,
  );
  return `{
${lines.join(',\n')}
${indent(depth)}}`;
}

export function formatJson(value) {
  return `${formatValue(value)}\n`;
}

async function main() {
  const argumentsList = process.argv.slice(2);
  const write = argumentsList.includes('--write');
  const tracked = argumentsList.includes('--tracked');
  const paths = argumentsList.filter((argument) => argument !== '--tracked' && argument !== '--write');
  if (tracked) {
    const result = await execFileAsync('git', ['ls-files', '*.json']);
    paths.push(...result.stdout.trim().split('\n').filter(Boolean));
  }
  if (!paths.length)
    throw new Error('Usage: node tools/format-json.mjs [--write] [--tracked] file.json ...');
  for (const path of paths) {
    const value = JSON.parse(await readFile(path, 'utf8'));
    const formatted = formatJson(value);
    if (write) await writeFile(path, formatted);
    else process.stdout.write(formatted);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
