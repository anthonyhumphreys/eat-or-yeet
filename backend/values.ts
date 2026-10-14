import { z } from "zod";

export type Id<Table extends string> = string & { readonly __table: Table };

// Shared validation for stored records and operation arguments. IDs stay opaque
// so a Convex export can retain its existing foreign keys and public links.
export const v = {
  string: () => z.string(),
  number: () => z.number(),
  boolean: () => z.boolean(),
  null: () => z.null(),
  any: () => z.unknown(),
  literal: <T extends string>(value: T) => z.literal(value),
  optional: <T extends z.ZodType>(value: T) => value.optional(),
  array: <T extends z.ZodType>(value: T) => z.array(value),
  object: <T extends z.ZodRawShape>(shape: T) => z.strictObject(shape),
  record: <K extends z.ZodString, T extends z.ZodType>(key: K, value: T) => z.record(key, value),
  union: <T extends [z.ZodType, z.ZodType, ...z.ZodType[]]>(...values: T) => z.union(values),
  id: <T extends string>(_table: T) => z.string().min(1).describe(`ID for ${_table}`).transform((value) => value as Id<T>),
};

export class BackendError extends Error {
  constructor(readonly data: unknown) {
    super(typeof data === "string" ? data : data && typeof data === "object" && "code" in data ? String(data.code) : "The backend operation failed.");
  }
}

export class TableDefinition<Shape extends z.ZodRawShape> {
  readonly validator: z.ZodObject<Shape>;
  readonly indexes: Record<string, string[]> = {};
  constructor(shape: Shape) { this.validator = z.strictObject(shape); }
  index(name: string, fields: Array<keyof Shape & string>): this {
    this.indexes[name] = fields;
    return this;
  }
}

export const defineTable = <T extends z.ZodRawShape>(shape: T) => new TableDefinition(shape);
export const defineSchema = <T extends Record<string, TableDefinition<z.ZodRawShape>>>(tables: T) => tables;
