import test from 'node:test';
import assert from 'node:assert/strict';
import { connect, deleteElements, insertJunction, MAX_NODES, MAX_POSITION, newCircuit, parseCircuit, serializeCircuit } from '../src/model/circuit';
import { createNode } from '../src/model/components';
import { CircuitHistory } from '../src/model/history';
import type { CircuitData, CircuitNode } from '../src/model/types';
import { pinPoint, wireRoutesFor } from '../src/ui/geometry';

function fixture(): CircuitData {
	return connect({ ...newCircuit(), nodes: [
		{ id: 'a', type: 'input', label: 'A', position: { x: 0, y: 0 } },
		{ id: 'g', type: 'and', position: { x: 400, y: 0 } },
	] }, 'a', 'out', 'g', 'in-1');
}

void test('inserting a routing junction splits one wire without adding a branch or changing schema', () => {
	const original = fixture();
	const edge = original.edges[0]!;
	const source = serializeCircuit(original);
	const split = insertJunction(original, edge.id, { x: 192, y: 16 });
	const junction = split.nodes.find(node => node.type === 'junction')!;
	assert.equal(split.schemaVersion, 1);
	assert.equal(split.nodes.length, original.nodes.length + 1);
	assert.equal(split.edges.length, 2);
	assert.deepEqual(junction.position, { x: 192, y: 16 });
	assert.deepEqual(split.edges[0], { ...edge, targetNodeId: junction.id, targetPinId: 'in-1' });
	assert.equal(split.edges[1]!.sourceNodeId, junction.id);
	assert.equal(split.edges[1]!.sourcePinId, 'out');
	assert.equal(split.edges[1]!.targetNodeId, edge.targetNodeId);
	assert.equal(split.edges[1]!.targetPinId, edge.targetPinId);
	assert.notEqual(split.edges[1]!.id, edge.id);
	assert.deepEqual(parseCircuit(serializeCircuit(split)), split, 'a degree-two junction survives source reload');
	assert.equal(serializeCircuit(original), source, 'the previous action remains immutable');
	const history = new CircuitHistory(original);
	history.commit(split);
	assert.deepEqual(history.undo(), original);
	assert.deepEqual(history.redo(), split);
});

void test('junction insertion preserves custom output identity and sequential feedback endpoints', () => {
	const custom: CircuitNode = { ...createNode('custom', { x: 0, y: 0 }), id: 'custom', pins: { inputs: [], outputs: [{ id: 'sum', label: 'Sum' }, { id: 'carry', label: 'Carry' }] } };
	const ff: CircuitNode = { ...createNode('d-ff', { x: 400, y: 0 }), id: 'ff' };
	let data: CircuitData = { ...newCircuit(), schemaVersion: 2, nodes: [custom, ff] };
	data = connect(data, custom.id, 'carry', ff.id, 'd');
	data = connect(data, ff.id, 'q-bar', ff.id, 'clock');
	for (const original of [...data.edges]) {
		const split = insertJunction(data, original.id, { x: 192, y: 96 });
		assert.equal(split.schemaVersion, 2);
		const junction = split.nodes.find(node => node.type === 'junction')!;
		assert.equal(split.edges.find(edge => edge.id === original.id)!.sourcePinId, original.sourcePinId);
		const downstream = split.edges.find(edge => edge.sourceNodeId === junction.id)!;
		assert.equal(downstream.targetNodeId, original.targetNodeId);
		assert.equal(downstream.targetPinId, original.targetPinId);
		assert.deepEqual(split.edges.find(edge => edge.id !== original.id && edge.sourceNodeId !== junction.id), data.edges.find(edge => edge.id !== original.id));
		assert.deepEqual(parseCircuit(serializeCircuit(split)), split);
	}
});

void test('consecutive routing points can be moved, deleted individually, or removed together without changing electrical endpoints', () => {
	const original = fixture();
	const first = insertJunction(original, original.edges[0]!.id, { x: 120, y: 40 });
	const j1 = first.nodes.find(node => node.type === 'junction')!;
	const second = insertJunction(first, first.edges.find(edge => edge.sourceNodeId === j1.id)!.id, { x: 280, y: 80 });
	const j2 = second.nodes.find(node => node.type === 'junction' && node.id !== j1.id)!;
	assert.equal(second.edges.length, 3);
	const moved = { ...second, nodes: second.nodes.map(node => node.id === j1.id ? { ...node, position: { x: 160, y: 152 } } : node) };
	assert.deepEqual(parseCircuit(serializeCircuit(moved)), moved);
	const routes = wireRoutesFor(moved);
	for (const edge of moved.edges) {
		const from = moved.nodes.find(node => node.id === edge.sourceNodeId)!;
		const to = moved.nodes.find(node => node.id === edge.targetNodeId)!;
		const route = routes.get(edge.id)!;
		assert.deepEqual(route[0], pinPoint(from, edge.sourcePinId));
		assert.deepEqual(route.at(-1), pinPoint(to, edge.targetPinId));
		for (let index = 1; index < route.length; index++) assert.ok(route[index]!.x === route[index - 1]!.x || route[index]!.y === route[index - 1]!.y);
	}
	const removedFirst = deleteElements(moved, [j1.id], []);
	assert.equal(removedFirst.nodes.some(node => node.id === j2.id), true);
	assert.equal(removedFirst.edges.find(edge => edge.targetNodeId === j2.id)!.sourceNodeId, 'a');
	const direct = deleteElements(moved, [j1.id, j2.id], []);
	assert.equal(direct.edges.length, 1);
	assert.deepEqual([direct.edges[0]!.sourceNodeId, direct.edges[0]!.sourcePinId, direct.edges[0]!.targetNodeId, direct.edges[0]!.targetPinId], ['a', 'out', 'g', 'in-1']);
	const removedSource = deleteElements(moved, ['a'], []);
	assert.equal(removedSource.edges.length, 0);
	assert.ok(removedSource.nodes.every(node => node.type !== 'junction'));
});

void test('nearby existing endpoint junctions are reused as an exact no-op', () => {
	const original = fixture();
	const split = insertJunction(original, original.edges[0]!.id, { x: 192, y: 16 });
	const junction = split.nodes.find(node => node.type === 'junction')!;
	const source = serializeCircuit(split);
	for (const edge of split.edges) {
		assert.equal(insertJunction(split, edge.id, { x: junction.position.x + 12, y: junction.position.y }), split);
		assert.equal(insertJunction(split, edge.id, { ...junction.position }), split);
	}
	assert.equal(serializeCircuit(split), source);
	const history = new CircuitHistory(split);
	assert.deepEqual(history.commit(insertJunction(split, split.edges[0]!.id, junction.position)), split);
	assert.equal(history.canUndo, false);
});

void test('a physically nearby junction on another wire does not merge independent signals', () => {
	let data = fixture();
	data = { ...data, nodes: [...data.nodes, { id: 'b', type: 'input', position: { x: 0, y: 96 } }, { id: 'h', type: 'and', position: { x: 400, y: 96 } }] };
	data = connect(data, 'b', 'out', 'h', 'in-1');
	const first = insertJunction(data, data.edges[0]!.id, { x: 192, y: 16 });
	const independent = insertJunction(first, data.edges[1]!.id, { x: 192, y: 16 });
	const junctions = independent.nodes.filter(node => node.type === 'junction');
	assert.equal(junctions.length, 2);
	assert.notEqual(junctions[0]!.id, junctions[1]!.id);
	assert.deepEqual(independent.edges.filter(edge => junctions.some(node => node.id === edge.targetNodeId)).map(edge => edge.sourceNodeId).sort(), ['a', 'b']);
});

void test('invalid positions, stale wires, and size limits reject insertion without partial changes', () => {
	const original = fixture();
	const source = serializeCircuit(original);
	for (const position of [{ x: NaN, y: 0 }, { x: 0, y: Infinity }, { x: MAX_POSITION + 1, y: 0 }, { x: 0, y: -MAX_POSITION - 1 }]) {
		assert.throws(() => insertJunction(original, original.edges[0]!.id, position), /finite|between/);
	}
	assert.throws(() => insertJunction(original, 'removed-wire', { x: 80, y: 0 }), /no longer exists/);
	const full = { ...original, nodes: [...original.nodes, ...Array.from({ length: MAX_NODES - original.nodes.length }, (_, index): CircuitNode => ({ id: `unused-${index}`, type: 'input', position: { x: 0, y: 0 } }))] };
	assert.throws(() => insertJunction(full, full.edges[0]!.id, { x: 80, y: 0 }), /too many nodes/);
	assert.equal(serializeCircuit(original), source);
});
