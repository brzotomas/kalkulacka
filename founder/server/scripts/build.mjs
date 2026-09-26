import fs from 'node:fs';
fs.mkdirSync('dist/server',{recursive:true});
fs.mkdirSync('dist/.openai',{recursive:true});
fs.copyFileSync('src/worker.mjs','dist/server/index.js');
fs.copyFileSync('.openai/hosting.json','dist/.openai/hosting.json');
console.log('Founder OS data worker built.');
