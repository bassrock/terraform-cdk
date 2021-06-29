// copied from https://github.com/aws/constructs/blob/e01e47f78ef1e9b600efcd23ff7705aa8d384017/lib/private/stack-trace.ts
// tslint:disable-next-line:ban-types
export function captureStackTrace(below?: Function): string[] {
  below = below || captureStackTrace; // hide myself if nothing else
  const object = { stack: "" };
  const previousLimit = Error.stackTraceLimit;
  try {
    Error.stackTraceLimit = Number.MAX_SAFE_INTEGER;
    Error.captureStackTrace(object, below);
  } finally {
    Error.stackTraceLimit = previousLimit;
  }
  if (!object.stack) {
    return [];
  }
  return object.stack
    .split("\n")
    .slice(1)
    .map((s) => s.replace(/^\s*at\s+/, ""));
}
