import { ValidationError } from '@crms/kernel';

/**
 * Safe formula expression language (PRD §28.1). A tiny, dependency-free
 * tokenizer + Pratt parser + evaluator. It supports arithmetic, comparison,
 * logical operators, string concatenation, field references, and a fixed set of
 * whitelisted functions. There is NO access to JS runtime, globals, eval or
 * new Function — the language simply cannot express them.
 */

type Token = { type: 'num' | 'str' | 'ident' | 'op' | 'lparen' | 'rparen' | 'comma'; value: string };

const OPERATORS = new Set(['+', '-', '*', '/', '%', '=', '!', '<', '>', '&', '|']);

function tokenize(input: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < input.length) {
    const ch = input[i]!;
    if (/\s/.test(ch)) {
      i++;
      continue;
    }
    if (ch === '"' || ch === "'") {
      const quote = ch;
      let str = '';
      i++;
      while (i < input.length && input[i] !== quote) {
        str += input[i];
        i++;
      }
      i++;
      tokens.push({ type: 'str', value: str });
      continue;
    }
    if (/[0-9.]/.test(ch)) {
      let num = '';
      while (i < input.length && /[0-9.]/.test(input[i]!)) {
        num += input[i];
        i++;
      }
      tokens.push({ type: 'num', value: num });
      continue;
    }
    if (/[a-zA-Z_]/.test(ch)) {
      let id = '';
      while (i < input.length && /[a-zA-Z0-9_.]/.test(input[i]!)) {
        id += input[i];
        i++;
      }
      tokens.push({ type: 'ident', value: id });
      continue;
    }
    if (ch === '(') {
      tokens.push({ type: 'lparen', value: ch });
      i++;
      continue;
    }
    if (ch === ')') {
      tokens.push({ type: 'rparen', value: ch });
      i++;
      continue;
    }
    if (ch === ',') {
      tokens.push({ type: 'comma', value: ch });
      i++;
      continue;
    }
    if (OPERATORS.has(ch)) {
      let op = ch;
      const next = input[i + 1];
      if (next && OPERATORS.has(next) && ['==', '!=', '<=', '>=', '&&', '||'].includes(ch + next)) {
        op = ch + next;
        i++;
      }
      tokens.push({ type: 'op', value: op });
      i++;
      continue;
    }
    throw ValidationError(`Unexpected character in formula: '${ch}'`);
  }
  return tokens;
}

type Node =
  | { kind: 'num'; value: number }
  | { kind: 'str'; value: string }
  | { kind: 'ref'; name: string }
  | { kind: 'call'; name: string; args: Node[] }
  | { kind: 'binary'; op: string; left: Node; right: Node }
  | { kind: 'unary'; op: string; operand: Node };

const PRECEDENCE: Record<string, number> = {
  '||': 1, '&&': 2, '==': 3, '!=': 3, '<': 4, '>': 4, '<=': 4, '>=': 4,
  '+': 5, '-': 5, '&': 5, '*': 6, '/': 6, '%': 6,
};

class Parser {
  private pos = 0;
  constructor(private tokens: Token[]) {}
  private peek(): Token | undefined {
    return this.tokens[this.pos];
  }
  private next(): Token | undefined {
    return this.tokens[this.pos++];
  }
  parse(): Node {
    const node = this.parseExpr(0);
    if (this.pos < this.tokens.length) throw ValidationError('Unexpected trailing tokens in formula');
    return node;
  }
  private parseExpr(minPrec: number): Node {
    let left = this.parseUnary();
    while (true) {
      const t = this.peek();
      if (!t || t.type !== 'op' || PRECEDENCE[t.value] === undefined) break;
      const prec = PRECEDENCE[t.value]!;
      if (prec < minPrec) break;
      this.next();
      const right = this.parseExpr(prec + 1);
      left = { kind: 'binary', op: t.value, left, right };
    }
    return left;
  }
  private parseUnary(): Node {
    const t = this.peek();
    if (t && t.type === 'op' && (t.value === '-' || t.value === '!')) {
      this.next();
      return { kind: 'unary', op: t.value, operand: this.parseUnary() };
    }
    return this.parsePrimary();
  }
  private parsePrimary(): Node {
    const t = this.next();
    if (!t) throw ValidationError('Unexpected end of formula');
    if (t.type === 'num') return { kind: 'num', value: Number(t.value) };
    if (t.type === 'str') return { kind: 'str', value: t.value };
    if (t.type === 'lparen') {
      const node = this.parseExpr(0);
      if (this.next()?.type !== 'rparen') throw ValidationError('Missing closing parenthesis');
      return node;
    }
    if (t.type === 'ident') {
      if (this.peek()?.type === 'lparen') {
        this.next();
        const args: Node[] = [];
        if (this.peek()?.type !== 'rparen') {
          do {
            args.push(this.parseExpr(0));
          } while (this.peek()?.type === 'comma' && this.next());
        }
        if (this.next()?.type !== 'rparen') throw ValidationError('Missing closing parenthesis in function call');
        return { kind: 'call', name: t.value.toUpperCase(), args };
      }
      return { kind: 'ref', name: t.value };
    }
    throw ValidationError(`Unexpected token '${t.value}' in formula`);
  }
}

type Value = number | string | boolean | null;

const FUNCTIONS: Record<string, (args: Value[]) => Value> = {
  IF: (a) => (truthy(a[0]) ? (a[1] ?? null) : (a[2] ?? null)),
  CONCAT: (a) => a.map((v) => (v == null ? '' : String(v))).join(''),
  UPPER: (a) => String(a[0] ?? '').toUpperCase(),
  LOWER: (a) => String(a[0] ?? '').toLowerCase(),
  TRIM: (a) => String(a[0] ?? '').trim(),
  LEN: (a) => String(a[0] ?? '').length,
  ROUND: (a) => Math.round((Number(a[0]) || 0) * 10 ** (Number(a[1]) || 0)) / 10 ** (Number(a[1]) || 0),
  ABS: (a) => Math.abs(Number(a[0]) || 0),
  MIN: (a) => Math.min(...a.map((v) => Number(v) || 0)),
  MAX: (a) => Math.max(...a.map((v) => Number(v) || 0)),
  SUM: (a) => a.reduce<number>((s, v) => s + (Number(v) || 0), 0),
  AVG: (a) => (a.length ? a.reduce<number>((s, v) => s + (Number(v) || 0), 0) / a.length : 0),
  COALESCE: (a) => a.find((v) => v != null && v !== '') ?? null,
  NOT: (a) => !truthy(a[0]),
};

function truthy(v: Value | undefined): boolean {
  return !!v && v !== '0' && v !== 0;
}

function evalNode(node: Node, ctx: Record<string, Value>): Value {
  switch (node.kind) {
    case 'num':
      return node.value;
    case 'str':
      return node.value;
    case 'ref':
      return ctx[node.name] ?? null;
    case 'unary': {
      const v = evalNode(node.operand, ctx);
      return node.op === '-' ? -(Number(v) || 0) : !truthy(v);
    }
    case 'call': {
      const fn = FUNCTIONS[node.name];
      if (!fn) throw ValidationError(`Unknown function '${node.name}'`);
      return fn(node.args.map((a) => evalNode(a, ctx)));
    }
    case 'binary': {
      const l = evalNode(node.left, ctx);
      const r = evalNode(node.right, ctx);
      switch (node.op) {
        case '+':
          return typeof l === 'string' || typeof r === 'string' ? `${l ?? ''}${r ?? ''}` : (Number(l) || 0) + (Number(r) || 0);
        case '-':
          return (Number(l) || 0) - (Number(r) || 0);
        case '*':
          return (Number(l) || 0) * (Number(r) || 0);
        case '/':
          return (Number(r) || 0) === 0 ? null : (Number(l) || 0) / (Number(r) || 0);
        case '%':
          return (Number(l) || 0) % (Number(r) || 0);
        case '&':
          return `${l ?? ''}${r ?? ''}`;
        case '==':
          return l === r;
        case '!=':
          return l !== r;
        case '<':
          return (Number(l) || 0) < (Number(r) || 0);
        case '>':
          return (Number(l) || 0) > (Number(r) || 0);
        case '<=':
          return (Number(l) || 0) <= (Number(r) || 0);
        case '>=':
          return (Number(l) || 0) >= (Number(r) || 0);
        case '&&':
          return truthy(l) && truthy(r);
        case '||':
          return truthy(l) ? l : r;
        default:
          throw ValidationError(`Unknown operator '${node.op}'`);
      }
    }
  }
}

/** Parse + validate a formula at save time (PRD §28.2 AST validation on save). */
export function compileFormula(expression: string): (ctx: Record<string, Value>) => Value {
  const ast = new Parser(tokenize(expression)).parse();
  return (ctx: Record<string, Value>) => evalNode(ast, ctx);
}

export function evaluateFormula(expression: string, ctx: Record<string, Value>): Value {
  return compileFormula(expression)(ctx);
}
