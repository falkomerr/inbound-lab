/**
 * Parse a cURL command into URL, method, headers, and body.
 * Shared by the UI (via window.extractCurlData) and Node unit tests.
 * @module public/curlParser
 */

/**
 * @param {string} curlCommand
 * @returns {{ url: string, method: string, headers: Record<string, string>, body: string|null }}
 */
export function extractCurlData(curlCommand) {
  const curl = curlCommand.replace(/\\\r?\n/g, ' ').trim();

  let url = null;
  const urlPatterns = [
    /curl\s+(?:--[a-z-]+\s+)?['"]([https?://][^'"]+)['"]/i,
    /curl\s+['"]([https?://][^'"]+)['"]/,
    /curl\s+(?:--[a-z-]+\s+)?(https?:\/\/[^\s\\]+)/i,
    /curl\s+(https?:\/\/[^\s\\]+)/,
    /(https?:\/\/[^\s'"\\]+)/,
  ];

  for (const pattern of urlPatterns) {
    const match = curl.match(pattern);
    if (match) {
      url = match[1].replace(/['"]/g, '').trim();
      url = url.replace(/\\+$/, '');
      break;
    }
  }

  if (!url) {
    throw new Error('Could not extract URL from cURL command');
  }

  let method = 'GET';
  const methodMatch = curl.match(/-X\s+([A-Z]+)|--request\s+([A-Z]+)/i);
  if (methodMatch) {
    method = (methodMatch[1] || methodMatch[2]).toUpperCase();
  } else if (curl.includes('-d ') || curl.includes('--data')) {
    method = 'POST';
  }

  const headers = {};
  const headerRegex = /(?:-H|--header)\s+(['"])([^:]+?):\s*(.+?)\1/gi;
  let headerMatch;
  while ((headerMatch = headerRegex.exec(curl)) !== null) {
    const key = headerMatch[2].trim();
    const value = headerMatch[3].trim();
    headers[key] = value;
  }

  let body = null;
  const originalCurl = curlCommand.replace(/\\\r?\n/g, '\n').trim();

  const dataPatterns = [/(?:-d|--data|--data-raw|--data-binary)\s+(['"])([\s\S]*?)\1/];

  for (const pattern of dataPatterns) {
    const match = originalCurl.match(pattern);
    if (match) {
      body = match[2];
      break;
    }
  }

  if (!body) {
    const fallbackPatterns = [
      /-d\s+(['"])((?:(?!\1).)*)\1/s,
      /--data\s+(['"])((?:(?!\1).)*)\1/s,
      /--data-raw\s+(['"])((?:(?!\1).)*)\1/s,
    ];

    for (const pattern of fallbackPatterns) {
      const match = curl.match(pattern);
      if (match) {
        body = match[2];
        break;
      }
    }
  }

  if (!body) {
    const simpleDataMatch = curl.match(/(?:-d|--data)\s+(\{[^}]+\}|\S+)/);
    if (simpleDataMatch) {
      body = simpleDataMatch[1];
    }
  }

  if (body) {
    body = body.trim();
    body = body.replace(/\\"/g, '"');

    try {
      const jsonBody = JSON.parse(body);
      body = JSON.stringify(jsonBody, null, 2);
    } catch {
      const cleanBody = body.replace(/\s+/g, ' ').trim();
      try {
        const jsonBody = JSON.parse(cleanBody);
        body = JSON.stringify(jsonBody, null, 2);
      } catch {
        body = body.trim();
      }
    }
  }

  return {
    url,
    method,
    headers,
    body,
  };
}

// Expose for classic-script UI (app.js) and the Vite bundle entry.
if (typeof globalThis !== 'undefined') {
  globalThis.extractCurlData = extractCurlData;
}
