/**
 * Poll until a condition is true or timeout.
 * @param {() => boolean | Promise<boolean>} predicate
 * @param {number} [timeoutMs]
 */
export async function waitFor(predicate, timeoutMs = 5000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    // eslint-disable-next-line no-await-in-loop -- intentional polling
    if (await predicate()) {
      return;
    }
    // eslint-disable-next-line no-await-in-loop -- intentional delay
    await new Promise((r) => {
      setTimeout(r, 50);
    });
  }
  throw new Error('waitFor: condition not met before timeout');
}
