import test from 'node:test';
import assert from 'node:assert/strict';
import { branchEdge, connect, deleteElements, MAX_EDGES, MAX_NODES, MAX_POSITION, newCircuit, parseCircuit, pinsFor, serializeCircuit } from '../src/model/circuit';
import { CircuitHistory } from '../src/model/history';
import type { CircuitData, CircuitEdge, CircuitNode } from '../src/model/types';

function base(): CircuitData {
	return { ...newCircuit(), circuitId: 'test', nodes: [
		{ id: 'a', type: 'input', position: { x: 0, y: 0 }, label: 'A' },
		{ id: 'b', type: 'input', position: { x: 0, y: 100 }, label: 'B' },
		{ id: 'gate', type: 'and', position: { x: 200, y: 0 } },
		{ id: 'other', type: 'or', position: { x: 200, y: 100 } },
		{ id: 'y', type: 'output', position: { x: 400, y: 0 }, label: 'Y' },
	] };
}

void test('pin counts match each supported symbol and terminal', () => {
	assert.deepEqual(pinsFor('input'), { inputs: [], outputs: ['out'] });
	assert.deepEqual(pinsFor('output'), { inputs: ['in-1'], outputs: [] });
	assert.deepEqual(pinsFor('not'), { inputs: ['in-1'], outputs: ['out'] });
	assert.deepEqual(pinsFor('junction'), { inputs: ['in-1'], outputs: ['out'] });
	for (const type of ['and', 'or', 'nand', 'nor', 'xor', 'xnor'] as const) assert.equal(pinsFor(type).inputs.length, 2);
});

void test('connections normalize reversed gestures and permit output fan-out', () => {
	const connected = connect(base(), 'gate', 'in-1', 'a', 'out');
	assert.equal(connected.edges[0]?.sourceNodeId, 'a');
	const fanout = connect(connected, 'a', 'out', 'other', 'in-1');
	assert.equal(fanout.edges.length, 2);
	assert.equal(connected.edges.length, 1, 'previous action remains immutable');
});

void test('invalid directions, references, duplicates and occupied inputs are rejected', () => {
	const data = base();
	assert.throws(() => connect(data, 'a', 'out', 'b', 'out'), /output pin cannot be connected to an Input node/);
	assert.throws(() => connect(data, 'gate', 'in-1', 'other', 'in-2'), /output pin to an input pin/);
	assert.throws(() => connect(data, 'missing', 'out', 'gate', 'in-1'), /connection is no longer available/);
	assert.throws(() => connect(data, 'a', 'bad', 'gate', 'in-1'), /output pin to an input pin/);
	assert.throws(() => connect(data, 'a', 'out', 'gate', 'in-3'), /output pin to an input pin/);
	const connected = connect(data, 'a', 'out', 'gate', 'in-1');
	assert.throws(() => connect(connected, 'a', 'out', 'gate', 'in-1'), /already exists/);
	assert.throws(() => connect(connected, 'b', 'out', 'gate', 'in-1'), /already connected/);
	assert.equal(connected.edges.length, 1);
});

void test('feedback through two gates is permitted without simulation constraints', () => {
	const connected = connect(connect(base(), 'gate', 'out', 'other', 'in-1'), 'other', 'out', 'gate', 'in-1');
	assert.deepEqual(parseCircuit(serializeCircuit(connected)), connected);
});

void test('branching splits a wire and preserves its original target as one immutable action', () => {
	const original = connect(base(), 'a', 'out', 'gate', 'in-1');
	const edge = original.edges[0]!;
	const branched = branchEdge(original, edge.id, { x: 100, y: 20 }, 'other', 'in-1');
	const junction = branched.nodes.find(node => node.type === 'junction')!;
	assert.equal(original.edges.length, 1);
	assert.equal(original.nodes.length, 5);
	assert.equal(branched.edges.length, 3);
	assert.equal(branched.edges.find(wire => wire.id === edge.id)?.targetNodeId, junction.id);
	assert.deepEqual(branched.edges.filter(wire => wire.sourceNodeId === junction.id).map(wire => wire.targetNodeId).sort(), ['gate', 'other']);
	assert.deepEqual(parseCircuit(serializeCircuit(branched)), branched);
});

void test('branching reuses a nearby existing endpoint junction', () => {
	const original = connect(base(), 'a', 'out', 'gate', 'in-1');
	const branched = branchEdge(original, original.edges[0]!.id, { x: 100, y: 20 }, 'other', 'in-1');
	const junction = branched.nodes.find(node => node.type === 'junction')!;
	const incoming = branched.edges.find(edge => edge.targetNodeId === junction.id)!;
	const reused = branchEdge(branched, incoming.id, { x: 108, y: 20 }, 'y', 'in-1');
	assert.equal(reused.nodes.length, branched.nodes.length);
	assert.equal(reused.edges.length, branched.edges.length + 1);
	assert.equal(reused.edges.at(-1)?.sourceNodeId, junction.id);
});

void test('overlapping junction hit areas reuse the closest endpoint', () => {
	const circuit: CircuitData = { ...base(), nodes: [...base().nodes,
		{ id: 'j1', type: 'junction', position: { x: 100, y: 20 } },
		{ id: 'j2', type: 'junction', position: { x: 110, y: 20 } },
	], edges: [
		{ id: 'upstream', sourceNodeId: 'a', sourcePinId: 'out', targetNodeId: 'j1', targetPinId: 'in-1' },
		{ id: 'middle', sourceNodeId: 'j1', sourcePinId: 'out', targetNodeId: 'j2', targetPinId: 'in-1' },
		{ id: 'downstream', sourceNodeId: 'j2', sourcePinId: 'out', targetNodeId: 'gate', targetPinId: 'in-1' },
	] };
	const branched = branchEdge(circuit, 'middle', { x: 109, y: 20 }, 'other', 'in-1');
	assert.equal(branched.edges.at(-1)?.sourceNodeId, 'j2');
	assert.equal(branched.nodes.length, circuit.nodes.length);
});

void test('a rejected branch leaves no partial junction or changed wire', () => {
	const original = connect(connect(base(), 'a', 'out', 'gate', 'in-1'), 'b', 'out', 'other', 'in-1');
	const baseline = serializeCircuit(original);
	assert.throws(() => branchEdge(original, original.edges[0]!.id, { x: 100, y: 20 }, 'other', 'in-1'), /already connected/);
	assert.throws(() => branchEdge(original, 'missing', { x: 100, y: 20 }, 'y', 'in-1'), /no longer exists/);
	assert.throws(() => branchEdge(original, original.edges[0]!.id, { x: NaN, y: 20 }, 'y', 'in-1'), /finite/);
	assert.throws(() => branchEdge(original, original.edges[0]!.id, { x: 1e308, y: 20 }, 'y', 'in-1'), /between -10000 and 10000/);
	assert.equal(serializeCircuit(original), baseline);
});

void test('junction deletion reconnects upstream to every downstream target', () => {
	const original = connect(base(), 'a', 'out', 'gate', 'in-1');
	const branched = branchEdge(original, original.edges[0]!.id, { x: 100, y: 20 }, 'other', 'in-1');
	const junction = branched.nodes.find(node => node.type === 'junction')!;
	const removed = deleteElements(branched, [junction.id], []);
	assert.equal(removed.nodes.length, original.nodes.length);
	assert.deepEqual(removed.edges.map(edge => [edge.sourceNodeId, edge.targetNodeId]).sort(), [['a', 'gate'], ['a', 'other']]);
	assert.equal(branched.nodes.length, 6);
});

void test('deleting a branch preserves a one-output routing anchor, then removes empty junctions', () => {
	const original = connect(base(), 'a', 'out', 'gate', 'in-1');
	const branched = branchEdge(original, original.edges[0]!.id, { x: 100, y: 20 }, 'other', 'in-1');
	const branch = branched.edges.find(edge => edge.targetNodeId === 'other')!;
	const one = deleteElements(branched, [], [branch.id]);
	assert.equal(one.nodes.filter(node => node.type === 'junction').length, 1);
	const final = deleteElements(one, [], [one.edges.find(edge => edge.targetNodeId === 'gate')!.id]);
	assert.equal(final.nodes.filter(node => node.type === 'junction').length, 0);
	assert.equal(final.edges.length, 0);
});

void test('deleting a source propagates cleanup through a chain of dependent junctions', () => {
	const original = connect(base(), 'a', 'out', 'gate', 'in-1');
	const first = branchEdge(original, original.edges[0]!.id, { x: 80, y: 0 }, 'other', 'in-1');
	const second = branchEdge(first, first.edges.find(edge => edge.targetNodeId === 'other')!.id, { x: 140, y: 70 }, 'y', 'in-1');
	assert.equal(second.nodes.filter(node => node.type === 'junction').length, 2);
	const removed = deleteElements(second, ['a'], []);
	assert.equal(removed.edges.length, 0);
	assert.equal(removed.nodes.filter(node => node.type === 'junction').length, 0);
});

void test('deleting multiple adjacent junctions reconnects to their surviving source', () => {
	const original = connect(base(), 'a', 'out', 'gate', 'in-1');
	const first = branchEdge(original, original.edges[0]!.id, { x: 80, y: 0 }, 'other', 'in-1');
	const second = branchEdge(first, first.edges.find(edge => edge.targetNodeId === 'other')!.id, { x: 140, y: 70 }, 'y', 'in-1');
	const removed = deleteElements(second, second.nodes.filter(node => node.type === 'junction').map(node => node.id), []);
	assert.equal(removed.edges.length, 3);
	assert.ok(removed.edges.every(edge => edge.sourceNodeId === 'a'));
	assert.deepEqual(parseCircuit(serializeCircuit(removed)), removed);
});

void test('deleting a junction does not resurrect explicitly deleted downstream branches', () => {
	const original = connect(base(), 'a', 'out', 'gate', 'in-1');
	const branched = branchEdge(original, original.edges[0]!.id, { x: 100, y: 20 }, 'other', 'in-1');
	const junction = branched.nodes.find(node => node.type === 'junction')!;
	const removed = deleteElements(branched, [junction.id], [branched.edges.find(edge => edge.targetNodeId === 'other')!.id]);
	assert.equal(removed.edges.length, 1);
	assert.equal(removed.edges[0]?.targetNodeId, 'gate');
});

void test('junction-only cycles are rejected, while feedback with a gate remains valid', () => {
	const junctions: CircuitNode[] = ['j1', 'j2'].map(id => ({ id, type: 'junction', position: { x: 20, y: 20 } }));
	const edges: CircuitEdge[] = [
		{ id: 'e1', sourceNodeId: 'j1', sourcePinId: 'out', targetNodeId: 'j2', targetPinId: 'in-1' },
		{ id: 'e2', sourceNodeId: 'j2', sourcePinId: 'out', targetNodeId: 'j1', targetPinId: 'in-1' },
	];
	assert.throws(() => parseCircuit(JSON.stringify({ ...base(), nodes: junctions, edges })), /cycle/);
	const gateFeedback = { ...base(), nodes: [...base().nodes, junctions[0]!], edges: [
		{ id: 'e1', sourceNodeId: 'gate', sourcePinId: 'out', targetNodeId: 'j1', targetPinId: 'in-1' },
		{ id: 'e2', sourceNodeId: 'j1', sourcePinId: 'out', targetNodeId: 'gate', targetPinId: 'in-1' },
	] };
	assert.doesNotThrow(() => serializeCircuit(gateFeedback));
	const direct = deleteElements(gateFeedback, ['j1'], []);
	assert.equal(direct.edges.length, 1);
	assert.equal(direct.edges[0]?.sourceNodeId, 'gate');
	assert.equal(direct.edges[0]?.targetNodeId, 'gate');
	assert.deepEqual(parseCircuit(serializeCircuit(direct)), direct);
});

void test('history restores all IDs and positions for compound branch actions and clears redo after new edits', () => {
	const original = connect(base(), 'a', 'out', 'gate', 'in-1');
	const history = new CircuitHistory(original);
	const branched = branchEdge(original, original.edges[0]!.id, { x: 100, y: 20 }, 'other', 'in-1');
	history.commit(branched);
	assert.deepEqual(history.undo(), original);
	assert.deepEqual(history.redo(), branched);
	assert.deepEqual(history.undo(), original);
	history.commit(connect(original, 'b', 'out', 'gate', 'in-2'));
	assert.equal(history.canRedo, false);
	const exposed = history.value;
	exposed.nodes[0]!.position.x = 999;
	assert.notEqual(history.value.nodes[0]!.position.x, 999, 'callers cannot mutate a history snapshot');
});

void test('parser rejects malformed or unsupported data rather than replacing it', () => {
	assert.throws(() => parseCircuit('{broken'), /valid JSON/);
	assert.throws(() => parseCircuit('null'), /object/);
	assert.throws(() => parseCircuit(JSON.stringify({ ...base(), schemaVersion: 3 })), /version: 3/);
	assert.throws(() => parseCircuit(JSON.stringify({ ...base(), extra: true })), /unsupported field/);
	assert.throws(() => parseCircuit(JSON.stringify({ ...base(), view: { preferredScale: 0 } })), /scale/);
	assert.throws(() => parseCircuit(JSON.stringify({ ...base(), nodes: [{ ...base().nodes[2], label: 'Gate label' }] })), /only Input and Output/);
	assert.throws(() => parseCircuit(JSON.stringify({ ...base(), nodes: [{ ...base().nodes[0], type: 'chip' }] })), /unsupported type/);
	assert.throws(() => parseCircuit(JSON.stringify({ ...base(), nodes: [base().nodes[0], base().nodes[0]] })), /Node identifiers must be unique/);
	assert.throws(() => parseCircuit(JSON.stringify({ ...base(), nodes: [{ ...base().nodes[0], position: { x: '5', y: 0 } }] })), /finite/);
	assert.throws(() => parseCircuit(JSON.stringify({ ...base(), nodes: [{ ...base().nodes[0], label: 'x'.repeat(201) }] })), /200/);
	assert.throws(() => parseCircuit(JSON.stringify({ ...base(), nodes: [{ id: 'j', type: 'junction', position: { x: 0, y: 0 } }] })), /must have an incoming connection/);
});

void test('finite coordinates that could overflow layout arithmetic are rejected with source preserved', () => {
	const source = JSON.stringify({ ...base(), nodes: [
		{ id: 'left', type: 'input', position: { x: -1e308, y: 0 } },
		{ id: 'right', type: 'output', position: { x: 1e308, y: 0 } },
	] });
	const original = source;
	assert.throws(() => parseCircuit(source), /between -10000 and 10000/);
	assert.equal(source, original);
	const boundary: CircuitData = { ...base(), nodes: [
		{ id: 'left', type: 'input', position: { x: -MAX_POSITION, y: -MAX_POSITION } },
		{ id: 'right', type: 'output', position: { x: MAX_POSITION, y: MAX_POSITION } },
	] };
	assert.deepEqual(parseCircuit(serializeCircuit(boundary)), boundary);
});

void test('oversized node and wire arrays are rejected before layout or graph processing', () => {
	const nodes = Array.from({ length: MAX_NODES + 1 }, (_, index): CircuitNode => ({ id: `node-${index}`, type: 'input', position: { x: 0, y: 0 } }));
	assert.throws(() => parseCircuit(JSON.stringify({ ...base(), nodes })), /too many nodes.*1000/);
	const edges = Array.from({ length: MAX_EDGES + 1 }, (_, index): CircuitEdge => ({ id: `wire-${index}`, sourceNodeId: 'a', sourcePinId: 'out', targetNodeId: 'gate', targetPinId: 'in-1' }));
	assert.throws(() => parseCircuit(JSON.stringify({ ...base(), edges })), /too many wires.*5000/);
});
