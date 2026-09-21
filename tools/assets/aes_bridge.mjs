import { createCipheriv, createDecipheriv } from 'node:crypto';
import { readSync, writeSync } from 'node:fs';

// Private keys travel only through the child process's pipes, never arguments,
// environment variables, logs, or temporary files. Node is already required by
// the application; its built-in crypto avoids an extra Python dependency.
function readExactly(length, allowEnd = false) {
  const result = Buffer.alloc(length);
  let offset = 0;
  while (offset < length) {
    const count = readSync(0, result, offset, length - offset);
    if (count === 0) {
      if (allowEnd && offset === 0) return null;
      throw new Error('Truncated AES request');
    }
    offset += count;
  }
  return result;
}

function writeExactly(data) {
  let offset = 0;
  while (offset < data.length) {
    offset += writeSync(1, data, offset, data.length - offset);
  }
}

try {
  for (;;) {
    const header = readExactly(37, true);
    if (header === null) break;
    const length = header.readUInt32BE(33);
    if (length > 64 * 1024 * 1024 || length % 16 !== 0 || header[0] > 1) {
      throw new Error('Invalid AES request');
    }
    const key = header.subarray(1, 17);
    const iv = header.subarray(17, 33);
    const createContext = header[0] === 1 ? createDecipheriv : createCipheriv;
    const context = createContext('aes-128-cbc', key, iv);
    context.setAutoPadding(false);
    const input = readExactly(length);
    writeExactly(Buffer.concat([context.update(input), context.final()]));
    header.fill(0);
  }
} catch {
  process.stderr.write('The local AES worker could not complete its request.\n');
  process.exitCode = 1;
}
