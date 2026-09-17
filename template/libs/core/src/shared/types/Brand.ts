declare const brand: unique symbol;

/**
 * Nominal typing for primitives, so an identifier of one kind cannot be passed
 * where another is expected even though both are strings at runtime.
 */
export type Brand<T, B extends string> = T & { readonly [brand]: B };
