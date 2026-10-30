import { build } from 'esbuild';
import { noRuntimeScripts } from '../scripts/no-runtime-scripts.mjs';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir, homedir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';

const directory = await mkdtemp(join(tmpdir(), 'logic-components-ui-'));
await build({ plugins: [noRuntimeScripts()], entryPoints: ['tests/ui-harness.tsx'], bundle: true, platform: 'browser', outfile: join(directory, 'app.js'), define: { 'process.env.NODE_ENV': '"development"' }, logLevel: 'warning' });
await writeFile(join(directory, 'styles.css'), await readFile('styles.css', 'utf8'));
await writeFile(join(directory, 'index.html'), `<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="styles.css"><style>
body { margin:0; padding:24px; font:15px system-ui; --font-interface:system-ui; --font-text:system-ui; --background-primary:#fff; --background-secondary:#f4f5f8; --background-modifier-border:#dce0e8; --interactive-accent:#6857d9; --text-on-accent:#fff; }
#circuit { max-width:850px; margin:auto; } button { font:inherit; } @media(max-width:480px) { body { padding:8px; } }
</style></head><body><div id="circuit"></div><label>Outside <input id="outside"></label><script src="app.js"></script></body></html>`);
const server = createServer((request, response) => {
	const file = request.url === '/' ? 'index.html' : request.url?.slice(1);
	if (!['index.html', 'app.js', 'styles.css'].includes(file)) { response.writeHead(404).end(); return; }
	void readFile(join(directory, file)).then(data => {
		response.setHeader('Content-Type', file.endsWith('.css') ? 'text/css' : file.endsWith('.js') ? 'text/javascript' : 'text/html');
		response.end(data);
	}).catch(() => response.writeHead(500).end());
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_PATH || join(homedir(), 'Library/Caches/ms-playwright/chromium-1223/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing');
let browser;
let page;
try {
	browser = await chromium.launch({ executablePath, headless: true });
	page = await browser.newPage({ viewport: { width: 1100, height: 1000 } });
	page.setDefaultTimeout(10000);
	const errors = [];
	page.on('pageerror', error => errors.push(error.message));
	await page.goto(`http://127.0.0.1:${server.address().port}/`);
	const data = () => page.evaluate(() => window.circuitTest.data());
	const saved = () => page.waitForFunction(() => !window.circuitTest.snapshot().saving);
	const current = async () => (await data()).nodes.find(node => node.id === 'component');
	const captureSavedState = () => page.evaluate(() => ({ circuit: window.circuitTest.data(), markdown: window.circuitTest.markdown(), writes: window.circuitTest.writes(), canUndo: window.circuitTest.snapshot().canUndo, canRedo: window.circuitTest.snapshot().canRedo }));
	const expectUnsaved = async before => assert.deepEqual(await captureSavedState(), before, 'live properties preview leaves saved data, Markdown, write count and history unchanged');
	const waitInputs = count => page.waitForFunction(count => document.querySelectorAll('[data-id="component"] [data-circuit-direction="input"]').length === count, count);
	const waitOutputs = count => page.waitForFunction(count => document.querySelectorAll('[data-id="component"] [data-circuit-direction="output"]').length === count, count);
	const waitWires = count => page.waitForFunction(count => document.querySelectorAll('path[data-circuit-edge]').length === count, count);
	const startEditing = async () => {
		await page.locator('.logic-circuit').hover();
		await page.getByRole('button', { name: 'Edit', exact: true }).click();
		await page.getByRole('button', { name: 'Done', exact: true }).waitFor();
	};
	const openProperties = async () => {
		await page.locator('[data-id="component"] .logic-object').click({ position: { x: 30, y: 8 } });
		await page.getByRole('button', { name: 'Properties', exact: true }).click();
		await page.getByRole('dialog', { name: 'Properties' }).waitFor();
	};
	const originalPropertiesLayout = async narrow => {
		assert.equal(await page.getByText('Live preview', { exact: true }).count(), 0, 'Properties adds no Live preview title');
		assert.equal(await page.locator('.logic-diagram-workspace,.logic-canvas-area').count(), 0, 'Properties retains the original direct panel/canvas layout');
		const layout = await page.evaluate(() => {
			const block = document.querySelector('.logic-circuit');
			const backdrop = document.querySelector('.logic-properties-backdrop');
			const panel = document.querySelector('.logic-properties');
			const canvas = document.querySelector('.logic-canvas');
			const lists = [...document.querySelectorAll('.logic-properties-pins')];
			const box = element => {
				const bounds = element.getBoundingClientRect();
				return { left: bounds.left, right: bounds.right, top: bounds.top, bottom: bounds.bottom, width: bounds.width };
			};
			return { block: box(block), backdrop: box(backdrop), panel: box(panel), canvas: box(canvas), lists: lists.map(box), siblings: backdrop.parentElement === block && canvas.parentElement === block };
		});
		assert.equal(layout.siblings, true, 'Properties and the diagram are direct children of the circuit block');
		assert.ok(Math.abs(layout.backdrop.width - layout.canvas.width) <= 1, 'the panel region and diagram use the full block width');
		assert.ok(Math.abs(layout.backdrop.width - (layout.block.width - 2)) <= 1, 'the panel region spans the block inside its border');
		assert.ok(layout.canvas.top >= layout.backdrop.bottom - 1, 'the diagram stays below the properties panel');
		assert.ok(Math.abs((layout.panel.left + layout.panel.right) / 2 - (layout.backdrop.left + layout.backdrop.right) / 2) <= 1, 'the properties panel stays horizontally centered');
		assert.equal(layout.lists.length, 2);
		if (narrow) {
			assert.ok(layout.panel.left >= 0 && layout.panel.right <= 380, 'the complete panel fits a narrow pane');
			assert.ok(layout.lists[1].top >= layout.lists[0].bottom - 1, 'pin lists stack in a narrow pane');
		} else {
			assert.ok(Math.abs(layout.panel.width - 540) <= 1, 'the wide panel retains its original 540px maximum width');
			assert.ok(Math.abs(layout.lists[0].top - layout.lists[1].top) <= 1 && layout.lists[1].left >= layout.lists[0].right + 8, 'input and output lists retain two columns when space allows');
		}
	};
	const apply = async () => {
		await page.getByRole('button', { name: 'Apply', exact: true }).click();
		await page.getByRole('dialog').waitFor({ state: 'detached' });
		await saved();
	};
	const fixture = async type => {
		await page.evaluate(type => window.circuitTest.showComponentFixture(type), type);
		await startEditing();
	};
	const continuity = async () => {
		await page.waitForFunction(() => document.querySelectorAll('path[data-circuit-edge]').length === window.circuitTest.data().edges.length);
		await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
		const gaps = await page.evaluate(() => window.circuitTest.data().edges.flatMap(edge => {
			const path = document.querySelector(`path[data-circuit-edge="${edge.id}"]`);
			if (!path) return [Infinity];
			return [{ node: edge.sourceNodeId, pin: edge.sourcePinId, output: true }, { node: edge.targetNodeId, pin: edge.targetPinId, output: false }].map((endpoint, index) => {
				const connector = document.querySelector(`[data-id="${endpoint.node}"] [data-circuit-connector="${endpoint.pin}"]`);
				if (!connector) return Infinity;
				const wire = path.getPointAtLength(index ? path.getTotalLength() : 0);
				const lead = connector.getPointAtLength(endpoint.output ? connector.getTotalLength() : 0);
				const a = new DOMPoint(wire.x, wire.y).matrixTransform(path.getScreenCTM());
				const b = new DOMPoint(lead.x, lead.y).matrixTransform(connector.getScreenCTM());
				return Math.hypot(a.x - b.x, a.y - b.y);
			});
		}));
		assert.ok(gaps.every(gap => gap < .6), `wires meet every input/output connector: ${JSON.stringify(gaps)}`);
	};
	const pin = (node, id) => page.locator(`[data-circuit-node="${node}"][data-circuit-pin="${id}"]`);
	const dragPin = async (source, target) => {
		const a = await source.boundingBox();
		assert.ok(a);
		await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
		await page.mouse.down();
		await page.mouse.move(a.x + a.width / 2 + 5, a.y + a.height / 2, { steps: 2 });
		await page.locator('[data-circuit-connection-preview="true"]').waitFor();
		const b = await target.boundingBox();
		assert.ok(b);
		await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 12 });
		await page.mouse.up();
	};

	await startEditing();
	for (const [index, name] of ['Latch', 'Flip-flop', 'Custom block'].entries()) {
		await page.getByRole('button', { name: `Place ${name}`, exact: true }).click();
		const canvas = await page.locator('.logic-canvas').boundingBox();
		await page.mouse.move(canvas.x + 150 + index * 250, canvas.y + 65 + index * 50, { steps: 10 });
		await page.locator('.logic-placement-preview:not(.is-invalid)').waitFor();
		await page.mouse.click(canvas.x + 150 + index * 250, canvas.y + 65 + index * 50);
		await page.waitForFunction(count => window.circuitTest.data().nodes.length === count, index + 1);
		await saved();
	}
	assert.deepEqual((await data()).nodes.map(node => node.type), ['d-latch', 'd-ff', 'custom']);
	assert.equal((await data()).schemaVersion, 2);
	console.log('Passed: latch, flip-flop, and custom block placement.');

	await fixture('and');
	await openProperties();
	const legacy = await data();
	const beforeUnchanged = await page.evaluate(() => window.circuitTest.writes());
	await apply();
	assert.deepEqual(await data(), legacy, 'applying unchanged legacy gate properties preserves version 1 bytes');
	assert.equal(await page.evaluate(() => window.circuitTest.writes()), beforeUnchanged, 'unchanged properties do not save');
	await page.locator('[data-id="component"] .logic-object').click({ button: 'right', position: { x: 30, y: 8 } });
	await page.getByRole('menu', { name: 'Component actions' }).waitFor();
	await page.keyboard.press('Escape');
	await page.getByRole('menu', { name: 'Component actions' }).waitFor({ state: 'detached' });
	assert.equal(await page.locator('.logic-circuit').evaluate(element => element === document.activeElement), true, 'dismissing component menu retains circuit keyboard focus');
	await page.locator('[data-id="component"] .logic-object').click({ button: 'right', position: { x: 30, y: 8 } });
	await page.getByRole('menuitem', { name: 'Properties', exact: true }).click();
	await page.getByRole('dialog', { name: 'Properties' }).waitFor();
	const gateSaved = await captureSavedState();
	await page.getByRole('spinbutton', { name: 'Input count' }).fill('5');
	await waitInputs(5);
	await expectUnsaved(gateSaved);
	for (const invalid of ['', '0', '33', '2.5']) {
		await page.getByRole('spinbutton', { name: 'Input count' }).fill(invalid);
		await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
		assert.equal(await page.locator('[data-id="component"] [data-circuit-direction="input"]').count(), 2, 'invalid input counts fall back to the saved circuit');
		await expectUnsaved(gateSaved);
	}
	await page.getByRole('spinbutton', { name: 'Input count' }).fill('5');
	await apply();
	assert.equal((await current()).inputCount, 5);
	assert.equal(await page.evaluate(() => window.circuitTest.writes()), gateSaved.writes + 1, 'Apply commits the complete gate preview once');
	assert.equal(await page.locator('[data-id="component"] [data-circuit-direction="input"]').count(), 5);
	assert.equal((await data()).schemaVersion, 2);
	await page.getByRole('button', { name: 'Undo circuit edit' }).click();
	await saved();
	assert.equal((await current()).inputCount, undefined);
	assert.equal((await data()).schemaVersion, 1);
	await page.getByRole('button', { name: 'Redo circuit edit' }).click();
	await saved();
	assert.equal((await current()).inputCount, 5);
	await openProperties();
	const beforeCancel = await page.evaluate(() => window.circuitTest.writes());
	const beforeGateCancel = await captureSavedState();
	await page.getByRole('spinbutton', { name: 'Input count' }).fill('7');
	await waitInputs(7);
	await expectUnsaved(beforeGateCancel);
	await page.getByRole('button', { name: 'Cancel', exact: true }).click();
	await waitInputs(5);
	assert.equal((await current()).inputCount, 5);
	assert.equal(await page.evaluate(() => window.circuitTest.writes()), beforeCancel);
	console.log('Passed: unchanged legacy Apply, context-menu properties, variable input count, schema upgrade, undo/redo, and Cancel without saving.');

	await fixture('custom');
	const originalCustom = await data();
	const beforeRefresh = await page.evaluate(() => window.circuitTest.writes());
	await openProperties();
	await originalPropertiesLayout(false);
	await page.screenshot({ path: join(directory, 'properties-wide.png'), fullPage: true });
	const customSaved = await captureSavedState();
	await page.getByRole('textbox', { name: 'Center label' }).fill('Draft survives remount');
	await page.waitForFunction(() => document.querySelector('[data-id="component"] .logic-block-label text')?.textContent === 'Draft survives remount');
	await expectUnsaved(customSaved);
	await page.getByRole('textbox', { name: 'Input 1 name', exact: true }).fill('DRAFT_A');
	await page.getByRole('button', { name: 'Move input 1 down', exact: true }).click();
	await page.getByRole('button', { name: '+ Add output', exact: true }).click();
	await page.getByRole('textbox', { name: 'Output 2 name', exact: true }).fill('New output');
	await waitOutputs(2);
	await expectUnsaved(customSaved);
	await page.evaluate(() => window.circuitTest.refreshWidget());
	await page.getByRole('dialog', { name: 'Properties' }).waitFor();
	assert.equal(await page.getByRole('textbox', { name: 'Center label' }).inputValue(), 'Draft survives remount');
	assert.equal(await page.getByRole('textbox', { name: 'Input 2 name', exact: true }).inputValue(), 'DRAFT_A');
	assert.equal(await page.getByRole('textbox', { name: 'Output 2 name', exact: true }).inputValue(), 'New output');
	await waitOutputs(2);
	assert.equal(await page.locator('[data-id="component"] .logic-block-label text').textContent(), 'Draft survives remount', 'the live rendered preview survives widget replacement');
	await expectUnsaved(customSaved);
	assert.deepEqual(await data(), originalCustom, 'a widget refresh leaves unapplied properties outside saved circuit data');
	assert.equal(await page.evaluate(() => window.circuitTest.writes()), beforeRefresh);
	await apply();
	assert.equal((await current()).label, 'Draft survives remount');
	assert.equal((await current()).pins.inputs[1].id, originalCustom.nodes[0].pins.inputs[0].id);
	assert.equal((await current()).pins.outputs.length, 2);
	assert.equal(await page.evaluate(() => window.circuitTest.writes()), beforeRefresh + 1, 'Apply after a widget refresh saves exactly once');
	await page.getByRole('button', { name: 'Undo circuit edit' }).click();
	await saved();
	assert.deepEqual(await data(), originalCustom, 'one undo restores the complete pre-properties circuit');
	console.log('Passed: unapplied label, pin order, and added-pin drafts survive widget refresh and Apply remains one undo step.');

	await fixture('d-latch');
	await openProperties();
	const latchSaved = await captureSavedState();
	await page.getByRole('checkbox', { name: 'Active-low enable' }).check();
	await page.waitForFunction(() => document.querySelector('[data-id="component"] [data-circuit-connector="enable"] + circle'));
	await expectUnsaved(latchSaved);
	await apply();
	assert.equal((await current()).sequential.enableActiveLow, true);
	assert.equal(await page.locator('[data-id="component"] [data-circuit-connector="enable"] + circle').count(), 1);
	await openProperties();
	await page.getByRole('combobox', { name: 'Type', exact: true }).selectOption('sr-latch');
	await apply();
	assert.equal((await current()).type, 'sr-latch');
	assert.equal((await current()).sequential.enableActiveLow, undefined);
	assert.equal(await pin('component', 's').count(), 1);
	assert.equal(await pin('component', 'r').count(), 1);

	await fixture('d-ff');
	await openProperties();
	const ffSaved = await captureSavedState();
	await page.getByRole('combobox', { name: 'Type', exact: true }).selectOption('jk-ff');
	await page.getByRole('combobox', { name: 'Clock edge' }).selectOption('falling');
	await page.getByRole('checkbox', { name: 'Preset', exact: true }).check();
	await page.getByRole('checkbox', { name: 'Clear/reset', exact: true }).check();
	const preset = page.locator('.logic-properties-control').filter({ has: page.getByRole('checkbox', { name: 'Preset', exact: true }) });
	const clear = page.locator('.logic-properties-control').filter({ has: page.getByRole('checkbox', { name: 'Clear/reset', exact: true }) });
	assert.equal(await page.getByRole('textbox', { name: 'Pin name', exact: true }).count(), 0, 'preset and clear/reset pin names are fixed');
	await preset.getByRole('checkbox', { name: 'Active-low' }).check();
	await clear.getByRole('checkbox', { name: 'Active-low' }).check();
	await page.locator('[data-id="component"] .logic-object-jk-ff').waitFor();
	await waitInputs(5);
	for (const id of ['clock', 'preset', 'clear']) assert.equal(await page.locator(`[data-id="component"] [data-circuit-connector="${id}"] + circle`).count(), 1, 'polarity bubbles update before Apply');
	assert.ok(await page.locator('[data-id="component"] svg').textContent().then(text => text.includes('PRE') && text.includes('CLR')), 'optional control pins show their fixed PRE and CLR names before Apply');
	await expectUnsaved(ffSaved);
	await apply();
	assert.equal((await current()).type, 'jk-ff');
	assert.equal(await page.evaluate(() => window.circuitTest.writes()), ffSaved.writes + 1, 'Apply commits all flip-flop fields once');
	assert.deepEqual((await current()).sequential, { clockEdge: 'falling', preset: { label: 'PRE', activeLow: true }, clear: { label: 'CLR', activeLow: true } });
	for (const id of ['clock', 'preset', 'clear']) assert.equal(await page.locator(`[data-id="component"] [data-circuit-connector="${id}"] + circle`).count(), 1);
	await openProperties();
	await page.getByRole('combobox', { name: 'Type', exact: true }).selectOption('t-ff');
	await page.getByRole('checkbox', { name: /Show Q/ }).uncheck();
	await page.getByRole('checkbox', { name: 'Preset', exact: true }).uncheck();
	await waitOutputs(1);
	await waitInputs(3);
	assert.equal(await pin('component', 't').count(), 1, 'changing flip-flop type updates live pin identity');
	assert.equal(await pin('component', 'q-bar').count(), 0, 'inverted output disappears immediately in preview');
	assert.equal((await current()).type, 'jk-ff', 'preview type does not mutate saved type');
	await apply();
	assert.equal((await current()).type, 't-ff');
	assert.equal((await current()).sequential.preset, undefined);
	assert.equal(await pin('component', 'q-bar').count(), 0);
	assert.equal(await pin('component', 't').count(), 1);
	await openProperties();
	const beforeEscape = await page.evaluate(() => window.circuitTest.writes());
	await page.getByRole('combobox', { name: 'Type', exact: true }).selectOption('d-ff');
	await page.getByRole('button', { name: 'Apply', exact: true }).focus();
	await page.keyboard.press('Tab');
	assert.equal(await page.getByRole('combobox', { name: 'Type', exact: true }).evaluate(element => element === document.activeElement), true);
	await page.keyboard.press('Escape');
	await page.getByRole('dialog').waitFor({ state: 'detached' });
	assert.equal((await current()).type, 't-ff');
	assert.equal(await page.evaluate(() => window.circuitTest.writes()), beforeEscape);
	console.log('Passed: both latch types, all flip-flop types, clock/enable polarity, preset/clear, Q̅, and Escape/focus trap.');

	await page.evaluate(() => window.circuitTest.showConnectedCustomFixture());
	await startEditing();
	await continuity();
	await dragPin(pin('component', 'custom-cout'), pin('component-extra', 'in-1'));
	await page.waitForFunction(() => window.circuitTest.data().edges.length === 4);
	await saved();
	await continuity();
	const initialEdges = (await data()).edges;
	await page.locator('[data-id="component"] .logic-block-label').dblclick();
	await page.getByRole('textbox', { name: 'Edit custom label', exact: true }).fill('Direct label');
	await page.getByRole('textbox', { name: 'Edit custom label', exact: true }).press('Enter');
	await saved();
	assert.equal((await current()).label, 'Direct label');
	assert.deepEqual((await data()).edges, initialEdges);
	await continuity();
	await page.locator('[data-id="component"] .logic-block-label').dblclick();
	const beforeLabelEscape = await page.evaluate(() => window.circuitTest.writes());
	await page.getByRole('textbox', { name: 'Edit custom label', exact: true }).fill('Discarded label');
	await page.getByRole('textbox', { name: 'Edit custom label', exact: true }).press('Escape');
	assert.equal((await current()).label, 'Direct label');
	assert.equal(await page.evaluate(() => window.circuitTest.writes()), beforeLabelEscape);
	await openProperties();
	const connectedSaved = await captureSavedState();
	const routesBeforePreview = await page.locator('.logic-wire .react-flow__edge-path').evaluateAll(paths => paths.map(path => path.getAttribute('d')));
	await page.getByRole('textbox', { name: 'Center label' }).fill('Full adder');
	await page.getByRole('textbox', { name: 'Output 1 name', exact: true }).fill('Result');
	await page.getByRole('button', { name: 'Move output 1 down', exact: true }).click();
	await page.getByRole('button', { name: '+ Add input', exact: true }).click();
	await page.getByRole('textbox', { name: 'Input 4 name', exact: true }).fill('Enable');
	await waitInputs(4);
	await continuity();
	await page.evaluate(() => window.circuitTest.refreshWidget());
	await page.getByRole('dialog', { name: 'Properties' }).waitFor();
	await waitInputs(4);
	await continuity();
	await expectUnsaved(connectedSaved);
	await page.screenshot({ path: join(directory, 'properties-live-preview.png'), fullPage: true });
	assert.notDeepEqual(await page.locator('.logic-wire .react-flow__edge-path').evaluateAll(paths => paths.map(path => path.getAttribute('d'))), routesBeforePreview, 'preview reroutes connected wires to resized/reordered pins');
	await apply();
	assert.equal((await current()).label, 'Full adder');
	assert.deepEqual((await current()).pins.outputs.map(pin => pin.id), ['custom-cout', 'custom-sum']);
	assert.equal((await current()).pins.outputs[1].label, 'Result');
	assert.deepEqual((await data()).edges, initialEdges);
	await continuity();
	await openProperties();
	const beforeRemovalPreview = await captureSavedState();
	await page.getByRole('button', { name: 'Remove output 1', exact: true }).click();
	await waitOutputs(1);
	await waitWires(2); // Removed-pin wires disappear in the unsaved preview.
	await expectUnsaved(beforeRemovalPreview);
	assert.match(await page.getByRole('dialog').innerText(), /will remove 2 wires/);
	await page.getByRole('button', { name: 'Cancel', exact: true }).click();
	await waitOutputs(2);
	await waitWires(4); // Cancel restores the complete saved graph after handle measurement.
	await expectUnsaved(beforeRemovalPreview);
	await continuity();
	await openProperties();
	await page.getByRole('button', { name: 'Remove output 1', exact: true }).click();
	await waitOutputs(1);
	await apply();
	assert.equal((await data()).edges.length, 2);
	await page.getByRole('button', { name: 'Undo circuit edit' }).click();
	await saved();
	assert.deepEqual((await data()).edges, initialEdges);
	await continuity();
	await page.getByRole('button', { name: 'Redo circuit edit' }).click();
	await saved();
	assert.equal((await data()).edges.length, 2);
	await continuity();
	const beforeReload = await data();
	await page.evaluate(() => window.circuitTest.remount());
	await page.locator('[data-id="component"]').waitFor();
	assert.deepEqual(await data(), beforeReload);
	await continuity();
	console.log('Passed: arbitrary output IDs, output fan-out gestures, direct label Enter/Escape, rename/reorder with wire continuity, removal warnings, undo/redo, and reload.');

	await startEditing();
	await page.setViewportSize({ width: 380, height: 900 });
	await openProperties();
	const bounds = await page.getByRole('dialog').boundingBox();
	assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= 380, 'properties fit a narrow pane');
	await originalPropertiesLayout(true);
	await page.getByRole('textbox', { name: 'Center label' }).fill('Long block label '.repeat(12));
	await page.getByRole('textbox', { name: 'Input 1 name', exact: true }).fill('Very long configurable input pin name');
	await page.screenshot({ path: join(directory, 'properties-narrow.png'), fullPage: true });
	await page.addStyleTag({ content: 'body.theme-dark { background:#181b22; --text-normal:#e2e5ee; --text-muted:#a3adbf; --background-primary:#222731; --background-secondary:#1a1f28; --background-modifier-border:#414a5b; --interactive-accent:#a899fc; --text-on-accent:#161421; }' });
	await page.locator('body').evaluate(element => element.classList.add('theme-dark'));
	await page.screenshot({ path: join(directory, 'properties-dark-narrow.png'), fullPage: true });
	await apply();
	assert.equal(await page.locator('.logic-invalid').count(), 0);
	await continuity();
	assert.deepEqual(errors, []);
	console.log(`Passed: live preview without saves/history, Cancel/Apply, invalid counts, live handles/wires/polarity, connected remount, responsive properties and long labels. Browser artifacts: ${directory}`);
} catch (error) {
	if (page) {
		await page.screenshot({ path: join(directory, 'failure.png'), fullPage: true });
		console.error(await page.locator('.logic-circuit').innerText());
		console.error(JSON.stringify(await page.evaluate(() => window.circuitTest.data())));
	}
	console.error(`Failure artifacts: ${directory}`);
	throw error;
} finally {
	await browser?.close();
	await new Promise(resolve => server.close(resolve));
}
