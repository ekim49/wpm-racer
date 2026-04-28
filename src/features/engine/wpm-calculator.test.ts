import assert from 'node:assert/strict';
import test from 'node:test';
import { WpmCalculator } from './wpm-calculator.js';

test('getInstantWpm returns null with fewer than two samples', () => {
  const c = new WpmCalculator(12);
  assert.equal(c.getInstantWpm(), null);
  c.recordCorrect(1000);
  assert.equal(c.getInstantWpm(), null);
});

test('window trims to last N timestamps', () => {
  const c = new WpmCalculator(3);
  c.recordCorrect(0);
  c.recordCorrect(1000);
  c.recordCorrect(2000);
  c.recordCorrect(3000);
  // Oldest 0 dropped; window [1000,2000,3000]
  const wpm = c.getInstantWpm();
  assert.ok(wpm !== null);
  // k=3, dt=2000ms -> (3/5)/(2000/60000) = 0.6 / (1/30) = 18
  assert.ok(Math.abs(wpm! - 18) < 0.001);
});

test('undoLastCorrect removes last sample', () => {
  const c = new WpmCalculator(12);
  c.recordCorrect(0);
  c.recordCorrect(1000);
  c.undoLastCorrect();
  assert.equal(c.getInstantWpm(), null);
});

test('formula matches blueprint', () => {
  const c = new WpmCalculator(12);
  const t0 = 0;
  const t1 = 60_000; // 1 minute between first and last
  c.recordCorrect(t0);
  for (let i = 1; i < 10; i++) c.recordCorrect(t0 + (i * (t1 / 9)));
  const wpm = c.getInstantWpm();
  assert.ok(wpm !== null);
  // k=10, dt=t1 -> (10/5)/1 = 2 WPM... wait dt is t_last - t_first = t1
  // (10/5)/(60000/60000) = 2
  assert.ok(Math.abs(wpm! - 2) < 0.01);
});
