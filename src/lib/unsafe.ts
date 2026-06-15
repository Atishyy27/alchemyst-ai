/**
 * ESCAPE HATCH: This file is the ONLY file in the project allowed to contain
 * 'any' types or '@ts-ignore' directives.
 *
 * To maintain strict type safety and code quality, ESLint is configured to
 * enforce strict TypeScript rules on all other files. Use this file if you
 * absolutely must perform unsafely-typed operations or bypass compiler/lint
 * rules.
 */

// Example helper function utilizing 'any' to cast under the hood
export function castToAny(value: unknown): any {
  return value;
}

// Example bypass using ts-ignore
// @ts-ignore
export const unsafeGlobal: any = {};
