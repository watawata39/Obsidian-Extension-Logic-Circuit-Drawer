import test from 'node:test';
import assert from 'node:assert/strict';
import type { CircuitNode } from '../src/model/types';
import { newCircuit } from '../src/model/circuit';
import { boundsFor, edgeWirePoints, GRID, localPinPoint, nodeSnapReference, pinAnchorFor, pinPoint, sizeFor, snapNodePosition, terminalGeometry, wirePoints } from '../src/ui/geometry';

void test('every gate port uses the same connector geometry regardless of circuit position', () => {
	for (const type of ['and', 'or', 'not', 'nand', 'nor', 'xor', 'xnor'] as const) {
		const node: CircuitNode = { id: type, type, position: { x: -128, y: 96 } };
		const size = sizeFor(node);
		assert.equal(size.width, 80, 'short leads keep the gate compact');
		assert.equal(size.height, 64);
		assert.ok((node.position.x + size.width / 2) % GRID === 0, 'the gate center shares the pin grid in both axes');
		assert.ok((node.position.y + size.height / 2) % GRID === 0);
		const pins = type === 'not' ? ['in-1', 'out'] : ['in-1', 'in-2', 'out'];
		for (const pin of pins) {
			const local = localPinPoint(node, pin);
			assert.deepEqual(pinPoint(node, pin), { x: node.position.x + local.x, y: node.position.y + local.y });
			assert.equal(local.x, pin === 'out' ? size.width : 0);
			assert.ok(local.y > 0 && local.y < size.height);
			assert.equal(local.x % GRID, 0);
			assert.equal(local.y % GRID, 0, 'every incoming pin and output uses the shared grid');
		}
	}
});

void test('measured handle side boundaries meet connectors independently of hit target size', () => {
	for (const type of ['and', 'or', 'not', 'nand', 'nor', 'xor', 'xnor', 'input', 'output', 'junction'] as const) {
		for (const pin of type === 'input' ? ['out'] : type === 'output' ? ['in-1'] : ['in-1', 'out']) {
			const node = { type, label: type === 'input' || type === 'output' ? 'Enable' : undefined };
			const point = localPinPoint(node, pin);
			const anchor = pinAnchorFor(node, pin);
			assert.ok(anchor.width > 0 && anchor.height > 0, 'Flow has a measurable handle');
			assert.equal(anchor.left + (pin === 'out' ? anchor.width : 0), point.x);
			assert.equal(anchor.top + anchor.height / 2, point.y);
			assert.equal(anchor.left + anchor.markerX, point.x, 'marker and centered hit disc use the same connector');
			assert.equal(anchor.top + anchor.markerY, point.y);
		}
	}
});

void test('terminal labels sit above small markers with inward-facing, continuous connectors', () => {
	for (const label of ['', 'A', 'Enable', 'First line\nSecond line', '輸入'.repeat(40), '🔌'.repeat(40)]) {
		const geometry = terminalGeometry(label);
		assert.ok(geometry.width >= 64 && geometry.width <= 192);
		assert.ok(geometry.labelHeight >= 19);
		assert.ok(geometry.markerTop > geometry.labelHeight);
		for (const type of ['input', 'output'] as const) {
			const point = localPinPoint({ type, label }, type === 'input' ? 'out' : 'in-1');
			assert.equal(point.y, geometry.markerY);
			assert.ok(point.x >= 0 && point.x <= geometry.width);
			assert.ok(point.y < geometry.height);
			assert.equal(point.x - geometry.markerX, type === 'input' ? 16 : -16);
			assert.equal(point.x % GRID, 0);
			assert.equal(point.y % GRID, 0, 'wrapped labels keep the marker on the grid');
		}
	}
	assert.equal(terminalGeometry('🔌').height, terminalGeometry('A').height, 'emoji surrogate pairs do not add extra rows');
});

void test('a gate output can align exactly with either incoming pin or another gate center', () => {
	const source: CircuitNode = { id: 'source', type: 'and', position: snapNodePosition({ type: 'and' }, { x: 37, y: 55 }) };
	const output = pinPoint(source, 'out');
	for (const type of ['and', 'or', 'not', 'nand', 'nor', 'xor', 'xnor'] as const) {
		for (const pin of type === 'not' ? ['in-1', 'out'] : ['in-1', 'in-2', 'out']) {
			const desired = { x: 260, y: output.y - localPinPoint({ type }, pin).y };
			const target: CircuitNode = { id: 'target', type, position: snapNodePosition({ type }, desired) };
			assert.equal(pinPoint(target, pin).y, output.y, `${type} ${pin} lines up exactly after snapping`);
		}
	}
});

void test('snapping places junctions and differently sized terminal labels on the gate connector lattice', () => {
	for (const node of [
		{ type: 'junction' as const },
		{ type: 'input' as const, label: 'A' },
		{ type: 'output' as const, label: 'Enable output\nfrom circuit' },
		{ type: 'input' as const, label: '輸入'.repeat(40) },
	]) {
		const position = snapNodePosition(node, { x: 101, y: 79 });
		const reference = nodeSnapReference(node);
		assert.equal((position.x + reference.x) % GRID, 0);
		assert.equal((position.y + reference.y) % GRID, 0);
		assert.deepEqual(snapNodePosition(node, position), position, 'snapping a placed node is stable');
		assert.ok(Math.abs(position.x - 101) <= GRID / 2 && Math.abs(position.y - 79) <= GRID / 2);
		for (const pin of node.type === 'input' ? ['out'] : node.type === 'output' ? ['in-1'] : ['in-1', 'out']) {
			const point = pinPoint({ ...node, id: 'test', position }, pin);
			assert.equal(point.x % GRID, 0);
			assert.equal(point.y % GRID, 0);
		}
	}
});

void test('orthogonal routes meet connectors exactly, including backward wires', () => {
	const input: CircuitNode = { id: 'a', type: 'input', label: 'A', position: { x: 16, y: 32 } };
	const gate: CircuitNode = { id: 'g', type: 'nand', position: { x: 240, y: 64 } };
	const output: CircuitNode = { id: 'y', type: 'output', label: 'Y', position: { x: 16, y: 32 } };
	for (const [source, sourcePin, target, targetPin] of [[input, 'out', gate, 'in-1'], [gate, 'out', output, 'in-1']] as const) {
		const start = pinPoint(source, sourcePin);
		const end = pinPoint(target, targetPin);
		const points = wirePoints(start, end);
		assert.deepEqual(points[0], start);
		assert.deepEqual(points.at(-1), end);
		for (let index = 1; index < points.length; index++) {
			assert.ok(points[index - 1]!.x === points[index]!.x || points[index - 1]!.y === points[index]!.y);
		}
	}
});

void test('fit bounds contain multiline terminal labels, junction markers and complete feedback routes', () => {
	const circuit = { ...newCircuit(), nodes: [
		{ id: 'a', type: 'input' as const, label: '長い入力ラベル'.repeat(12), position: { x: -48, y: 0 } },
		{ id: 'g', type: 'not' as const, position: { x: 240, y: 16 } },
		{ id: 'j', type: 'junction' as const, position: { x: 96, y: 8 } },
		{ id: 'h', type: 'not' as const, position: { x: 0, y: 96 } },
	], edges: [
		{ id: 'g-j', sourceNodeId: 'g', sourcePinId: 'out', targetNodeId: 'j', targetPinId: 'in-1' },
		{ id: 'j-h', sourceNodeId: 'j', sourcePinId: 'out', targetNodeId: 'h', targetPinId: 'in-1' },
		{ id: 'h-g', sourceNodeId: 'h', sourcePinId: 'out', targetNodeId: 'g', targetPinId: 'in-1' },
	] };
	const bounds = boundsFor(circuit);
	const inside = (point: { x: number; y: number }) => assert.ok(point.x >= bounds.minX && point.x <= bounds.maxX && point.y >= bounds.minY && point.y <= bounds.maxY);
	for (const node of circuit.nodes) {
		const size = sizeFor(node);
		inside(node.position);
		inside({ x: node.position.x + size.width, y: node.position.y + size.height });
		if (node.type === 'junction') { inside(pinPoint(node, 'in-1')); inside(pinPoint(node, 'out')); }
	}
	for (const edge of circuit.edges) {
		const source = circuit.nodes.find(node => node.id === edge.sourceNodeId)!;
		const target = circuit.nodes.find(node => node.id === edge.targetNodeId)!;
		edgeWirePoints(source, edge.sourcePinId, target, edge.targetPinId).forEach(inside);
	}
});

void test('configurable gates grow without moving their default connectors off the grid', () => {
	for (const type of ['and', 'or', 'nand', 'nor', 'xor', 'xnor'] as const) {
		for (const inputCount of [2, 3, 4, 8, 32]) {
			const node = { type, inputCount };
			const size = sizeFor(node);
			assert.deepEqual(size, { width: 80, height: inputCount * 32 });
			for (let index = 0; index < inputCount; index++) {
				assert.deepEqual(localPinPoint(node, `in-${index + 1}`), { x: 0, y: 16 + index * 32 });
			}
			assert.deepEqual(localPinPoint(node, 'out'), { x: 80, y: size.height / 2 });
			const position = snapNodePosition(node, { x: 101, y: 79 });
			assert.equal((position.x + size.width / 2) % GRID, 0);
			assert.equal((position.y + size.height / 2) % GRID, 0);
		}
	}
});
