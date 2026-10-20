import assert from 'node:assert/strict';
import test from 'node:test';
import { formatWorld, partOfDay } from './clock.ts';
import { runEngineSelfTest } from './selfTest.ts';
import { routineAt } from './sim.ts';

test('clock formatting and parts of day', () => {
  // Day 1, 06:00 -> Dawn
  assert.equal(partOfDay(360), 'dawn');
  assert.equal(formatWorld(360, 'part'), 'Day 1 · Dawn');
  // Day 3, 18:42 -> (2 * 1440) + (18 * 60) + 42 = 3990 + 12 = 4002
  assert.equal(partOfDay(4002), 'dusk');
  assert.equal(formatWorld(4002, 'part'), 'Day 3 · Dusk');
  assert.equal(formatWorld(4002, 'time'), 'Day 3 · 18:42');
});

test('pure routineAt returns deterministic schedule', () => {
  const morning = routineAt('seren', 8 * 60);
  assert.equal(morning.place, 'east-gate');
  const midday = routineAt('seren', 12 * 60 + 30);
  assert.equal(midday.place, 'lantern-terrace');
});

test('full engine self-test suite passes all checks (ledger, R1-R8, memory, determinism)', () => {
  const results = runEngineSelfTest();
  assert.ok(results.length >= 11);
  for (const item of results) {
    assert.equal(item.passed, true, `${item.id} (${item.name}) failed: ${item.detail}`);
  }
});
