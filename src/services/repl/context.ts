export type ReplProviderContext = {
  cwd?: string
  continue?: boolean
  resume?: string | boolean
  resumeSessionAt?: string
  forkSession?: boolean
  userSpecifiedModel?: string
}
