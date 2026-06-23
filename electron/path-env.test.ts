import { describe, it, expect, beforeEach, vi } from 'vitest'

vi.mock('node:child_process', () => ({ execFileSync: vi.fn() }))
vi.mock('node:fs', () => ({ existsSync: vi.fn(), readdirSync: vi.fn() }))
vi.mock('node:os', () => ({ homedir: () => '/home/test' }))

import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync } from 'node:fs'
import { fixPathEnv } from './path-env'

const exec = vi.mocked(execFileSync)
const exists = vi.mocked(existsSync)
const readdir = vi.mocked(readdirSync)

beforeEach(() => {
  vi.clearAllMocks()
  process.env.SHELL = '/bin/zsh'
  exists.mockReturnValue(false) // no known bin dirs by default
  readdir.mockImplementation(() => {
    throw new Error('no nvm')
  })
})

describe('fixPathEnv', () => {
  it('merges the login-shell PATH, prepending new dirs and deduping', () => {
    process.env.PATH = '/usr/bin:/bin'
    exec.mockReturnValue('SHLVL=1\nPATH=/home/test/.nvm/bin:/usr/bin:/usr/local/bin\nTERM=xterm')

    fixPathEnv()

    expect(process.env.PATH).toBe('/home/test/.nvm/bin:/usr/bin:/usr/local/bin:/bin')
    expect(exec).toHaveBeenCalledWith('/bin/zsh', ['-ilc', 'env'], expect.objectContaining({ encoding: 'utf8' }))
  })

  it('falls through to the next shell when one fails', () => {
    process.env.PATH = '/usr/bin'
    exec
      .mockImplementationOnce(() => {
        throw new Error('zsh broken')
      })
      .mockReturnValueOnce('PATH=/from/bash')
    fixPathEnv()
    expect(process.env.PATH).toBe('/from/bash:/usr/bin')
    expect(exec).toHaveBeenCalledTimes(2)
  })

  it('adds installed nvm node bins even when the shell trick yields nothing', () => {
    process.env.PATH = '/usr/bin'
    exec.mockReturnValue('NO_PATH_HERE=1')
    exists.mockImplementation((p) => String(p).includes('.nvm/versions/node'))
    readdir.mockReturnValue(['v20.0.0', 'v25.8.1'] as never)

    fixPathEnv()

    expect(process.env.PATH).toContain('/home/test/.nvm/versions/node/v25.8.1/bin')
    expect(process.env.PATH).toContain('/home/test/.nvm/versions/node/v20.0.0/bin')
  })

  it('leaves PATH usable when everything fails', () => {
    process.env.PATH = '/usr/bin'
    exec.mockImplementation(() => {
      throw new Error('no shell')
    })
    fixPathEnv()
    expect(process.env.PATH).toBe('/usr/bin')
  })
})
