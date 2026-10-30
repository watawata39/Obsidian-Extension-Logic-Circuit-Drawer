export type GateType = 'and' | 'or' | 'not' | 'nand' | 'nor' | 'xor' | 'xnor';
export type SequentialType = 'sr-latch' | 'd-latch' | 'd-ff' | 'jk-ff' | 't-ff';
export type NodeType = GateType | SequentialType | 'custom' | 'input' | 'output' | 'junction';

export interface Position { x: number; y: number }

export interface BlockPin { id: string; label: string }
// Keep the saved label field for schema compatibility; control names render as PRE/CLR.
export interface ControlPin { label: string; activeLow: boolean }
export interface SequentialOptions {
	showInvertedOutput?: boolean;
	clockEdge?: 'rising' | 'falling';
	enableActiveLow?: boolean;
	preset?: ControlPin;
	clear?: ControlPin;
}

export interface CircuitNode {
	id: string;
	type: NodeType;
	position: Position;
	label?: string;
	inputCount?: number;
	pins?: { inputs: BlockPin[]; outputs: BlockPin[] };
	sequential?: SequentialOptions;
}

export type NodeShape = Pick<CircuitNode, 'type' | 'label' | 'inputCount' | 'pins' | 'sequential'>;

export interface CircuitEdge {
	id: string;
	sourceNodeId: string;
	sourcePinId: string;
	targetNodeId: string;
	targetPinId: string;
}

export interface CircuitData {
	schemaVersion: 1 | 2;
	circuitId: string;
	nodes: CircuitNode[];
	edges: CircuitEdge[];
	view: { preferredScale: number };
}
