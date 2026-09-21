import type { ButtonHTMLAttributes, ReactNode, Ref } from 'react';
import { formatMinorUnits } from './locale.js';

/**
 * The component set 03-DESIGN-SYSTEM requires. Every component is presentational: none fetches,
 * and none decides permission. `PermissionGate` hides a control the actor cannot use, but the
 * server re-checks every call — hiding a button is not protection (02-IDENTITY).
 *
 * States are explicit rather than implied. A list renders Skeleton while loading, EmptyState when
 * there is nothing, ErrorState when a read failed, and never an empty div for any of the three.
 */

export type Tone = 'neutral' | 'success' | 'warning' | 'danger' | 'info';

/** Status is never colour alone (03): each tone carries a glyph announced to assistive tech. */
const toneIcon: Record<Tone, string> = { neutral: '•', success: '✓', warning: '!', danger: '✕', info: 'i' };

export function VisuallyHidden({ children }: { children: ReactNode }) {
  return <span className="tmk-visually-hidden">{children}</span>;
}

/** Wraps an identifier, email, IBAN or URL so it stays LTR inside Arabic text (03 RTL rules). */
export function Ltr({ children }: { children: ReactNode }) {
  return <bdi className="tmk-ltr">{children}</bdi>;
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'quiet' | 'danger';
  /** Renders a busy state and blocks double submission (20-UI-CONTRACT mutation contract). */
  busy?: boolean;
  busyLabel?: string;
  ref?: Ref<HTMLButtonElement>;
}

export function Button({ variant = 'secondary', busy = false, busyLabel, children, disabled, type = 'button', className, ...rest }: ButtonProps) {
  return (
    <button
      {...rest}
      type={type}
      disabled={disabled || busy}
      aria-busy={busy || undefined}
      className={`tmk-button tmk-button--${variant}${className ? ` ${className}` : ''}`}
    >
      {busy && busyLabel ? busyLabel : children}
    </button>
  );
}

export function StatusBadge({ tone = 'neutral', children, label }: { tone?: Tone; children: ReactNode; label?: string }) {
  return (
    <span className={`tmk-badge tmk-badge--${tone}`}>
      <i className="tmk-badge__icon" aria-hidden="true">{toneIcon[tone]}</i>
      {label ? <VisuallyHidden>{label}</VisuallyHidden> : null}
      {children}
    </span>
  );
}

/**
 * A page-level message. `assertive` is reserved for a failure the person must act on; a decisive
 * notice is not dismissible in a way that could read as success (GLOBAL-17).
 */
export function Notice({ tone = 'info', title, children, live }: { tone?: Tone; title?: string; children: ReactNode; live?: 'polite' | 'assertive' }) {
  return (
    <div className={`tmk-notice tmk-notice--${tone === 'neutral' ? 'info' : tone}`} role={live === 'assertive' ? 'alert' : 'status'} aria-live={live ?? 'polite'}>
      <i className="tmk-notice__icon" aria-hidden="true">{toneIcon[tone]}</i>
      <div className="tmk-notice__body">
        {title ? <strong>{title}</strong> : null}
        {children}
      </div>
    </div>
  );
}

export function Card({ title, headingLevel = 2, children, id }: { title?: ReactNode; headingLevel?: 2 | 3; children: ReactNode; id?: string }) {
  const Heading = headingLevel === 2 ? 'h2' : 'h3';
  return (
    <section className="tmk-card" aria-labelledby={title && id ? `${id}-title` : undefined} id={id}>
      {title ? <Heading className="tmk-card__title" id={id ? `${id}-title` : undefined}>{title}</Heading> : null}
      {children}
    </section>
  );
}

export function PageHeader({ eyebrow, title, lead, actions, dashboard = false }: { eyebrow?: ReactNode; title: ReactNode; lead?: ReactNode; actions?: ReactNode; dashboard?: boolean }) {
  return (
    <header className={`tmk-page-header${dashboard ? ' tmk-page-header--dashboard' : ''}`}>
      {eyebrow ? <p className="tmk-page-header__eyebrow">{eyebrow}</p> : null}
      <h1>{title}</h1>
      {lead ? <p className="tmk-page-header__lead">{lead}</p> : null}
      {actions ? <div className="tmk-page-header__actions">{actions}</div> : null}
    </header>
  );
}

/**
 * Breadcrumbs never name a private object for an actor who may not read it (04-INFORMATION-ARCHITECTURE),
 * so callers pass already-authorised labels.
 */
export function Breadcrumbs({ label, items }: { label: string; items: Array<{ href?: string; text: string }> }) {
  return (
    <nav className="tmk-breadcrumbs" aria-label={label}>
      <ol>
        {items.map((item, index) => (
          <li key={`${item.text}-${index}`}>
            {item.href && index < items.length - 1
              ? <a href={item.href}>{item.text}</a>
              : <span aria-current={index === items.length - 1 ? 'page' : undefined}>{item.text}</span>}
          </li>
        ))}
      </ol>
    </nav>
  );
}

export function Field({ id, label, hint, error, children }: { id: string; label: ReactNode; hint?: ReactNode; error?: ReactNode; children: (props: { id: string; 'aria-describedby'?: string; 'aria-invalid'?: true; className: string }) => ReactNode }) {
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(' ') || undefined;
  return (
    <div className="tmk-field">
      <label className="tmk-field__label" htmlFor={id}>{label}</label>
      {hint ? <span className="tmk-field__hint" id={hintId}>{hint}</span> : null}
      {children({ id, className: 'tmk-field__control', ...(describedBy ? { 'aria-describedby': describedBy } : {}), ...(error ? { 'aria-invalid': true as const } : {}) })}
      {error ? <span className="tmk-field__error" id={errorId}>{error}</span> : null}
    </div>
  );
}

/** A plain text/email/password input wired to Field's accessibility contract. */
export function TextField(props: { id: string; name: string; label: ReactNode; hint?: ReactNode; error?: ReactNode; type?: string; defaultValue?: string; required?: boolean; minLength?: number; maxLength?: number; autoComplete?: string; inputMode?: 'text' | 'email' | 'numeric' | 'tel'; readOnly?: boolean; disabled?: boolean }) {
  const { id, name, label, hint, error, type = 'text', ...rest } = props;
  return (
    <Field id={id} label={label} {...(hint ? { hint } : {})} {...(error ? { error } : {})}>
      {control => <input {...control} {...rest} name={name} type={type} />}
    </Field>
  );
}

export function SelectField({ id, name, label, hint, error, options, defaultValue, required, disabled }: { id: string; name: string; label: ReactNode; hint?: ReactNode; error?: ReactNode; options: Array<{ value: string; text: string; disabled?: boolean }>; defaultValue?: string; required?: boolean; disabled?: boolean }) {
  return (
    <Field id={id} label={label} {...(hint ? { hint } : {})} {...(error ? { error } : {})}>
      {control => (
        <select {...control} name={name} defaultValue={defaultValue} required={required} disabled={disabled}>
          {options.map(option => <option key={option.value} value={option.value} disabled={option.disabled}>{option.text}</option>)}
        </select>
      )}
    </Field>
  );
}

export function Choice({ id, name, value, label, defaultChecked, type = 'checkbox', disabled }: { id: string; name: string; value?: string; label: ReactNode; defaultChecked?: boolean; type?: 'checkbox' | 'radio'; disabled?: boolean }) {
  return (
    <label className="tmk-choice" htmlFor={id}>
      <input id={id} name={name} value={value} type={type} defaultChecked={defaultChecked} disabled={disabled} />
      <span>{label}</span>
    </label>
  );
}

export function Fieldset({ legend, children }: { legend: ReactNode; children: ReactNode }) {
  return <fieldset className="tmk-fieldset"><legend>{legend}</legend>{children}</fieldset>;
}

/**
 * Amounts are integer minor units carried as strings (08-FINANCIAL-SYSTEM) so JavaScript number
 * precision is never involved. Formatting is display only and never feeds a calculation.
 */
export function MoneyAmount({ minor, currency, exponent = 2, locale = 'ar', label }: { minor: string; currency: string; exponent?: number; locale?: string; label?: string }) {
  return (
    <span className="tmk-money" lang={locale}>
      {label ? <VisuallyHidden>{label}</VisuallyHidden> : null}
      <span className="tmk-money__amount">{formatMinorUnits(minor, exponent)}</span>
      <span className="tmk-money__currency">{currency}</span>
    </span>
  );
}

/**
 * A labelled progress bar. The label is mandatory: a bare bar cannot say what it measures, and
 * 03 requires funding progress to sit beside its own definition.
 */
export function ProgressWithLabel({ id, label, valueNow, valueMax, startText, endText }: { id: string; label: string; valueNow: number; valueMax: number; startText: ReactNode; endText: ReactNode }) {
  const safeMax = valueMax > 0 ? valueMax : 1;
  const percent = Math.max(0, Math.min(100, Math.round((valueNow / safeMax) * 100)));
  return (
    <div className="tmk-meter">
      <div className="tmk-meter__track" role="progressbar" id={id} aria-label={label} aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100} aria-valuetext={`${percent}%`}>
        <div className="tmk-meter__fill" style={{ inlineSize: `${percent}%` }} />
      </div>
      <p className="tmk-meter__labels"><span>{startText}</span><span>{endText}</span></p>
    </div>
  );
}

export function Stat({ label, value, note }: { label: ReactNode; value: ReactNode; note?: ReactNode }) {
  return (
    <div className="tmk-stat">
      <p className="tmk-stat__label">{label}</p>
      <p className="tmk-stat__value">{value}</p>
      {note ? <p className="tmk-stat__note">{note}</p> : null}
    </div>
  );
}

export function EmptyState({ title, children, action }: { title: ReactNode; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="tmk-empty">
      <p className="tmk-empty__title">{title}</p>
      {children ? <p className="tmk-empty__body">{children}</p> : null}
      {action}
    </div>
  );
}

/** A failed read. The short request reference lets support correlate without exposing internals. */
export function ErrorState({ title, children, requestId, onRetry, retryLabel }: { title: ReactNode; children?: ReactNode; requestId?: string; onRetry?: ReactNode; retryLabel?: string }) {
  return (
    <div className="tmk-error-state" role="alert">
      <p className="tmk-error-state__title">{title}</p>
      {children ? <p className="tmk-error-state__body">{children}</p> : null}
      {requestId ? <p className="tmk-error-state__reference">{retryLabel ? `${retryLabel} ` : ''}<Ltr>{requestId}</Ltr></p> : null}
      {onRetry}
    </div>
  );
}

export function Skeleton({ lines = 3, label }: { lines?: number; label: string }) {
  return (
    <div role="status" aria-live="polite" aria-busy="true">
      <VisuallyHidden>{label}</VisuallyHidden>
      {Array.from({ length: lines }, (_, index) => (
        <div key={index} className="tmk-skeleton" style={{ marginBlockEnd: '12px', inlineSize: index === lines - 1 ? '60%' : '100%' }} />
      ))}
    </div>
  );
}

export interface Column<Row> {
  key: string;
  header: ReactNode;
  /** Right-aligned and tabular; set for every money or count column. */
  numeric?: boolean;
  cell: (row: Row) => ReactNode;
}

/**
 * A data table with a caption, scoped headers and a labelled scroll region, so a wide money table
 * stays reachable at 360px without hiding the amount, status or action (03 responsive rules).
 */
export function DataTable<Row>({ caption, columns, rows, rowKey, emptyState }: { caption: ReactNode; columns: Array<Column<Row>>; rows: Row[]; rowKey: (row: Row) => string; emptyState: ReactNode }) {
  if (!rows.length) return <>{emptyState}</>;
  return (
    <div className="tmk-table-wrap" tabIndex={0} role="region" aria-label={typeof caption === 'string' ? caption : undefined}>
      <table className="tmk-table">
        <caption>{caption}</caption>
        <thead>
          <tr>{columns.map(column => <th key={column.key} scope="col" data-numeric={column.numeric || undefined}>{column.header}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map(row => (
            <tr key={rowKey(row)}>
              {columns.map(column => <td key={column.key} data-numeric={column.numeric || undefined}>{column.cell(row)}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function Timeline({ label, items }: { label: string; items: Array<{ id: string; title: ReactNode; meta?: ReactNode; state?: 'done' | 'active' | 'pending'; body?: ReactNode }> }) {
  return (
    <ol className="tmk-timeline" aria-label={label}>
      {items.map(item => (
        <li className="tmk-timeline__item" key={item.id}>
          <span className={`tmk-timeline__marker${item.state === 'done' ? ' tmk-timeline__marker--done' : item.state === 'active' ? ' tmk-timeline__marker--active' : ''}`} aria-hidden="true" />
          <div>
            <strong>{item.title}</strong>
            {item.meta ? <p className="tmk-timeline__meta">{item.meta}</p> : null}
            {item.body}
          </div>
        </li>
      ))}
    </ol>
  );
}

export function Pagination({ label, statusText, previous, next }: { label: string; statusText: ReactNode; previous?: ReactNode; next?: ReactNode }) {
  return (
    <nav className="tmk-pagination" aria-label={label}>
      <p className="tmk-pagination__status">{statusText}</p>
      <div className="tmk-row__actions">{previous}{next}</div>
    </nav>
  );
}

/**
 * Hides a control the actor has no permission for. Presentation only: it reduces noise and stops
 * a person walking into a guaranteed 403, and it is never the thing that enforces the rule.
 */
export function PermissionGate({ allowed, children, fallback = null }: { allowed: boolean; children: ReactNode; fallback?: ReactNode }) {
  return <>{allowed ? children : fallback}</>;
}

/** Marks a value that is restricted, so a reader can tell redaction from absence. */
export function SensitiveField({ label, children, reason }: { label: ReactNode; children?: ReactNode; reason?: ReactNode }) {
  return (
    <span>
      <VisuallyHidden>{label}</VisuallyHidden>
      {children ?? <span className="tmk-field__hint">{reason}</span>}
    </span>
  );
}
