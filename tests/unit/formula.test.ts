import { describe, it, expect } from 'vitest';
import { evaluateFormula, validateScript } from '@crms/sandbox-engine';

/** Formula engine + script safety gate (PRD §28). */
describe('formula engine', () => {
  it('evaluates arithmetic and precedence', () => {
    expect(evaluateFormula('2 + 3 * 4', {})).toBe(14);
    expect(evaluateFormula('(2 + 3) * 4', {})).toBe(20);
  });

  it('resolves field references', () => {
    expect(evaluateFormula('price * quantity', { price: 10, quantity: 3 })).toBe(30);
  });

  it('supports functions and conditionals', () => {
    expect(evaluateFormula('IF(total > 100, "big", "small")', { total: 150 })).toBe('big');
    expect(evaluateFormula('CONCAT(first, " ", last)', { first: 'Ada', last: 'Lovelace' })).toBe('Ada Lovelace');
    expect(evaluateFormula('ROUND(3.14159, 2)', {})).toBe(3.14);
  });

  it('cannot express runtime escapes (no eval/global access)', () => {
    // These are just identifiers/strings to the formula language, never executed.
    expect(() => evaluateFormula('process', {})).not.toThrow();
    expect(evaluateFormula('process', {})).toBe(null);
  });
});

describe('script safety gate', () => {
  it('rejects eval and friends', () => {
    expect(validateScript('eval("x")').ok).toBe(false);
    expect(validateScript('new Function("return 1")').ok).toBe(false);
    expect(validateScript('require("fs")').ok).toBe(false);
    expect(validateScript('process.env.SECRET').ok).toBe(false);
  });
  it('allows benign code', () => {
    expect(validateScript('const x = input.value * 2; return x;').ok).toBe(true);
  });
});
