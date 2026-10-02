import {createServer} from 'node:http';
import {readFile,stat} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
const root=fileURLToPath(new URL('../docs/',import.meta.url));
const port=Number(process.env.PORT||4173);
const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.pdf':'application/pdf','.woff':'font/woff','.woff2':'font/woff2','.txt':'text/plain; charset=utf-8'};
createServer(async(req,res)=>{try{const raw=decodeURIComponent(new URL(req.url,'http://localhost').pathname);const relative=raw==='/'?'index.html':raw.replace(/^\/+/, '');let file=path.resolve(root,relative);if(!file.startsWith(root)){res.writeHead(403);res.end();return;}if((await stat(file)).isDirectory())file=path.join(file,'index.html');res.writeHead(200,{'Content-Type':types[path.extname(file)]||'application/octet-stream','Cache-Control':'no-store'});res.end(await readFile(file));}catch{res.writeHead(404,{'Content-Type':'text/plain;charset=utf-8'});res.end('Файл не найден');}}).listen(port,'0.0.0.0',()=>console.log(`Прототип: http://localhost:${port}`));
