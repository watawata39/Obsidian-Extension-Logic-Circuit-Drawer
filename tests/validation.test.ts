import test from 'node:test';
import assert from 'node:assert/strict';
import { CircuitValidationError, connect, newCircuit, parseCircuit, pinsFor, serializeCircuit } from '../src/model/circuit';
import type { CircuitData, CircuitEdge, CircuitNode, GateType } from '../src/model/types';

const gateTypes: GateType[] = ['and', 'or', 'not', 'nand', 'nor', 'xor', 'xnor'];

void test('every gate permits direct output feedback to each input and survives source reload', () => {
	for (const type of gateTypes) {
		const original: CircuitData = { ...newCircuit(), nodes: [{ id: 'gate', type, position: { x: 80, y: 64 } }] };
		let connected = original;
		for (const pin of pinsFor(type).inputs) {
			connected = connect(connected, 'gate', 'out', 'gate', pin);
			assert.deepEqual(parseCircuit(serializeCircuit(connected)), connected);
		}
		assert.equal(connected.edges.length, pinsFor(type).inputs.length);
		assert.equal(original.edges.length, 0, 'adding feedback leaves the preceding action immutable');
	}
});

void test('reverse self-feedback gestures normalize output and input pins without bypassing validation', () => {
	const data: CircuitData = { ...newCircuit(), nodes: [{ id: 'gate', type: 'xor', position: { x: 0, y: 0 } }] };
	const reverse = connect(data, 'gate', 'in-2', 'gate', 'out');
	assert.equal(reverse.edges[0]?.sourcePinId, 'out');
	assert.equal(reverse.edges[0]?.targetPinId, 'in-2');
	assert.deepEqual(parseCircuit(serializeCircuit(reverse)), reverse);
	assert.throws(() => connect(reverse, 'gate', 'in-2', 'gate', 'out'), /already exists/);
	assert.throws(() => connect(data, 'gate', 'in-1', 'gate', 'in-2'), /output pin to an input pin/);
	assert.throws(() => connect(data, 'gate', 'out', 'gate', 'out'), /output pin to an input pin/);
});

void test('feedback retains exclusive input occupancy, terminal directions and junction-only cycle rejection', () => {
	const gate: CircuitNode = { id: 'gate', type: 'and', position: { x: 80, y: 0 } };
	const input: CircuitNode = { id: 'input', type: 'input', label: 'A', position: { x: 0, y: 0 } };
	const output: CircuitNode = { id: 'output', type: 'output', label: 'Y', position: { x: 160, y: 0 } };
	const data: CircuitData = { ...newCircuit(), nodes: [gate, input, output] };
	const feedback = connect(data, 'gate', 'out', 'gate', 'in-1');
	assert.throws(() => connect(feedback, 'input', 'out', 'gate', 'in-1'), /This input pin is already connected/);
	const driven = connect(data, 'input', 'out', 'gate', 'in-2');
	assert.throws(() => connect(driven, 'gate', 'out', 'gate', 'in-2'), /This input pin is already connected/);
	assert.throws(() => connect(data, 'input', 'out', 'input', 'in-1'), /output pin cannot be connected to an Input node/);
	assert.throws(() => connect(data, 'output', 'out', 'output', 'in-1'), /Output node cannot start a connection/);
	const junction: CircuitData = { ...newCircuit(), nodes: [{ id: 'junction', type: 'junction', position: { x: 0, y: 0 } }] };
	assert.throws(() => connect(junction, 'junction', 'out', 'junction', 'in-1'), /Junctions cannot form a cycle/);
	const selfCycle: CircuitEdge = { id: 'wire', sourceNodeId: 'junction', sourcePinId: 'out', targetNodeId: 'junction', targetPinId: 'in-1' };
	assert.throws(() => parseCircuit(JSON.stringify({ ...junction, edges: [selfCycle] })), /cycle/);
});

const opaqueIds = [
	'152b7edc-337e-4b3c-b84f-4bfd97b18001',
	'152b7edc-337e-4b3c-b84f-4bfd97b18002',
	'152b7edc-337e-4b3c-b84f-4bfd97b18003',
	'152b7edc-337e-4b3c-b84f-4bfd97b18004',
	'152b7edc-337e-4b3c-b84f-4bfd97b18005',
	'152b7edc-337e-4b3c-b84f-4bfd97b18006',
];
const [inputId, gateId, outputId, junctionId, wireId, missingId] = opaqueIds as [string, string, string, string, string, string];
function readable(action: () => unknown, expected: RegExp): void {
	assert.throws(action, (reason: unknown) => {
		assert.ok(reason instanceof CircuitValidationError);
		assert.match(reason.message, expected);
		for (const identifier of opaqueIds) assert.ok(!reason.message.includes(identifier), `Error exposed an internal identifier: ${reason.message}`);
		assert.doesNotMatch(reason.message, /(?:wire|node|junction) \d+|\b(?:AND|OR|NOT|NAND|NOR|XOR|XNOR) gate\b/i);
		for (const label of ['Left signal', 'Result signal']) assert.ok(!reason.message.includes(label));
		return true;
	});
}
const parse = (data: unknown): CircuitData => parseCircuit(JSON.stringify(data));
function labelled(): CircuitData {
	return { ...newCircuit(), nodes: [
		{ id: inputId, type: 'input', label: 'Left signal', position: { x: 0, y: 0 } },
		{ id: gateId, type: 'xor', position: { x: 80, y: 0 } },
		{ id: outputId, type: 'output', label: 'Result signal', position: { x: 160, y: 0 } },
	] };
}
const wire = (sourceNodeId: string, sourcePinId: string, targetNodeId: string, targetPinId: string): CircuitEdge => ({
	id: wireId, sourceNodeId, sourcePinId, targetNodeId, targetPinId,
});

void test('connection errors explain the action without identifying individual gates, wires, or labels', () => {
	const data = labelled();
	readable(() => connect(data, gateId, 'in-1', outputId, 'in-1'), /^Connect an output pin to an input pin\.$/);
	readable(() => connect(data, gateId, 'out', inputId, 'out'), /^An output pin cannot be connected to an Input node\.$/);
	readable(() => connect(data, outputId, 'out', gateId, 'in-1'), /^An Output node cannot start a connection\.$/);
	readable(() => connect(data, missingId, 'out', gateId, 'in-1'), /^This connection is no longer available\.$/);
	const feedback = connect(data, gateId, 'out', gateId, 'in-2');
	readable(() => connect(feedback, inputId, 'out', gateId, 'in-2'), /^This input pin is already connected\.$/);
	const driven = connect(data, inputId, 'out', gateId, 'in-1');
	readable(() => connect(driven, inputId, 'out', gateId, 'in-1'), /^This connection already exists\.$/);
});

void test('malformed graph errors use generic explanations without ordinals, labels, or identifiers', () => {
	const data = labelled();
	readable(() => parse({ ...data, nodes: [data.nodes[0], data.nodes[0]] }), /^Node identifiers must be unique\.$/);
	const first = wire(inputId, 'out', gateId, 'in-1');
	readable(() => parse({ ...data, edges: [first, first] }), /^Wire identifiers must be unique\.$/);
	readable(() => parse({ ...data, edges: [wire(missingId, 'out', gateId, 'in-1')] }), /^This connection is no longer available\.$/);
	readable(() => parse({ ...data, edges: [wire(gateId, 'in-1', outputId, 'in-1')] }), /^Connect an output pin to an input pin\.$/);
	readable(() => parse({ ...data, edges: [wire(gateId, 'out', inputId, 'out')] }), /^An output pin cannot be connected to an Input node\.$/);
	const junction: CircuitNode = { id: junctionId, type: 'junction', position: { x: 40, y: 0 } };
	readable(() => parse({ ...data, nodes: [...data.nodes, junction] }), /^A junction must have an incoming connection\.$/);
	readable(() => parse({ ...data, nodes: [...data.nodes, junction], edges: [wire(inputId, 'out', junctionId, 'in-1')] }), /^A junction must have an outgoing connection\.$/);
	readable(() => parse({ ...data, nodes: [{ ...junction }], edges: [wire(junctionId, 'out', junctionId, 'in-1')] }), /Junctions cannot form a cycle/);
});

void test('malformed node and wire fields retain useful field descriptions without object indexes', () => {
	const data = labelled();
	readable(() => parse({ ...data, nodes: [{ ...data.nodes[0], position: { x: 'bad', y: 0 } }] }), /^Node x must be a finite number\.$/);
	readable(() => parse({ ...data, edges: [{ ...wire(inputId, 'out', gateId, 'in-1'), targetPinId: '' }] }), /^Wire target pin must be a nonempty identifier/);
});

void test('schema and scale errors avoid echoing arbitrary source identifiers and show percentages', () => {
	const data = labelled();
	readable(() => parse({ ...data, [missingId]: true }), /contains an unsupported field/);
	readable(() => parse({ ...data, schemaVersion: missingId }), /^Unsupported circuit schema version\. This plugin supports versions 1 and 2\.$/);
	readable(() => parse({ ...data, schemaVersion: { id: missingId } }), /^Unsupported circuit schema version\. This plugin supports versions 1 and 2\.$/);
	readable(() => parse({ ...data, schemaVersion: 3 }), /schema version: 3/);
	readable(() => parse({ ...data, view: { preferredScale: 0.1 } }), /scale must be between 25% and 300%/);
});
