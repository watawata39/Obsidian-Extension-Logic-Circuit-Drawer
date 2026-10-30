import type { CircuitData, CircuitEdge, CircuitNode, Position } from './types';
import { CircuitValidationError, pinsFor, validateCircuit, validateNode } from './validation';
import { requiresV2 } from './components';
import { createId } from './id';
export { createId } from './id';
export { CircuitValidationError, pinsFor, MIN_SCALE, MAX_SCALE, MAX_LABEL_LENGTH, MAX_POSITION, MAX_NODES, MAX_EDGES } from './validation';

export function newCircuit(scale = 1): CircuitData {
	return validateCircuit({ schemaVersion: 1, circuitId: createId(), nodes: [], edges: [], view: { preferredScale: scale } });
}

export function parseCircuit(json: string): CircuitData {
	let value: unknown;
	try { value = JSON.parse(json); }
	catch { throw new CircuitValidationError('Circuit data is not valid JSON. Open Source mode to correct the original block.'); }
	return validateCircuit(value);
}

export function serializeCircuit(data: CircuitData): string { return JSON.stringify(validateCircuit(data), null, 2); }

export function connect(data: CircuitData, sourceNodeId: string, sourcePinId: string, targetNodeId: string, targetPinId: string): CircuitData {
	const source = data.nodes.find(node => node.id === sourceNodeId);
	const target = data.nodes.find(node => node.id === targetNodeId);
	if (!source || !target) throw new CircuitValidationError('This connection is no longer available.');
	if (pinsFor(source).inputs.includes(sourcePinId) && pinsFor(target).outputs.includes(targetPinId)) {
		return connect(data, targetNodeId, targetPinId, sourceNodeId, sourcePinId);
	}
	const result = { ...data, edges: [...data.edges, { id: createId(), sourceNodeId, sourcePinId, targetNodeId, targetPinId }] };
	return validateCircuit(result);
}

function nearbyEndpointJunction(data: CircuitData, edge: CircuitEdge, position: Position): CircuitNode | undefined {
	return data.nodes
		.filter(node => node.type === 'junction' && (node.id === edge.sourceNodeId || node.id === edge.targetNodeId))
		.map(node => ({ node, distance: Math.hypot(node.position.x - position.x, node.position.y - position.y) }))
		.filter(candidate => candidate.distance <= 12)
		.sort((a, b) => a.distance - b.distance)[0]?.node;
}

/** Add one movable routing point without creating another signal branch. */
export function insertJunction(data: CircuitData, edgeId: string, position: Position): CircuitData {
	const original = data.edges.find(edge => edge.id === edgeId);
	if (!original) throw new CircuitValidationError('The wire no longer exists.');
	const junction = validateNode({ id: createId(), type: 'junction', position: { ...position } }, data.schemaVersion);
	if (nearbyEndpointJunction(data, original, position)) {
		validateCircuit(data);
		return data;
	}
	return validateCircuit({
		...data, nodes: [...data.nodes, junction],
		edges: [
			...data.edges.map(edge => edge.id === edgeId ? { ...edge, targetNodeId: junction.id, targetPinId: 'in-1' } : edge),
			{ ...original, id: createId(), sourceNodeId: junction.id, sourcePinId: 'out' },
		],
	});
}

export function branchEdge(data: CircuitData, edgeId: string, position: Position, targetNodeId: string, targetPinId: string): CircuitData {
	const original = data.edges.find(edge => edge.id === edgeId);
	if (!original) throw new CircuitValidationError('The wire no longer exists.');
	if (!Number.isFinite(position.x) || !Number.isFinite(position.y)) throw new CircuitValidationError('Junction position must be finite.');
	// Endpoint branches reuse the actual junction rather than adding coincident dots.
	const existing = nearbyEndpointJunction(data, original, position);
	if (existing) return connect(data, existing.id, 'out', targetNodeId, targetPinId);
	const junction: CircuitNode = { id: createId(), type: 'junction', position: { ...position } };
	const result: CircuitData = {
		...data, nodes: [...data.nodes, junction],
		edges: [
			...data.edges.map(edge => edge.id === edgeId ? { ...edge, targetNodeId: junction.id, targetPinId: 'in-1' } : edge),
			{ ...original, id: createId(), sourceNodeId: junction.id, sourcePinId: 'out' },
			{ id: createId(), sourceNodeId: junction.id, sourcePinId: 'out', targetNodeId, targetPinId },
		],
	};
	return validateCircuit(result);
}

function cleanupJunctions(data: CircuitData): CircuitData {
	let result = data;
	for (;;) {
		const incoming = new Set(result.edges.map(edge => edge.targetNodeId));
		const outgoing = new Set(result.edges.map(edge => edge.sourceNodeId));
		const invalid = new Set(result.nodes.filter(node => node.type === 'junction' && (!incoming.has(node.id) || !outgoing.has(node.id))).map(node => node.id));
		if (!invalid.size) return result;
		result = { ...result, nodes: result.nodes.filter(node => !invalid.has(node.id)), edges: result.edges.filter(edge => !invalid.has(edge.sourceNodeId) && !invalid.has(edge.targetNodeId)) };
	}
}

/** Replace a component and remove only wires whose pins no longer exist. */
export function replaceNode(data: CircuitData, replacement: CircuitNode): CircuitData {
	if (!data.nodes.some(node => node.id === replacement.id)) throw new CircuitValidationError('This component is no longer available.');
	const schemaVersion = data.schemaVersion === 2 || requiresV2(replacement) ? 2 : 1;
	// Validate configuration before examining pins, so malformed counts cannot
	// allocate unbounded arrays or silently remove existing connections.
	const checked = validateNode(replacement, schemaVersion);
	const pins = pinsFor(checked);
	const edges = data.edges.filter(edge => (edge.sourceNodeId !== checked.id || pins.outputs.includes(edge.sourcePinId))
		&& (edge.targetNodeId !== checked.id || pins.inputs.includes(edge.targetPinId)));
	return validateCircuit(cleanupJunctions({ ...data, schemaVersion, nodes: data.nodes.map(node => node.id === checked.id ? checked : node), edges }));
}

export function countRemovedConnections(data: CircuitData, replacement: CircuitNode): number {
	return data.edges.length - replaceNode(data, replacement).edges.length;
}

export function deleteElements(data: CircuitData, nodeIds: string[], edgeIds: string[]): CircuitData {
	const deletedNodes = new Set(nodeIds);
	const deletedEdges = new Set(edgeIds);
	const nodes = new Map(data.nodes.map(node => [node.id, node]));
	const retainedEdges = data.edges.filter(edge => !deletedEdges.has(edge.id));
	const incoming = new Map(retainedEdges.map(edge => [edge.targetNodeId, edge]));
	function sourceFor(edge: CircuitEdge): { nodeId: string; pinId: string } | null {
		let nodeId = edge.sourceNodeId;
		let pinId = edge.sourcePinId;
		const visited = new Set<string>();
		while (deletedNodes.has(nodeId)) {
			if (nodes.get(nodeId)?.type !== 'junction' || visited.has(nodeId)) return null;
			visited.add(nodeId);
			const parent = incoming.get(nodeId);
			if (!parent) return null;
			nodeId = parent.sourceNodeId;
			pinId = parent.sourcePinId;
		}
		return { nodeId, pinId };
	}
	const edges: CircuitEdge[] = [];
	for (const edge of retainedEdges) {
		if (deletedNodes.has(edge.targetNodeId)) continue;
		const source = sourceFor(edge);
		if (source) edges.push({ ...edge, sourceNodeId: source.nodeId, sourcePinId: source.pinId });
	}
	const result = cleanupJunctions({ ...data, nodes: data.nodes.filter(node => !deletedNodes.has(node.id)), edges });
	return validateCircuit(result);
}
