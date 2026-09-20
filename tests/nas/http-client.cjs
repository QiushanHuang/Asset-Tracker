// Real HTTP transport for tests that must exercise an explicit virtual-host authority.
// Node's fetch replaces a supplied Host header with the URL authority.
const http = require('node:http');
module.exports = function wireFetch(url, options = {}) {
  return new Promise((resolve, reject) => {
    const request = http.request(url, {method:options.method || 'GET',headers:options.headers,signal:options.signal}, response => {
      const chunks=[];response.on('data',chunk=>chunks.push(chunk));response.on('end',()=>resolve(new Response(Buffer.concat(chunks),{status:response.statusCode,headers:response.headers})));response.on('error',reject);
    });
    request.on('error',reject);request.end(options.body);
  });
};
