import test from 'node:test';
import assert from 'node:assert/strict';
import { createLocalPredictor } from '../src/keyboard-prediction.js';

test('local suggestions prioritize learned draft words and respect the selected language', () => {
  const predictor = createLocalPredictor('Helium balloon');
  assert.equal(predictor.suggest('he')[0], 'helium');
  assert.ok(predictor.suggest('he').includes('hello'));
  assert.ok(predictor.suggest('bo', { language: 'fr' }).includes('bonjour'));
  assert.ok(predictor.suggest('ho', { language: 'es' }).includes('hola'));
  assert.ok(!predictor.suggest('ho', { language: 'en' }).includes('hola'));
  predictor.learn('Hermes ');
  assert.ok(predictor.suggest('HE').includes('HERMES'));
});

test('a caller can replace a local vocabulary without losing learned draft words', () => {
  const predictor = createLocalPredictor('Helium', { en: ['helicopter', 'helmet'] });
  assert.deepEqual(predictor.suggest('Hel'), ['Helium', 'Helicopter', 'Helmet']);
  assert.deepEqual(predictor.suggest('helicopter'), []);
});
