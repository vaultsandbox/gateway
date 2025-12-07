import { Logger } from '@nestjs/common';

/**
 * Silences NestJS Logger warn/error output for noisy test scenarios.
 * Returns a restore function to reinstate original behavior.
 */
export function silenceNestLogger(): () => void {
  const spies = ['warn', 'error'].map((method) =>
    jest.spyOn(Logger.prototype as Record<string, any>, method).mockImplementation(() => undefined),
  );

  return () => {
    spies.forEach((spy) => spy.mockRestore());
  };
}
