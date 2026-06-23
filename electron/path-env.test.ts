import { describe, it, expect, beforeEach, vi } from 'vitest'

vi.mock('node:child_process', () => ({ execFileSync: vi.fn() }))

import { execFileSync } from 'node:child_process'
import { fixPathEnv } from './path-env'

const mocked = vi.mocked(execFileSync)

beforeEach(() => {
  vi.clearAllMocks()
  process.env.SHELL = '/bin/zsh'
})

describe('fixPathEnv', () => {
  it('merges the login-shell PATH into process.env, prepending new dirs and deduping', () => {
    process.env.PATH = '/usr/bin:/bin'
    mocked.mockReturnValue('SHLVL=1\nPATH=/home/u/.nvm/bin:/usr/bin:/usr/local/bin\nTERM=xterm')

    fixPathEnv()

    expect(process.env.PATH).toBe('/home/u/.nvm/bin:/usr/bin:/usr/local/bin:/bin')
    expect(mocked).toHaveBeenCalledWith('/bin/zsh', ['-ilc', 'env'], expect.objectContaining({ encoding: 'utf8' }))
  })

  it('leaves PATH untouched when the shell output has no PATH line', () => {
    process.env.PATH = '/usr/bin'
    mocked.mockReturnValue('SHLVL=1\nTERM=xterm')
    fixPathEnv()
    expect(process.env.PATH).toBe('/usr/bin')
  })

  it('leaves PATH untouched when the shell call throws', () => {
    process.env.PATH = '/usr/bin'
    mocked.mockImplementation(() => {
      throw new Error('no shell')
    })
    fixPathEnv()
    expect(process.env.PATH).toBe('/usr/bin')
  })
})
