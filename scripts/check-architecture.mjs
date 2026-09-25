import { readdirSync, readFileSync } from 'node:fs';
import { importSpecifiers, boundaryViolation } from './import-boundaries.mjs';
const read = (file) => JSON.parse(readFileSync(file, 'utf8'));
const catalog = read('docs/architecture/service-catalog.json');
const requirements = read('docs/roadmap/requirements.json');
const pages = read('docs/design/pages.json');
const errors = [];
const assert = (ok, message) => {
  if (!ok) errors.push(message);
};
assert(catalog.length === 32, 'Expected 32 service boundaries');
for (const key of ['id', 'port', 'database', 'databaseRole']) {
  const values = catalog.map((s) => s[key]).filter((v) => v !== null);
  assert(new Set(values).size === values.length, `Duplicate service ${key}`);
}
assert(new Set(requirements.map((r) => r.stage)).size === 20, 'Expected 20 stages');
assert(
  new Set(requirements.map((r) => r.id)).size === requirements.length,
  'Duplicate requirement IDs',
);
assert(new Set(pages.map((p) => `${p.app}:${p.path}`)).size === pages.length, 'Duplicate routes');
for (const page of pages) {
  assert(
    catalog.some((s) => s.id === page.dataOwner),
    `${page.id}: unknown owner`,
  );
  assert(page.path.startsWith('/[locale]/'), `${page.id}: missing locale`);
}
const ids = new Set(catalog.map((s) => s.id));
assert(
  readdirSync('services').sort().join() === [...ids].sort().join(),
  'Service directory/catalog mismatch',
);
for (const service of catalog) {
  const pkg = read(`services/${service.id}/package.json`);
  assert(pkg.name === `@vianoor/${service.id}`, `Wrong package for ${service.id}`);
  for (const dep of service.dependencies) assert(ids.has(dep), `Unknown dependency ${dep}`);
  const main = readFileSync(`services/${service.id}/src/main.ts`, 'utf8');
  assert(
    main.includes(`'${service.id}'`) && main.includes(String(service.port)),
    `Entry/catalog drift: ${service.id}`,
  );
}
function walk(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (['node_modules', 'dist', '.next'].includes(entry.name)) continue;
    const file = `${directory}/${entry.name}`;
    if (entry.isDirectory()) walk(file);
    else if (/\.(tsx?|mjs)$/.test(file) && !file.endsWith('.d.ts')) {
      for (const specifier of importSpecifiers(readFileSync(file, 'utf8'), file)) {
        const violation = boundaryViolation(file, specifier);
        if (violation) errors.push(`${file}: ${specifier}: ${violation}`);
      }
    }
  }
}
for (const group of ['apps', 'services', 'packages']) {
  walk(group);
  for (const dir of readdirSync(group)) {
    const pkg = read(`${group}/${dir}/package.json`);
    for (const key of ['dependencies', 'devDependencies', 'peerDependencies']) {
      for (const [dep, version] of Object.entries(pkg[key] ?? {})) {
        assert(!version.startsWith('file:'), `File dependency forbidden: ${pkg.name}/${dep}`);
        assert(
          !dep.startsWith('@vianoor/') ||
            ['@vianoor/contracts', '@vianoor/service-runtime', '@vianoor/ui'].includes(dep),
          `Domain package dependency forbidden: ${dep}`,
        );
      }
    }
  }
}
if (errors.length) {
  console.error(errors.join('\n'));
  process.exit(1);
}
console.log(
  `Architecture OK: ${catalog.length} services, ${requirements.length} requirements, ${pages.length} planned pages.`,
);
