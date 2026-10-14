import type { z } from "zod";
import type schema from "./schema";
export type { Id } from "./values";
import type { Id } from "./values";

export type TableNames = keyof typeof schema;
export type RecordValue<T extends TableNames> = z.output<(typeof schema)[T]["validator"]>;
export type Doc<T extends TableNames> = RecordValue<T> & { _id: Id<T>; _creationTime: number };
