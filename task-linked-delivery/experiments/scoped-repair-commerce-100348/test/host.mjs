import express from 'express';
import { mountScopedRepairCommerce } from '../route/mount.mjs';
import { SCANNER } from './support.mjs';

const app=express();
app.use((req,res,next)=>{
  if(req.headers['x-test-drop-reply']==='1'){
    const end=res.end.bind(res);res.end=(...args)=>{res.destroy();return res;};res.on('close',()=>{res.end=end;});
  }
  next();
});
mountScopedRepairCommerce(app,{dataDir:process.argv[2],skillguardRoot:SCANNER});
const server=app.listen(0,'127.0.0.1',()=>process.stdout.write(JSON.stringify({base:'http://127.0.0.1:'+server.address().port})+'\n'));
process.on('SIGTERM',()=>server.close(()=>process.exit(0)));
