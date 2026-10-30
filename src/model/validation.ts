import type { BlockPin, CircuitData, CircuitEdge, CircuitNode, ControlPin, NodeType, SequentialOptions } from './types';
import { isFlipFlop, isGateType, isSequential, MAX_PIN_LABEL_LENGTH, MAX_PINS, pinsFor, SEQUENTIAL_TYPES } from './components';
export { pinsFor } from './components';

export const MIN_SCALE = 0.25;
export const MAX_SCALE = 3;
export const MAX_LABEL_LENGTH = 200;
// Keep malformed source from overflowing layout arithmetic or exhausting the renderer.
export const MAX_POSITION = 10_000;
export const MAX_NODES = 1_000;
export const MAX_EDGES = 5_000;
const LEGACY_NODE_TYPES: readonly string[] = ['and', 'or', 'not', 'nand', 'nor', 'xor', 'xnor', 'input', 'output', 'junction'];
const NODE_TYPES: readonly string[] = [...LEGACY_NODE_TYPES, ...SEQUENTIAL_TYPES, 'custom'];

export class CircuitValidationError extends Error {
	constructor(message: string) { super(message); this.name = 'CircuitValidationError'; }
}

function fail(message: string): never { throw new CircuitValidationError(message); }

function record(value: unknown, name: string, keys: string[]): Record<string, unknown> {
	if (value === null || typeof value !== 'object' || Array.isArray(value)) fail(`${name} must be an object.`);
	const result = value as Record<string, unknown>;
	for (const key of Object.keys(result)) if (!keys.includes(key)) fail(`${name} contains an unsupported field.`);
	return result;
}

function id(value: unknown, name: string): string {
	if (typeof value !== 'string' || !value.trim() || value.length > 200) fail(`${name} must be a nonempty identifier of at most 200 characters.`);
	return value;
}

function finite(value: unknown, name: string): number {
	if (typeof value !== 'number' || !Number.isFinite(value)) fail(`${name} must be a finite number.`);
	return value;
}

function coordinate(value: unknown, name: string): number {
	const result = finite(value, name);
	if (Math.abs(result) > MAX_POSITION) fail(`${name} must be between -${MAX_POSITION} and ${MAX_POSITION}.`);
	return result;
}

function text(value: unknown, name: string, maximum: number): string {
	if (typeof value !== 'string' || value.length > maximum) fail(`${name} must be text of at most ${maximum} characters.`);
	return value;
}

function boolean(value: unknown, name: string): boolean {
	if (typeof value !== 'boolean') fail(`${name} must be true or false.`);
	return value;
}

function customPins(value: unknown): { inputs: BlockPin[]; outputs: BlockPin[] } {
	const item = record(value, 'Custom block pins', ['inputs', 'outputs']);
	const seen = new Set<string>();
	const list = (value: unknown): BlockPin[] => {
		if (!Array.isArray(value) || value.length > MAX_PINS) fail(`Custom block pin lists must contain at most ${MAX_PINS} pins.`);
		return value.map(value => {
			const pin = record(value, 'Pin', ['id', 'label']);
			const pinId = id(pin.id, 'Pin ID');
			if (seen.has(pinId)) fail('Pin identifiers must be unique within a block.');
			seen.add(pinId);
			return { id: pinId, label: text(pin.label, 'Pin label', MAX_PIN_LABEL_LENGTH) };
		});
	};
	const result = { inputs: list(item.inputs), outputs: list(item.outputs) };
	if (!result.inputs.length && !result.outputs.length) fail('Custom blocks must have at least one input or output pin.');
	return result;
}

function sequentialOptions(value: unknown, type: NodeType): SequentialOptions {
	if (!isSequential(type)) fail('Only latches and flip-flops can have sequential options.');
	const item = record(value, 'Sequential options', ['showInvertedOutput', 'clockEdge', 'enableActiveLow', 'preset', 'clear']);
	const result: SequentialOptions = {};
	if ('showInvertedOutput' in item) result.showInvertedOutput = boolean(item.showInvertedOutput, 'Inverted output visibility');
	if ('clockEdge' in item) {
		if (!isFlipFlop(type)) fail('Only flip-flops can have a clock edge.');
		if (item.clockEdge !== 'rising' && item.clockEdge !== 'falling') fail('Clock edge must be rising or falling.');
		result.clockEdge = item.clockEdge;
	}
	if ('enableActiveLow' in item) {
		if (type !== 'd-latch') fail('Only D latches can have an enable polarity.');
		result.enableActiveLow = boolean(item.enableActiveLow, 'Enable polarity');
	}
	const control = (value: unknown): ControlPin => {
		if (!isFlipFlop(type)) fail('Only flip-flops can have preset and clear/reset pins.');
		const pin = record(value, 'Control pin', ['label', 'activeLow']);
		return { label: text(pin.label, 'Control pin label', MAX_PIN_LABEL_LENGTH), activeLow: boolean(pin.activeLow, 'Control pin polarity') };
	};
	if ('preset' in item) result.preset = control(item.preset);
	if ('clear' in item) result.clear = control(item.clear);
	return result;
}

export function validateNode(value: unknown, version: 1 | 2): CircuitNode {
	const name = 'Node';
	const item = record(value, name, version === 1 ? ['id', 'type', 'position', 'label'] : ['id', 'type', 'position', 'label', 'inputCount', 'pins', 'sequential']);
	if (typeof item.type !== 'string' || !(version === 1 ? LEGACY_NODE_TYPES : NODE_TYPES).includes(item.type)) fail(`${name} has an unsupported type.`);
	const type = item.type as NodeType;
	const position = record(item.position, `${name} position`, ['x', 'y']);
	const result: CircuitNode = { id: id(item.id, `${name} ID`), type, position: { x: coordinate(position.x, `${name} x`), y: coordinate(position.y, `${name} y`) } };
	if (Object.prototype.hasOwnProperty.call(item, 'label')) {
		if (type !== 'input' && type !== 'output' && type !== 'custom') fail(`${name}: only Input and Output terminals and custom blocks can have labels.`);
		result.label = text(item.label, `${name} label`, MAX_LABEL_LENGTH);
	}
	if ('inputCount' in item) {
		if (!isGateType(type) || type === 'not') fail('Only gates with multiple inputs can have an input count.');
		if (typeof item.inputCount !== 'number' || !Number.isInteger(item.inputCount) || item.inputCount < 2 || item.inputCount > MAX_PINS) fail(`Gate input count must be a whole number between 2 and ${MAX_PINS}.`);
		result.inputCount = item.inputCount;
	}
	if ('pins' in item || type === 'custom') {
		if (type !== 'custom') fail('Only custom blocks can have configurable pin lists.');
		result.pins = customPins(item.pins);
	}
	if ('sequential' in item) result.sequential = sequentialOptions(item.sequential, type);
	return result;
}

function edge(value: unknown): CircuitEdge {
	const name = 'Wire';
	const item = record(value, name, ['id', 'sourceNodeId', 'sourcePinId', 'targetNodeId', 'targetPinId']);
	return { id: id(item.id, `${name} ID`), sourceNodeId: id(item.sourceNodeId, `${name} source`), sourcePinId: id(item.sourcePinId, `${name} source pin`), targetNodeId: id(item.targetNodeId, `${name} target`), targetPinId: id(item.targetPinId, `${name} target pin`) };
}

export function validateConnections(data: CircuitData): void {
	const nodes = new Map<string, CircuitNode>();
	for (const item of data.nodes) {
		if (nodes.has(item.id)) fail('Node identifiers must be unique.');
		nodes.set(item.id, item);
	}
	const edgeIds = new Set<string>();
	const occupied = new Set<string>();
	const connections = new Set<string>();
	const incoming = new Map<string, CircuitEdge>();
	const outgoing = new Set<string>();
	for (const wire of data.edges) {
		if (edgeIds.has(wire.id)) fail('Wire identifiers must be unique.');
		edgeIds.add(wire.id);
		const source = nodes.get(wire.sourceNodeId);
		const target = nodes.get(wire.targetNodeId);
		if (!source || !target) fail('This connection is no longer available.');
		// Gate feedback is a drawing connection, with the same pin constraints as
		// every other wire. Junction-only cycles are checked separately below.
		if (source.type === 'output') fail('An Output node cannot start a connection.');
		if (target.type === 'input') fail('An output pin cannot be connected to an Input node.');
		if (!pinsFor(source).outputs.includes(wire.sourcePinId)
			|| !pinsFor(target).inputs.includes(wire.targetPinId)) fail('Connect an output pin to an input pin.');
		const connectionKey = JSON.stringify([source.id, wire.sourcePinId, target.id, wire.targetPinId]);
		if (connections.has(connectionKey)) fail('This connection already exists.');
		connections.add(connectionKey);
		const targetKey = JSON.stringify([target.id, wire.targetPinId]);
		if (occupied.has(targetKey)) fail('This input pin is already connected.');
		occupied.add(targetKey);
		if (target.type === 'junction') incoming.set(target.id, wire);
		outgoing.add(source.id);
	}
	// A branch must have a real upstream source; junction-only cycles cannot acquire one.
	const resolved = new Set<string>();
	for (const item of data.nodes) {
		if (item.type !== 'junction') continue;
		if (!incoming.has(item.id)) fail('A junction must have an incoming connection.');
		if (!outgoing.has(item.id)) fail('A junction must have an outgoing connection.');
		const visited = new Set<string>();
		let current: CircuitNode | undefined = item;
		while (current?.type === 'junction' && !resolved.has(current.id)) {
			if (visited.has(current.id)) fail('Junctions cannot form a cycle without a gate or terminal source.');
			visited.add(current.id);
			const upstream = incoming.get(current.id);
			if (!upstream) fail('A junction must have an incoming connection.');
			current = nodes.get(upstream.sourceNodeId);
		}
		for (const junctionId of visited) resolved.add(junctionId);
	}
}

export function validateCircuit(value: unknown): CircuitData {
	const item = record(value, 'Circuit', ['schemaVersion', 'circuitId', 'nodes', 'edges', 'view']);
	if (item.schemaVersion !== 1 && item.schemaVersion !== 2) {
		const version = typeof item.schemaVersion === 'number' && Number.isFinite(item.schemaVersion) ? `: ${item.schemaVersion}` : '';
		fail(`Unsupported circuit schema version${version}. This plugin supports versions 1 and 2.`);
	}
	if (!Array.isArray(item.nodes)) fail('Circuit nodes must be an array.');
	if (!Array.isArray(item.edges)) fail('Circuit wires must be an array.');
	if (item.nodes.length > MAX_NODES) fail(`Circuit contains too many nodes. The supported limit is ${MAX_NODES}.`);
	if (item.edges.length > MAX_EDGES) fail(`Circuit contains too many wires. The supported limit is ${MAX_EDGES}.`);
	const view = record(item.view, 'Circuit view', ['preferredScale']);
	const preferredScale = finite(view.preferredScale, 'Circuit scale');
	if (preferredScale < MIN_SCALE || preferredScale > MAX_SCALE) fail(`Circuit scale must be between ${MIN_SCALE * 100}% and ${MAX_SCALE * 100}%.`);
	const schemaVersion = item.schemaVersion;
	const data: CircuitData = { schemaVersion, circuitId: id(item.circuitId, 'Circuit ID'), nodes: item.nodes.map(value => validateNode(value, schemaVersion)), edges: item.edges.map(edge), view: { preferredScale } };
	validateConnections(data);
	return data;
}
