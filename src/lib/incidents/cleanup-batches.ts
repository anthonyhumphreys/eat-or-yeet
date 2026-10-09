export const EPHEMERAL_CLEANUP_BATCH_SIZE = 100;

export function cleanupNeedsContinuation(...counts: number[]): boolean {
  return counts.some((count) => count >= EPHEMERAL_CLEANUP_BATCH_SIZE);
}
