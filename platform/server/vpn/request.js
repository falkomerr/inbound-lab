export function createVariables(buffer, now) {
  const bytes = new Uint8Array(buffer);
  bytes[6] = (bytes[6] & 15) | 64;
  bytes[8] = (bytes[8] & 63) | 128;
  const hex = Array.from(bytes.slice(0, 16), (byte) => byte.toString(16).padStart(2, '0')).join('');
  return {
    'random.uuid': `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`,
    'random.int': String(bytes.slice(16, 20).reduce((value, byte) => value * 256 + byte, 0)),
    timestamp: String(now),
  };
}

/** Подставляет только разрешённые переменные без eval; один запрос использует единый набор значений. */
export function materializeRequest(request, variables) {
  const render = (value) =>
    value.replace(
      /\{\{\s*(random\.uuid|random\.int|timestamp)\s*\}\}/g,
      (_, name) => variables[name]
    );
  let url = render(request.url);
  const headers = Object.fromEntries(
    Object.entries(request.headers).map(([name, value]) => [name, render(value)])
  );
  if (request.cacheBust) {
    url = url.split('#')[0];
    const index = url.indexOf('?');
    const base = index < 0 ? url : url.slice(0, index);
    const query =
      index < 0
        ? []
        : url
            .slice(index + 1)
            .split('&')
            .filter((part) => part && !/^__inbound_nonce(?:=|$)/.test(part));
    query.push(`__inbound_nonce=${variables['random.uuid']}`);
    url = `${base}?${query.join('&')}`;
    for (const name of Object.keys(headers)) {
      if (/^(cache-control|pragma)$/i.test(name)) {
        delete headers[name];
      }
    }
    headers['Cache-Control'] = 'no-cache, no-store';
    headers.Pragma = 'no-cache';
  }
  return { ...request, url, headers, body: request.body === null ? null : render(request.body) };
}
