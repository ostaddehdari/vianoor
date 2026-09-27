import { createConnection } from 'node:net';
import { once } from 'node:events';
import { ServiceError } from '@vianoor/service-runtime';

// clamd INSTREAM: network-byte-order length followed by bytes; zero length terminates.
export async function scan(bytes: Buffer): Promise<'CLEAN' | 'INFECTED'> {
  const host = process.env.CLAMD_HOST;
  if (!host) throw new ServiceError(503, 'SCANNER_UNAVAILABLE');
  const socket = createConnection({ host, port: Number(process.env.CLAMD_PORT ?? 3310) });
  socket.setTimeout(45000, () => socket.destroy(new Error('Scanner timeout')));
  let result = '';
  const response = new Promise<'CLEAN' | 'INFECTED'>((resolve, reject) => {
    socket.on('error', () => reject(new ServiceError(503, 'SCANNER_UNAVAILABLE')));
    socket.on('data', (chunk) => {
      result += chunk.toString('utf8');
      if (result.length > 4096) socket.destroy(new Error('Scanner response'));
    });
    socket.on('close', () => {
      const message = result.replaceAll(String.fromCharCode(0), '').trim();
      if (message === 'stream: OK') resolve('CLEAN');
      else if (/^stream: .+ FOUND$/.test(message)) resolve('INFECTED');
      else reject(new ServiceError(503, 'SCANNER_UNAVAILABLE'));
    });
  });
  // Attach a handler immediately so connection failures cannot become unhandled rejections.
  void response.catch(() => {});
  try {
    await once(socket, 'connect');
    socket.write('zINSTREAM\0');
    for (let offset = 0; offset < bytes.length; offset += 65536) {
      const part = bytes.subarray(offset, offset + 65536),
        header = Buffer.alloc(4);
      header.writeUInt32BE(part.length);
      socket.write(header);
      if (!socket.write(part)) await once(socket, 'drain');
    }
    socket.write(Buffer.alloc(4));
    return await response;
  } finally {
    socket.destroy();
  }
}
