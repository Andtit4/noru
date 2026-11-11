import Image from 'next/image'
import { Counter } from '@/components/Counter'

export default function Home() {
  return (
    <section>
      <h1 id="title" className="text-[rgb(10,20,30)] font-bold">
        Home page
      </h1>
      <p id="greeting">{process.env.NEXT_PUBLIC_GREETING}</p>
      <p id="secret">{typeof process.env.SECRET_TOKEN}</p>
      <Image id="logo" src="/logo.svg" alt="logo" width={32} height={32} priority />
      <Counter />
      <div id="brand" className="brand-border">
        brand
      </div>
    </section>
  )
}
