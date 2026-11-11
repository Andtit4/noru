import { notFound } from 'next/navigation'

type Props = { params: Promise<{ slug: string }> }

// A server component that loads its data: runs in the browser with noru.
async function getPost(slug: string) {
  await new Promise((resolve) => setTimeout(resolve, 300))
  if (slug === 'missing') return null
  return { title: `Post: ${slug}` }
}

export async function generateMetadata({ params }: Props) {
  const { slug } = await params
  return { title: `Blog ${slug}` }
}

export default async function BlogPost({ params }: Props) {
  const { slug } = await params
  const post = await getPost(slug)
  if (!post) notFound()
  return (
    <article>
      <h1 id="title">{post.title}</h1>
    </article>
  )
}
