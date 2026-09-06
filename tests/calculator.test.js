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
