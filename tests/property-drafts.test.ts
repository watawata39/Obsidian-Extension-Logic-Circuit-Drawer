import test from 'node:test';
import assert from 'node:assert/strict';
import { CircuitSession, type SessionHost } from '../src/integration/session';
import type { BlockBaseline, NoteStore } from '../src/integration/note-store';
import { createNode } from '../src/model/components';
import { newCircuit, pinsFor, serializeCircuit } from '../src/model/circuit';
import type { CircuitData } from '../src/model/types';
import { scanCircuitBlocks, updateCircuitBlock } from '../src/storage/blocks';
import { candidateForPropertyDraft, getPropertyDraftStore, previewCircuitForProperties } from '../src/ui/property-drafts';
import { pinPoint, sizeFor } from '../src/ui/geometry';

function setup(circuit: CircuitData = { ...newCircuit(), schemaVersion: 2, nodes: [createNode('custom', { x: 0, y: 0 })] }) {
	const node = circuit.nodes[0]!;
	const memory = { text: `Before\n\`\`\`logic-circuit\n${serializeCircuit(circuit)}\n\`\`\`\nAfter`, writes: 0 };
	const store = {
		read: () => Promise.resolve(memory.text),
		queue: <T>(_file: unknown, action: () => Promise<T>) => action(),
		write: (_file: unknown, _editor: unknown, baseline: BlockBaseline, circuit: CircuitData) => {
			const updated = updateCircuitBlock(memory.text, baseline, circuit);
			memory.text = updated.text; memory.writes++;
			return Promise.resolve(updated.block);
		},
	};
	const host = { file: {}, store: store as unknown as NoteStore, activate: () => Promise.resolve() } as unknown as SessionHost;
	const session = new CircuitSession(host, scanCircuitBlocks(memory.text)[0]!);
	return { node, circuit, memory, session, store: getPropertyDraftStore(session) };
}

void test('property drafts survive replacing their subscribing widget and never change the circuit or note', async () => {
	const { node, circuit, memory, session, store } = setup();
	await session.startEditing();
	const originalNote = memory.text;
	let firstChanges = 0;
	const unmount = store.subscribe(() => { firstChanges++; });
	store.open(node);
	const opened = store.getSnapshot()!;
	assert.notEqual(opened.draft, node);
	assert.notEqual(opened.draft.pins, node.pins);
	const edited = { ...opened.draft, label: 'Adder', pins: { ...opened.draft.pins!, inputs: [...opened.draft.pins!.inputs].reverse() } };
	store.update({ draft: edited, count: '5', error: 'Example validation error' });
	edited.label = 'Caller mutated its object';
	assert.equal(store.getSnapshot()!.draft.label, 'Adder', 'updates retain independent snapshots');
	const retained = store.getSnapshot();
	unmount();
	assert.equal(getPropertyDraftStore(session), store, 'a successor widget finds the same session-owned store');
	assert.equal(getPropertyDraftStore(session).getSnapshot(), retained, 'React external-store reads return the same snapshot until a change');
	assert.equal(retained?.count, '5');
	assert.equal(retained?.error, 'Example validation error');
	assert.deepEqual(retained?.draft.pins?.inputs.map(pin => pin.id), [...node.pins!.inputs].reverse().map(pin => pin.id));
	let nextChanges = 0;
	const releaseNext = getPropertyDraftStore(session).subscribe(() => { nextChanges++; });
	store.update({ error: '' });
	assert.equal(firstChanges, 2, 'the previous widget subscription was cleaned up');
	assert.equal(nextChanges, 1);
	assert.deepEqual(session.getSnapshot().circuit, circuit);
	assert.equal(session.getSnapshot().canUndo, false);
	assert.equal(session.getSnapshot().saving, false);
	assert.equal(session.hasDraft, false);
	assert.equal(memory.writes, 0);
	assert.equal(memory.text, originalNote);
	releaseNext();
});

void test('closing properties discards the draft and reopening starts from the saved node', async () => {
	const { node, session, store, memory } = setup();
	store.open(node);
	assert.equal(store.getSnapshot(), null, 'finished diagrams cannot open property drafts');
	await session.startEditing();
	store.open(node);
	store.update({ draft: { ...node, label: 'Unapplied' }, count: '9', error: 'Invalid' });
	store.close();
	assert.equal(store.getSnapshot(), null);
	store.update({ count: '7' });
	assert.equal(store.getSnapshot(), null);
	store.open(node);
	assert.deepEqual(store.getSnapshot(), { nodeId: node.id, draft: node, count: '2', error: '' });
	assert.equal(memory.writes, 0);
});

void test('finishing a session clears property drafts even when no widget is subscribed', async () => {
	const { node, session, store, memory } = setup();
	await session.startEditing();
	store.open(node);
	store.update({ draft: { ...node, label: 'Unapplied' } });
	await session.finish();
	assert.equal(store.getSnapshot(), null);
	await session.startEditing();
	assert.equal(getPropertyDraftStore(session).getSnapshot(), null, 'a later session must not resurrect the old unapplied draft');
	assert.equal(memory.writes, 0);
});

void test('a save-driven session notification preserves an open property draft; a conflict clears it', async () => {
	const { node, circuit, session, store, memory } = setup();
	await session.startEditing();
	store.open(node);
	store.update({ draft: { ...node, label: 'Keep during save' } });
	session.commit({ ...circuit, view: { preferredScale: 1.2 } });
	await session.flush();
	assert.equal(store.getSnapshot()?.draft.label, 'Keep during save');
	assert.equal(memory.writes, 1);
	const block = scanCircuitBlocks(memory.text)[0]!;
	const changed = updateCircuitBlock(memory.text, { circuitId: circuit.circuitId, content: block.content }, { ...circuit, view: { preferredScale: 1.5 } });
	session.observe(changed.block);
	assert.equal(session.getSnapshot().conflict, true);
	assert.equal(store.getSnapshot(), null);
	store.open(node);
	assert.equal(store.getSnapshot(), null, 'a conflicted circuit cannot start another properties draft');
});

void test('live gate previews share the Apply candidate and leave session data and history unchanged', async () => {
	const gate = createNode('and', { x: 80, y: 32 });
	const original: CircuitData = { ...newCircuit(), nodes: [gate] };
	const { circuit, memory, session, store } = setup(original);
	await session.startEditing();
	store.open(gate);
	assert.equal(previewCircuitForProperties(circuit, store.getSnapshot()), circuit, 'unchanged properties preserve the original circuit reference');
	assert.equal(candidateForPropertyDraft(store.getSnapshot())?.inputCount, undefined, 'an unchanged legacy gate keeps its omitted default');
	const originalNote = memory.text;
	store.update({ count: '5' });
	const candidate = candidateForPropertyDraft(store.getSnapshot())!;
	const preview = previewCircuitForProperties(circuit, store.getSnapshot());
	assert.equal(candidate.inputCount, 5);
	assert.deepEqual(preview.nodes[0], candidate);
	assert.equal(preview.schemaVersion, 2);
	assert.equal(pinsFor(preview.nodes[0]).inputs.length, 5);
	assert.notDeepEqual(pinPoint(preview.nodes[0], 'out'), pinPoint(gate, 'out'), 'the preview output follows the resized symbol');
	assert.ok(sizeFor(preview.nodes[0]).height > sizeFor(gate).height);
	assert.deepEqual(session.getSnapshot().circuit, original);
	assert.equal(memory.text, originalNote);
	assert.equal(memory.writes, 0);
	assert.equal(session.getSnapshot().canUndo, false);
	assert.equal(session.getSnapshot().saving, false);
	store.close();
	assert.equal(previewCircuitForProperties(circuit, store.getSnapshot()), circuit, 'Cancel immediately returns the original circuit');
});

void test('invalid live property drafts retain the original preview instead of generating invalid geometry', async () => {
	const gate = createNode('xor', { x: 0, y: 0 });
	const { circuit, store, session } = setup({ ...newCircuit(), nodes: [gate] });
	await session.startEditing();
	store.open(gate);
	for (const count of ['', ' ', '1', '2.5', '33', 'Infinity', 'text']) {
		store.update({ count });
		assert.equal(candidateForPropertyDraft(store.getSnapshot()), null, `reject invalid count ${JSON.stringify(count)}`);
		assert.equal(previewCircuitForProperties(circuit, store.getSnapshot()), circuit);
	}
	const custom = createNode('custom', { x: 0, y: 0 });
	const empty = { nodeId: custom.id, draft: { ...custom, pins: { inputs: [], outputs: [] } }, count: '2', error: '' };
	assert.equal(candidateForPropertyDraft(empty), null);
	assert.equal(previewCircuitForProperties(circuit, empty), circuit);
	assert.equal(candidateForPropertyDraft({ ...empty, draft: { ...custom, label: 'x'.repeat(201) } }), null);
	assert.equal(candidateForPropertyDraft({ ...empty, nodeId: 'different-node', draft: custom }), null);
	assert.equal(previewCircuitForProperties(circuit, { ...empty, draft: custom }), circuit, 'a draft for a removed node cannot create a preview node');
});

void test('custom preview renames and reorders pins with rerouted endpoints without touching saved connections', async () => {
	const { node, circuit, memory, session, store } = setup();
	await session.startEditing();
	store.open(node);
	const firstPin = node.pins!.inputs[0]!;
	const originalPoint = pinPoint(node, firstPin.id);
	const originalNode = JSON.stringify(node);
	store.update({ draft: { ...node, label: 'A longer live preview label', pins: { ...node.pins!, inputs: [...node.pins!.inputs].reverse().map(pin => pin.id === firstPin.id ? { ...pin, label: 'Renamed' } : pin) } } });
	const preview = previewCircuitForProperties(circuit, store.getSnapshot());
	const visibleNode = preview.nodes[0]!;
	assert.equal(visibleNode.label, 'A longer live preview label');
	assert.equal(visibleNode.pins!.inputs[1]!.id, firstPin.id);
	assert.equal(visibleNode.pins!.inputs[1]!.label, 'Renamed');
	assert.notDeepEqual(pinPoint(visibleNode, firstPin.id), originalPoint);
	assert.equal(JSON.stringify(node), originalNode);
	assert.equal(memory.writes, 0);
	assert.equal(session.getSnapshot().canUndo, false);
});

void test('removing a preview output temporarily hides its branch wires; Cancel restores the saved circuit', async () => {
	const custom = createNode('custom', { x: 0, y: 0 });
	custom.pins!.outputs.push({ id: 'extra-output', label: 'Carry' });
	const junction = createNode('junction', { x: 320, y: 32 });
	const output = createNode('output', { x: 480, y: 32 }, 'Y');
	const original: CircuitData = { ...newCircuit(), schemaVersion: 2, nodes: [custom, junction, output], edges: [
		{ id: 'trunk', sourceNodeId: custom.id, sourcePinId: 'extra-output', targetNodeId: junction.id, targetPinId: 'in-1' },
		{ id: 'branch', sourceNodeId: junction.id, sourcePinId: 'out', targetNodeId: output.id, targetPinId: 'in-1' },
	] };
	const { circuit, session, store, memory } = setup(original);
	await session.startEditing();
	store.open(custom);
	store.update({ draft: { ...custom, pins: { ...custom.pins!, outputs: custom.pins!.outputs.filter(pin => pin.id !== 'extra-output') } } });
	const preview = previewCircuitForProperties(circuit, store.getSnapshot());
	assert.equal(preview.edges.length, 0);
	assert.ok(!preview.nodes.some(node => node.type === 'junction'));
	assert.equal(circuit.edges.length, 2);
	assert.equal(circuit.nodes.length, 3);
	assert.deepEqual(session.getSnapshot().circuit, original);
	assert.equal(memory.writes, 0);
	assert.equal(session.getSnapshot().canUndo, false);
	store.close();
	const cancelled = previewCircuitForProperties(circuit, store.getSnapshot());
	assert.equal(cancelled, circuit);
	assert.deepEqual(cancelled, original);
});
