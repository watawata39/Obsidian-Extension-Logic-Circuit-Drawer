import { spawnSync } from 'node:child_process';


const tests = ['tests/ui-smoke.mjs', 'tests/components-smoke.mjs', 'tests/waypoints-smoke.mjs', 'tests/cm-smoke.mjs', 'tests/drag-scroll-smoke.mjs', 'tests/finish-scroll-smoke.mjs', 'tests/native-remount-smoke.mjs', 'tests/undo-smoke.mjs', 'tests/line-deletion-smoke.mjs', 'tests/runtime-scripts-smoke.mjs'];
const filter = process.argv[2];
const selected = filter ? tests.filter(test => test.endsWith(`/${filter}-smoke.mjs`)) : tests;
if (!selected.length) throw new Error(`Unknown browser test: ${filter}`);
for (const test of selected) {
	const result = spawnSync(process.execPath, [test], { stdio: 'inherit' });
	if (result.status !== 0) process.exit(result.status ?? 1);
}
