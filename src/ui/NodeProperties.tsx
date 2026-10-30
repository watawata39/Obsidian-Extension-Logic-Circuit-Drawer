import { useId, useLayoutEffect, useRef, useSyncExternalStore, type SyntheticEvent } from 'react';
import { countRemovedConnections, createId } from '../model/circuit';
import { CONTROL_PIN_LABELS, MAX_PINS, MAX_PIN_LABEL_LENGTH } from '../model/components';
import type { BlockPin, CircuitData, CircuitNode, ControlPin, NodeType, SequentialOptions } from '../model/types';
import { AccessibleButton } from './accessibility';
import { candidateForPropertyDraft, type PropertyDraft, type PropertyDraftStore } from './property-drafts';

const LATCH_TYPES: { value: NodeType; label: string }[] = [
	{ value: 'sr-latch', label: 'SR latch' }, { value: 'd-latch', label: 'D latch' },
];
const FF_TYPES: { value: NodeType; label: string }[] = [
	{ value: 'd-ff', label: 'D flip-flop' }, { value: 'jk-ff', label: 'JK flip-flop' }, { value: 't-ff', label: 'T flip-flop' },
];

/** Keep property edits local until Apply makes a single circuit history entry. */
interface PropertiesProps {
	node: CircuitNode;
	circuit: CircuitData;
	store: PropertyDraftStore;
	apply: (node: CircuitNode) => void;
	close: () => void;
}
export function NodeProperties(props: PropertiesProps) {
	const state = useSyncExternalStore(props.store.subscribe, props.store.getSnapshot);
	return state ? <PropertiesPanel {...props} state={state} /> : null;
}

function PropertiesPanel({ circuit, store, state, apply, close }: PropertiesProps & { state: PropertyDraft }) {
	const { draft, count, error } = state;
	const setDraft = (value: CircuitNode | ((current: CircuitNode) => CircuitNode)) => store.update({ draft: typeof value === 'function' ? value(draft) : value });
	const setCount = (count: string) => store.update({ count });
	const setError = (error: string) => store.update({ error });
	const panel = useRef<HTMLDivElement>(null);
	const title = useId();
	const countId = useId();
	const labelId = useId();
	const typeId = useId();
	const edgeId = useId();
	const custom = draft.type === 'custom';
	const latch = LATCH_TYPES.some(type => type.value === draft.type);
	const ff = FF_TYPES.some(type => type.value === draft.type);
	const sequential = latch || ff;
	const options = draft.sequential ?? {};
	const setOptions = (patch: Partial<SequentialOptions>) => setDraft(current => {
		const sequential = { ...current.sequential, ...patch };
		if (sequential.preset === undefined) delete sequential.preset;
		if (sequential.clear === undefined) delete sequential.clear;
		return { ...current, sequential };
	});
	const candidate = candidateForPropertyDraft(state);
	const emptyCustom = custom && !(draft.pins?.inputs.length || draft.pins?.outputs.length);
	let removed = 0;
	try { if (candidate) removed = countRemovedConnections(circuit, candidate); } catch { /* Report invalid fields when applied. */ }

	useLayoutEffect(() => {
		const element = panel.current;
		if (!element) return;
		const document = element.ownerDocument;
		const previous = document.activeElement;
		const focusFirst = () => (element.querySelector<HTMLElement>('input,select,textarea,button') ?? element).focus({ preventScroll: true });
		focusFirst();
		const containFocus = (event: FocusEvent) => { if (event.target && !element.contains(event.target as Node)) focusFirst(); };
		document.addEventListener('focusin', containFocus);
		return () => {
			document.removeEventListener('focusin', containFocus);
			if (previous && 'focus' in previous && previous.isConnected) (previous as HTMLElement).focus({ preventScroll: true });
			else element.closest<HTMLElement>('.logic-circuit')?.focus({ preventScroll: true });
		};
	}, []);

	const submit = (event: SyntheticEvent<HTMLFormElement>) => {
		event.preventDefault();
		if (!candidate) {
			setError(emptyCustom ? 'Add at least one input or output.' : !custom && !sequential
				? `Enter a whole input count between 2 and ${MAX_PINS}.` : 'Check the component properties.');
			return;
		}
		try { apply(candidate); }
		catch (reason) { setError(reason instanceof Error ? reason.message : 'The properties could not be applied.'); }
	};
	const changeType = (type: NodeType) => setDraft(current => {
		const next = { ...current, type };
		if (type === 'sr-latch' && next.sequential) {
			const { enableActiveLow: _enable, ...remaining } = next.sequential;
			next.sequential = remaining;
		}
		return next;
	});
	const setPins = (direction: 'inputs' | 'outputs', pins: BlockPin[]) => setDraft(current => ({
		...current, pins: { inputs: current.pins?.inputs ?? [], outputs: current.pins?.outputs ?? [], [direction]: pins },
	}));

	return <div className="logic-properties-backdrop" onPointerDown={event => event.stopPropagation()} onMouseDown={event => event.stopPropagation()} onClick={event => event.stopPropagation()} onDoubleClick={event => event.stopPropagation()} onContextMenu={event => event.stopPropagation()}>
		<div className="logic-properties" role="dialog" aria-modal="true" aria-labelledby={title} ref={panel} tabIndex={-1} onKeyDown={event => {
			event.stopPropagation();
			if (event.key === 'Escape') { event.preventDefault(); close(); return; }
			if (event.key !== 'Tab') return;
			const targets = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),[tabindex="0"]'));
			const first = targets[0];
			const last = targets.at(-1);
			const active = event.currentTarget.ownerDocument.activeElement;
			if (event.shiftKey && active === first) { event.preventDefault(); last?.focus(); }
			else if (!event.shiftKey && active === last) { event.preventDefault(); first?.focus(); }
		}}>
			<form onSubmit={submit}>
				<h3 id={title}>Properties</h3>
				{!custom && !sequential && <label className="logic-properties-field" htmlFor={countId}>Input count
					<input id={countId} type="number" min={2} max={MAX_PINS} step={1} value={count} onChange={event => { setCount(event.target.value); setError(''); }} />
				</label>}
				{custom && <>
					<label className="logic-properties-field" htmlFor={labelId}>Center label
						<textarea id={labelId} rows={2} maxLength={200} value={draft.label ?? ''} onChange={event => setDraft(current => ({ ...current, label: event.target.value }))} />
					</label>
					<div className="logic-properties-pin-columns">
						<PinList name="Inputs" pins={draft.pins?.inputs ?? []} change={pins => setPins('inputs', pins)} />
						<PinList name="Outputs" pins={draft.pins?.outputs ?? []} change={pins => setPins('outputs', pins)} />
					</div>
				</>}
				{sequential && <>
					<label className="logic-properties-field" htmlFor={typeId}>Type
						<select id={typeId} value={draft.type} onChange={event => changeType(event.target.value as NodeType)}>
							{(latch ? LATCH_TYPES : FF_TYPES).map(type => <option key={type.value} value={type.value}>{type.label}</option>)}
						</select>
					</label>
					<label className="logic-properties-check"><input type="checkbox" checked={options.showInvertedOutput !== false} onChange={event => setOptions({ showInvertedOutput: event.target.checked })} />Show Q̅ output</label>
					{draft.type === 'd-latch' && <label className="logic-properties-check"><input type="checkbox" checked={options.enableActiveLow ?? false} onChange={event => setOptions({ enableActiveLow: event.target.checked })} />Active-low enable</label>}
					{ff && <>
						<label className="logic-properties-field" htmlFor={edgeId}>Clock edge
							<select id={edgeId} value={options.clockEdge ?? 'rising'} onChange={event => setOptions({ clockEdge: event.target.value as 'rising' | 'falling' })}><option value="rising">Rising edge</option><option value="falling">Falling edge</option></select>
						</label>
						<ControlSettings name="Preset" defaultLabel={CONTROL_PIN_LABELS.preset} value={options.preset} change={value => setOptions({ preset: value })} />
						<ControlSettings name="Clear/reset" defaultLabel={CONTROL_PIN_LABELS.clear} value={options.clear} change={value => setOptions({ clear: value })} />
					</>}
				</>}
				{removed > 0 && <p className="logic-properties-warning" role="status">Applying these properties will remove {removed} {removed === 1 ? 'wire' : 'wires'}.</p>}
				{error && <p className="logic-properties-warning" role="alert">{error}</p>}
				<div className="logic-properties-actions"><button type="button" onClick={close}>Cancel</button><button type="submit" className="logic-done">Apply</button></div>
			</form>
		</div>
	</div>;
}

function PinList({ name, pins, change }: { name: string; pins: BlockPin[]; change: (pins: BlockPin[]) => void }) {
	const heading = useId();
	const move = (index: number, offset: -1 | 1) => {
		const next = [...pins];
		const pin = next[index];
		const other = next[index + offset];
		if (!pin || !other) return;
		next[index] = other; next[index + offset] = pin; change(next);
	};
	return <fieldset className="logic-properties-pins" aria-labelledby={heading}>
		<legend id={heading}>{name}</legend>
		{pins.map((pin, index) => <PinRow key={pin.id} pin={pin} name={`${name === 'Inputs' ? 'Input' : 'Output'} ${index + 1}`} index={index} total={pins.length}
			change={label => change(pins.map(item => item.id === pin.id ? { ...item, label } : item))}
			move={offset => move(index, offset)} remove={() => change(pins.filter(item => item.id !== pin.id))} />)}
		<button type="button" disabled={pins.length >= MAX_PINS} onClick={() => change([...pins, { id: createId(), label: `${name === 'Inputs' ? 'In' : 'Out'} ${pins.length + 1}` }])}>+ Add {name === 'Inputs' ? 'input' : 'output'}</button>
		{!pins.length && <span className="logic-properties-empty">No {name.toLowerCase()}</span>}
	</fieldset>;
}

function PinRow({ pin, name, index, total, change, move, remove }: {
	pin: BlockPin; name: string; index: number; total: number; change: (label: string) => void; move: (offset: -1 | 1) => void; remove: () => void;
}) {
	const id = useId();
	return <div className="logic-properties-pin-row">
		<label htmlFor={id} className="logic-sr-only">{name} name</label>
		<input id={id} value={pin.label} maxLength={MAX_PIN_LABEL_LENGTH} onChange={event => change(event.target.value)} />
		<AccessibleButton type="button" label={`Move ${name.toLowerCase()} up`} title="Move up" disabled={index === 0} onClick={() => move(-1)}>↑</AccessibleButton>
		<AccessibleButton type="button" label={`Move ${name.toLowerCase()} down`} title="Move down" disabled={index === total - 1} onClick={() => move(1)}>↓</AccessibleButton>
		<AccessibleButton type="button" label={`Remove ${name.toLowerCase()}`} title="Remove pin" onClick={remove}>×</AccessibleButton>
	</div>;
}

function ControlSettings({ name, defaultLabel, value, change }: {
	name: string; defaultLabel: string; value: ControlPin | undefined; change: (value: ControlPin | undefined) => void;
}) {
	return <fieldset className="logic-properties-control">
		<legend><label className="logic-properties-check"><input type="checkbox" checked={Boolean(value)} onChange={event => change(event.target.checked ? { label: defaultLabel, activeLow: false } : undefined)} />{name}</label></legend>
		{value && <label className="logic-properties-check"><input type="checkbox" checked={value.activeLow} onChange={event => change({ ...value, activeLow: event.target.checked })} />Active-low</label>}
	</fieldset>;
}
