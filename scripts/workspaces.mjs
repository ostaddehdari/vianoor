import { readdirSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
const [task, selected] = process.argv.slice(2);
if (
  !['build', 'typecheck'].includes(task) ||
  (selected && !['packages', 'services', 'apps'].includes(selected))
)
  throw new Error('Invalid workspace task');
for (const group of selected ? [selected] : ['packages', 'services', 'apps']) {
  for (const directory of readdirSync(group).sort()) {
    const pkg = JSON.parse(readFileSync(`${group}/${directory}/package.json`, 'utf8'));
    if (!pkg.scripts?.[task]) throw new Error(`${pkg.name} missing ${task}`);
    const result = spawnSync('npm', ['run', task, '--workspace', pkg.name], {
      stdio: 'inherit',
      shell: process.platform === 'win32',
    });
    if (result.status !== 0) process.exit(result.status ?? 1);
  }
}
