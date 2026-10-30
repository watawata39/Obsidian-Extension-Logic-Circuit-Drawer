import { build } from 'esbuild';
import { noRuntimeScripts } from '../scripts/no-runtime-scripts.mjs';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir, homedir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';

const directory = await mkdtemp(join(tmpdir(), 'logic-waypoints-ui-'));
await build({ plugins: [noRuntimeScripts()], entryPoints: ['tests/ui-harness.tsx'], bundle: true, platform: 'browser', outfile: join(directory, 'app.js'), define: { 'process.env.NODE_ENV': '"development"' }, logLevel: 'warning' });
await writeFile(join(directory, 'styles.css'), await readFile('styles.css', 'utf8'));
await writeFile(join(directory, 'index.html'), `<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="styles.css"><style>
body { margin:0; padding:24px; font:15px system-ui; --font-interface:system-ui; --font-text:system-ui; --background-primary:#fff; --background-secondary:#f4f5f8; --background-modifier-border:#dce0e8; --interactive-accent:#6857d9; --text-on-accent:#fff; }
#circuit { max-width:850px; margin:auto; } button { font:inherit; }
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
	const writes = () => page.evaluate(() => window.circuitTest.writes());
	const settled = async () => {
		await page.waitForFunction(() => !window.circuitTest.snapshot().saving);
		await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
	};
	const waitSize = async (nodes, edges) => {
		await page.waitForFunction(({ nodes, edges }) => window.circuitTest.data().nodes.length === nodes && window.circuitTest.data().edges.length === edges, { nodes, edges });
		await settled();
	};
	const startEditing = async () => {
		await page.locator('.logic-circuit').hover();
		await page.getByRole('button', { name: 'Edit', exact: true }).click();
		await page.getByRole('button', { name: 'Done', exact: true }).waitFor();
	};
	const pointOnWire = (id, fraction = .5) => page.evaluate(({ id, fraction }) => {
		const path = document.querySelector(`path[data-circuit-edge="${id}"]`);
		const point = path.getPointAtLength(path.getTotalLength() * fraction);
		const screen = new DOMPoint(point.x, point.y).matrixTransform(path.getScreenCTM());
		return { x: screen.x, y: screen.y };
	}, { id, fraction });
	const clickHoveredWire = async (id, fraction = .5, shift = false) => {
		const point = await pointOnWire(id, fraction);
		await page.mouse.move(point.x, point.y);
		const handle = page.locator(`.logic-branch-handle[data-circuit-edge="${id}"]`);
		await handle.waitFor();
		await handle.click({ modifiers: shift ? ['Shift'] : [] });
		await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
	};
	const doubleClickWire = async (id, fraction) => {
		const point = await pointOnWire(id, fraction);
		await page.mouse.move(point.x, point.y);
		await page.mouse.dblclick(point.x, point.y);
	};
	const continuity = async () => {
		await settled();
		const gaps = await page.evaluate(() => window.circuitTest.data().edges.flatMap(edge => {
			const path = document.querySelector(`path[data-circuit-edge="${edge.id}"]`);
			if (!path) return [Infinity];
			return [{ node: edge.sourceNodeId, pin: edge.sourcePinId, output: true }, { node: edge.targetNodeId, pin: edge.targetPinId, output: false }].map((endpoint, index) => {
				const element = document.querySelector(`[data-id="${endpoint.node}"]`);
				const connector = element.querySelector(`[data-circuit-connector="${endpoint.pin}"]`);
				const wire = path.getPointAtLength(index ? path.getTotalLength() : 0);
				const a = new DOMPoint(wire.x, wire.y).matrixTransform(path.getScreenCTM());
				let b;
				if (connector) {
					const lead = connector.getPointAtLength(endpoint.output ? connector.getTotalLength() : 0);
					b = new DOMPoint(lead.x, lead.y).matrixTransform(connector.getScreenCTM());
				} else {
					const dot = element.querySelector('.logic-junction-dot').getBoundingClientRect();
					b = { x: dot.x + dot.width / 2, y: dot.y + dot.height / 2 };
				}
				return Math.hypot(a.x - b.x, a.y - b.y);
			});
		}));
		assert.ok(gaps.every(gap => gap < .6), `wire ends meet connector/dot centers: ${JSON.stringify(gaps)}`);
	};
	const assertChain = circuit => {
		let current = 'waypoint-input';
		const visited = new Set();
		while (current !== 'waypoint-output') {
			assert.ok(!visited.has(current), 'waypoint chain remains acyclic');
			visited.add(current);
			const outgoing = circuit.edges.filter(edge => edge.sourceNodeId === current);
			assert.equal(outgoing.length, 1, 'each waypoint retains one continuation');
			current = outgoing[0].targetNodeId;
		}
		assert.equal(visited.size, circuit.nodes.length - 1);
		assert.equal(circuit.edges.find(edge => edge.sourceNodeId === 'waypoint-input').sourcePinId, 'out');
		assert.equal(circuit.edges.find(edge => edge.targetNodeId === 'waypoint-output').targetPinId, 'in-1');
	};

	await page.evaluate(() => window.circuitTest.showWireWaypointFixture());
	const initial = await data();
	const beforeFinished = await writes();
	await doubleClickWire('waypoint-wire', .5);
	await page.getByRole('button', { name: 'Done', exact: true }).waitFor();
	assert.deepEqual(await data(), initial, 'double-clicking a finished wire starts editing without adding a waypoint');
	assert.equal(await writes(), beforeFinished);
	await page.getByRole('button', { name: 'Done', exact: true }).click();
	await page.getByRole('button', { name: 'Done', exact: true }).waitFor({ state: 'detached' });
	await page.evaluate(() => window.circuitTest.setReadOnly(true));
	const readOnlyPoint = await pointOnWire('waypoint-wire', .5);
	await page.mouse.click(readOnlyPoint.x, readOnlyPoint.y);
	await page.mouse.dblclick(readOnlyPoint.x, readOnlyPoint.y);
	assert.deepEqual(await data(), initial, 'Reading view ignores wire single/double clicks');
	assert.equal(await writes(), beforeFinished);
	assert.equal(await page.getByRole('button', { name: 'Done', exact: true }).count(), 0);
	await page.evaluate(() => window.circuitTest.setReadOnly(false));
	await startEditing();
	const deleteSelected = page.getByRole('button', { name: 'Delete selected elements', exact: true });
	const beforeSingle = await writes();
	await clickHoveredWire('waypoint-wire');
	assert.equal(await page.locator('.react-flow__edge.selected').count(), 1, 'clicking the materialized hover handle selects its wire');
	assert.equal(await page.locator('.logic-wire.is-selected').count(), 1, 'the selected wire is visibly highlighted');
	assert.equal(await deleteSelected.isEnabled(), true, 'wire selection enables the trash button');
	assert.equal(await page.locator('.logic-branch-preview').count(), 0, 'a stationary click does not begin a branch drag');
	assert.deepEqual(await data(), initial, 'single-click changes selection only');
	assert.equal(await writes(), beforeSingle);
	for (const action of ['Delete', 'Backspace', 'trash']) {
		await clickHoveredWire('waypoint-wire', .4);
		const beforeDelete = await writes();
		if (action === 'trash') await deleteSelected.click();
		else await page.keyboard.press(action);
		await waitSize(2, 0);
		assert.equal(await writes(), beforeDelete + 1, `${action} deletes the selected wire as one save`);
		await page.getByRole('button', { name: 'Undo circuit edit', exact: true }).click();
		await waitSize(2, 1);
		assert.deepEqual(await data(), initial);
	}
	const beforeSplit = await writes();
	await page.mouse.move(20, 20);
	await doubleClickWire('waypoint-wire', .5);
	await waitSize(3, 2);
	const split = await data();
	assert.equal(await writes(), beforeSplit + 1, 'double-clicking inserts one waypoint as one save');
	const first = split.nodes.find(node => node.type === 'junction');
	assert.ok(first);
	assertChain(split);
	await continuity();
	const selectionWrites = await writes();
	const firstEdge = split.edges.find(edge => edge.targetNodeId === first.id);
	const continuation = split.edges.find(edge => edge.sourceNodeId === first.id);
	await clickHoveredWire(firstEdge.id);
	await clickHoveredWire(continuation.id, .5, true);
	assert.equal(await page.locator('.logic-wire.is-selected').count(), 2, 'Shift-click adds a hovered wire to the selection');
	await clickHoveredWire(continuation.id, .5, true);
	assert.equal(await page.locator('.logic-wire.is-selected').count(), 1, 'Shift-click toggles a hovered wire off exactly once');
	assert.equal(await page.locator(`.logic-wire.is-selected [data-circuit-edge="${firstEdge.id}"]`).count(), 1);
	await page.locator(`[data-id="${first.id}"] .logic-junction-dot`).click();
	assert.equal(await page.locator(`[data-id="${first.id}"] .logic-object.is-selected`).count(), 1, 'single-click visibly selects the actual junction dot');
	assert.equal(await page.locator('.logic-wire.is-selected').count(), 0, 'plain junction selection clears selected wires');
	assert.equal(await deleteSelected.isEnabled(), true);
	assert.deepEqual(await data(), split, 'wire and junction selection leave data unchanged');
	assert.equal(await writes(), selectionWrites);
	const beforeRoutes = await page.locator('.logic-wire .react-flow__edge-path').evaluateAll(paths => paths.map(path => path.getAttribute('d')));
	const dot = await page.locator(`[data-id="${first.id}"] .logic-junction-dot`).boundingBox();
	assert.ok(dot);
	await page.mouse.move(dot.x + dot.width / 2, dot.y + dot.height / 2);
	await page.mouse.down();
	await page.mouse.move(dot.x + dot.width / 2 + 80, dot.y + dot.height / 2 + 96, { steps: 12 });
	await page.mouse.up();
	await page.waitForFunction(({ id, y }) => window.circuitTest.data().nodes.find(node => node.id === id).position.y > y + 32, { id: first.id, y: first.position.y });
	await settled();
	const dragged = await data();
	assert.deepEqual(dragged.edges, split.edges, 'dragging changes routing without changing wire endpoints');
	assert.notDeepEqual(await page.locator('.logic-wire .react-flow__edge-path').evaluateAll(paths => paths.map(path => path.getAttribute('d'))), beforeRoutes);
	assertChain(dragged);
	await continuity();
	const secondWire = dragged.edges.find(edge => edge.sourceNodeId === first.id);
	const beforeSecond = await writes();
	await doubleClickWire(secondWire.id, .6);
	await waitSize(4, 3);
	assert.equal(await writes(), beforeSecond + 1);
	const twoWaypoints = await data();
	assertChain(twoWaypoints);
	await continuity();
	await page.getByRole('button', { name: 'Undo circuit edit', exact: true }).click();
	await waitSize(3, 2);
	assert.deepEqual(await data(), dragged, 'one undo removes the complete second split');
	await page.getByRole('button', { name: 'Redo circuit edit', exact: true }).click();
	await waitSize(4, 3);
	assert.deepEqual(await data(), twoWaypoints);
	await page.evaluate(() => window.circuitTest.remount());
	await page.locator('.logic-junction-dot').first().waitFor();
	assert.deepEqual(await data(), twoWaypoints, 'waypoints survive a source reload');
	await continuity();
	await startEditing();
	const junctions = twoWaypoints.nodes.filter(node => node.type === 'junction');
	for (const [index, junction] of junctions.entries()) {
		await page.locator(`[data-id="${junction.id}"] .logic-junction-dot`).click();
		assert.equal(await page.locator(`[data-id="${junction.id}"] .logic-object.is-selected`).count(), 1, 'junction selection is visible before deletion');
		await page.keyboard.press('Delete');
		await waitSize(3 - index, 2 - index);
		assertChain(await data());
		await continuity();
		if (index === 0) {
			await page.getByRole('button', { name: 'Undo circuit edit', exact: true }).click();
			await waitSize(4, 3);
			assert.deepEqual(await data(), twoWaypoints);
			await page.getByRole('button', { name: 'Redo circuit edit', exact: true }).click();
			await waitSize(3, 2);
		}
	}
	assert.equal((await data()).edges[0].sourceNodeId, 'waypoint-input');
	assert.equal((await data()).edges[0].targetNodeId, 'waypoint-output');
	assert.deepEqual(errors, []);
	await page.screenshot({ path: join(directory, 'waypoints-complete.png'), fullPage: true });
	console.log(`Passed: hover-dwell wire selection, Shift selection, Delete/Backspace/trash, visible junction selection, double-click waypoints, dragging, repeated splits, undo/redo/reload, deletion reconnects, finished/Reading behavior. Browser artifacts: ${directory}`);
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
