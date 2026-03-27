import { execSync } from 'node:child_process';

function main() {
  const forwardedArgs = process.argv.slice(2).join(' ');

  execSync('npm run build --workspaces', { stdio: 'inherit' });
  execSync(`node packages/runtime/dist/cli-guidance.js ${forwardedArgs}`.trim(), { stdio: 'inherit' });
}

main();
