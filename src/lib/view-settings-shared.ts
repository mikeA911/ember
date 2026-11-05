// Shared by the server loader and the calm view components.
export type ViewScene = 'ember' | 'dusk' | 'mist' | 'plain' | 'photo'
export type SavedView = { scene: ViewScene; dim: number; soften: number; photoUrl: string | null }
