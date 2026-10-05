import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import type { Socket } from 'node:net';

/** Real localhost RFC6455 test server. No screen-reader or browser behavior is claimed. */
export async function mockAtDriverServer(options: { onCommand?: (command: any, output: (text: string) => void) => void } = {}) {
  const sockets = new Set<Socket>();
  const commands: any[] = [];
  const server = createServer((_request, response) => response.writeHead(404).end());
  server.on('upgrade', (request, rawSocket) => {
    const socket = rawSocket as Socket; sockets.add(socket);
    socket.on('close',()=>sockets.delete(socket));
    const accept = createHash('sha1').update(String(request.headers['sec-websocket-key'])+'258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
    socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
    const send=(data:unknown)=>{
      const payload=Buffer.from(JSON.stringify(data));
      const header=payload.length<126?Buffer.from([0x81,payload.length]):Buffer.from([0x81,126,payload.length>>8,payload.length&255]);
      if (!socket.destroyed) socket.write(Buffer.concat([header,payload]));
    };
    const output=(text:string)=>send({method:'interaction.capturedOutput',params:{data:text}});
    let pending=Buffer.alloc(0);
    socket.on('data',(chunk:Buffer)=>{
      pending=Buffer.concat([pending,chunk]);
      while(pending.length>=2){
        const opcode=pending[0]!&15;const masked=(pending[1]!&128)!==0;let length=pending[1]!&127;let offset=2;
        if(length===126){if(pending.length<4)return;length=pending.readUInt16BE(2);offset=4;}
        if(length===127){socket.destroy();return;}
        const maskOffset=offset;if(masked)offset+=4;
        if(pending.length<offset+length)return;
        const body=Buffer.from(pending.subarray(offset,offset+length));
        if(masked)for(let i=0;i<body.length;i++)body[i]^=pending[maskOffset+(i%4)]!;
        pending=pending.subarray(offset+length);
        if(opcode===8){socket.end(Buffer.from([0x88,0]));return;}
        if(opcode!==1)continue;
        const command=JSON.parse(body.toString());commands.push(command);
        if(command.method==='session.new'){
          send({id:command.id,result:{sessionId:'real-websocket-mock',capabilities:{atName:command.params.capabilities.alwaysMatch.atName,atVersion:'test-only',platformName:'test'}}});
          output('Mock screen reader ready');
        }else{
          options.onCommand?.(command,output);
          send({id:command.id,result:{}});
        }
      }
    });
  });
  await new Promise<void>((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  const address=server.address();if(!address||typeof address==='string')throw new Error('No mock server port');
  return {url:`ws://127.0.0.1:${address.port}/session`,commands,close:async()=>{for(const socket of sockets)socket.destroy();await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));}};
}
