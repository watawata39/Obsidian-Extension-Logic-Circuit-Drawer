import test from 'node:test';
import assert from 'node:assert/strict';
import { branchEdge, connect, countRemovedConnections, newCircuit, parseCircuit, replaceNode, serializeCircuit } from '../src/model/circuit';
import { createNode, MAX_PINS, pinDefinitions, pinsFor, requiresV2 } from '../src/model/components';
import { CircuitHistory } from '../src/model/history';
import type { CircuitData, CircuitNode, GateType, NodeType } from '../src/model/types';

function diagram(...nodes: CircuitNode[]): CircuitData {
	return { ...newCircuit(), circuitId: 'components-test', schemaVersion: nodes.some(requiresV2) ? 2 : 1, nodes };
}
const parse = (value: unknown): CircuitData => parseCircuit(JSON.stringify(value));
const node = (type: NodeType, id: string = type): CircuitNode => ({ ...createNode(type, { x: 0, y: 0 }), id });

void test('version 1 stays byte-compatible after parsing and serialization; version 2 also accepts old symbols', () => {
	const legacy = diagram(node('and'), node('input'));
	const source = serializeCircuit(legacy);
	assert.equal(parseCircuit(source).schemaVersion, 1);
	assert.equal(serializeCircuit(parseCircuit(source)), source);
	assert.deepEqual(parse({ ...legacy, schemaVersion: 2 }), { ...legacy, schemaVersion: 2 });
	assert.throws(() => parse({ ...diagram(node('d-ff')), schemaVersion: 1 }), /unsupported type/);
	assert.throws(() => parse({ ...legacy, nodes: [{ ...node('and'), inputCount: 3 }] }), /unsupported field/);
});

void test('all multi-input gates support 2–32 stable incoming pins, with NOT fixed at one', () => {
	for (const type of ['and', 'nand', 'or', 'nor', 'xor', 'xnor'] as GateType[]) {
		const gate = { ...node(type), inputCount: MAX_PINS };
		assert.equal(pinsFor(gate).inputs.length, MAX_PINS);
		assert.equal(pinsFor(gate).inputs.at(-1), `in-${MAX_PINS}`);
		assert.deepEqual(parseCircuit(serializeCircuit(diagram(gate))), diagram(gate));
		for (const inputCount of [0, 1, 2.5, MAX_PINS + 1, '3', null]) {
			assert.throws(() => parse({ ...diagram(gate), nodes: [{ ...gate, inputCount }] }), /input count/);
		}
	}
	assert.deepEqual(pinsFor('not'), { inputs: ['in-1'], outputs: ['out'] });
	assert.throws(() => parse({ ...diagram(node('not')), schemaVersion: 2, nodes: [{ ...node('not'), inputCount: 2 }] }), /Only gates with multiple inputs/);
});

void test('latch and flip-flop definitions contain named pins and correct visual polarity markers', () => {
	assert.deepEqual(pinsFor('sr-latch'), { inputs: ['s', 'r'], outputs: ['q', 'q-bar'] });
	assert.deepEqual(pinsFor('d-latch'), { inputs: ['d', 'enable'], outputs: ['q', 'q-bar'] });
	assert.deepEqual(pinsFor('d-ff'), { inputs: ['d', 'clock'], outputs: ['q', 'q-bar'] });
	assert.deepEqual(pinsFor('jk-ff'), { inputs: ['j', 'k', 'clock'], outputs: ['q', 'q-bar'] });
	assert.deepEqual(pinsFor('t-ff'), { inputs: ['t', 'clock'], outputs: ['q', 'q-bar'] });
	const ff: CircuitNode = { ...node('jk-ff'), sequential: {
		clockEdge: 'falling', showInvertedOutput: false,
		preset: { label: 'SET', activeLow: true }, clear: { label: 'RESET', activeLow: false },
	} };
	const pins = pinDefinitions(ff);
	assert.deepEqual(pins.inputs.find(pin => pin.id === 'clock'), { id: 'clock', label: 'CLK', clock: true, activeLow: true });
	assert.deepEqual(pins.inputs.find(pin => pin.id === 'preset'), { id: 'preset', label: 'PRE', activeLow: true });
	assert.deepEqual(pins.inputs.find(pin => pin.id === 'clear'), { id: 'clear', label: 'CLR', activeLow: false });
	assert.deepEqual(pins.outputs.map(pin => pin.id), ['q']);
	assert.deepEqual(parseCircuit(serializeCircuit(diagram(ff))), diagram(ff));
	const latch: CircuitNode = { ...node('d-latch'), sequential: { enableActiveLow: true } };
	assert.equal(pinDefinitions(latch).inputs.find(pin => pin.id === 'enable')?.activeLow, true);
	assert.ok(pinDefinitions(latch).inputs.every(pin => !pin.clock));
});

void test('invalid options are rejected instead of being ignored or silently changing component meaning', () => {
	for (const [type, sequential] of [
		['and', {}], ['sr-latch', { clockEdge: 'rising' }], ['d-ff', { enableActiveLow: false }],
		['d-latch', { clear: { label: 'CLR', activeLow: false } }], ['sr-latch', { preset: { label: 'PRE', activeLow: false } }],
		['d-ff', { clockEdge: 'both' }], ['d-ff', { showInvertedOutput: 1 }],
		['d-ff', { clear: { label: 'CLR', activeLow: 'false' } }],
		['d-ff', { clear: { label: 'x'.repeat(41), activeLow: false } }],
		['d-ff', { unknown: true }],
	] as const) {
		assert.throws(() => parse({ ...newCircuit(), schemaVersion: 2, nodes: [{ ...node(type), sequential }] }));
	}
	assert.throws(() => parse({ ...diagram(node('and')), schemaVersion: 2, nodes: [{ ...node('and'), pins: { inputs: [], outputs: [] } }] }), /Only custom blocks/);
});

void test('custom blocks require bounded pin lists and IDs unique across both directions', () => {
	const block = node('custom');
	assert.equal(block.label, 'Block');
	assert.equal(block.pins?.inputs.length, 2);
	assert.equal(block.pins?.outputs.length, 1);
	assert.equal(new Set([...block.pins.inputs, ...block.pins.outputs].map(pin => pin.id)).size, 3);
	assert.deepEqual(parseCircuit(serializeCircuit(diagram(block))), diagram(block));
	const invalid = [undefined, { inputs: [], outputs: [] }, { inputs: [], outputs: 'bad' }, { inputs: [], outputs: Array.from({ length: 33 }, (_, i) => ({ id: `${i}`, label: '' })) },
		{ inputs: [{ id: 'same', label: '' }], outputs: [{ id: 'same', label: '' }] },
		{ inputs: [{ id: '', label: '' }], outputs: [] }, { inputs: [{ id: 'pin', label: 'x'.repeat(41) }], outputs: [] }];
	for (const pins of invalid) assert.throws(() => parse({ ...diagram(block), nodes: [{ ...block, pins }] }));
	assert.doesNotThrow(() => serializeCircuit(diagram({ ...block, pins: { inputs: [{ id: 'unnamed', label: '' }], outputs: [] } })));
});

void test('multiple custom outputs, reversed gestures, fanout, occupancy and source reload work independently', () => {
	const block: CircuitNode = { ...node('custom'), pins: { inputs: [{ id: 'a', label: 'A' }], outputs: [{ id: 'sum', label: 'Sum' }, { id: 'carry', label: 'Carry' }] } };
	let data = diagram(block, node('output', 'y'), node('output', 'z'), node('input', 'source'));
	data = connect(data, 'y', 'in-1', 'custom', 'carry');
	data = connect(data, 'custom', 'sum', 'z', 'in-1');
	data = connect(data, 'source', 'out', 'custom', 'a');
	assert.deepEqual(data.edges.map(edge => edge.sourcePinId), ['carry', 'sum', 'out']);
	assert.throws(() => connect(data, 'custom', 'carry', 'z', 'in-1'), /already connected/);
	assert.throws(() => connect(data, 'custom', 'a', 'y', 'in-1'), /output pin to an input pin/);
	assert.deepEqual(parseCircuit(serializeCircuit(data)), data);
});

void test('renaming and reordering custom pins preserves exact wire IDs and endpoints', () => {
	const block = node('custom');
	const output = block.pins!.outputs[0]!;
	const input = block.pins!.inputs[0]!;
	let data = connect(diagram(block, node('input'), node('output')), 'input', 'out', 'custom', input.id);
	data = connect(data, 'custom', output.id, 'output', 'in-1');
	const replacement = { ...block, label: 'Renamed block', pins: {
		inputs: [...block.pins!.inputs].reverse().map(pin => ({ ...pin, label: '' })),
		outputs: [{ ...output, label: 'Renamed output' }],
	} };
	assert.equal(countRemovedConnections(data, replacement), 0);
	assert.deepEqual(replaceNode(data, replacement).edges, data.edges);
	assert.deepEqual(data.nodes[0], block, 'the previous snapshot stays untouched');
});

void test('gate input growth upgrades only that circuit and shrink removes highest pins as one undo step', () => {
	const original = connect(diagram(node('and'), node('input')), 'input', 'out', 'and', 'in-2');
	assert.equal(original.schemaVersion, 1);
	const larger = replaceNode(original, { ...original.nodes[0]!, inputCount: 4 });
	assert.equal(larger.schemaVersion, 2);
	assert.deepEqual(larger.edges, original.edges);
	const connected = connect(larger, 'input', 'out', 'and', 'in-4');
	const replacement = { ...connected.nodes[0]!, inputCount: 2 };
	assert.equal(countRemovedConnections(connected, replacement), 1);
	const smaller = replaceNode(connected, replacement);
	assert.deepEqual(smaller.edges, original.edges);
	const history = new CircuitHistory(connected);
	history.commit(smaller);
	assert.deepEqual(history.undo(), connected);
	assert.deepEqual(history.redo(), smaller);
	assert.throws(() => replaceNode(original, { ...replacement, inputCount: Number.MAX_VALUE }), /input count/);
	assert.equal(original.schemaVersion, 1);
});

void test('removing a complementary output cleans its dependent junctions and counts all removed wires', () => {
	const ff = node('d-ff');
	let data = connect(diagram(ff, node('output', 'y'), node('output', 'z')), 'd-ff', 'q-bar', 'y', 'in-1');
	data = branchEdge(data, data.edges[0]!.id, { x: 160, y: 48 }, 'z', 'in-1');
	assert.equal(data.edges.length, 3);
	const replacement = { ...ff, sequential: { showInvertedOutput: false } };
	assert.equal(countRemovedConnections(data, replacement), 3);
	const updated = replaceNode(data, replacement);
	assert.equal(updated.edges.length, 0);
	assert.ok(updated.nodes.every(node => node.type !== 'junction'));
	assert.equal(data.edges.length, 3);
});

void test('legacy control labels stay compatible while fixed display names and polarity preserve wires', () => {
	const ff: CircuitNode = { ...node('d-ff'), sequential: { clear: { label: 'CLR', activeLow: false } } };
	const data = connect(diagram(ff, node('input')), 'input', 'out', 'd-ff', 'clear');
	const changed = { ...ff, sequential: { clear: { label: 'RESET', activeLow: true } } };
	assert.equal(countRemovedConnections(data, changed), 0);
	assert.deepEqual(replaceNode(data, changed).edges, data.edges);
	assert.equal(pinDefinitions(changed).inputs.find(pin => pin.id === 'clear')?.label, 'CLR');
	assert.deepEqual(parseCircuit(serializeCircuit(diagram(changed))), diagram(changed));
	assert.equal(countRemovedConnections(data, { ...ff, sequential: {} }), 1);
	assert.throws(() => replaceNode(data, { ...ff, id: 'missing' }), /no longer available/);
});
