import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import http from 'http';
import https from 'https';
import { parse, URL } from 'url';
import zlib from 'zlib';

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    {
      name: 'cors-proxy',
      configureServer(server) {
        server.middlewares.use('/shutdown', (_req, res) => {
          res.setHeader('Access-Control-Allow-Origin', '*');
          res.setHeader('Content-Type', 'application/json');
          res.statusCode = 200;
          res.end(JSON.stringify({ success: true, message: 'Server is shutting down...' }));

          console.log('[Agraja IPTV] Shutdown requested. Terminating process in 500ms...');
          setTimeout(() => {
            process.exit(0);
          }, 500);
        });

        server.middlewares.use('/check', (req, res) => {
          if (req.method === 'OPTIONS') {
            res.setHeader('Access-Control-Allow-Origin', '*');
            res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
            res.setHeader('Access-Control-Allow-Headers', '*');
            res.statusCode = 200;
            res.end();
            return;
          }

          const parsedUrl = parse(req.url || '', true);
          const targetUrl = parsedUrl.query.url as string;

          if (!targetUrl) {
            res.statusCode = 400;
            res.end(JSON.stringify({ error: 'Missing url query parameter.' }));
            return;
          }

          function performCheck(currentUrl: string, redirectCount = 0) {
            if (redirectCount > 6) {
              res.setHeader('Access-Control-Allow-Origin', '*');
              res.setHeader('Content-Type', 'application/json');
              res.statusCode = 200;
              res.end(JSON.stringify({ online: false, reason: 'max_redirects' }));
              return;
            }

            try {
              const target = parse(currentUrl);
              const client = target.protocol === 'https:' ? https : http;

              const checkReq = client.request({
                hostname: target.hostname,
                port: target.port || (target.protocol === 'https:' ? 443 : 80),
                path: target.path,
                method: 'GET', // Use GET for compatibility, abort once headers arrive
                timeout: 3000, // 3 second timeout
                rejectUnauthorized: false,
                headers: {
                  'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
                }
              }, (checkRes) => {
                const statusCode = checkRes.statusCode || 200;

                // Follow Redirects
                if (statusCode >= 300 && statusCode < 400 && checkRes.headers.location) {
                  checkReq.destroy(); // Abort active connection
                  let location = checkRes.headers.location;
                  if (!location.startsWith('http')) {
                    const resolved = new URL(location, currentUrl);
                    location = resolved.toString();
                  }
                  performCheck(location, redirectCount + 1);
                  return;
                }

                // Immediately destroy request on headers received to save server bandwidth
                checkReq.destroy();

                if (res.headersSent) return;
                res.setHeader('Access-Control-Allow-Origin', '*');
                res.setHeader('Content-Type', 'application/json');

                // 200-399 and 401/403/405 are online (reachable). 404 and 5xx are offline.
                const online = statusCode !== 404 && statusCode < 500;
                res.statusCode = 200;
                res.end(JSON.stringify({ online, status: statusCode }));
              });

              checkReq.on('timeout', () => {
                checkReq.destroy();
                if (res.headersSent) return;
                res.setHeader('Access-Control-Allow-Origin', '*');
                res.setHeader('Content-Type', 'application/json');
                res.statusCode = 200;
                res.end(JSON.stringify({ online: false, reason: 'timeout' }));
              });

              checkReq.on('error', (err) => {
                if (res.headersSent) return;
                res.setHeader('Access-Control-Allow-Origin', '*');
                res.setHeader('Content-Type', 'application/json');
                res.statusCode = 200;
                res.end(JSON.stringify({ online: false, reason: err.message }));
              });

              checkReq.end();
            } catch (err: any) {
              if (res.headersSent) return;
              res.setHeader('Access-Control-Allow-Origin', '*');
              res.setHeader('Content-Type', 'application/json');
              res.statusCode = 200;
              res.end(JSON.stringify({ online: false, reason: err.message }));
            }
          }

          performCheck(targetUrl);
        });

        server.middlewares.use('/proxy', (req, res) => {
          // Handle CORS preflight OPTIONS request
          if (req.method === 'OPTIONS') {
            res.setHeader('Access-Control-Allow-Origin', '*');
            res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
            res.setHeader('Access-Control-Allow-Headers', '*');
            res.statusCode = 200;
            res.end();
            return;
          }

          const parsedUrl = parse(req.url || '', true);
          const targetUrl = parsedUrl.query.url as string;

          if (!targetUrl) {
            res.statusCode = 400;
            res.end('Missing url query parameter.');
            return;
          }

          // Recursive function to perform proxy request and follow redirects
          function performProxyRequest(currentUrl: string, redirectCount = 0) {
            if (redirectCount > 8) {
              res.statusCode = 502;
              res.end('Max redirects exceeded.');
              return;
            }

            try {
              const target = parse(currentUrl);
              const client = target.protocol === 'https:' ? https : http;

              // Copy incoming headers defensively (forward critical and custom headers, filter WAF-blocking headers)
              const headers: Record<string, string> = {};
              for (const key of Object.keys(req.headers)) {
                const lowerKey = key.toLowerCase();
                if (
                  lowerKey === 'host' ||
                  lowerKey === 'connection' ||
                  lowerKey === 'accept-encoding' ||
                  lowerKey.startsWith('sec-')
                ) {
                  continue;
                }
                const val = req.headers[key];
                if (val) {
                  const valStr = String(val);
                  if (lowerKey === 'referer' || lowerKey === 'origin') {
                    if (valStr.includes('localhost') || valStr.includes('127.0.0.1')) {
                      continue;
                    }
                  }
                  headers[key] = valStr;
                }
              }

              headers['host'] = target.host || '';
              headers['accept-encoding'] = 'identity';
              // Add standard user agent to avoid bot-blocking on some streams if not already set
              if (!headers['user-agent']) {
                headers['user-agent'] = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
              }

              const proxyReq = client.request({
                hostname: target.hostname,
                port: target.port || (target.protocol === 'https:' ? 443 : 80),
                path: target.path,
                method: req.method,
                headers,
                rejectUnauthorized: false // Ignore self-signed/expired certs on custom streams
              }, (proxyRes) => {
                const statusCode = proxyRes.statusCode || 200;

                // Follow HTTP Redirects (301, 302, 307, 308)
                if (statusCode >= 300 && statusCode < 400 && proxyRes.headers.location) {
                  let location = proxyRes.headers.location;
                  // Handle relative redirect URL
                  if (!location.startsWith('http')) {
                    const resolved = new URL(location, currentUrl);
                    location = resolved.toString();
                  }
                  console.log(`[Proxy Redirect ${redirectCount + 1}] -> ${location}`);
                  performProxyRequest(location, redirectCount + 1);
                  return;
                }

                // Inject CORS headers
                res.setHeader('Access-Control-Allow-Origin', '*');
                res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
                res.setHeader('Access-Control-Allow-Headers', '*');

                if (proxyRes.headers['content-type']) {
                  res.setHeader('Content-Type', proxyRes.headers['content-type']);
                }

                const contentType = proxyRes.headers['content-type'] || '';
                const isRaw = parsedUrl.query.raw === 'true';
                const isM3U8 = !isRaw && (
                               contentType.includes('mpegurl') || 
                               contentType.includes('x-mpegurl') || 
                               currentUrl.toLowerCase().includes('.m3u8')
                );

                // If it is a playlist manifest (.m3u8), rewrite segment, nested playlist, and key URLs
                if (isM3U8 && req.method === 'GET') {
                  const lastSlash = currentUrl.lastIndexOf('/');
                  const baseUrl = lastSlash !== -1 ? currentUrl.substring(0, lastSlash + 1) : currentUrl;

                  const chunks: Buffer[] = [];
                  proxyRes.on('data', (chunk) => {
                    chunks.push(chunk);
                  });

                  proxyRes.on('end', () => {
                    let buffer = Buffer.concat(chunks);

                    const contentEncoding = proxyRes.headers['content-encoding'] || '';
                    if (contentEncoding.includes('gzip')) {
                      try {
                        buffer = zlib.gunzipSync(buffer);
                      } catch (err: any) {
                        console.error('Failed to gunzip manifest:', err.message);
                      }
                    } else if (contentEncoding.includes('deflate')) {
                      try {
                        buffer = zlib.inflateSync(buffer);
                      } catch (err: any) {
                        console.error('Failed to inflate manifest:', err.message);
                      }
                    } else if (contentEncoding.includes('br')) {
                      try {
                        buffer = zlib.brotliDecompressSync(buffer);
                      } catch (err: any) {
                        console.error('Failed to brotli decompress manifest:', err.message);
                      }
                    }

                    const bodyData = buffer.toString('utf8');
                    const lines = bodyData.split('\n');
                    const rewrittenLines = lines.map((line) => {
                      const trimmed = line.trim();
                      if (!trimmed) return line;

                      if (trimmed.startsWith('#')) {
                        // Look for tag attribute URIs, e.g. URI="something.key" or URI="http://..."
                        if (trimmed.includes('URI="')) {
                          return line.replace(/URI="([^"]+)"/g, (_, p1) => {
                            let absoluteKeyUrl = p1;
                            if (!p1.startsWith('http://') && !p1.startsWith('https://')) {
                              try {
                                absoluteKeyUrl = new URL(p1, baseUrl).toString();
                              } catch (e) {
                                console.warn('Failed resolving relative key path:', p1);
                              }
                            }
                            return `URI="/proxy?url=${encodeURIComponent(absoluteKeyUrl)}"`;
                          });
                        }
                        return line;
                      }

                      // It is a stream or segment path.
                      let absoluteUrl = trimmed;
                      if (!trimmed.startsWith('http://') && !trimmed.startsWith('https://')) {
                        try {
                          absoluteUrl = new URL(trimmed, baseUrl).toString();
                        } catch (e) {
                          console.warn('Failed resolving relative segment path:', trimmed);
                        }
                      }

                      return `/proxy?url=${encodeURIComponent(absoluteUrl)}`;
                    });

                    const rewrittenBody = rewrittenLines.join('\n');
                    res.setHeader('Content-Length', Buffer.byteLength(rewrittenBody));
                    res.statusCode = statusCode;
                    res.end(rewrittenBody);
                  });
                } else {
                  // Direct piping for video binary chunks (.ts files) and other payloads
                  if (proxyRes.headers['content-length']) {
                    res.setHeader('Content-Length', proxyRes.headers['content-length']);
                  }
                  if (proxyRes.headers['content-range']) {
                    res.setHeader('Content-Range', proxyRes.headers['content-range']);
                  }
                  if (proxyRes.headers['accept-ranges']) {
                    res.setHeader('Accept-Ranges', proxyRes.headers['accept-ranges']);
                  }
                  if (proxyRes.headers['content-encoding']) {
                    res.setHeader('Content-Encoding', proxyRes.headers['content-encoding']);
                  }

                  res.statusCode = statusCode;
                  proxyRes.pipe(res);
                }
              });

              proxyReq.on('error', (err) => {
                console.error(`[Proxy Request Error for ${currentUrl}]:`, err.message);
                if (res.headersSent) return;
                res.statusCode = 502;
                res.end(`Proxy request failed: ${err.message}`);
              });

              if (req.method === 'GET' || req.method === 'HEAD') {
                proxyReq.end();
              } else {
                req.pipe(proxyReq);
              }
            } catch (err: any) {
              console.error(`[Proxy General Error for ${currentUrl}]:`, err.message);
              if (res.headersSent) return;
              res.statusCode = 500;
              res.end(`Proxy exception: ${err.message}`);
            }
          }

          // Initial proxy execution
          performProxyRequest(targetUrl);
        });
      }
    }
  ]
});
