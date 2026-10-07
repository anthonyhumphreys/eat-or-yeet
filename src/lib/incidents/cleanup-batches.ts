export const EPHEMERAL_CLEANUP_BATCH_SIZE = 100;

export function cleanupNeedsContinuation(sharesRead: number, rateLimitsRead: number): boolean {
  return sharesRead >= EPHEMERAL_CLEANUP_BATCH_SIZE || rateLimitsRead >= EPHEMERAL_CLEANUP_BATCH_SIZE;
}
