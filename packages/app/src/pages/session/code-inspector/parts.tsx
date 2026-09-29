/* SPDX-License-Identifier: MIT */

// The reference's code inspector blocks (.v57-inspector-card, -row, -actions)
// shared by every tool of the Code inspector (ADR-049).

import { Show, type JSX } from "solid-js"

export function Card(props: { title?: JSX.Element; children?: JSX.Element }): JSX.Element {
  return (
    <section data-code-card>
      <Show when={props.title}>
        <h4>{props.title}</h4>
      </Show>
      {props.children}
    </section>
  )
}

/** A .v57-inspector-row: glyph, label (bold when `strong`), trailing meta. */
export function Row(props: {
  glyph: JSX.Element
  label: JSX.Element
  meta?: JSX.Element
  strong?: boolean
  onClick?: () => void
}): JSX.Element {
  const content = () => (
    <>
      <span data-code-glyph>{props.glyph}</span>
      <span data-code-label>{props.strong ? <b>{props.label}</b> : props.label}</span>
      <Show when={props.meta !== undefined}>
        <small>{props.meta}</small>
      </Show>
    </>
  )
  return (
    <Show when={props.onClick} fallback={<div data-code-row>{content()}</div>}>
      <button type="button" data-code-row onClick={() => props.onClick?.()}>
        {content()}
      </button>
    </Show>
  )
}

export function Actions(props: { children: JSX.Element }): JSX.Element {
  return <div data-code-actions>{props.children}</div>
}

/** A greyed control: no backend behind it yet (ADR-047's "visual + greyed"). */
export function Soon(props: { label: string; hint: string; primary?: boolean }): JSX.Element {
  return (
    <button type="button" disabled title={props.hint} data-soon data-primary={props.primary ? "" : undefined}>
      {props.label}
    </button>
  )
}

export function Empty(props: { children: JSX.Element }): JSX.Element {
  return <p data-code-empty>{props.children}</p>
}
