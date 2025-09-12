/**
 * Retrieves a value from a nested object using a dot-separated key path.
 * @param obj The object to query.
 * @param keyPath The dot-separated path (e.g., 'a.b.c').
 * @returns The value found at the key path, or undefined if not found.
 */
export function get(obj: Record<string, unknown>, keyPath: string): unknown {
  return keyPath.split(".").reduce((acc: unknown, key): unknown => {
    if (acc && typeof acc === "object" && key in acc) {
      return (acc as Record<string, unknown>)[key];
    }
    return undefined;
  }, obj);
}

/**
 * Recursively finds all possible dot-separated key paths from a nested object.
 * @param obj The object to process.
 * @param prefix Internal use for recursion.
 * @returns An array of all fully-qualified key paths.
 */
export function getAllKeys(
  obj: Record<string, unknown>,
  prefix = "",
): string[] {
  return Object.entries(obj).flatMap(([key, value]) => {
    const newKey = prefix ? `${prefix}.${key}` : key;
    if (typeof value === "object" && value !== null) {
      return getAllKeys(value as Record<string, unknown>, newKey);
    }
    return newKey;
  });
}
