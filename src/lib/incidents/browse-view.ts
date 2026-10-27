import type { api } from "@backend/api";
import type { FunctionReturnType } from "@backend/operations";
export type BrowsePage = FunctionReturnType<typeof api.browse.list>;
