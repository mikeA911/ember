import { useId, type ReactNode } from 'react'

// A small "?" that explains a control on hover -- and on keyboard focus,
// since the trigger is a real button (tab to it and the text shows). CSS-only
// (group-hover / group-focus-within), so it works from server and client
// components alike. The popup is pointer-events-none: it can overlap the
// controls below it and must never swallow a click meant for them. The text
// is wired to the button with aria-describedby, so screen readers read it
// without hovering.
export function HelpTip({ children, label = 'More information' }: { children: ReactNode; label?: string }) {
  const tooltipId = useId()
  return (
    <span className="group relative inline-flex align-middle">
      <button
        type="button"
        aria-label={label}
        aria-describedby={tooltipId}
        className="flex h-4 w-4 items-center justify-center rounded-full border border-zinc-400 text-[10px] font-semibold leading-none text-zinc-500 hover:border-zinc-600 hover:text-zinc-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-zinc-400"
      >
        ?
      </button>
      <span
        id={tooltipId}
        role="tooltip"
        className="pointer-events-none invisible absolute left-1/2 top-full z-20 mt-1.5 w-72 max-w-[80vw] -translate-x-1/2 rounded-md border border-zinc-200 bg-white p-2.5 text-xs font-normal normal-case leading-relaxed tracking-normal text-zinc-700 opacity-0 shadow-lg transition-opacity group-focus-within:visible group-focus-within:opacity-100 group-hover:visible group-hover:opacity-100"
      >
        {children}
      </span>
    </span>
  )
}
