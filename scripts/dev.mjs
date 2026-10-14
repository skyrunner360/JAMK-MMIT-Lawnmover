import { spawn, spawnSync } from 'node:child_process';
// Intentionally target the local Compose database, never a production DATABASE_URL.
const args = process.argv.slice(2);
const portIndex = args.indexOf('--port');
const port = portIndex >= 0 ? args[portIndex + 1] : '5173';
const env = {
	...process.env,
	DATABASE_URL: `postgresql://root:mysecretpassword@127.0.0.1:${process.env.DEV_DB_PORT || 5432}/local`,
	ORIGIN: process.env.DEV_ORIGIN || `http://localhost:${port}`,
	BETTER_AUTH_SECRET:
		process.env.BETTER_AUTH_SECRET || 'local-development-only-secret-change-before-deploy'
};
function run(command, args) {
	const result = spawnSync(command, args, { stdio: 'inherit', env });
	if (result.error) {
		console.error(result.error.message);
		process.exit(1);
	}
	if (result.status !== 0) process.exit(result.status ?? 1);
}
run('docker', ['compose', 'up', '-d', '--wait', 'db']);
run('bunx', ['prisma', 'generate']);
run('bunx', ['prisma', 'migrate', 'deploy']);
if (args.includes('--setup-only')) process.exit(0);
const child = spawn('bunx', ['vite', 'dev', ...args], { stdio: 'inherit', env });
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
child.on('error', (error) => {
	console.error(error.message);
	process.exit(1);
});
child.on('exit', (code) => process.exit(code ?? 0));
