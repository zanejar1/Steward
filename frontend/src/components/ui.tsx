'use client';
import { ReactNode, useEffect, useRef } from 'react';
import { X } from 'lucide-react';
import { Status } from '@/lib/types';
import { useSteward } from './store';
export function Badge({ status }: { status: Status }) { return <span className={`badge ${status.toLowerCase()}`}><span className="dot"/>{status}</span>; }
export function PageHeading({ eyebrow, title, description, action }: { eyebrow: string; title: string; description: string; action?: ReactNode }) { return <div className="page-heading"><div><p className="eyebrow">{eyebrow}</p><h1>{title}</h1><p className="muted">{description}</p></div>{action}</div>; }
export function Modal({ title, children, close }: { title: string; children: ReactNode; close: () => void }) {
 const ref = useRef<HTMLDialogElement>(null);
 const { notice, clearNotice, busy, stage } = useSteward();
 useEffect(() => { const dialog = ref.current; clearNotice(); dialog?.showModal(); return () => dialog?.close(); }, [clearNotice]);
 return <dialog ref={ref} className="modal" aria-label={title} onCancel={close} onClick={e => { if (e.target === e.currentTarget) close(); }}><div className="modal-heading"><h2>{title}</h2><button className="icon-button" aria-label="Close dialog" onClick={close}><X size={20}/></button></div>{notice?.error && <p className="form-error" role="alert">{notice.text}</p>}{busy && <p className="form-note" role="status">Transaction in progress: {stage}. Complete any signature request in Freighter.</p>}{children}</dialog>;
}
