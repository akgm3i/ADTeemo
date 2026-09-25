import { assertEquals } from "@std/assert";

/** Script direct boundary responses; never derive domain decisions in a fake. */
export function strictFake<Args extends unknown[], Result>(
  name: string,
  steps: Array<{
    args?: Args;
    check?: (...args: Args) => void;
    value: Result;
  }>,
) {
  const calls: Args[] = [];
  const failures: unknown[] = [];
  const invoke = (...args: Args): Result => {
    const index = calls.length;
    calls.push(args);
    try {
      const step = steps[index];
      if (!step) throw new Error(`Unexpected call: ${name} #${index + 1}`);
      if (step.args) assertEquals(args, step.args, `${name} arguments`);
      step.check?.(...args);
      return step.value;
    } catch (error) {
      failures.push(error);
      throw error;
    }
  };
  return {
    invoke,
    calls,
    [Symbol.dispose]() {
      // The service may deliberately catch dependency errors. Never let it hide
      // a fake's unexpected call or argument mismatch from the test runner.
      assertEquals(failures, [], `${name} unexpected boundary calls`);
      assertEquals(calls.length, steps.length, `${name} unconsumed responses`);
    },
  };
}
