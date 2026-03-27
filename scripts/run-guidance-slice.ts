import { execSync } from 'node:child_process';

function main() {
  const forwardedArgs = process.argv.slice(2).join(' ');

  execSync('npm run build --workspaces', { stdio: 'inherit' });
  execSync(`node apps/visualizer/dist/cli.js ${forwardedArgs}`.trim(), { stdio: 'inherit' });
}

main();
