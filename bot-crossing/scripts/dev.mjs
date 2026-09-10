// `pnpm dev` runs the Fastify event server and the Next.js dev server in one
// terminal, without a third-party process runner. Either child dying takes
// the other down so a half-running stack is never mistaken for a running one.
import { spawn } from 'node:child_process';

const children = [];
function run(name, cmd, args) {
  const child = spawn(cmd, args, { stdio: 'inherit', shell: process.platform === 'win32' });
  child.on('exit', (code) => {
    console.log(`[dev] ${name} exited with code ${code ?? 'null'}`);
    for (const other of children) if (other !== child && other.exitCode === null) other.kill();
    process.exit(code ?? 1);
  });
  children.push(child);
}

run('server', 'pnpm', ['run', 'dev:server']);
run('web', 'pnpm', ['run', 'dev:web']);

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    for (const child of children) if (child.exitCode === null) child.kill(sig);
  });
}
