import type { CircuitSession } from '../integration/session';
import { replaceNode } from '../model/circuit';
import { isConfigurable, isGateType, MAX_PINS, requiresV2 } from '../model/components';
import type { CircuitData, CircuitNode } from '../model/types';
import { validateNode } from '../model/validation';

export interface PropertyDraft {
	nodeId: string;
	draft: CircuitNode;
	count: string;
	error: string;
}

const copyNode = (node: CircuitNode): CircuitNode => JSON.parse(JSON.stringify(node)) as CircuitNode;

/** The preview and Apply must use exactly the same valid component configuration. */
export function candidateForPropertyDraft(state: PropertyDraft | null): CircuitNode | null {
	if (!state || state.nodeId !== state.draft.id || !isConfigurable(state.draft)) return null;
	try {
		let candidate = state.draft;
		if (isGateType(candidate.type)) {
			const count = Number(state.count);
			if (!state.count.trim() || !Number.isInteger(count) || count < 2 || count > MAX_PINS) return null;
			// Keep an untouched legacy gate in version 1 instead of introducing an
			// explicit default inputCount simply by opening and applying Properties.
			if (count !== (candidate.inputCount ?? 2)) candidate = { ...candidate, inputCount: count };
		}
		if (candidate.type === 'custom' && !(candidate.pins?.inputs?.length || candidate.pins?.outputs?.length)) return null;
		return validateNode(candidate, requiresV2(candidate) ? 2 : 1);
	}
	catch { return null; }
}

/** Derive visible nodes and wires without changing session data, notes or history. */
export function previewCircuitForProperties(circuit: CircuitData, state: PropertyDraft | null): CircuitData {
	const candidate = candidateForPropertyDraft(state);
	if (!candidate) return circuit;
	const original = circuit.nodes.find(node => node.id === candidate.id);
	if (!original || JSON.stringify(original) === JSON.stringify(candidate)) return circuit;
	try { return replaceNode(circuit, candidate); }
	catch { return circuit; }
}

/** Transient property edits survive native widget replacement without note writes. */
export class PropertyDraftStore {
	private snapshot: PropertyDraft | null = null;
	private readonly listeners = new Set<() => void>();
	constructor(private readonly session: CircuitSession) {
		// CircuitSession owns this listener and clears it when disposed. The
		// WeakMap below lets the session and its store be collected together.
		session.subscribe(() => {
			const state = session.getSnapshot();
			if (!state.editing || state.conflict) this.close();
		});
	}
	getSnapshot = (): PropertyDraft | null => this.snapshot;
	subscribe = (listener: () => void): (() => void) => {
		this.listeners.add(listener);
		return () => { this.listeners.delete(listener); };
	};
	open = (node: CircuitNode): void => {
		const state = this.session.getSnapshot();
		if (!state.editing || state.conflict || !state.circuit?.nodes.some(item => item.id === node.id)) return;
		this.snapshot = { nodeId: node.id, draft: copyNode(node), count: String(node.inputCount ?? 2), error: '' };
		this.publish();
	};
	close = (): void => {
		if (!this.snapshot) return;
		this.snapshot = null;
		this.publish();
	};
	update = (patch: Partial<Omit<PropertyDraft, 'nodeId'>>): void => {
		if (!this.snapshot) return;
		const current = this.snapshot;
		const next: PropertyDraft = {
			nodeId: current.nodeId,
			draft: patch.draft ? copyNode(patch.draft) : current.draft,
			count: patch.count ?? current.count,
			error: patch.error ?? current.error,
		};
		if (next.draft === current.draft && next.count === current.count && next.error === current.error) return;
		this.snapshot = next;
		this.publish();
	};
	private publish(): void { for (const listener of this.listeners) listener(); }
}

const stores = new WeakMap<CircuitSession, PropertyDraftStore>();
export function getPropertyDraftStore(session: CircuitSession): PropertyDraftStore {
	let store = stores.get(session);
	if (!store) { store = new PropertyDraftStore(session); stores.set(session, store); }
	return store;
}
