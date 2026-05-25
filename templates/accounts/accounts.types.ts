export interface Account {
  id: string
  email: string
  createdAt: string
}

export interface AccountProfile extends Account {
  displayName: string | null
  avatarUrl: string | null
}
