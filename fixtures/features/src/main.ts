import './global-imported.css'
import styles from './button.module.css'
import data, { list } from './data.json'
import rawText from './text.txt?raw'
import squareUrl from './assets/square.svg?url'
import dotInline from './assets/dot.svg'
import { add, Color, Calc, mul, mathNs, type Point } from './reexport'
import multiply from './math'
import Anon from './anon'
import { getB } from './circular-a'
import cjs, { greet } from './cjs-lib.cjs'
import babelDefault, { named } from './cjs-esmodule.js'
import { count, inc } from './counter'
import { whoAmI } from './this-check'
import clsx from 'clsx'
import dayjs from 'dayjs'

declare const process: { env: Record<string, string | undefined> }

const results: Record<string, boolean> = {}
const check = (name: string, condition: unknown) => {
  results[name] = Boolean(condition)
}

check('env.MODE', import.meta.env.MODE === 'production')
check('env.PROD/DEV', import.meta.env.PROD === true && import.meta.env.DEV === false)
check('env.VITE_ var', import.meta.env.VITE_GREETING === 'hello from .env')
check('env.NORU_ var', import.meta.env.NORU_FEATURE === 'on')
check('env secret not leaked', import.meta.env.SECRET_KEY === undefined)
check('env object', typeof import.meta.env === 'object' && import.meta.env.BASE_URL === '/')
check('process.env.NODE_ENV', process.env.NODE_ENV === 'production')
if (import.meta.env.DEV) {
  console.log('DEV_ONLY_MARKER')
}
check('css module', styles.primary && styles.big.split(' ').length === 2 && styles.big.includes(styles.primary))
check('json default', data.name === 'noru')
check('json named', Array.isArray(list) && list.length === 3)
check('?raw', rawText.trim() === 'hello raw text')
check('?url', squareUrl.startsWith('/assets/square-') && squareUrl.endsWith('.svg'))
check('small asset inlined', dotInline.startsWith('data:image/svg+xml;base64,'))
check('re-export named', add(2, 3) === 5)
check('re-export default as', mul(2, 3) === 6 && multiply(4, 5) === 20)
check('re-export namespace', mathNs.add(1, 1) === 2)
check('ts enum', Color.Red === 0 && Color[1] === 'Green')
check('ts class param property', new Calc(2).double() === 4)
check('anonymous default class', new Anon().hello() === 'anon')
const point: Point = { x: 1, y: 2 }
check('type-only import', point.x + point.y === 3)
check('circular imports', getB() === 'b uses a: A')
check('cjs default', cjs.greet('x') === 'hi x')
check('cjs named', greet('y') === 'hi y')
check('__esModule interop', babelDefault === 'babel-default' && named === 'n')
inc()
inc()
check('live bindings', count === 2)
check('imported fn has no this', whoAmI() === undefined)
check('npm: clsx', clsx('a', { b: true, c: false }) === 'a b')
check('npm: dayjs (UMD)', dayjs('2024-01-15').format('YYYY/MM/DD') === '2024/01/15')
const rootStyle = getComputedStyle(document.documentElement)
check('css from index.html', rootStyle.getPropertyValue('--noru-global').trim() === 'yes')
check('css @import', rootStyle.getPropertyValue('--noru-reset').trim() === 'yes')
check('css imported from js', rootStyle.getPropertyValue('--noru-js').trim() === 'yes')
check('css url() asset', getComputedStyle(document.body).backgroundImage.includes('data:image/svg+xml'))

import('./lazy').then((mod) => {
  check('dynamic import', mod.lazyValue === 42)
  const failed = Object.keys(results).filter((k) => !results[k])
  document.getElementById('results')!.textContent = JSON.stringify({ failed, results }, null, 1)
  document.title = failed.length === 0 ? 'PASS' : 'FAIL'
})
