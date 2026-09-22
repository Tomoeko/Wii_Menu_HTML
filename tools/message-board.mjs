#!/usr/bin/env node
import { formatJson } from './format-json.mjs';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { readMessageBoard, writeMessageBoard } from './local-state.mjs';

const store = fileURLToPath(new URL('../.local/message-board.json', import.meta.url));
const [command = 'show', file] = process.argv.slice(2);
try {
  if (command === 'show') console.log(formatJson(await readMessageBoard(store)).trimEnd());
  else if (command === 'export' && file) {
    await writeFile(file, formatJson(await readMessageBoard(store)).trimEnd() + '\n');
    console.log(`Exported Message Board to ${file}`);
  } else if (command === 'import' && file) {
    const state = await writeMessageBoard(store, JSON.parse(await readFile(file, 'utf8')));
    console.log(`Imported ${state.memos.length} memos. Reload the menu to display them.`);
  } else throw new Error('Usage: node tools/message-board.mjs show | export FILE | import FILE');
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
