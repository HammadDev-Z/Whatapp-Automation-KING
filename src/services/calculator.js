'use strict';

// Pure arithmetic helper for the calculation handler.
// A message counts as a calculation ONLY when the entire trimmed string is a
// valid arithmetic expression built from numbers and the operators + - * /.
// A single leading + or - is allowed; signs are never allowed after an operator
// (so "3++3", "3**3", "3//3" are rejected). No spaces, letters, parentheses,
// or anything else is permitted. Evaluation uses normal precedence: * and /
// before + and -, each group left-to-right. eval() is never used.

const EXPRESSION_PATTERN = /^[+-]?\d+(?:\.\d+)?(?:[+\-*/]\d+(?:\.\d+)?)*$/;
const LEADING_NUMBER_PATTERN = /^[+-]?\d+(?:\.\d+)?/;
const OPERATOR_TERM_PATTERN = /^([+\-*/])(\d+(?:\.\d+)?)/;
const MAX_LENGTH = 500;

function tokenize(expression) {
  const leading = expression.match(LEADING_NUMBER_PATTERN);
  if (!leading) return null;
  const numbers = [Number.parseFloat(leading[0])];
  const operators = [];
  let rest = expression.slice(leading[0].length);
  while (rest.length) {
    const match = rest.match(OPERATOR_TERM_PATTERN);
    if (!match) return null;
    operators.push(match[1]);
    numbers.push(Number.parseFloat(match[2]));
    rest = rest.slice(match[0].length);
  }
  return { numbers, operators };
}

function calculate(input) {
  if (typeof input !== 'string') return null;
  const expr = input.trim();
  if (!expr || expr.length > MAX_LENGTH || !EXPRESSION_PATTERN.test(expr)) return null;

  const tokens = tokenize(expr);
  if (!tokens) return null;
  const { numbers, operators } = tokens;

  // Pass 1: resolve * and /.
  const values = [numbers[0]];
  const addOps = [];
  for (let index = 0; index < operators.length; index += 1) {
    const operator = operators[index];
    const operand = numbers[index + 1];
    if (operator === '*' || operator === '/') {
      const previous = values.pop();
      values.push(operator === '*' ? previous * operand : previous / operand);
    } else {
      addOps.push(operator);
      values.push(operand);
    }
  }

  // Pass 2: resolve + and - left-to-right.
  let result = values[0];
  for (let index = 0; index < addOps.length; index += 1) {
    result = addOps[index] === '+' ? result + values[index + 1] : result - values[index + 1];
  }

  if (!Number.isFinite(result)) return null;
  return { expr, value: result, bare: operators.length === 0 };
}

// Render a number without floating-point artifacts (e.g. 0.1 + 0.2 -> "0.3").
function formatNumber(value) {
  if (!Number.isFinite(value)) return null;
  let rounded = Number(value.toFixed(10));
  if (Object.is(rounded, -0)) rounded = 0;
  return String(rounded);
}

module.exports = { calculate, formatNumber, EXPRESSION_PATTERN };
