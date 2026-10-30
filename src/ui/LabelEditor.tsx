import { useAccessibleLabel } from './accessibility';

/** Shared keyboard behavior for terminal and custom-block labels. */
export function LabelEditor({ type, draft, change, confirm, cancel }: {
	type: string; draft: string; change: (value: string) => void; confirm: () => void; cancel: () => void;
}) {
	const name = useAccessibleLabel(`Edit ${type} label`);
	return <>{name.label}<textarea autoFocus className="logic-label-input nodrag nopan nowheel" value={draft} maxLength={200} rows={1} aria-labelledby={name.id} onChange={event => change(event.target.value)} onBlur={confirm} onPointerDown={event => event.stopPropagation()} onKeyDown={event => {
		event.stopPropagation();
		const circuit = event.currentTarget.closest<HTMLElement>('.logic-circuit');
		if (event.key === 'Enter') { event.preventDefault(); confirm(); circuit?.focus({ preventScroll: true }); }
		if (event.key === 'Escape') { event.preventDefault(); cancel(); circuit?.focus({ preventScroll: true }); }
	}} /></>;
}
