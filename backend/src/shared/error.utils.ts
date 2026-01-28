/**
 * Extracts a string message from an unknown error value.
 * Handles both Error instances and arbitrary thrown values.
 *
 * @param error - The caught error value (Error instance or any thrown value)
 * @returns The error message string
 */
export function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
