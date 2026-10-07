'use client'

import { useState } from 'react'

interface Tab {
  id: string
  label: string
  content: React.ReactNode
}

export function AdminTabs({ tabs }: { tabs: Tab[] }) {
  const [active, setActive] = useState(tabs[0]?.id)

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap gap-1 border-b border-zinc-200">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActive(tab.id)}
            aria-current={active === tab.id}
            className={`border-b-2 px-3 py-2 text-sm font-medium ${
              active === tab.id
                ? 'border-zinc-900 text-zinc-900'
                : 'border-transparent text-zinc-500 hover:text-zinc-700'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>
      {tabs.map((tab) => (
        <div key={tab.id} hidden={active !== tab.id}>
          {tab.content}
        </div>
      ))}
    </div>
  )
}
