import { test } from 'node:test';
import assert from 'node:assert/strict';
import { badgeLabel } from '../src/lib/notification-count.ts';
test('notification counters disappear at zero and display unread numbers with a 99+ limit',()=>{
  assert.equal(badgeLabel(0),undefined);assert.equal(badgeLabel(-1),undefined);
  assert.equal(badgeLabel(1),'1');assert.equal(badgeLabel(12),'12');assert.equal(badgeLabel(100),'99+');assert.equal(badgeLabel(NaN),undefined);
});
