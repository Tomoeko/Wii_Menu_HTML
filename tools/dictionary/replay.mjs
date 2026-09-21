#!/usr/bin/env node
/** Replay bounded, readable editor commands through the original local worker. */
import { readFile, writeFile } from 'node:fs/promises';
import { createDictionaryService } from '../dictionary-service.mjs';

const [inputPath, outputPath] = process.argv.slice(2);
if (!inputPath || process.argv.length > 4) {
  console.error('Usage: node tools/dictionary/replay.mjs <commands.json> [report.json]');
  process.exitCode = 1;
} else {
  const service = createDictionaryService();
  try {
    const commands = JSON.parse(await readFile(inputPath, 'utf8'));
    if (!Array.isArray(commands) || commands.length > 256) {
      throw new TypeError('Replay must contain at most 256 dictionary commands');
    }
    const results = [];
    for (const command of commands) {
      if (!command || typeof command !== 'object' || Array.isArray(command)) {
        throw new TypeError('Each replay command must be an object');
      }
      results.push({ command, result: await service.query(command) });
    }
    const report = `${JSON.stringify({
      profile: 'USA 4.3',
      executableSha256: '47b9c1bb0ba1890256fb368b1b3272e33ea2467feadf39d20ce469d6de6e6c43',
      engine: 'original-zi8',
      wrapper: 'WithZi',
      results,
    }, null, 2)}\n`;
    if (outputPath) await writeFile(outputPath, report);
    else process.stdout.write(report);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  } finally {
    service.close();
  }
}
