import { z } from "zod";
import { Database } from "./database";

export type OperationRef<A, R> = { readonly name: string; readonly args?: A; readonly result?: R };
export type QueryCtx = { db: Database };
export type MutationCtx = QueryCtx & { scheduler: { runAfter<A, R>(delay: number, ref: OperationRef<A, R>, args: A): Promise<string> } };
export type ActionCtx = {
  runQuery<A, R>(ref: OperationRef<A, R>, args: A): Promise<R>;
  runMutation<A, R>(ref: OperationRef<A, R>, args: A): Promise<R>;
  runAction<A, R>(ref: OperationRef<A, R>, args: A): Promise<R>;
  scheduler: MutationCtx["scheduler"];
  storage: { get(id: string): Promise<Blob | null>; put(id: string, body: string): Promise<void>; delete(id: string): Promise<void> };
};
export type Operation<Shape extends z.ZodRawShape, R, Context = MutationCtx & ActionCtx> = {
  kind: "query" | "mutation" | "action";
  internal: boolean;
  validator: z.ZodObject<Shape>;
  handler: (ctx: Context, args: z.output<z.ZodObject<Shape>>) => R;
};
function define<Context>(kind: Operation<z.ZodRawShape, unknown>["kind"], internal: boolean) {
  return <Shape extends z.ZodRawShape, R>(definition: { args: Shape; handler: Operation<Shape, R, Context>["handler"] }): Operation<Shape, R, Context> => ({ kind, internal, validator: z.strictObject(definition.args), handler: definition.handler });
}
export const query = define<QueryCtx>("query", false);
export const mutation = define<MutationCtx>("mutation", false);
export const action = define<ActionCtx>("action", false);
export const internalQuery = define<QueryCtx>("query", true);
export const internalMutation = define<MutationCtx>("mutation", true);
export const internalAction = define<ActionCtx>("action", true);
export type FunctionReturnType<T> = T extends OperationRef<unknown, infer R> ? R : never;
