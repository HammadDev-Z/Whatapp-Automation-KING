'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { calculate } = require('../src/services/calculator');

test('÷ (U+00F7) divides, identically to /', () => {
  assert.equal(calculate('90.38÷5').value, calculate('90.38/5').value);
  assert.equal(calculate('90.38÷5').value, 18.076);
  assert.equal(calculate('10÷4÷5').value, calculate('10/4/5').value);
  assert.equal(calculate('3+8÷2').value, 7); // precedence: 3 + (8 ÷ 2)
});

test('÷ result still echoes the original expression as received', () => {
  assert.equal(calculate('90.38÷5').expr, '90.38÷5');
});

test('x / × stay excluded from arithmetic (reserved for code-quantity shorthand)', () => {
  assert.equal(calculate('830x5'), null);
  assert.equal(calculate('830×5'), null);
  assert.equal(calculate('8x2'), null);
});

test('unchanged behaviour: bare unsigned number ignored, signed number accepted', () => {
  assert.equal(calculate('500'), null);
  assert.equal(calculate('+500').value, 500);
  assert.equal(calculate('-12.5').value, -12.5);
});

test('a leading "-" is never neglected, whether the message is one number or a full expression', () => {
  // bare negative number
  assert.deepEqual(calculate('-5'), { expr: '-5', value: -5, bare: true });
  // negative number followed by any operator
  assert.equal(calculate('-32*4').value, -128);
  assert.equal(calculate('-32+4').value, -28);
  assert.equal(calculate('-32-4').value, -36);
  assert.equal(calculate('-32/4').value, -8);
  assert.equal(calculate('-32÷4').value, -8);
  // decimals, multiple operators, still starting with "-"
  assert.equal(calculate('-32.5*4').value, -130);
  assert.equal(calculate('-32*4-10').value, -138);
  assert.equal(calculate('-32+4*2').value, -24); // precedence: -32 + (4*2)
  assert.equal(calculate('-32*4*2').value, -256);
  // none of these are ever "bare" (they have an operator), so they always
  // render as "① expr=result", never silently echoed or dropped
  for (const expr of ['-32*4', '-32+4', '-32-4', '-32/4', '-32*4-10']) {
    const result = calculate(expr);
    assert.ok(result, `expected ${expr} to be a valid calculation`);
    assert.equal(result.bare, false);
    assert.equal(result.expr, expr);
  }
});
