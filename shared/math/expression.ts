import { MAX_EXPRESSION_LENGTH } from "../types";

export const MAX_AST_NODES = 160;
export const MAX_PARSE_DEPTH = 48;
export const MAX_EVAL_STEPS = 2_000;
export const MAX_NUMERIC_ABS = 1e7;

export type MathErrorCode =
  | "EMPTY"
  | "TOO_LONG"
  | "SYNTAX"
  | "UNKNOWN_TOKEN"
  | "UNKNOWN_IDENTIFIER"
  | "COMPLEXITY"
  | "DIVISION_BY_ZERO"
  | "DOMAIN"
  | "NON_FINITE"
  | "RANGE";

export class MathExpressionError extends Error {
  readonly code: MathErrorCode;
  readonly position?: number;

  constructor(code: MathErrorCode, message: string, position?: number) {
    super(message);
    this.name = "MathExpressionError";
    this.code = code;
    this.position = position;
  }
}

type BinaryOperator = "+" | "-" | "*" | "/" | "^";
type UnaryOperator = "+" | "-";

export type AstNode =
  | { type: "number"; value: number }
  | { type: "variable" }
  | { type: "unary"; op: UnaryOperator; operand: AstNode }
  | { type: "binary"; op: BinaryOperator; left: AstNode; right: AstNode }
  | { type: "call"; name: FunctionName; arg: AstNode };

const FUNCTIONS = {
  sin: Math.sin,
  cos: Math.cos,
  tan: Math.tan,
  asin: Math.asin,
  acos: Math.acos,
  atan: Math.atan,
  sqrt: Math.sqrt,
  abs: Math.abs,
  exp: Math.exp,
  ln: Math.log,
  log: Math.log10,
  floor: Math.floor,
  ceil: Math.ceil,
  round: Math.round,
  sign: Math.sign,
} as const;

type FunctionName = keyof typeof FUNCTIONS;

export interface CompiledExpression {
  source: string;
  ast: AstNode;
  nodeCount: number;
}

interface Token {
  kind: "number" | "identifier" | "operator" | "lparen" | "rparen" | "eof";
  value: string;
  position: number;
}

const NUMBER_PATTERN = /^(?:(?:\d+\.?\d*)|(?:\.\d+))(?:[eE][+-]?\d+)?/;

function tokenize(source: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < source.length) {
    const c = source[i];
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    if (tokens.length >= MAX_AST_NODES * 2 + 20) {
      throw new MathExpressionError("COMPLEXITY", "Expression has too many tokens.", i);
    }
    if (c === "(" || c === ")") {
      tokens.push({ kind: c === "(" ? "lparen" : "rparen", value: c, position: i });
      i++;
      continue;
    }
    if ("+-*/^".includes(c)) {
      tokens.push({ kind: "operator", value: c, position: i });
      i++;
      continue;
    }
    if (/\d/.test(c) || (c === "." && /\d/.test(source[i + 1] ?? ""))) {
      const rest = source.slice(i);
      const match = NUMBER_PATTERN.exec(rest);
      if (!match) {
        throw new MathExpressionError("SYNTAX", `Malformed number at position ${i + 1}.`, i);
      }
      tokens.push({ kind: "number", value: match[0], position: i });
      i += match[0].length;
      continue;
    }
    if (/[A-Za-z]/.test(c)) {
      let end = i + 1;
      while (end < source.length && /[A-Za-z]/.test(source[end])) end++;
      tokens.push({ kind: "identifier", value: source.slice(i, end).toLowerCase(), position: i });
      i = end;
      continue;
    }
    throw new MathExpressionError("UNKNOWN_TOKEN", `Unsupported character “${c}”.`, i);
  }
  tokens.push({ kind: "eof", value: "", position: source.length });
  return tokens;
}

class Parser {
  private index = 0;
  private nodes = 0;

  constructor(
    private readonly tokens: Token[],
    private readonly source: string,
  ) {}

  parse(): AstNode {
    const ast = this.parseAdditive(0);
    if (this.peek().kind !== "eof") {
      throw this.syntax(`Unexpected “${this.peek().value}”.`);
    }
    if (this.nodes > MAX_AST_NODES) {
      throw new MathExpressionError("COMPLEXITY", "Expression is too complex.", 0);
    }
    return ast;
  }

  get nodeCount(): number {
    return this.nodes;
  }

  private peek(): Token {
    return this.tokens[this.index];
  }

  private consume(): Token {
    return this.tokens[this.index++];
  }

  private syntax(message: string): MathExpressionError {
    const token = this.tokens[this.index] ?? this.tokens[this.tokens.length - 1];
    return new MathExpressionError("SYNTAX", message, token?.position ?? this.source.length);
  }

  private node<T extends AstNode>(node: T): T {
    this.nodes++;
    if (this.nodes > MAX_AST_NODES) {
      throw new MathExpressionError("COMPLEXITY", "Expression is too complex.", 0);
    }
    return node;
  }

  private checkDepth(depth: number): void {
    if (depth > MAX_PARSE_DEPTH) {
      throw new MathExpressionError("COMPLEXITY", "Expression nesting is too deep.", this.peek().position);
    }
  }

  private parseAdditive(depth: number): AstNode {
    this.checkDepth(depth);
    let left = this.parseMultiplicative(depth + 1);
    while (this.peek().kind === "operator" && (this.peek().value === "+" || this.peek().value === "-")) {
      const op = this.consume().value as "+" | "-";
      const right = this.parseMultiplicative(depth + 1);
      left = this.node({ type: "binary", op, left, right });
    }
    return left;
  }

  private parseMultiplicative(depth: number): AstNode {
    this.checkDepth(depth);
    let left = this.parseUnary(depth + 1);
    while (this.peek().kind === "operator" && (this.peek().value === "*" || this.peek().value === "/")) {
      const op = this.consume().value as "*" | "/";
      const right = this.parseUnary(depth + 1);
      left = this.node({ type: "binary", op, left, right });
    }
    return left;
  }

  private parseUnary(depth: number): AstNode {
    this.checkDepth(depth);
    const token = this.peek();
    if (token.kind === "operator" && (token.value === "+" || token.value === "-")) {
      this.consume();
      return this.node({ type: "unary", op: token.value as "+" | "-", operand: this.parseUnary(depth + 1) });
    }
    return this.parsePower(depth + 1);
  }

  private parsePower(depth: number): AstNode {
    this.checkDepth(depth);
    const left = this.parsePrimary(depth + 1);
    if (this.peek().kind === "operator" && this.peek().value === "^") {
      this.consume();
      // Right associative, and a unary sign is permitted in the exponent.
      const right = this.parseUnary(depth + 1);
      return this.node({ type: "binary", op: "^", left, right });
    }
    return left;
  }

  private parsePrimary(depth: number): AstNode {
    this.checkDepth(depth);
    const token = this.consume();
    if (token.kind === "number") {
      const value = Number(token.value);
      if (!Number.isFinite(value) || Math.abs(value) > MAX_NUMERIC_ABS) {
        throw new MathExpressionError("RANGE", "Numeric literal is outside the supported range.", token.position);
      }
      return this.node({ type: "number", value });
    }
    if (token.kind === "identifier") {
      if (token.value === "x") return this.node({ type: "variable" });
      if (token.value === "pi") return this.node({ type: "number", value: Math.PI });
      if (token.value === "e") return this.node({ type: "number", value: Math.E });
      if (token.value === "tau") return this.node({ type: "number", value: Math.PI * 2 });
      if (!(token.value in FUNCTIONS)) {
        throw new MathExpressionError(
          "UNKNOWN_IDENTIFIER",
          `Unknown identifier “${token.value}”. Supported functions: ${Object.keys(FUNCTIONS).join(", ")}.`,
          token.position,
        );
      }
      if (this.peek().kind !== "lparen") {
        throw this.syntax(`Expected “(” after ${token.value}.`);
      }
      this.consume();
      const arg = this.parseAdditive(depth + 1);
      if (this.peek().kind !== "rparen") {
        throw this.syntax("Expected a closing parenthesis.");
      }
      this.consume();
      return this.node({ type: "call", name: token.value as FunctionName, arg });
    }
    if (token.kind === "lparen") {
      const value = this.parseAdditive(depth + 1);
      if (this.peek().kind !== "rparen") {
        throw this.syntax("Expected a closing parenthesis.");
      }
      this.consume();
      return value;
    }
    if (token.kind === "eof") {
      throw this.syntax("Unexpected end of expression.");
    }
    throw this.syntax(`Expected a number, x, function, or “(”, got “${token.value}”.`);
  }
}

export function compileExpression(source: string): CompiledExpression {
  const trimmed = source.trim();
  if (!trimmed) {
    throw new MathExpressionError("EMPTY", "Enter an expression such as 10*sin(x/5).", 0);
  }
  if (trimmed.length > MAX_EXPRESSION_LENGTH) {
    throw new MathExpressionError("TOO_LONG", `Expressions are limited to ${MAX_EXPRESSION_LENGTH} characters.`, 0);
  }
  const tokens = tokenize(trimmed);
  const parser = new Parser(tokens, trimmed);
  const ast = parser.parse();
  return { source: trimmed, ast, nodeCount: parser.nodeCount };
}

function finite(value: number, message: string): number {
  if (!Number.isFinite(value)) {
    throw new MathExpressionError("NON_FINITE", message);
  }
  if (Math.abs(value) > MAX_NUMERIC_ABS) {
    throw new MathExpressionError("RANGE", "A value exceeded the supported numeric range.");
  }
  return value;
}

export interface EvalResult {
  value: number;
  steps: number;
}

export function evaluateExpression(compiled: CompiledExpression, x: number): EvalResult {
  let steps = 0;

  const evaluate = (node: AstNode): number => {
    steps++;
    if (steps > MAX_EVAL_STEPS) {
      throw new MathExpressionError("COMPLEXITY", "Evaluation exceeded the operation limit.");
    }
    switch (node.type) {
      case "number":
        return node.value;
      case "variable":
        return x;
      case "unary": {
        const value = evaluate(node.operand);
        return node.op === "-" ? finite(-value, "Negation produced a non-finite value.") : value;
      }
      case "binary": {
        const left = evaluate(node.left);
        const right = evaluate(node.right);
        switch (node.op) {
          case "+":
            return finite(left + right, "Addition overflowed.");
          case "-":
            return finite(left - right, "Subtraction overflowed.");
          case "*":
            return finite(left * right, "Multiplication overflowed.");
          case "/":
            if (right === 0) throw new MathExpressionError("DIVISION_BY_ZERO", "Division by zero.");
            return finite(left / right, "Division overflowed.");
          case "^": {
            if (left === 0 && right < 0) {
              throw new MathExpressionError("DIVISION_BY_ZERO", "Zero cannot be raised to a negative power.");
            }
            return finite(Math.pow(left, right), "Exponentiation overflowed.");
          }
        }
        break;
      }
      case "call": {
        const arg = evaluate(node.arg);
        if ((node.name === "sqrt" && arg < 0) || ((node.name === "ln" || node.name === "log") && arg <= 0)) {
          throw new MathExpressionError("DOMAIN", `${node.name} is outside its real-valued domain here.`);
        }
        if ((node.name === "asin" || node.name === "acos") && (arg < -1 || arg > 1)) {
          throw new MathExpressionError("DOMAIN", `${node.name} expects a value between -1 and 1.`);
        }
        return finite(FUNCTIONS[node.name](arg), `${node.name} produced a non-finite result.`);
      }
    }
    throw new MathExpressionError("SYNTAX", "Malformed expression tree.");
  };

  const value = evaluate(compiled.ast);
  return { value, steps };
}

/** Parse and evaluate once; convenient for previews and tests. */
export function evaluateSource(source: string, x: number): number {
  return evaluateExpression(compileExpression(source), x).value;
}
