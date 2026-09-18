export function ShareUnavailable({ message }: { message: string }) {
  return (
    <main className="mx-auto flex min-h-screen max-w-xl flex-col items-center justify-center gap-3 p-8 text-center">
      <h1 className="text-lg font-medium">分享不可用</h1>
      <p className="text-sm text-neutral-500">{message}</p>
    </main>
  )
}
