#!/usr/bin/env node
import { copyFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { loadPublicAcquisition } from '../../../../public-acquisition/engine.mjs';
const pkg=path.resolve(import.meta.dirname,'..'),repo=path.resolve(pkg,'../../..'),candidate=path.join(pkg,'export/current');
const mode=process.argv[2];if(process.argv.length!==3||!['--check','--apply'].includes(mode))throw new Error('explicit_install_mode_required');
const manifest=JSON.parse(readFileSync(path.join(candidate,'manifest.json')));
loadPublicAcquisition({manifestPath:path.join(candidate,'manifest.json'),bytesRoot:path.join(candidate,'bytes')});
const files=manifest.assets.map(asset=>['bytes/'+asset.relativePath,asset.sha256]);
const inventory=manifest.assets.find(asset=>asset.role==='archive').inventory;files.push([inventory.path,inventory.fileSha256]);
for(const [relative] of files){const source=path.join(candidate,relative),target=path.join(repo,'public-acquisition',relative);
  if(existsSync(target)&&!readFileSync(source).equals(readFileSync(target)))throw new Error('receiving_file_conflict');}
if(mode==='--apply')for(const [relative] of files){const target=path.join(repo,'public-acquisition',relative);mkdirSync(path.dirname(target),{recursive:true});copyFileSync(path.join(candidate,relative),target);}
process.stdout.write(JSON.stringify({mode,files:files.map(([path,sha256])=>({path,sha256})),publicationVerified:false})+'\n');
