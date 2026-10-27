import { describe, expect, it } from "vitest";
import {
  compileExpression,
  evaluateSource,
  MathExpressionError,
  MAX_EVAL_STEPS,
} from "../shared/math/expression";

function errorCode(source: string, x = 0): string {
  try {
    evaluateSource(source, x);
    return "NO_ERROR";
  } catch (error) {
    return error instanceof MathExpressionError ? error.code : "UNKNOWN";
  }
}

describe("mathematical expression engine", () => {
  it("evaluates arithmetic with standard precedence", () => {
    expect(evaluateSource("2 + 3 * 4", 0)).toBe(14);
    expect(evaluateSource("(2 + 3) * 4", 0)).toBe(20);
    expect(evaluateSource("10 - 6 / 2", 0)).toBe(7);
    expect(evaluateSource("2 + 3 * 4 ^ 2", 0)).toBe(50);
  });

  it("handles parentheses and unary negatives with conventional exponent precedence", () => {
    expect(evaluateSource("-2^2", 0)).toBe(-4);
    expect(evaluateSource("(-2)^2", 0)).toBe(4);
    expect(evaluateSource("2^-2", 0)).toBe(0.25);
    expect(evaluateSource("-(3 + 4)", 0)).toBe(-7);
    expect(evaluateSource("--5", 0)).toBe(5);
  });

  it("treats exponentiation as right-associative", () => {
    expect(evaluateSource("2^3^2", 0)).toBe(512);
    expect(evaluateSource("(2^3)^2", 0)).toBe(64);
  });

  it("substitutes the variable x", () => {
    expect(evaluateSource("x^2 + 2*x + 1", 3)).toBe(16);
    expect(evaluateSource("0.02*x^2", 10)).toBeCloseTo(2);
  });

  it("supports trigonometric functions in radians", () => {
    expect(evaluateSource("sin(pi/2)", 0)).toBeCloseTo(1, 12);
    expect(evaluateSource("cos(0)", 0)).toBe(1);
    expect(evaluateSource("tan(pi/4)", 0)).toBeCloseTo(1, 12);
    expect(evaluateSource("asin(1)", 0)).toBeCloseTo(Math.PI / 2, 12);
    expect(evaluateSource("acos(1)", 0)).toBe(0);
    expect(evaluateSource("atan(1)", 0)).toBeCloseTo(Math.PI / 4, 12);
  });

  it("supports exponential, logarithmic, root and absolute functions", () => {
    expect(evaluateSource("sqrt(81)", 0)).toBe(9);
    expect(evaluateSource("abs(-7.5)", 0)).toBe(7.5);
    expect(evaluateSource("ln(e)", 0)).toBeCloseTo(1, 12);
    expect(evaluateSource("log(1000)", 0)).toBeCloseTo(3, 12);
    expect(evaluateSource("exp(0)", 0)).toBe(1);
    expect(evaluateSource("floor(2.9)+ceil(2.1)+round(2.5)+sign(-3)", 0)).toBe(7);
    expect(evaluateSource("tau", 0)).toBeCloseTo(Math.PI * 2, 12);
  });

  it("supports the documented example curves", () => {
    expect(evaluateSource("0.02*x^2", 20)).toBeCloseTo(8);
    expect(evaluateSource("-0.05*(x-20)^2+30", 20)).toBeCloseTo(30);
    expect(evaluateSource("10*sin(x/5)+15", Math.PI * 2.5)).toBeCloseTo(25);
    expect(evaluateSource("sqrt(abs(x))*3", -16)).toBe(12);
  });

  it("rejects malformed syntax and unknown identifiers", () => {
    expect(errorCode("2 +")).toBe("SYNTAX");
    expect(errorCode("sin(1")).toBe("SYNTAX");
    expect(errorCode("2x")).toBe("SYNTAX");
    expect(errorCode("foo(x)")).toBe("UNKNOWN_IDENTIFIER");
    expect(errorCode("2,3")).toBe("UNKNOWN_TOKEN");
    expect(errorCode("")).toBe("EMPTY");
  });

  it("handles division by zero and invalid domains as structured errors", () => {
    expect(errorCode("1/0")).toBe("DIVISION_BY_ZERO");
    expect(errorCode("1/(x-x)")).toBe("DIVISION_BY_ZERO");
    expect(errorCode("sqrt(-1)")).toBe("DOMAIN");
    expect(errorCode("ln(0)")).toBe("DOMAIN");
    expect(errorCode("log(-2)")).toBe("DOMAIN");
    expect(errorCode("asin(2)")).toBe("DOMAIN");
  });

  it("rejects non-finite and out-of-range values", () => {
    expect(errorCode("10^1000000")).toBe("NON_FINITE");
    expect(errorCode("1e6*100")).toBe("RANGE");
    expect(errorCode("1e999999")).toBe("RANGE");
  });

  it("enforces expression length, nesting and token limits", () => {
    expect(errorCode("1".repeat(121))).toBe("TOO_LONG");
    expect(errorCode(`${"(".repeat(20)}1${")".repeat(20)}`)).toBe("COMPLEXITY");
    expect(errorCode(`${"1+".repeat(58)}1`)).toBe("NO_ERROR");
  });

  it("reports AST node counts and exposes a bounded evaluator", () => {
    const compiled = compileExpression("sin(x) + pi*x^2");
    expect(compiled.nodeCount).toBeGreaterThan(4);
    expect(compiled.nodeCount).toBeLessThan(30);
    expect(MAX_EVAL_STEPS).toBeGreaterThan(100);
    expect(() => evaluateSource("1/0", 1)).toThrow(MathExpressionError);
  });
});
