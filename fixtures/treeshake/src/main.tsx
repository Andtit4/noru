import { createRoot } from 'react-dom/client'
import { debounce, chunk } from 'lodash-es'
import { Camera } from 'lucide-react'
import { usedHelper, fancy } from './lib'
import * as ns from './ns-module'
import { neverCalled } from './pure-unused'
import { Used } from './components'
import './side-effect'
import './static-init'

const results: Record<string, boolean> = {}
const check = (name: string, condition: unknown) => {
  results[name] = Boolean(condition)
}

check('barrel: used helper (+ its own import)', usedHelper('noru') === 'hello NORU')
check('barrel: default re-export', fancy('x') === '*x*')
check('namespace member', ns.onlyThis() === 'ns works')
check('lodash-es chunk', JSON.stringify(chunk([1, 2, 3], 2)) === '[[1,2],[3]]')
check('lodash-es debounce', typeof debounce(() => {}, 10) === 'function')
check('side-effect import kept', (window as any).__sideEffectRan === true)
check('class static side effect kept', (window as any).__staticRan === true)

function App() {
  return (
    <div>
      <Camera data-testid="camera" />
      <Used />
    </div>
  )
}

createRoot(document.getElementById('root')!).render(<App />)

setTimeout(() => {
  check('lucide icon rendered', document.querySelector('svg.lucide-camera') !== null)
  check('used component css applied', getComputedStyle(document.querySelector('.used-component')!).color === 'rgb(0, 128, 0)')
  const failed = Object.keys(results).filter((k) => !results[k])
  document.getElementById('results')!.textContent = JSON.stringify({ failed, results }, null, 1)
  document.title = failed.length === 0 ? 'PASS' : 'FAIL'
}, 50)

// Referenced only in dead code: the import above must not keep the module alive.
if (import.meta.env.DEV) {
  console.log(neverCalled())
}
