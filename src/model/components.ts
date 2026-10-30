import type { CircuitNode, GateType, NodeShape, NodeType, Position, SequentialType } from './types';
import { createId } from './id';

export const MAX_PINS = 32;
export const MAX_PIN_LABEL_LENGTH = 40;
export const CONTROL_PIN_LABELS = { preset: 'PRE', clear: 'CLR' } as const;
export const GATE_TYPES: readonly GateType[] = ['and', 'or', 'not', 'nand', 'nor', 'xor', 'xnor'];
export const SEQUENTIAL_TYPES: readonly SequentialType[] = ['sr-latch', 'd-latch', 'd-ff', 'jk-ff', 't-ff'];

export interface PinDefinition { id: string; label: string; activeLow?: boolean; clock?: boolean }
export function isGateType(type: NodeType): type is GateType { return (GATE_TYPES as readonly string[]).includes(type); }
export function isSequential(type: NodeType): type is SequentialType { return (SEQUENTIAL_TYPES as readonly string[]).includes(type); }
export function isFlipFlop(type: NodeType): boolean { return type === 'd-ff' || type === 'jk-ff' || type === 't-ff'; }
export function isBlockType(type: NodeType): boolean { return type === 'custom' || isSequential(type); }
export function isConfigurable(node: NodeShape): boolean { return isBlockType(node.type) || isGateType(node.type) && node.type !== 'not'; }
export function requiresV2(node: NodeShape): boolean {
	return isBlockType(node.type) || node.inputCount !== undefined || node.pins !== undefined || node.sequential !== undefined;
}

/** IDs are independent from labels and from pin order. */
export function pinDefinitions(node: NodeShape): { inputs: PinDefinition[]; outputs: PinDefinition[] } {
	const pin = (id: string, label = ''): PinDefinition => ({ id, label });
	if (node.type === 'custom') return { inputs: node.pins?.inputs ?? [], outputs: node.pins?.outputs ?? [] };
	if (node.type === 'input') return { inputs: [], outputs: [pin('out')] };
	if (node.type === 'output') return { inputs: [pin('in-1')], outputs: [] };
	if (isSequential(node.type)) {
		const options = node.sequential;
		const inputs = node.type === 'sr-latch' ? [pin('s', 'S'), pin('r', 'R')]
			: node.type === 'jk-ff' ? [pin('j', 'J'), pin('k', 'K')]
				: node.type === 't-ff' ? [pin('t', 'T')] : [pin('d', 'D')];
		if (node.type === 'd-latch') inputs.push({ ...pin('enable', 'EN'), activeLow: options?.enableActiveLow ?? false });
		if (isFlipFlop(node.type)) {
			inputs.push({ ...pin('clock', 'CLK'), clock: true, activeLow: options?.clockEdge === 'falling' });
			if (options?.preset) inputs.push({ ...options.preset, id: 'preset', label: CONTROL_PIN_LABELS.preset });
			if (options?.clear) inputs.push({ ...options.clear, id: 'clear', label: CONTROL_PIN_LABELS.clear });
		}
		const outputs = [pin('q', 'Q')];
		if (options?.showInvertedOutput !== false) outputs.push({ ...pin('q-bar', 'Q̅'), activeLow: true });
		return { inputs, outputs };
	}
	const count = node.type === 'not' || node.type === 'junction' ? 1 : node.inputCount ?? 2;
	return { inputs: Array.from({ length: count }, (_, index) => pin(`in-${index + 1}`)), outputs: [pin('out')] };
}

export function pinsFor(value: NodeType | NodeShape): { inputs: string[]; outputs: string[] } {
	const pins = pinDefinitions(typeof value === 'string' ? { type: value } : value);
	return { inputs: pins.inputs.map(pin => pin.id), outputs: pins.outputs.map(pin => pin.id) };
}

export function createNode(type: NodeType, position: Position, label?: string): CircuitNode {
	const node: CircuitNode = { id: createId(), type, position: { ...position } };
	if (type === 'input' || type === 'output') { if (label !== undefined) node.label = label; }
	if (type === 'custom') {
		node.label = label ?? 'Block';
		node.pins = {
			inputs: [{ id: createId(), label: 'A' }, { id: createId(), label: 'B' }],
			outputs: [{ id: createId(), label: 'Y' }],
		};
	}
	return node;
}
