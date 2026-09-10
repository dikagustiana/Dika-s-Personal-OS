// `npm run dev` / `pnpm dev` runs the Fastify event server and the Next.js dev
// server in one terminal, without a third-party process runner and without
// caring which package manager launched it: the binaries are called directly.
// Either child dying takes the other down so a half-running stack is never
// mistaken for a running one.
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const bin = (name) => path.join(root, 'node_modules', '.bin', process.platform === 'win32' ? `${name}.cmd` : name);

const children = [];
function run(name, cmd, args) {
  const child = spawn(cmd, args, { cwd: root, stdio: 'inherit', shell: process.platform === 'win32' });
  child.on('exit', (code) => {
    console.log(`[dev] ${name} exited with code ${code ?? 'null'}`);
    for (const other of children) if (other !== child && other.exitCode === null) other.kill();
    process.exit(code ?? 1);
  });
  children.push(child);
}

run('server', bin('tsx'), ['watch', 'server/index.ts']);
run('web', bin('next'), ['dev', '-p', process.env.WEB_PORT ?? '3000']);

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    for (const child of children) if (child.exitCode === null) child.kill(sig);
  });
}
